'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMoneyToFils, allocateProportionally, formatFils, majorToFils } = require('../src/services/posSettlement/posMoney.ts')
const { parseMashreqFile, parseDate, readRrn, normalizeType } = require('../src/services/posSettlement/posMashreqParser.ts')

const config = { dateOrder: 'DMY' as const, headerAliases: null, currency: 'AED', rrnSource: { digits: 12 } }
const parse = (text: string, extra: Record<string, unknown> = {}) => parseMashreqFile(Buffer.from(text, 'utf8'), { fileName: 'test.csv', config: { ...config, ...extra } })

test('money is parsed to integer fils from text, never rounded', () => {
  assert.deepEqual(parseMoneyToFils('330.65'), { ok: true, fils: 33065 })
  assert.equal(parseMoneyToFils('1,234.5').fils, 123450)
  assert.equal(parseMoneyToFils('(6.10)').fils, -610)
  assert.equal(parseMoneyToFils('6.10-').fils, -610)
  assert.equal(parseMoneyToFils('AED 0.31').fils, 31)
  assert.equal(parseMoneyToFils('0.305').ok, false, 'a third non-zero decimal is refused, not rounded')
  assert.equal(parseMoneyToFils('0.300').fils, 30)
  assert.equal(parseMoneyToFils('abc').ok, false)
  assert.equal(majorToFils(324.24), 32424)
  assert.equal(formatFils(-610), '-6.10')
})

test('proportional allocation always adds back to the total exactly', () => {
  assert.deepEqual(allocateProportionally(610, [22780, 10285]), [420, 190])
  assert.deepEqual(allocateProportionally(31, [22780, 10285]), [21, 10])
  const parts = allocateProportionally(1, [1, 1, 1])
  assert.equal(parts.reduce((s: number, x: number) => s + x, 0), 1)
})

test('RRN keeps leading zeros and is never padded or converted', () => {
  assert.deepEqual(readRrn('003042448545', 12), { rrn: '003042448545', problem: null })
  assert.deepEqual(readRrn('="003042448545"', 12), { rrn: '003042448545', problem: null })
  assert.deepEqual(readRrn("'003042448545", 12), { rrn: '003042448545', problem: null })
  assert.match(readRrn('3042448545', 12).problem, /10 digits.*leading zeros/)
  assert.equal(readRrn('3042448545', 12).rrn, '3042448545', 'not padded')
  assert.match(readRrn('3.04245E+09', 12).problem, /scientific notation/)
  assert.match(readRrn('', 12).problem, /blank/)
})

test('dates: DMY by default, ISO, compact, month names, with times', () => {
  assert.deepEqual(parseDate('05/09/2026 14:03', 'DMY'), { date: '2026-09-05', time: '14:03:00' })
  assert.equal(parseDate('05/09/2026', 'MDY').date, '2026-05-09')
  assert.equal(parseDate('2026-09-05T10:00:00', 'DMY').date, '2026-09-05')
  assert.equal(parseDate('20260905', 'DMY').date, '2026-09-05')
  assert.equal(parseDate('05-Sep-2026', 'DMY').date, '2026-09-05')
  assert.equal(parseDate('31/02/2026', 'DMY').date, null)
})

test('transaction types normalise; unknown is flagged', () => {
  assert.equal(normalizeType('Purchase'), 'SALE')
  assert.equal(normalizeType('REFUND'), 'REFUND')
  assert.equal(normalizeType('Void'), 'REVERSAL')
  assert.equal(normalizeType('weird'), 'UNKNOWN')
})

const ENRICH = [
  'Merchant ID,Terminal ID,RRN,STAN,Auth Code,Transaction Type,Transaction Date,Card Type,Transaction Amount,Commission,VAT,Net Amount,Batch No',
  '200600123456,BJ000001,003042448545,000123,A1B2C3,PURCHASE,05/09/2026 13:10,VISA,227.80,4.20,0.21,223.39,0042',
  '200600123456,BJ000001,="003042523578",000124,D4E5F6,PURCHASE,05/09/2026 16:45,MASTERCARD,102.85,1.90,0.10,100.85,0042',
  'Total,,,,,,,,330.65,6.10,0.31,324.24,',
].join('\n')

test('Enrich CSV: headers by alias, RRN as text, amounts in fils, totals reconciled', () => {
  const p = parse(ENRICH)
  assert.deepEqual(p.problems, [])
  assert.equal(p.transactions.length, 2)
  const [a, b] = p.transactions
  assert.equal(a.rrn, '003042448545')
  assert.equal(b.rrn, '003042523578')
  assert.equal(a.merchantId, '200600123456')
  assert.equal(a.terminalId, 'BJ000001')
  assert.equal(a.transactionDate, '2026-09-05')
  assert.equal(a.transactionTime, '13:10:00')
  assert.equal(a.transactionType, 'SALE')
  assert.deepEqual(a.minor, { gross: 22780, commission: 420, otherFees: null, vat: 21, net: 22339 })
  assert.equal(p.totalsRows.length, 1)
  assert.equal(p.fileHash.length, 64)
})

