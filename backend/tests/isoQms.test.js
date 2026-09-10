const test = require('node:test')
const assert = require('node:assert/strict')
const { mockModule, freshRequire } = require('./_helpers')

function makeDbMock(handlers = {}) {
  const calls = []
  async function query(sql, params = []) {
    calls.push({ sql: String(sql), params })
    if (typeof handlers.query === 'function') {
      return handlers.query(sql, params, calls)
    }
    return { rows: [], rowCount: 0 }
  }
  return { query, calls }
}

test('parseFilenameSuggestions recognizes LIF-QMS codes and CA/MRM/audit patterns', () => {
  const upload = require('../src/services/isoQms/isoUploadService')
  assert.equal(upload.parseFilenameSuggestions('LIF-QMS-M-01 Quality Manual.pdf').documentCode, 'LIF-QMS-M-01')
  assert.equal(upload.parseFilenameSuggestions('LIF-QMS-M-ANX-01C.pdf').documentCode, 'LIF-QMS-M-ANX-01C')
  assert.equal(upload.parseFilenameSuggestions('LIF-QMS-PR-07 Procedure.pdf').documentCode, 'LIF-QMS-PR-07')
  assert.equal(upload.parseFilenameSuggestions('LIF-QMS-FO-05B.xlsx').documentCode, 'LIF-QMS-FO-05B')
  assert.equal(upload.parseFilenameSuggestions('CA-95 Root Cause.docx').documentCode, 'CA-95')
  assert.equal(upload.parseFilenameSuggestions('MRM-02-2024 Minutes.pdf').documentCode, 'MRM-02-2024')
  assert.equal(upload.parseFilenameSuggestions('Audit Schedule 01-2025.pdf').documentCode, 'AUDIT-01-2025')
})

test('validateFileType rejects unsupported extensions', () => {
  const upload = require('../src/services/isoQms/isoUploadService')
  assert.throws(
    () => upload.validateFileType({ fileName: 'malware.exe', contentType: 'application/octet-stream' }),
    /Unsupported file type/
  )
  assert.doesNotThrow(() =>
    upload.validateFileType({ fileName: 'policy.pdf', contentType: 'application/pdf' })
  )
})

test('validateFileSize rejects over 50MB', () => {
  const upload = require('../src/services/isoQms/isoUploadService')
  assert.throws(() => upload.validateFileSize(51 * 1024 * 1024), /File too large/)
  assert.equal(upload.validateFileSize(1024), 1024)
})

test('isoPermissions: auditor cannot edit/approve; warehouse is not auditor', () => {
  const perms = require('../src/services/isoQms/isoPermissions')
  assert.equal(perms.isAuditorRole({ role: 'auditor' }), true)
  assert.equal(perms.canEditIso({ role: 'auditor' }), false)
  assert.equal(perms.canApproveIso({ role: 'auditor' }), false)
  assert.equal(perms.canEditIso({ role: 'warehouse' }), true)
  assert.equal(perms.canDownloadAsAuditor({ auditorDownloadAllowed: true }), true)
  assert.equal(perms.canDownloadAsAuditor({ auditor_download_allowed: false }), false)
  assert.equal(
    perms.auditorAccessActive({
      access_start_date: '2020-01-01',
      access_expiry_date: '2099-01-01',
      revoked_at: null,
    }),
    true
  )
  assert.equal(
    perms.auditorAccessActive({
      access_start_date: '2020-01-01',
      access_expiry_date: '2020-02-01',
      revoked_at: null,
    }),
    false
  )
})

test('filterForAuditor requires publish + Approved/Current', () => {
  const perms = require('../src/services/isoQms/isoPermissions')
  const f = perms.filterForAuditor('d', 0)
  assert.match(f.sql, /publish_to_auditor_room = TRUE/)
  assert.deepEqual(f.params[0], ['Approved', 'Current'])
})

test('validateClosureFields requires root cause, CA details, evidence, effectiveness, verifier+date', () => {
  const findings = require('../src/services/isoQms/isoFindingsService')
  const missing = findings.validateClosureFields({
    rootCause: '',
    correctiveActionDetails: 'fix',
    evidenceNotes: '',
    effectivenessReview: 'ok',
    verifierName: '',
    verifiedAt: null,
  })
  assert.ok(missing.includes('rootCause'))
  assert.ok(missing.includes('evidenceNotes'))
  assert.ok(missing.includes('verifierName'))
  assert.ok(missing.includes('verifiedAt'))
  assert.ok(!missing.includes('correctiveActionDetails'))
  assert.ok(!missing.includes('effectivenessReview'))

  const ok = findings.validateClosureFields({
    rootCause: 'cause',
    correctiveActionDetails: 'action',
    evidenceNotes: 'note',
    effectivenessReview: 'effective',
    verifierName: 'QM',
    verifiedAt: '2026-01-01',
  })
  assert.deepEqual(ok, [])
})

