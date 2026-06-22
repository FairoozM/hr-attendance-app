const ExcelJS = require('exceljs')
const nutritionCoachService = require('./nutritionCoachService')

function fmtDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
}

async function buildDailyNutritionXlsx(userId, logDate) {
  const date = logDate || new Date().toISOString().slice(0, 10)
  const items = await nutritionCoachService.listFoodLogItems(userId, date)
  const summary = await nutritionCoachService.getDailySummary(userId, date)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'HR & BI App — Nutrition Coach'
  const ws = wb.addWorksheet('Daily Nutrition')

  ws.addRow(['Nutrition Report — Daily'])
  ws.addRow(['Date', date])
  ws.addRow(['Disclaimer', summary?.disclaimer || 'For wellness tracking only. Not medical advice.'])
  ws.addRow([])

  ws.addRow(['Meal', 'Food', 'Qty', 'Unit', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fiber (g)', 'Notes'])
  for (const item of items) {
    const n = item.nutrients || {}
    ws.addRow([
      item.meal_type,
      item.food_name,
      item.quantity,
      item.unit,
      n.calories || 0,
      n.protein || 0,
      n.carbs || 0,
      n.fiber || 0,
      item.why_notes || '',
    ])
  }

  ws.addRow([])
  ws.addRow(['Nutrient', 'Intake', 'Target', 'Coverage %', 'Status'])
  const coverage = summary?.coverage || {}
  for (const [key, c] of Object.entries(coverage)) {
    ws.addRow([c.displayName || key, c.intake, c.target, c.pct, c.status])
  }

  ws.addRow([])
  ws.addRow(['Food quality score', summary?.food_quality_score || 0])
  ws.addRow(['Hydration (ml)', summary?.hydration_ml || 0])

  return wb.xlsx.writeBuffer()
}

async function buildWeeklyNutritionXlsx(userId, endDate) {
  const end = endDate ? new Date(endDate) : new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Weekly Nutrition')

  ws.addRow(['Nutrition Report — Weekly'])
  ws.addRow(['From', fmtDate(start), 'To', fmtDate(end)])
  ws.addRow(['Disclaimer', 'For wellness tracking only. Not medical advice.'])
  ws.addRow([])
  ws.addRow(['Date', 'Calories', 'Protein', 'Fiber', 'Water (ml)', 'Quality Score', 'Top gaps'])

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmtDate(d)
    const summary = await nutritionCoachService.getDailySummary(userId, dateStr)
    const missing = (summary?.missing_nutrients || []).slice(0, 3).map((m) => m.displayName).join(', ')
    ws.addRow([
      dateStr,
      summary?.totals?.calories || 0,
      summary?.totals?.protein || 0,
      summary?.totals?.fiber || 0,
      summary?.hydration_ml || 0,
      summary?.food_quality_score || 0,
      missing,
    ])
  }

  return wb.xlsx.writeBuffer()
}

async function buildWorkoutProgressXlsx(userId, fromDate, toDate) {
  const end = toDate || new Date().toISOString().slice(0, 10)
  const start = fromDate || (() => {
    const d = new Date(end)
    d.setDate(d.getDate() - 30)
    return fmtDate(d)
  })()

  const sessions = await nutritionCoachService.listWorkoutSessions(userId, start, end)
  const progress = await nutritionCoachService.listProgressLogs(userId, 90)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Workout Progress')
  ws.addRow(['Workout Progress Report'])
  ws.addRow(['From', start, 'To', end])
  ws.addRow([])
  ws.addRow(['Date', 'Type', 'Completed', 'Duration (min)', 'Notes', 'Exercises'])

  for (const s of sessions) {
    const exNames = (s.exercises || []).map((e) => e.exercise_name).join('; ')
    ws.addRow([s.session_date, s.session_type, s.completed, s.duration_minutes, s.notes, exNames])
  }

  const ws2 = wb.addWorksheet('Weight Trend')
  ws2.addRow(['Date', 'Weight (kg)', 'Body fat %', 'Notes'])
  for (const p of progress) {
    ws2.addRow([p.log_date, p.weight_kg, p.body_fat_pct, p.notes])
  }

  return wb.xlsx.writeBuffer()
}

module.exports = {
  buildDailyNutritionXlsx,
  buildWeeklyNutritionXlsx,
  buildWorkoutProgressXlsx,
}
