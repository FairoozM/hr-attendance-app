import { useState, useCallback, useEffect, useRef } from 'react'
import { DEFAULT_DEPARTMENTS } from '../constants/employees'
import { PREF_APP_SETTINGS } from '../constants/userPreferenceKeys'
import { useAuth } from '../contexts/AuthContext'
import { useUserPreferences } from '../contexts/UserPreferencesContext'

const DEFAULT_APP_TITLE = 'Business Intelligence (BI) - Life Smile'
const LEGACY_APP_TITLES = new Set([
  'HR Attendance',
  'HR Attendance Dashboard',
  'HR & Business Intelligence',
])

const defaultSettings = {
  companyName: '',
  appTitle: DEFAULT_APP_TITLE,
  departments: [...DEFAULT_DEPARTMENTS],
}

function normalizeAppTitle(value) {
  const title = String(value ?? '').trim()
  if (!title || LEGACY_APP_TITLES.has(title)) return DEFAULT_APP_TITLE
  return title
}

function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...defaultSettings }
  return {
    companyName: raw.companyName ?? defaultSettings.companyName,
    appTitle: normalizeAppTitle(raw.appTitle),
    departments:
      Array.isArray(raw.departments) && raw.departments.length > 0
        ? raw.departments
        : defaultSettings.departments,
  }
}

export function useAppSettings() {
  const { user } = useAuth()
  const { ready, getPref, setPref, prefsVersion } = useUserPreferences()
  const [settings, setSettingsState] = useState({ ...defaultSettings })
  const skipNextSave = useRef(false)

  useEffect(() => {
    if (!user || !ready) {
      setSettingsState({ ...defaultSettings })
      return
    }
    skipNextSave.current = true
    const raw = getPref(PREF_APP_SETTINGS, null)
    setSettingsState(normalizeSettings(raw))
  }, [user, ready, prefsVersion, getPref])

  useEffect(() => {
    if (!user || !ready) return undefined
    if (skipNextSave.current) {
      skipNextSave.current = false
      return undefined
    }
    const t = setTimeout(() => {
      setPref(PREF_APP_SETTINGS, settings)
    }, 350)
    return () => clearTimeout(t)
  }, [settings, user, ready, setPref])

  const persist = useCallback((next) => {
    setSettingsState((prev) => (typeof next === 'function' ? next(prev) : next))
  }, [])

  const setCompanyName = useCallback(
    (value) => persist((prev) => ({ ...prev, companyName: value })),
    [persist]
  )
  const setAppTitle = useCallback(
    (value) => persist((prev) => ({ ...prev, appTitle: value })),
    [persist]
  )

  const addDepartment = useCallback(
    (name) => {
      const trimmed = String(name).trim()
      if (!trimmed) return
      persist((prev) => {
        const exists = prev.departments.some(
          (d) => d.toLowerCase() === trimmed.toLowerCase()
        )
        if (exists) return prev
        return { ...prev, departments: [...prev.departments, trimmed] }
      })
    },
    [persist]
  )

  const updateDepartment = useCallback(
    (index, newName) => {
      const trimmed = String(newName).trim()
      if (!trimmed) return
      persist((prev) => {
        const departments = [...prev.departments]
        const exists = departments.some(
          (d, i) => i !== index && d.toLowerCase() === trimmed.toLowerCase()
        )
        if (exists) return prev
        if (index >= 0 && index < departments.length) {
          departments[index] = trimmed
          return { ...prev, departments }
        }
        return prev
      })
    },
    [persist]
  )

  const deleteDepartment = useCallback(
    (index) => {
      persist((prev) => {
        const departments = prev.departments.filter((_, i) => i !== index)
        return { ...prev, departments: departments.length ? departments : ['General'] }
      })
    },
    [persist]
  )

  return {
    companyName: settings.companyName,
    appTitle: settings.appTitle,
    departments: settings.departments,
    setCompanyName,
    setAppTitle,
    addDepartment,
    updateDepartment,
    deleteDepartment,
    persist,
  }
}
