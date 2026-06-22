const nutritionCoachService = require('../services/nutritionCoachService')
const xlsxService = require('../services/nutritionCoachXlsxService')

function userId(req) {
  const raw = req.user?.userId ?? req.user?.id
  if (raw == null) return null
  const n = Number.parseInt(String(raw), 10)
  return Number.isFinite(n) ? n : null
}

async function getMeta(req, res) {
  try {
    res.json(await nutritionCoachService.getMeta())
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load meta' })
  }
}

async function getProfile(req, res) {
  try {
    const profile = await nutritionCoachService.getProfile(userId(req))
    res.json({ profile, disclaimer: (await nutritionCoachService.getMeta()).disclaimer })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load profile' })
  }
}

async function putProfile(req, res) {
  try {
    const uid = userId(req)
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })
    const profile = await nutritionCoachService.upsertProfile(uid, req.body || {})
    res.json({ profile })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to save profile' })
  }
}

async function listFoodLibrary(req, res) {
  try {
    const filters = {
      q: req.query.q,
      origin_region: req.query.origin_region || req.query.region,
      diet_tag: req.query.diet_tag,
      nutrient_tag: req.query.nutrient_tag,
      diet_mode: req.query.diet_mode,
      goal: req.query.goal,
      vegetarian: req.query.vegetarian,
      non_vegetarian: req.query.non_vegetarian,
      high_protein: req.query.high_protein,
      probiotic: req.query.probiotic,
      healthy_fat: req.query.healthy_fat,
      budget_friendly: req.query.budget_friendly,
      nutrient_gap: req.query.nutrient_gap,
    }
    const foods = await nutritionCoachService.listFoodLibrary(userId(req), req.query.q, filters)
    res.json({ foods })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list food library' })
  }
}

async function createFoodLibraryItem(req, res) {
  try {
    const food = await nutritionCoachService.createFoodLibraryItem(userId(req), req.body || {})
    res.status(201).json({ food })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create food' })
  }
}

async function listFoodLog(req, res) {
  try {
    const date = req.query.date
    const items = await nutritionCoachService.listFoodLogItems(userId(req), date)
    res.json({ items, date: date || new Date().toISOString().slice(0, 10) })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load food log' })
  }
}

async function addFoodLogItem(req, res) {
  try {
    const item = await nutritionCoachService.addFoodLogItem(userId(req), req.body || {})
    res.status(201).json({ item })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to add food log item' })
  }
}

