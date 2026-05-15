import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from '../api/client'
import { useAuth } from './AuthContext'
import {
  clearPrefCache,
  hydratePrefCache,
  registerUserPrefSaver,
  setUserPrefKeyLocal,
  getUserPrefKey,
} from '../lib/userPreferencesBridge'
import {
  collectLegacyPreferencePatches,
  removeMigratedPreferenceLocalKeys,
  migrateWeeklyAdsWarHistoryFromLocalStorage,
} from '../lib/legacyStorageMigration'

const UserPreferencesContext = createContext(null)

const debounceMs = 450
const debouncers = new Map()

function scheduleDebounced(key, fn) {
  const prev = debouncers.get(key)
  if (prev) clearTimeout(prev)
  const t = setTimeout(() => {
    debouncers.delete(key)
    fn()
  }, debounceMs)
  debouncers.set(key, t)
}

export function UserPreferencesProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState(0)
  const prefsRef = useRef({})

  const mergeAndHydrate = useCallback((next) => {
    const merged = { ...prefsRef.current, ...(next && typeof next === 'object' ? next : {}) }
    prefsRef.current = merged
    hydratePrefCache(merged)
    setVersion((v) => v + 1)
  }, [])

  const flushPut = useCallback(async (key, value) => {
    const res = await api.put('/api/user-preferences', { key, value })
    const p = res?.preferences && typeof res.preferences === 'object' ? res.preferences : null
    if (p) mergeAndHydrate(p)
  }, [mergeAndHydrate])

  useEffect(() => {
    const saver = (key, value) => {
      setUserPrefKeyLocal(key, value)
      prefsRef.current = { ...prefsRef.current, [key]: value }
      setVersion((v) => v + 1)
      scheduleDebounced(key, () => {
        flushPut(key, getUserPrefKey(key)).catch((e) => {
          console.warn('[userPreferences] save failed', key, e?.message || e)
        })
      })
    }
    registerUserPrefSaver(saver)
    return () => registerUserPrefSaver(null)
  }, [flushPut])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      clearPrefCache()
      prefsRef.current = {}
      setReady(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setReady(false)
      try {
        const first = await api.get('/api/user-preferences')
        if (cancelled) return
        let prefs = first?.preferences && typeof first.preferences === 'object' ? { ...first.preferences } : {}
        const patches = collectLegacyPreferencePatches(prefs)
        for (const { key, value } of patches) {
          const res = await api.put('/api/user-preferences', { key, value })
          if (cancelled) return
          if (res?.preferences && typeof res.preferences === 'object') prefs = { ...res.preferences }
        }
        if (patches.length) removeMigratedPreferenceLocalKeys()
        await migrateWeeklyAdsWarHistoryFromLocalStorage()
        if (cancelled) return
        const finalRes = patches.length ? await api.get('/api/user-preferences') : { preferences: prefs }
        if (cancelled) return
        const finalPrefs =
          finalRes?.preferences && typeof finalRes.preferences === 'object' ? finalRes.preferences : prefs
        prefsRef.current = finalPrefs
        hydratePrefCache(finalPrefs)
        setReady(true)
        setVersion((v) => v + 1)
      } catch (e) {
        console.warn('[userPreferences] load failed', e?.message || e)
        clearPrefCache()
        prefsRef.current = {}
        setReady(true)
        setVersion((v) => v + 1)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id, authLoading])

  const getPref = useCallback((key, defaultValue) => {
    if (Object.prototype.hasOwnProperty.call(prefsRef.current, key)) {
      const v = prefsRef.current[key]
      return v === undefined ? defaultValue : v
    }
    return getUserPrefKey(key, defaultValue)
  }, [])

  const setPref = useCallback((key, value) => {
    setUserPrefKeyLocal(key, value)
    prefsRef.current = { ...prefsRef.current, [key]: value }
    setVersion((v) => v + 1)
    scheduleDebounced(key, () => {
      flushPut(key, getUserPrefKey(key)).catch((e) => {
        console.warn('[userPreferences] setPref save failed', key, e?.message || e)
      })
    })
  }, [flushPut])

  const value = useMemo(
    () => ({
      ready,
      prefsVersion: version,
      getPref,
      setPref,
    }),
    [ready, version, getPref, setPref]
  )

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
}

export function useUserPreferences() {
  const ctx = useContext(UserPreferencesContext)
  if (!ctx) throw new Error('useUserPreferences must be used within UserPreferencesProvider')
  return ctx
}
