const COMPANY_LINES = [
  'To,',
  'General Manager,',
  'Basmat Al Hayat General Trading LLC',
  '',
]

const APPROVER_NAME = 'Abdolrahim Mirzadeh'

/** Renders the formal vacation request letter (A4, business tone). */
function renderLeaveRequestVacationPdf(ctx, options = {}) {
  const { signatureImageBuffer = null } = options
  const PDFDocument = require('pdfkit')
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      // Keep larger top margin for pre-printed company letterhead.
      margins: { top: 96, bottom: 56, left: 56, right: 56 },
    })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.font('Times-Roman').fontSize(12)

    doc.text(`Date: ${ctx.applicationDateFormatted}`, { align: 'left' })
    doc.moveDown(1.2)

    COMPANY_LINES.forEach((line) => {
      doc.text(line, { align: 'left' })
    })
    doc.moveDown(0.6)

    doc.font('Times-Bold').text('Subject: REQUEST FOR VACATION', { align: 'left' })
    doc.moveDown(0.8)
    doc.font('Times-Roman')

    doc.text('Dear Sir,', { align: 'left' })
    doc.moveDown(0.6)

    const body1 = `I, ${ctx.employeeName}, would like to request for Annual Vacation for ${ctx.currentYear} for ${ctx.numberOfDays} day${ctx.numberOfDays === '1' ? '' : 's'}. Dates of vacation are mentioned hereunder,`
    doc.text(body1, { align: 'justify', lineGap: 2 })
    doc.moveDown(0.5)

    doc
      .fillColor('#dc2626')
      .font('Times-Bold')
      .text('From ', { align: 'left', continued: true })
      .fillColor('#111827')
      .font('Times-Roman')
      .text(`${ctx.leaveStartFormatted} `, { continued: true })
      .fillColor('#16a34a')
      .font('Times-Bold')
      .text('to ', { continued: true })
      .fillColor('#111827')
      .font('Times-Roman')
      .text(ctx.leaveEndFormatted, { align: 'left' })
    doc.moveDown(0.8)

    if (ctx.alternateEmployeeName) {
      doc
        .fillColor('#111827')
        .font('Times-Roman')
        .text(
          'I kindly request your approval for my vacation request. I assure you that I will complete all pending tasks and hand over any ongoing tasks to ',
          { align: 'justify', lineGap: 2, continued: true }
        )
        .font('Times-BoldItalic')
        .text(ctx.alternateEmployeeName, { continued: true })
        .font('Times-Roman')
        .text('.', { lineGap: 2 })
    } else {
      const body2 = `I kindly request your approval for my vacation request. I assure you that I will complete all pending tasks and hand over any ongoing tasks to ${ctx.alternateHandoverPhrase}.`
      doc.fillColor('#111827').font('Times-Roman').text(body2, { align: 'justify', lineGap: 2 })
    }
    doc.moveDown(0.8)

    doc.text(
      'Thanks for considering my request. Kindly prepare my account and Annual Leave Salary. Looking forward to the positive response.',
      { align: 'justify', lineGap: 2 }
    )
    doc.moveDown(1.2)

    doc.text('Yours sincerely,', { align: 'left' })
    doc.moveDown(1.5)

    if (signatureImageBuffer) {
      try {
        const signatureY = doc.y
        doc.image(signatureImageBuffer, doc.page.margins.left, signatureY, {
          fit: [240, 96],
          align: 'left',
          valign: 'top',
        })
        doc.y = signatureY + 104
      } catch (e) {
        console.warn('[leave-letter] Signature image render failed:', e.message)
      }
    }

    const sigY = doc.y
    const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2

    doc.font('Times-Bold').text(ctx.employeeName, doc.page.margins.left, sigY, {
      width: colW - 8,
      align: 'left',
    })
    doc.font('Times-Roman').text('Approved by', doc.page.margins.left + colW, sigY, {
      width: colW - 8,
      align: 'right',
    })

    const line2Y = sigY + 18
    doc.font('Times-Roman').text(ctx.designation, doc.page.margins.left, line2Y, {
      width: colW - 8,
      align: 'left',
    })
    doc.text(APPROVER_NAME, doc.page.margins.left + colW, line2Y, {
      width: colW - 8,
      align: 'right',
    })

    doc.end()
  })
}

module.exports = { renderLeaveRequestVacationPdf }