test('a totals row that disagrees with the rows is a file problem', () => {
  const p = parse(ENRICH.replace('330.65,6.10,0.31,324.24', '330.65,6.10,0.31,324.25'))
  assert.ok(p.problems.some((x: any) => x.code === 'TOTALS_NOT_RECONCILED' && x.field === 'netAmount'))
})

test('missing required columns and unknown layouts are refused', () => {
  assert.equal(parse('A,B,C\n1,2,3').problems[0].code, 'HEADERS_NOT_FOUND')
  const p = parse('RRN,STAN,Auth Code,Transaction Date\n003042448545,1,2,05/09/2026')
  assert.ok(p.problems.some((x: any) => x.code === 'MISSING_REQUIRED_HEADER'))
})

test('extra header aliases come from configuration', () => {
  const text = 'REF NO,TXN DT,TXN AMT,MDR,VAT,NET\n003042448545,05/09/2026,227.80,4.20,0.21,223.39'
  assert.equal(parse(text).problems[0].code, 'HEADERS_NOT_FOUND')
  const p = parse(text, { headerAliases: { rrn: ['REF NO'], transactionDate: ['TXN DT'], grossAmount: ['TXN AMT'] } })
  assert.deepEqual(p.problems, [])
  assert.equal(p.transactions[0].rrn, '003042448545')
})

test('pipe-delimited TXT with record markers: H / DT / T split, trailer reconciled', () => {
  const text = [
    'RECORD TYPE|MID|TID|RRN|TRAN DATE|TRAN TYPE|TRAN AMOUNT|COMMISSION|VAT|NET AMOUNT',
    'H|200600123456|||05092026|||||',
    'DT|200600123456|BJ000001|003042448545|05/09/2026|SALE|227.80|4.20|0.21|223.39',
    'DT|200600123456|BJ000001|003042523578|05/09/2026|SALE|102.85|1.90|0.10|100.85',
    'T|||||2|330.65|6.10|0.31|324.24',
  ].join('\n')
  const p = parse(text)
  assert.deepEqual(p.problems, [])
  assert.equal(p.delimiter, '|')
  assert.equal(p.recordMarkers, true)
  assert.equal(p.transactions.length, 2)
  assert.equal(p.headerRecords.length, 1)
  assert.equal(p.trailerRecords.length, 1)
})

test('row problems are reported per row (RRN length, scientific notation, bad amount)', () => {
  const text = 'RRN,Transaction Date,Amount,Commission,VAT,Net\n3042448545,05/09/2026,227.80,4.20,0.21,223.39\n3.04245E+11,05/09/2026,1.00,0,0,1.00\n003042448546,05/09/2026,12.345,0,0,12.34'
  const p = parse(text)
  const codes = p.transactions.map((t: any) => t.problems.map((x: any) => x.code))
  assert.deepEqual(codes[0], ['RRN_FORMAT'])
  assert.deepEqual(codes[1], ['RRN_FORMAT'])
  assert.deepEqual(codes[2], ['AMOUNT_FORMAT'])
})

test('net is derived and flagged when the file has no net column', () => {
  const p = parse('RRN,Transaction Date,Amount,Commission,VAT\n003042448545,05/09/2026,227.80,4.20,0.21')
  assert.equal(p.transactions[0].minor.net, 22339)
  assert.equal(p.transactions[0].netDerived, true)
  assert.ok(p.transactions[0].warnings.some((w: any) => w.code === 'NET_DERIVED'))
})

// ── Real Mashreq merchant-portal exports ────────────────────────────────────

const fs = require('node:fs')
const path = require('node:path')
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'mashreq', name))
const parseFixture = (name: string, sourceFormat = 'ENRICH_CSV') => parseMashreqFile(fixture(name), { fileName: name, sourceFormat, config })
const SEP5 = [
  { rrn: '003042448545', terminalId: '10244324', stan: '119', authCode: '330309', transactionDate: '2026-09-05', transactionTime: '21:29:00', minor: { gross: 22780, commission: 456, otherFees: 0, vat: 23, net: 22301 } },
  { rrn: '003042523578', terminalId: '10244324', stan: '120', authCode: '468081', transactionDate: '2026-09-05', transactionTime: '21:54:00', minor: { gross: 10285, commission: 154, otherFees: 0, vat: 8, net: 10123 } },
]
const essentials = (t: any) => ({ rrn: t.rrn, terminalId: t.terminalId, stan: t.stan, authCode: t.authCode, transactionDate: t.transactionDate, transactionTime: t.transactionTime, minor: t.minor })