async function deleteFoodLogItem(req, res) {
  try {
    const deleted = await nutritionCoachService.deleteFoodLogItem(userId(req), req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Item not found' })
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to delete item' })
  }
}

async function getDailySummary(req, res) {
  try {
    const summary = await nutritionCoachService.getDailySummary(userId(req), req.query.date)
    res.json({ summary })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to compute summary' })
  }
}

async function getDashboard(req, res) {
  try {
    const dashboard = await nutritionCoachService.getDashboard(userId(req))
    res.json({ dashboard })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load dashboard' })
  }
}

async function parseAssistant(req, res) {
  try {
    const result = await nutritionCoachService.parseFoodAssistant(userId(req), req.body?.text)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to parse food input' })
  }
}

async function confirmAssistant(req, res) {
  try {
    const result = await nutritionCoachService.confirmAssistantLog(userId(req), req.body || {})
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to confirm log' })
  }
}

async function generateMealPlan(req, res) {
  try {
    const plan = await nutritionCoachService.generateMealPlan(userId(req), req.body || {})
    res.status(201).json({ plan })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to generate meal plan' })
  }
}

async function listMealPlans(req, res) {
  try {
    const plans = await nutritionCoachService.listMealPlans(userId(req))
    res.json({ plans })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list meal plans' })
  }
}

async function getWorkoutPlan(req, res) {
  try {
    const plan = await nutritionCoachService.getOrCreateWorkoutPlan(userId(req), req.query.level)
    res.json({ plan, disclaimer: (await nutritionCoachService.getMeta()).disclaimer })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load workout plan' })
  }
}

async function upsertWorkoutSession(req, res) {
  try {
    const session = await nutritionCoachService.upsertWorkoutSession(userId(req), req.body || {})
    res.json({ session })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to save workout session' })
  }
}

async function listWorkoutSessions(req, res) {
  try {
    const to = req.query.to || new Date().toISOString().slice(0, 10)
    const from = req.query.from || (() => {
      const d = new Date(to)
      d.setDate(d.getDate() - 30)
      return d.toISOString().slice(0, 10)
    })()
    const sessions = await nutritionCoachService.listWorkoutSessions(userId(req), from, to)
    res.json({ sessions })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list sessions' })
  }
}

async function addProgressLog(req, res) {
  try {
    const log = await nutritionCoachService.addProgressLog(userId(req), req.body || {})
    res.status(201).json({ log })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to save progress' })
  }
}

async function listProgressLogs(req, res) {
  try {
    const logs = await nutritionCoachService.listProgressLogs(userId(req))
    res.json({ logs })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list progress' })
  }
}

async function listNutrientTargets(req, res) {
  try {
    const targets = await nutritionCoachService.getNutrientTargets()
    res.json({ targets })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list targets' })
  }
}

async function updateNutrientTarget(req, res) {
  try {
    const updated = await nutritionCoachService.updateNutrientTarget(req.params.key, req.body || {})
    if (!updated) return res.status(404).json({ error: 'Target not found' })
    res.json({ target: updated })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update target' })
  }
}

async function getCalculators(req, res) {
  try {
    res.json(await nutritionCoachService.getCalculators(userId(req)))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to compute calculators' })
  }
}

async function getWhatToEatNext(req, res) {
  try {
    res.json(await nutritionCoachService.getWhatToEatNext(userId(req)))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to suggest next meal' })
  }
}

async function fixTodayNutrition(req, res) {
  try {
    res.json(await nutritionCoachService.fixTodayNutrition(userId(req)))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to build fix plan' })
  }
}

async function getMediterraneanPlate(req, res) {
  try {
    res.json(await nutritionCoachService.getMediterraneanPlate(userId(req)))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to build Mediterranean plate' })
  }
}

async function getWorldDietPlate(req, res) {
  try {
    res.json(await nutritionCoachService.getWorldDietPlate(userId(req), req.query))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to build world diet plate' })
  }
}

async function exportDailyXlsx(req, res) {
  try {
    const buf = await xlsxService.buildDailyNutritionXlsx(userId(req), req.query.date)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="nutrition-daily-${req.query.date || 'today'}.xlsx"`)
    res.send(Buffer.from(buf))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Export failed' })
  }
}

async function exportWeeklyXlsx(req, res) {
  try {
    const buf = await xlsxService.buildWeeklyNutritionXlsx(userId(req), req.query.endDate)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="nutrition-weekly.xlsx"')
    res.send(Buffer.from(buf))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Export failed' })
  }
}

async function exportWorkoutXlsx(req, res) {
  try {
    const buf = await xlsxService.buildWorkoutProgressXlsx(userId(req), req.query.from, req.query.to)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="workout-progress.xlsx"')
    res.send(Buffer.from(buf))
  } catch (e) {
    res.status(500).json({ error: e.message || 'Export failed' })
  }
}

module.exports = {
  getMeta,
  getProfile,
  putProfile,
  listFoodLibrary,
  createFoodLibraryItem,
  listFoodLog,
  addFoodLogItem,
  deleteFoodLogItem,
  getDailySummary,
  getDashboard,
  parseAssistant,
  confirmAssistant,
  generateMealPlan,
  listMealPlans,
  getWorkoutPlan,
  upsertWorkoutSession,
  listWorkoutSessions,
  addProgressLog,
  listProgressLogs,
  listNutrientTargets,
  updateNutrientTarget,
  getMediterraneanPlate,
  getWorldDietPlate,
  exportDailyXlsx,
  exportWeeklyXlsx,
  exportWorkoutXlsx,
  getCalculators,
  getWhatToEatNext,
  fixTodayNutrition,
}