test('activity log insert maps camelCase', async () => {
  const db = makeDbMock({
    query: async () => ({
      rows: [{
        id: 1,
        user_id: 5,
        action: 'document.create',
        entity_type: 'iso_document',
        entity_id: 9,
        version_id: 3,
        previous_value: null,
        new_value: { a: 1 },
        ip: '127.0.0.1',
        user_agent: 'test',
        message: 'hi',
        created_at: new Date('2026-01-01T00:00:00Z'),
      }],
    }),
  })
  mockModule('../src/db', db)
  const activity = freshRequire('../src/services/isoQms/isoActivityLogService')
  const row = await activity.logActivity({
    userId: 5,
    action: 'document.create',
    entityType: 'iso_document',
    entityId: 9,
    versionId: 3,
    newValue: { a: 1 },
    ip: '127.0.0.1',
    userAgent: 'test',
    message: 'hi',
  })
  assert.equal(row.action, 'document.create')
  assert.equal(row.entityType, 'iso_document')
  assert.equal(row.entityId, 9)
  assert.equal(row.userId, 5)
})

test('findByChecksum returns duplicate document info', async () => {
  const db = makeDbMock({
    query: async (sql) => {
      if (String(sql).includes('checksum_sha256')) {
        return {
          rows: [{
            id: 11,
            document_id: 7,
            title: 'Quality Manual',
            document_code: 'LIF-QMS-M-01',
            document_status: 'Current',
            storage_key: 'iso-qms/7/00/abc-file.pdf',
            revision_number: '00',
          }],
        }
      }
      return { rows: [] }
    },
  })
  mockModule('../src/db', db)
  mockModule('../src/services/isoQms/isoExtractionService', {
    queueExtraction() {},
    retryExtraction: async () => null,
  })
  const docs = freshRequire('../src/services/isoQms/isoDocumentService')
  const dup = await docs.findByChecksum('abc123')
  assert.equal(dup.documentId, 7)
  assert.equal(dup.versionId, 11)
  assert.equal(dup.documentCode, 'LIF-QMS-M-01')
})

test('createDocumentWithVersion rejects duplicate checksum', async () => {
  const db = makeDbMock({
    query: async (sql) => {
      if (String(sql).includes('checksum_sha256')) {
        return {
          rows: [{
            id: 1,
            document_id: 2,
            title: 'Existing',
            document_code: 'X',
            document_status: 'Current',
            storage_key: 'iso-qms/2/00/x.pdf',
            revision_number: '00',
          }],
        }
      }
      return { rows: [] }
    },
  })
  mockModule('../src/db', db)
  mockModule('../src/services/isoQms/isoExtractionService', { queueExtraction() {} })
  const docs = freshRequire('../src/services/isoQms/isoDocumentService')
  await assert.rejects(
    () =>
      docs.createDocumentWithVersion(
        { title: 'New' },
        { storageKey: 'iso-qms/new/00/y.pdf', checksumSha256: 'dup' },
        1
      ),
    /Duplicate file checksum/
  )
})

test('uploadNewRevision refuses to create Current status directly', async () => {
  let call = 0
  const db = makeDbMock({
    query: async (sql) => {
      call += 1
      // getDocument path
      if (String(sql).includes('FROM iso_documents d') && String(sql).includes('d.id = $1')) {
        return {
          rows: [{
            id: 5,
            title: 'Proc',
            document_code: 'LIF-QMS-PR-01',
            document_type: 'Procedure',
            status: 'Current',
            revision: '01',
            publish_to_auditor_room: false,
            auditor_download_allowed: false,
            soft_deleted_at: null,
            current_version_id: 10,
            tags: [],
            clause_ids: [],
            clause_numbers: [],
          }],
        }
      }
      if (String(sql).includes('checksum_sha256')) return { rows: [] }
      return { rows: [] }
    },
  })
  mockModule('../src/db', db)
  mockModule('../src/services/isoQms/isoExtractionService', { queueExtraction() {} })
  const docs = freshRequire('../src/services/isoQms/isoDocumentService')
  await assert.rejects(
    () =>
      docs.uploadNewRevision(
        5,
        { storageKey: 'iso-qms/5/02/unique.pdf', originalFilename: 'a.pdf', fileType: 'application/pdf', fileSize: 10 },
        1,
        { status: 'Current' }
      ),
    /must start as Draft/
  )
})

