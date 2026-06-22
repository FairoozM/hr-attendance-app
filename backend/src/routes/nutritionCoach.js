const express = require('express')
const { attachAuth, requireAuth, requirePermission } = require('../middleware/auth')
const ctrl = require('../controllers/nutritionCoachController')

const router = express.Router()

/** All authenticated users can use personal wellness tracking */
const self = [attachAuth, requireAuth]
const manageTargets = [attachAuth, requireAuth, requirePermission('nutrition_fitness', 'manage')]

router.get('/meta', ...self, ctrl.getMeta)
router.get('/profile', ...self, ctrl.getProfile)
router.put('/profile', ...self, ctrl.putProfile)

router.get('/food-library', ...self, ctrl.listFoodLibrary)
router.post('/food-library', ...self, ctrl.createFoodLibraryItem)

router.get('/food-log', ...self, ctrl.listFoodLog)
router.post('/food-log/items', ...self, ctrl.addFoodLogItem)
router.delete('/food-log/items/:id', ...self, ctrl.deleteFoodLogItem)

router.get('/summary', ...self, ctrl.getDailySummary)
router.get('/dashboard', ...self, ctrl.getDashboard)
router.get('/calculators', ...self, ctrl.getCalculators)
router.get('/actions/what-to-eat-next', ...self, ctrl.getWhatToEatNext)
router.get('/actions/fix-today', ...self, ctrl.fixTodayNutrition)

router.post('/assistant/parse', ...self, ctrl.parseAssistant)
router.post('/assistant/confirm', ...self, ctrl.confirmAssistant)

router.post('/meal-plans/generate', ...self, ctrl.generateMealPlan)
router.get('/meal-plans', ...self, ctrl.listMealPlans)

router.get('/workout-plan', ...self, ctrl.getWorkoutPlan)
router.post('/workout-sessions', ...self, ctrl.upsertWorkoutSession)
router.get('/workout-sessions', ...self, ctrl.listWorkoutSessions)

router.get('/progress', ...self, ctrl.listProgressLogs)
router.post('/progress', ...self, ctrl.addProgressLog)

router.get('/nutrient-targets', ...self, ctrl.listNutrientTargets)
router.put('/nutrient-targets/:key', ...manageTargets, ctrl.updateNutrientTarget)

router.get('/mediterranean/plate', ...self, ctrl.getMediterraneanPlate)
router.get('/world-diet/plate', ...self, ctrl.getWorldDietPlate)

router.get('/export/daily.xlsx', ...self, ctrl.exportDailyXlsx)
router.get('/export/weekly.xlsx', ...self, ctrl.exportWeeklyXlsx)
router.get('/export/workout.xlsx', ...self, ctrl.exportWorkoutXlsx)

module.exports = router
