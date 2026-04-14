const COMPANY_LINES = [
  'To,',
  'General Manager,',
  'Basmat Al Hayat General Trading LLC',
  '',
]

const APPROVER_NAME = 'Abdolrahim Mirzadeh'

/** Renders the formal vacation request letter (A4, business tone). */
function renderLeaveRequestVacationPdf(ctx) {
  const PDFDocument = require('pdfkit')
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
    })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.font('Times-Roman').fontSize(11)

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

    doc.text(`Starting From: ${ctx.leaveStartFormatted}`, { align: 'left' })
    doc.text(`To: ${ctx.leaveEndFormatted}`, { align: 'left' })
    doc.moveDown(0.8)

    const body2 = `I kindly request your approval for my vacation request. I assure you that I will complete all pending tasks and hand over any ongoing tasks to ${ctx.alternateHandoverPhrase}.`
    doc.text(body2, { align: 'justify', lineGap: 2 })
    doc.moveDown(0.8)

    doc.text(
      'Thanks for considering my request. Kindly prepare my account and Annual Leave Salary. Looking forward to the positive response.',
      { align: 'justify', lineGap: 2 }
    )
    doc.moveDown(1.2)

    doc.text('Yours sincerely,', { align: 'left' })
    doc.moveDown(2.2)

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
