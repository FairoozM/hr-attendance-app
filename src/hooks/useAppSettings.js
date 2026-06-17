import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_DEPARTMENTS } from '../constants/employees'

const STORAGE_KEY = 'hr-attendance-settings'
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

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return {
          companyName: parsed.companyName ?? defaultSettings.companyName,
          appTitle: normalizeAppTitle(parsed.appTitle),
          departments:
          Array.isArray(parsed.departments) && parsed.departments.length > 0
            ? parsed.departments
            : defaultSettings.departments,
        }
      }
    }
  } catch (_) {}
  return { ...defaultSettings }
}

function save(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (_) {}
}

export function useAppSettings() {
  const [settings, setSettingsState] = useState(load)

  useEffect(() => {
    save(settings)
  }, [settings])

  const persist = useCallback((next) => {
    setSettingsState((prev) => {
      const nextSettings = typeof next === 'function' ? next(prev) : next
      save(nextSettings)
      return nextSettings
    })
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
