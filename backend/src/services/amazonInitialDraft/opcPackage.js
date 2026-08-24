'use strict'

/**
 * Minimal OPC (zip) reader/writer for Amazon flat-file workbooks.
 *
 * Why this exists instead of a zip library: the generator must return the *uploaded*
 * workbook with a single worksheet part rewritten and every other part bit-for-bit
 * identical, including the macro-enabled `vbaProject.bin`. Libraries that decompress
 * and recompress every entry cannot promise that, and ExcelJS cannot even load these
 * templates (see docs/amazon-uae-initial-draft-handoff.md section 9).
 *
 * Untouched entries are copied as their original compressed bytes together with their
 * original local header, so the deflate stream, CRC, timestamps and extra fields all
 * survive. Only a replaced entry is re-deflated.
 */

const zlib = require('zlib')

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50

const LOCAL_HEADER_FIXED = 30
const CENTRAL_HEADER_FIXED = 46
const EOCD_FIXED = 22

const FLAG_DATA_DESCRIPTOR = 0x08
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

const ZIP64_SENTINEL = 0xffffffff

const CRC32_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function findEndOfCentralDirectory(buffer) {
  // The EOCD sits at the tail, followed only by an optional comment (max 65535).
  const earliest = Math.max(0, buffer.length - EOCD_FIXED - 0xffff)
  for (let offset = buffer.length - EOCD_FIXED; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === SIG_EOCD) return offset
  }
  throw new Error('Not a valid workbook package: end-of-central-directory record not found.')
}

/**
 * Parses the package into entries that carry both their metadata and their untouched
 * compressed bytes. The central directory is treated as authoritative for sizes.
 */
function readPackage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < EOCD_FIXED) {
    throw new Error('Not a valid workbook package: file is empty or truncated.')
  }

  const eocdOffset = findEndOfCentralDirectory(buffer)

  if (buffer.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])) !== -1) {
    const probe = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]))
    if (buffer.readUInt32LE(probe) === SIG_EOCD64) {
      throw new Error('Zip64 workbook packages are not supported; the file is unexpectedly large.')
    }
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  const commentLength = buffer.readUInt16LE(eocdOffset + 20)
  const archiveComment = buffer.subarray(eocdOffset + EOCD_FIXED, eocdOffset + EOCD_FIXED + commentLength)

  if (centralOffset === ZIP64_SENTINEL) {
    throw new Error('Zip64 workbook packages are not supported; the file is unexpectedly large.')
  }

  const entries = []
  let cursor = centralOffset

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error(`Corrupt workbook package: central directory entry ${index} has a bad signature.`)
    }

    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const entryCommentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL) {
      throw new Error('Zip64 workbook packages are not supported; the file is unexpectedly large.')
    }
    if (flags & FLAG_DATA_DESCRIPTOR) {
      throw new Error('Streamed (data-descriptor) workbook packages are not supported.')
    }

    const name = buffer.subarray(cursor + CENTRAL_HEADER_FIXED, cursor + CENTRAL_HEADER_FIXED + nameLength).toString('utf8')
    const centralHeaderEnd = cursor + CENTRAL_HEADER_FIXED + nameLength + extraLength + entryCommentLength
    const centralRaw = Buffer.from(buffer.subarray(cursor, centralHeaderEnd))

    if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`Corrupt workbook package: local header for "${name}" has a bad signature.`)
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const localHeaderEnd = localOffset + LOCAL_HEADER_FIXED + localNameLength + localExtraLength
    const localRaw = Buffer.from(buffer.subarray(localOffset, localHeaderEnd))
    const compressedData = Buffer.from(buffer.subarray(localHeaderEnd, localHeaderEnd + compressedSize))

    entries.push({
      name,
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localRaw,
      centralRaw,
      compressedData,
    })

    cursor = centralHeaderEnd
  }

  return { entries, archiveComment }
}

/** Inflates one entry. Stored entries are returned as-is. */
function readEntryContent(entry) {
  if (entry.method === METHOD_STORE) return Buffer.from(entry.compressedData)
  if (entry.method === METHOD_DEFLATE) return zlib.inflateRawSync(entry.compressedData)
  throw new Error(`Workbook part "${entry.name}" uses unsupported compression method ${entry.method}.`)
}

function findEntry(pkg, name) {
  return pkg.entries.find((entry) => entry.name === name) || null
}

function buildLocalHeader(entry, { crc, compressedSize, uncompressedSize }) {
  // Reuse the original header so filename, extra fields, flags, method and the DOS
  // timestamp are preserved exactly; only the three size/checksum fields move.
  const header = Buffer.from(entry.localRaw)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(compressedSize, 18)
  header.writeUInt32LE(uncompressedSize, 22)
  return header
}

function buildCentralHeader(entry, { crc, compressedSize, uncompressedSize, localOffset }) {
  const header = Buffer.from(entry.centralRaw)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(compressedSize, 20)
  header.writeUInt32LE(uncompressedSize, 24)
  header.writeUInt32LE(localOffset, 42)
  return header
}

/**
 * Rebuilds the package, substituting the contents of the named parts.
 * Entry order, compression methods and every untouched byte stream are preserved.
 *
 * @param {object} pkg result of readPackage
 * @param {Map<string, Buffer>} replacements part name -> new uncompressed content
 */
function writePackage(pkg, replacements = new Map()) {
  for (const name of replacements.keys()) {
    if (!findEntry(pkg, name)) {
      throw new Error(`Cannot replace workbook part "${name}": it is not present in the upload.`)
    }
  }

  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const entry of pkg.entries) {
    const replacement = replacements.get(entry.name)

    let data
    let crc
    let uncompressedSize

    if (replacement === undefined) {
      data = entry.compressedData
      crc = entry.crc32
      uncompressedSize = entry.uncompressedSize
    } else {
      crc = crc32(replacement)
      uncompressedSize = replacement.length
      data =
        entry.method === METHOD_STORE
          ? replacement
          : zlib.deflateRawSync(replacement, { level: zlib.constants.Z_DEFAULT_COMPRESSION })
    }

    const local = buildLocalHeader(entry, { crc, compressedSize: data.length, uncompressedSize })
    localChunks.push(local, data)
    centralChunks.push(
      buildCentralHeader(entry, { crc, compressedSize: data.length, uncompressedSize, localOffset: offset })
    )
    offset += local.length + data.length
  }

  const centralDirectory = Buffer.concat(centralChunks)
  const eocd = Buffer.alloc(EOCD_FIXED)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(pkg.entries.length, 8)
  eocd.writeUInt16LE(pkg.entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(pkg.archiveComment.length, 20)

  return Buffer.concat([...localChunks, centralDirectory, eocd, pkg.archiveComment])
}

module.exports = {
  METHOD_DEFLATE,
  METHOD_STORE,
  crc32,
  findEntry,
  readEntryContent,
  readPackage,
  writePackage,
}
