'use strict'

/**
 * Import of one Mashreq file: parse, refuse anything that cannot be booked safely, then store
 * (file hash + transaction identity idempotency). A refused file is not stored at all, so a
 * corrected export can be imported without leftovers. MSA files are stored as control documents.
 */

const { parseMashreqFile } = require('./posMashreqParser.ts')
const model = require('./posSettlementModel.ts')
const { storeError } = require('./posSettlementStore.ts')

function refused(code: string, message: string, problems: any[]) {
  return Object.assign(storeError(422, code, message), { problems })
}

/**
 * @returns {{ result, file, settlementIds, counts, transactions, warnings }}
 * @throws 422 FILE_REFUSED with `problems` when the file or any row is not safely readable
 */
const OTHER_EXPORT: Record<string, string> = {
  CSV1: 'the csv1 export',
  DETAIL: 'the detailed batch report (TXT)',
  MSA: 'the MSA statement',
}

/**
 * @param input.enrichOnly accept only the Mashreq Enrich CSV (the upload screen); other layouts are
 *   refused with the name of the file to upload instead
 */
async function importPosFile({ buffer, fileName, sourceFormat, store, config, actor, enrichOnly = false }: any) {
  const parsed = parseMashreqFile(buffer, { fileName, sourceFormat, config })
  if (enrichOnly && parsed.mashreqLayout !== 'ENRICH') {
    const what = OTHER_EXPORT[parsed.mashreqLayout] || 'not a Mashreq Enrich CSV'
    throw refused('ENRICH_CSV_ONLY', `${fileName || 'This file'} is ${what}. Upload the Enrich CSV from the Mashreq portal instead (its name ends with _Enrich_csv1.csv).`, [])
  }
  if (parsed.problems.length) throw refused('FILE_REFUSED', `${fileName || 'File'} was not imported: ${parsed.problems.slice(0, 3).map((p: any) => p.message).join(' ')}`, parsed.problems)
  const rowProblems = parsed.transactions.flatMap((t: any) => t.problems.map((p: any) => ({ ...p, sourceRow: t.sourceRow, rrn: t.rrn })))
  if (rowProblems.length) throw refused('FILE_REFUSED', `${fileName || 'File'} was not imported: ${rowProblems.length} row problem(s), e.g. row ${rowProblems[0].sourceRow}: ${rowProblems[0].message}`, rowProblems)
  const dups = model.inFileDuplicates(parsed.transactions)
  if (dups.length) throw refused('FILE_REFUSED', `${fileName || 'File'} was not imported: it lists the same transaction twice (${dups[0].message})`, dups)
  const imported = await store.importFile({ parsed, organizationId: config.organizationId, provider: config.provider, prefix: config.referencePrefix, actor })
  const rowWarnings = parsed.transactions.flatMap((t: any) => (t.warnings || []).map((w: any) => ({ ...w, sourceRow: t.sourceRow })))
  const reused = (imported.transactions || []).filter((t: any) => t.rrnReused).map((t: any) => ({ code: 'RRN_REUSED', message: `RRN ${t.rrn} (row ${t.sourceRow}) was imported before for another terminal/STAN or more than 180 days apart; kept as a separate transaction.`, sourceRow: t.sourceRow }))
  return { ...imported, role: parsed.role, warnings: [...parsed.warnings, ...rowWarnings, ...reused] }
}

module.exports = { importPosFile }
