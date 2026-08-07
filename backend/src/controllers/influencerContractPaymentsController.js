const influencerContractPaymentsService = require('../services/influencerContractPaymentsService')

/**
 * GET /api/influencers/contract-payments
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listContractPayments(req, res) {
  try {
    const payments = await influencerContractPaymentsService.listContractPayments()
    res.json({ payments })
  } catch (err) {
    console.error('[influencerContractPayments] list failed', err)
    res.status(500).json({ error: err.message || 'Failed to load contract payments' })
  }
}

/**
 * PATCH /api/influencers/contract-payments/:contractId
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function patchContractPayment(req, res) {
  try {
    const contractId = String(req.params.contractId || '').trim()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const influencerId = String(body.influencerId || '').trim()
    if (!contractId) {
      return res.status(400).json({ error: 'contractId is required' })
    }
    if (!influencerId) {
      return res.status(400).json({ error: 'influencerId is required' })
    }

    const payment = await influencerContractPaymentsService.upsertContractPayment(
      {
        contractId,
        influencerId,
        amountPaid: body.amountPaid,
        paymentStatus: body.paymentStatus,
        dueDate: body.dueDate,
        paymentDate: body.paymentDate,
        invoiceReference: body.invoiceReference,
        notes: body.notes,
      },
      req.user?.id,
    )
    res.json({ payment })
  } catch (err) {
    console.error('[influencerContractPayments] patch failed', err)
    res.status(500).json({ error: err.message || 'Failed to update contract payment' })
  }
}

module.exports = {
  listContractPayments,
  patchContractPayment,
}
