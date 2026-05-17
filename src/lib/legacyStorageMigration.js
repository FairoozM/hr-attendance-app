/**
 * One-time reads from legacy localStorage keys, then removes them.
 * Centralized so the rest of the app never depends on localStorage for prefs.
 */
import { api } from '../api/client'
import * as K from '../constants/userPreferenceKeys'

const WAR_LEGACY_KEY = 'war_history_v1'

function tryGetLocal(key) {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function tryRemoveLocal(key) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function tryParseJson(raw) {
  if (raw == null || raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Build preference PUTs from browser legacy keys. Does not write to network.
 * @param {Record<string, unknown>} serverPrefs
 * @returns {{ key: string, value: unknown }[]}
 */
function ownsPref(serverPrefs, pk) {
  return serverPrefs != null && Object.prototype.hasOwnProperty.call(serverPrefs, pk)
}

export function collectLegacyPreferencePatches(serverPrefs) {
  const sp = serverPrefs && typeof serverPrefs === 'object' ? serverPrefs : {}
  const patches = []

  if (!ownsPref(sp, K.PREF_APP_SETTINGS)) {
    const p = tryParseJson(tryGetLocal('hr-attendance-settings'))
    if (p && typeof p === 'object') patches.push({ key: K.PREF_APP_SETTINGS, value: p })
  }

  if (!ownsPref(sp, K.PREF_COMPANY_PAYMENTS)) {
    const p = tryParseJson(tryGetLocal('hr_company_payments_v1'))
    if (Array.isArray(p) && p.length) patches.push({ key: K.PREF_COMPANY_PAYMENTS, value: p })
  }

  if (!ownsPref(sp, K.PREF_SALES_VS_EXPENSES)) {
    for (const legacyKey of ['sve_report_history_v1', 'hr-sales-vs-expenses-rows-v1']) {
      const p = tryParseJson(tryGetLocal(legacyKey))
      if (Array.isArray(p) && p.length) {
        patches.push({ key: K.PREF_SALES_VS_EXPENSES, value: p })
        break
      }
    }
  }

  if (!ownsPref(sp, K.PREF_NOTIFICATIONS_DISMISSED)) {
    const raw = tryGetLocal('hr-dismissed-notification-ids-v1') || tryGetLocal('hr-dismissed-notifications')
    const p = tryParseJson(raw)
    if (Array.isArray(p) && p.length) patches.push({ key: K.PREF_NOTIFICATIONS_DISMISSED, value: p })
  }

  if (!ownsPref(sp, K.PREF_SAVED_COMPOSITES)) {
    const p = tryParseJson(tryGetLocal('hr-saved-composite-items-v1'))
    if (Array.isArray(p) && p.length) patches.push({ key: K.PREF_SAVED_COMPOSITES, value: p })
  }

  if (!ownsPref(sp, K.PREF_ALL_PRICES_EC)) {
    const rates = tryParseJson(tryGetLocal('hr-all-prices-ecommerce-rates-v1'))
    const rows = tryParseJson(tryGetLocal('hr-all-prices-ecommerce-rows-v1'))
    const merged = tryParseJson(tryGetLocal('hr-all-prices-ecommerce-v1'))
    if (merged && typeof merged === 'object' && (merged.rates || merged.rows)) {
      patches.push({ key: K.PREF_ALL_PRICES_EC, value: merged })
    } else if (
      (rates && typeof rates === 'object') ||
      (Array.isArray(rows) && rows.length)
    ) {
      patches.push({ key: K.PREF_ALL_PRICES_EC, value: { rates: rates || {}, rows: Array.isArray(rows) ? rows : [] } })
    }
  }

  if (!ownsPref(sp, K.PREF_INFLUENCER_PERF)) {
    const records = tryParseJson(tryGetLocal('hr-influencer-performance-v1'))
    const tombObj = tryParseJson(tryGetLocal('hr-influencer-performance-tombstones-v1'))
    if ((Array.isArray(records) && records.length) || (tombObj && typeof tombObj === 'object')) {
      patches.push({
        key: K.PREF_INFLUENCER_PERF,
        value: {
          records: Array.isArray(records) ? records : [],
          tombstones: tombObj && typeof tombObj === 'object' ? tombObj : {},
        },
      })
    }
  }

  if (!ownsPref(sp, K.PREF_INFLUENCER_LIST_COLS)) {
    for (const legacyKey of ['hr-influencer-list-col-widths-v3', 'hr-influencer-list-col-widths-v1']) {
      const p = tryParseJson(tryGetLocal(legacyKey))
      if (p && typeof p === 'object' && Object.keys(p).length) {
        patches.push({ key: K.PREF_INFLUENCER_LIST_COLS, value: p })
        break
      }
    }
  }

  if (!ownsPref(sp, K.PREF_WEEKLY_HOLIDAY_DAY)) {
    const raw = tryGetLocal('hr-attendance-weekly-holiday-day')
    if (raw != null && raw !== '') {
      const n = parseInt(raw, 10)
      if (n >= 0 && n <= 6) patches.push({ key: K.PREF_WEEKLY_HOLIDAY_DAY, value: n })
    }
  }

  if (!ownsPref(sp, K.PREF_THEME)) {
    const raw = tryGetLocal('hr-attendance-theme')
    if (raw && typeof raw === 'string' && ['light', 'dark', 'comfort', 'system'].includes(raw)) {
      patches.push({ key: K.PREF_THEME, value: raw })
    }
  }

  if (!ownsPref(sp, K.PREF_AI_PLANNER)) {
    const tasks = tryParseJson(tryGetLocal('ai_planner_tasks_v2'))
    const sections = tryParseJson(tryGetLocal('ai_planner_sections_v2'))
    const trash = tryParseJson(tryGetLocal('ai_planner_trash_v1'))
    const recents = tryParseJson(tryGetLocal('ai_planner_recents_v1'))
    const seedRaw = tryGetLocal('ai_planner_seed_revision_v1')
    const seedRevision = seedRaw != null ? Number(seedRaw) : 0
    if (tasks || sections || (Array.isArray(trash) && trash.length) || (Array.isArray(recents) && recents.length)) {
      patches.push({
        key: K.PREF_AI_PLANNER,
        value: {
          tasks: Array.isArray(tasks) ? tasks : null,
          sections: Array.isArray(sections) ? sections : null,
          trash: Array.isArray(trash) ? trash : [],
          recents: Array.isArray(recents) ? recents : [],
          seedRevision: Number.isFinite(seedRevision) ? seedRevision : 0,
        },
      })
    }
  }

  return patches
}

/** Remove legacy keys after a successful preference migration. */
export function removeMigratedPreferenceLocalKeys() {
  const keys = [
    'hr-attendance-settings',
    'hr_company_payments_v1',
    'sve_report_history_v1',
    'hr-sales-vs-expenses-rows-v1',
    'hr-dismissed-notification-ids-v1',
    'hr-dismissed-notifications',
    'hr-saved-composite-items-v1',
    'hr-all-prices-ecommerce-rates-v1',
    'hr-all-prices-ecommerce-rows-v1',
    'hr-all-prices-ecommerce-v1',
    'hr-influencer-performance-v1',
    'hr-influencer-performance-tombstones-v1',
    'hr-influencer-list-col-widths-v3',
    'hr-influencer-list-col-widths-v1',
    'hr-attendance-weekly-holiday-day',
    'hr-attendance-theme',
    'ai_planner_tasks_v2',
    'ai_planner_sections_v2',
    'ai_planner_trash_v1',
    'ai_planner_recents_v1',
    'ai_planner_seed_revision_v1',
  ]
  keys.forEach(tryRemoveLocal)
}

/**
 * Upload Weekly Ads snapshots that only existed in legacy localStorage.
 */
export async function migrateWeeklyAdsWarHistoryFromLocalStorage() {
  const raw = tryGetLocal(WAR_LEGACY_KEY)
  if (!raw) return
  let legacy = []
  try {
    const p = JSON.parse(raw)
    legacy = Array.isArray(p) ? p : []
  } catch {
    tryRemoveLocal(WAR_LEGACY_KEY)
    return
  }
  if (!legacy.length) {
    tryRemoveLocal(WAR_LEGACY_KEY)
    return
  }
  try {
    // Always POST legacy entries (server upserts by id). Do not delete localStorage
    // just because the server already has rows — that discarded legacy-only snapshots.
    for (const entry of legacy) {
      if (!entry || typeof entry !== 'object') continue
      const id = entry.id != null ? String(entry.id) : ''
      if (!id) continue
      await api.post('/api/weekly-reports/weekly-ads/history', {
        id,
        title: entry.title != null ? String(entry.title) : '',
        startDate: entry.startDate,
        endDate: entry.endDate,
        rows: entry.rows && typeof entry.rows === 'object' ? entry.rows : {},
        notes: entry.notes != null ? String(entry.notes) : '',
      })
    }
  } catch {
    /* leave key for retry */
    return
  }
  tryRemoveLocal(WAR_LEGACY_KEY)
}

export function readLegacyInfluencersSnapshot() {
  return tryParseJson(tryGetLocal('hr-influencers-v1'))
}

export function clearLegacyInfluencersSnapshot() {
  tryRemoveLocal('hr-influencers-v1')
}

export { WAR_LEGACY_KEY }
