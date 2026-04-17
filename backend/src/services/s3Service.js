const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const crypto = require('crypto')

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1'
const bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET

/** WHEN_REQUIRED avoids default CRC checksum query params on presigned PUTs (browser uploads can't satisfy them → "Failed to fetch"). */
const s3 = new S3Client({ region, requestChecksumCalculation: 'WHEN_REQUIRED' })

function requireBucket() {
  if (!bucket) {
    const err = new Error('S3_BUCKET (or AWS_S3_BUCKET) is required')
    err.status = 500
    throw err
  }
  return bucket
}

function sanitizeName(name) {
  return String(name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function createSickLeaveKey(employeeId, attendanceDate, fileName) {
  const safe = sanitizeName(fileName)
  return `sick-leave/${employeeId}/${attendanceDate}/${crypto.randomUUID()}-${safe}`
}

function createProfileDocKey(employeeId, docType, fileName) {
  const safe = sanitizeName(fileName)
  return `profile-docs/${employeeId}/${docType}/${crypto.randomUUID()}-${safe}`
}

function createAnnualLeaveLetterKey(leaveId) {
  return `annual-leave-letters/${leaveId}/${crypto.randomUUID()}.pdf`
}

function createTaskAttachmentKey(taskId, fileName) {
  const safe = sanitizeName(fileName)
  return `task-attachments/${taskId}/${crypto.randomUUID()}-${safe}`
}

async function getUploadUrl({ key, contentType, expiresIn = 300 }) {
  const Bucket = requireBucket()
  const command = new PutObjectCommand({
    Bucket,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn })
}

async function getDownloadUrl({ key, expiresIn = 300 }) {
  const Bucket = requireBucket()
  const command = new GetObjectCommand({
    Bucket,
    Key: key,
  })
  return getSignedUrl(s3, command, { expiresIn })
}

async function putObjectBuffer({ key, body, contentType = 'application/pdf' }) {
  const Bucket = requireBucket()
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

/** Download object body as Buffer (for server-side PDF streaming). */
async function getObjectBuffer({ key }) {
  const Bucket = requireBucket()
  const out = await s3.send(new GetObjectCommand({ Bucket, Key: key }))
  if (!out.Body) return null
  if (typeof out.Body.transformToByteArray === 'function') {
    const bytes = await out.Body.transformToByteArray()
    return Buffer.from(bytes)
  }
  const chunks = []
  for await (const chunk of out.Body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function deleteObjectIfExists(key) {
  if (!key) return
  const Bucket = requireBucket()
  const command = new DeleteObjectCommand({
    Bucket,
    Key: key,
  })
  await s3.send(command)
}

module.exports = {
  createSickLeaveKey,
  createProfileDocKey,
  createAnnualLeaveLetterKey,
  createTaskAttachmentKey,
  getUploadUrl,
  getDownloadUrl,
  putObjectBuffer,
  getObjectBuffer,
  deleteObjectIfExists,
}
