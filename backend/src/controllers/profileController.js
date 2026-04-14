const profileService = require('../services/profileService')
const s3Service = require('../services/s3Service')
const employeesService = require('../services/employeesService')

const VALID_DOC_TYPES = ['passport', 'visa', 'emirates-id', 'photo', 'signature']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]

function resolveEmployeeId(req) {
  const id = parseInt(req.user?.employeeId, 10)
  return Number.isNaN(id) ? null : id
}

async function getMyProfile(req, res) {
  try {
    const employeeId = resolveEmployeeId(req)
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' })

    const profile = await profileService.getFullProfile(employeeId)
    if (!profile) return res.status(404).json({ error: 'Profile not found' })

    res.json(await profileService.attachDocUrls(profile))
  } catch (err) {
    console.error('[profile] getMyProfile error:', err)
    res.status(500).json({ error: 'Failed to load profile' })
  }
}

async function updateMyProfile(req, res) {
  try {
    const employeeId = resolveEmployeeId(req)
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' })
    if (Object.prototype.hasOwnProperty.call(req.body, 'full_name')) {
      const fullName = String(req.body.full_name || '').trim()
      if (!fullName) return res.status(400).json({ error: 'full_name cannot be empty' })
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'alternate_employee_id')) {
      const rawAlt = req.body.alternate_employee_id
      if (rawAlt != null && rawAlt !== '') {
        const altId = parseInt(String(rawAlt), 10)
        if (Number.isNaN(altId) || altId < 1) {
          return res.status(400).json({ error: 'alternate_employee_id must be a valid employee id or null' })
        }
        if (altId === employeeId) {
          return res.status(400).json({ error: 'You cannot select yourself as alternate employee' })
        }
        const alt = await employeesService.findById(altId)
        if (!alt) {
          return res.status(400).json({ error: 'Selected alternate employee does not exist' })
        }
      }
    }

    const updated = await profileService.updateProfile(employeeId, req.body)
    if (!updated) return res.status(404).json({ error: 'Profile not found' })

    res.json(await profileService.attachDocUrls(updated))
  } catch (err) {
    console.error('[profile] updateMyProfile error:', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
}

async function requestDocUploadUrl(req, res) {
  try {
    const employeeId = resolveEmployeeId(req)
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' })

    const { docType, fileName, contentType, fileSize } = req.body

    if (!VALID_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ error: `Invalid docType. Allowed: ${VALID_DOC_TYPES.join(', ')}` })
    }
    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' })
    }
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'File type not allowed. Accepted: JPEG, PNG, WebP, PDF' })
    }
    if (docType === 'signature' && contentType !== 'image/png') {
      return res.status(400).json({ error: 'Signature must be a PNG (.png) file' })
    }
    if (fileSize && Number(fileSize) > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File too large. Maximum 10 MB.' })
    }

    const key = s3Service.createProfileDocKey(employeeId, docType, fileName)
    const uploadUrl = await s3Service.getUploadUrl({ key, contentType })
    res.json({ uploadUrl, key })
  } catch (err) {
    console.error('[profile] requestDocUploadUrl error:', err)
    res.status(500).json({ error: 'Failed to generate upload URL' })
  }
}

async function confirmDocUpload(req, res) {
  try {
    const employeeId = resolveEmployeeId(req)
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' })

    const { docType, key } = req.body
    if (!VALID_DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'Invalid docType' })
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key is required' })

    // Security: key must belong to this employee's profile
    const expectedPrefix = `profile-docs/${employeeId}/${docType}/`
    if (!key.startsWith(expectedPrefix)) {
      return res.status(403).json({ error: 'Invalid document key' })
    }

    const docUrl = await profileService.updateDocKey(employeeId, docType, key)
    res.json({ docUrl, key })
  } catch (err) {
    console.error('[profile] confirmDocUpload error:', err)
    res.status(500).json({ error: 'Failed to confirm document upload' })
  }
}

async function deleteDoc(req, res) {
  try {
    const employeeId = resolveEmployeeId(req)
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' })

    const { docType } = req.params
    if (!VALID_DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'Invalid docType' })

    await profileService.deleteDocKey(employeeId, docType)
    res.json({ success: true })
  } catch (err) {
    console.error('[profile] deleteDoc error:', err)
    res.status(500).json({ error: 'Failed to delete document' })
  }
}

// Admin: view any employee's full profile
async function getEmployeeProfile(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid employee id' })

    const profile = await profileService.getFullProfile(id)
    if (!profile) return res.status(404).json({ error: 'Employee profile not found' })

    res.json(await profileService.attachDocUrls(profile))
  } catch (err) {
    console.error('[profile] getEmployeeProfile error:', err)
    res.status(500).json({ error: 'Failed to load employee profile' })
  }
}

async function listAlternateEmployeeOptions(req, res) {
  try {
    const employeeId = resolveEmployeeId(req)
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' })
    const options = await employeesService.findAlternateCandidates(employeeId)
    res.json(options.map((r) => ({
      id: r.id,
      employee_code: r.employee_code,
      full_name: r.full_name,
      is_active: r.is_active,
    })))
  } catch (err) {
    console.error('[profile] listAlternateEmployeeOptions error:', err)
    res.status(500).json({ error: 'Failed to load alternate employee options' })
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  requestDocUploadUrl,
  confirmDocUpload,
  deleteDoc,
  getEmployeeProfile,
  listAlternateEmployeeOptions,
}
