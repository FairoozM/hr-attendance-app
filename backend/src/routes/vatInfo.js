const express = require('express')
const auth = require('../middleware/auth')
const vatInfoController = require('../controllers/vatInfoController')

const router = express.Router()

router.get('/', auth.requireAuth, auth.requirePermission('vat_info', 'view'), vatInfoController.list)
router.post('/', auth.requireAuth, auth.requirePermission('vat_info', 'add'), vatInfoController.create)
router.put('/:id', auth.requireAuth, auth.requirePermission('vat_info', 'edit'), vatInfoController.update)
router.delete('/:id', auth.requireAuth, auth.requirePermission('vat_info', 'delete'), vatInfoController.remove)

router.get(
  '/:id/certificates',
  auth.requireAuth,
  auth.requirePermission('vat_info', 'view'),
  vatInfoController.listCertificates
)
router.post(
  '/:id/certificates/upload-url',
  auth.requireAuth,
  auth.requirePermission('vat_info', 'edit'),
  vatInfoController.getCertificateUploadUrl
)
router.post(
  '/:id/certificates',
  auth.requireAuth,
  auth.requirePermission('vat_info', 'edit'),
  vatInfoController.saveCertificate
)
router.get(
  '/:id/certificates/:certId/download-url',
  auth.requireAuth,
  auth.requirePermission('vat_info', 'view'),
  vatInfoController.getCertificateDownloadUrl
)
router.delete(
  '/:id/certificates/:certId',
  auth.requireAuth,
  auth.requirePermission('vat_info', 'edit'),
  vatInfoController.deleteCertificate
)

module.exports = router