test('approve workflow supersedes previous current versions', async () => {
  const executed = []
  const db = makeDbMock({
    query: async (sql, params) => {
      executed.push(String(sql).replace(/\s+/g, ' ').trim().slice(0, 120))
      if (String(sql).includes('FROM iso_documents d') && String(sql).includes('d.id = $1')) {
        return {
          rows: [{
            id: 5,
            title: 'Proc',
            document_code: 'LIF-QMS-PR-01',
            document_type: 'Procedure',
            status: 'Under Review',
            revision: '02',
            publish_to_auditor_room: false,
            auditor_download_allowed: false,
            soft_deleted_at: null,
            current_version_id: 10,
            tags: [],
            clause_ids: [],
            clause_numbers: [],
          }],
        }
      }
      if (String(sql).includes('FROM iso_document_versions') && String(sql).includes('ORDER BY CASE')) {
        return {
          rows: [{
            id: 20,
            document_id: 5,
            revision_number: '02',
            status: 'Under Review',
            storage_key: 'iso-qms/5/02/x.pdf',
          }],
        }
      }
      return { rows: [{ id: 5 }] }
    },
  })
  mockModule('../src/db', db)
  mockModule('../src/services/isoQms/isoExtractionService', { queueExtraction() {} })
  mockModule('../src/services/isoQms/isoActivityLogService', {
    logActivity: async () => ({}),
    listActivity: async () => [],
  })
  const docs = freshRequire('../src/services/isoQms/isoDocumentService')
  await docs.approve(5, 1, { makeCurrent: true })
  assert.ok(executed.some((s) => s.includes("status = 'Superseded'")))
  assert.ok(executed.some((s) => s.includes('current_version_id')))
})

test('searchIso returns ranked document results with snippets', async () => {
  const db = makeDbMock({
    query: async (sql) => {
      if (String(sql).includes('ts_rank') || String(sql).includes('plainto_tsquery')) {
        return {
          rows: [{
            document_id: 1,
            title: 'Calibration Procedure',
            document_code: 'LIF-QMS-PR-09',
            revision: '01',
            status: 'Current',
            department: 'Maintenance',
            document_type: 'Procedure',
            publish_to_auditor_room: true,
            version_id: 3,
            original_filename: 'cal.pdf',
            extraction_status: 'Completed',
            extracted_text: 'annual calibration of gauges',
            rank: 0.9,
            headline: 'annual <b>calibration</b> of gauges',
          }],
        }
      }
      return { rows: [] }
    },
  })
  mockModule('../src/db', db)
  const search = freshRequire('../src/services/isoQms/isoSearchService')
  const out = await search.searchIso('calibration', {}, { isAuditor: false })
  assert.equal(out.results[0].entityType, 'document')
  assert.match(out.results[0].snippet, /calibration/i)
})

test('auth requirePermission: auditor never gets warehouse bypass; iso_qms write implies view', async () => {
  const auth = require('../src/middleware/auth')
  const { makeReqRes } = require('./_helpers')

  // auditor blocked from leave
  {
    const { req, res } = makeReqRes({ user: { role: 'auditor', permissions: {} } })
    let nextCalled = false
    await new Promise((resolve) => {
      auth.requirePermission('leave', 'view')(req, res, () => {
        nextCalled = true
        resolve()
      })
      // if blocked, resolve shortly
      setImmediate(resolve)
    })
    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 403)
  }

  // employee with iso_qms edit gets view
  {
    const { req, res } = makeReqRes({
      user: { role: 'employee', permissions: { iso_qms: { edit: true } } },
    })
    let nextCalled = false
    auth.requirePermission('iso_qms', 'view')(req, res, () => {
      nextCalled = true
    })
    assert.equal(nextCalled, true)
  }

  // auditor allowed iso_qms view
  {
    const { req, res } = makeReqRes({ user: { role: 'auditor', permissions: {} } })
    let nextCalled = false
    auth.requirePermission('iso_qms', 'view')(req, res, () => {
      nextCalled = true
    })
    assert.equal(nextCalled, true)
  }
})

test('createIsoQmsDocKey produces unique keys under iso-qms/', () => {
  const s3 = require('../src/services/s3Service')
  const a = s3.createIsoQmsDocKey(12, '01', 'Manual.pdf')
  const b = s3.createIsoQmsDocKey(12, '01', 'Manual.pdf')
  assert.match(a, /^iso-qms\/12\/01\//)
  assert.notEqual(a, b)
})

test('updateCorrectiveAction blocks close without required fields', async () => {
  const db = makeDbMock({
    query: async (sql) => {
      if (String(sql).includes('FROM iso_corrective_actions WHERE id')) {
        return {
          rows: [{
            id: 1,
            ca_number: 'CA-01',
            status: 'Open',
            root_cause: null,
            corrective_action_details: null,
            evidence_notes: null,
            effectiveness_review: null,
            verifier_name: null,
            verified_at: null,
          }],
        }
      }
      if (String(sql).includes('iso_corrective_action_updates')) {
        return { rows: [] }
      }
      return { rows: [] }
    },
  })
  mockModule('../src/db', db)
  mockModule('../src/services/isoQms/isoActivityLogService', {
    logActivity: async () => ({}),
  })
  const findings = freshRequire('../src/services/isoQms/isoFindingsService')
  await assert.rejects(
    () => findings.updateCorrectiveAction(1, { status: 'Closed' }, 1),
    /Cannot close CA without/
  )
})
