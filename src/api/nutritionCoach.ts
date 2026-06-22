import { apiFetch, buildApiUrl } from '../lib/api'

const BASE = '/api/nutrition-coach'

export async function fetchNutritionMeta() {
  return apiFetch(`${BASE}/meta`)
}

export async function fetchNutritionProfile() {
  return apiFetch(`${BASE}/profile`)
}

export async function saveNutritionProfile(body: Record<string, unknown>) {
  return apiFetch(`${BASE}/profile`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function fetchFoodLibrary(params: Record<string, string> | string = '') {
  if (typeof params === 'string') {
    const qs = params ? `?q=${encodeURIComponent(params)}` : ''
    return apiFetch(`${BASE}/food-library${qs}`)
  }
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) search.set(k, v)
  }
  const qs = search.toString() ? `?${search}` : ''
  return apiFetch(`${BASE}/food-library${qs}`)
}

export async function createFoodLibraryItem(body: Record<string, unknown>) {
  return apiFetch(`${BASE}/food-library`, { method: 'POST', body: JSON.stringify(body) })
}

export async function fetchFoodLog(date?: string) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiFetch(`${BASE}/food-log${qs}`)
}

export async function addFoodLogItem(body: Record<string, unknown>) {
  return apiFetch(`${BASE}/food-log/items`, { method: 'POST', body: JSON.stringify(body) })
}

export async function deleteFoodLogItem(id: number | string) {
  return apiFetch(`${BASE}/food-log/items/${id}`, { method: 'DELETE' })
}

export async function fetchDailySummary(date?: string) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiFetch(`${BASE}/summary${qs}`)
}

export async function fetchNutritionDashboard() {
  return apiFetch(`${BASE}/dashboard`)
}

export async function fetchCalculators() {
  return apiFetch(`${BASE}/calculators`)
}

export async function fetchWhatToEatNext() {
  return apiFetch(`${BASE}/actions/what-to-eat-next`)
}

export async function fetchFixTodayNutrition() {
  return apiFetch(`${BASE}/actions/fix-today`)
}

export async function fetchMediterraneanPlate() {
  return apiFetch(`${BASE}/mediterranean/plate`)
}

export async function fetchWorldDietPlate(region?: string) {
  const qs = region ? `?region=${encodeURIComponent(region)}` : ''
  return apiFetch(`${BASE}/world-diet/plate${qs}`)
}

export async function parseNutritionAssistant(text: string) {
  return apiFetch(`${BASE}/assistant/parse`, { method: 'POST', body: JSON.stringify({ text }) })
}

export async function confirmNutritionAssistant(body: Record<string, unknown>) {
  return apiFetch(`${BASE}/assistant/confirm`, { method: 'POST', body: JSON.stringify(body) })
}

export async function generateMealPlan(body: Record<string, unknown> = {}) {
  return apiFetch(`${BASE}/meal-plans/generate`, { method: 'POST', body: JSON.stringify(body) })
}

export async function fetchMealPlans() {
  return apiFetch(`${BASE}/meal-plans`)
}

export async function fetchWorkoutPlan(level?: string) {
  const qs = level ? `?level=${encodeURIComponent(level)}` : ''
  return apiFetch(`${BASE}/workout-plan${qs}`)
}

export async function saveWorkoutSession(body: Record<string, unknown>) {
  return apiFetch(`${BASE}/workout-sessions`, { method: 'POST', body: JSON.stringify(body) })
}

export async function fetchWorkoutSessions(from?: string, to?: string) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString() ? `?${params}` : ''
  return apiFetch(`${BASE}/workout-sessions${qs}`)
}

export async function fetchProgressLogs() {
  return apiFetch(`${BASE}/progress`)
}

export async function addProgressLog(body: Record<string, unknown>) {
  return apiFetch(`${BASE}/progress`, { method: 'POST', body: JSON.stringify(body) })
}

export async function fetchNutrientTargets() {
  return apiFetch(`${BASE}/nutrient-targets`)
}

export async function updateNutrientTarget(key: string, body: Record<string, unknown>) {
  return apiFetch(`${BASE}/nutrient-targets/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function nutritionExportUrl(kind: 'daily' | 'weekly' | 'workout', params: Record<string, string> = {}) {
  const path = kind === 'daily' ? 'daily.xlsx' : kind === 'weekly' ? 'weekly.xlsx' : 'workout.xlsx'
  const qs = new URLSearchParams(params).toString()
  return buildApiUrl(`${BASE}/export/${path}${qs ? `?${qs}` : ''}`)
}