test('real Enrich CSV: detected from content, RRN from ARN REFNO, deductions stored as positive charges', () => {
  const p = parseFixture('enrich-2461289.csv', 'SIMPLE_CSV')
  assert.deepEqual(p.problems, [])
  assert.equal(p.sourceFormat, 'ENRICH_CSV', 'the picked format does not matter for a recognised export')
  assert.deepEqual(p.transactions.map(essentials), SEP5)
  const t = p.transactions[0]
  assert.equal(t.transactionType, 'SALE')
  assert.equal(t.merchantId, '001000195592')
  assert.equal(t.settlementId, '2461289', 'settlement reference from the TR record')
  assert.equal(t.settlementDate, '2026-09-05')
  assert.equal(t.cardScheme, 'VISA PREM')
  assert.deepEqual(t.problems, [])
  assert.equal(p.totalsRows.length, 2, 'TR and GT gross / net reconciled')
})

test('real csv1 (no column row) and detailed batch TXT read the same transactions as Enrich', () => {
  for (const name of ['csv1-2461289.csv', 'detail-2461289.txt']) {
    const p = parseFixture(name)
    assert.deepEqual(p.problems, [], name)
    assert.deepEqual(p.transactions.map(essentials), SEP5, name)
    assert.ok(p.transactions.every((t: any) => t.settlementId === '2461289' && t.settlementDate === '2026-09-05' && !t.problems.length), name)
  }
  assert.equal(parseFixture('csv1-2461289.csv').sourceFormat, 'SIMPLE_CSV')
  assert.equal(parseFixture('detail-2461289.txt').sourceFormat, 'DETAIL_TXT')
})

test('real Enrich with two terminals: one settlement, file totals reconciled', () => {
  const p = parseFixture('enrich-2461288.csv')
  assert.deepEqual(p.problems, [])
  assert.equal(p.transactions.length, 4)
  assert.deepEqual([...new Set(p.transactions.map((t: any) => t.terminalId))].sort(), ['10244323', '10244324'])
  assert.ok(p.transactions.every((t: any) => t.settlementId === '2461288'))
  assert.equal(p.transactions.reduce((s: number, t: any) => s + t.minor.net, 0), 266803)
})

test('real MSA statement is detected and stored as a control document with its payment', () => {
  const p = parseFixture('msa-2461289.txt', 'SIMPLE_CSV')
  assert.equal(p.sourceFormat, 'MSA')
  assert.equal(p.role, 'CONTROL')
  assert.deepEqual(p.problems, [])
  assert.match(p.warnings[0].message, /05-SEP-26.*324\.24/)
})

test('real layouts refuse tampered files instead of guessing', () => {
  const enrich = fixture('enrich-2461289.csv').toString('utf8')
  const badNet = parseMashreqFile(Buffer.from(enrich.replace('          330.65,          324.24', '          330.65,          324.25')), { fileName: 'x.csv', config })
  assert.ok(badNet.problems.some((x: any) => x.code === 'TOTALS_NOT_RECONCILED'))
  const lostZeros = parseMashreqFile(Buffer.from(enrich.replace("'003042448545", '3042448545')), { fileName: 'x.csv', config })
  assert.equal(lostZeros.transactions[0].problems[0].code, 'RRN_FORMAT')
  const extraRecord = parseMashreqFile(Buffer.from(`${enrich}\nAD,001000195592,10244324,-49.00\n`), { fileName: 'x.csv', config })
  assert.ok(extraRecord.problems.some((x: any) => x.code === 'UNKNOWN_RECORD'))
  const csv1 = fixture('csv1-2461289.csv').toString('utf8').replace(/,'\r?\nTR/, ",',EXTRA\nTR")
  assert.ok(parseMashreqFile(Buffer.from(csv1), { fileName: 'x.csv', config }).problems.some((x: any) => x.code === 'LAYOUT_CHANGED'))
  const detail = fixture('detail-2461289.txt').toString('utf8').replace('227.80  AED      227.80', '227.81  AED      227.81')
  assert.ok(parseMashreqFile(Buffer.from(detail), { fileName: 'x.txt', config }).problems.some((x: any) => x.code === 'TOTALS_NOT_RECONCILED'))
})

test('MSA files are control documents with no transactions', () => {
  const p = parseMashreqFile(Buffer.from('anything'), { fileName: 'msa.txt', sourceFormat: 'MSA', config })
  assert.equal(p.role, 'CONTROL')
  assert.equal(p.transactions.length, 0)
  assert.deepEqual(p.problems, [])
})
