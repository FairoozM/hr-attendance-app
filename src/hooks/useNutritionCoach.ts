import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import * as api from '../api/nutritionCoach'

export type NutritionProfile = {
  id?: number
  display_name?: string
  age?: number
  gender?: string
  height_cm?: number
  heightCm?: number
  weight_kg?: number
  weightKg?: number
  target_weight_kg?: number
  targetWeightKg?: number
  waist_cm?: number
  waistCm?: number
  activity_level?: string
  activityLevel?: string
  job_activity_level?: string
  jobActivityLevel?: string
  sleep_hours?: number
  sleepHours?: number
  goal?: string
  workout_goal?: string
  workoutGoal?: string
  dietary_preference?: string
  dietaryPreference?: string
  allergies?: string
  disliked_foods?: string
  dislikedFoods?: string
  usual_meal_timing?: Record<string, string>
  usualMealTiming?: Record<string, string>
  gym_experience?: string
  gymExperience?: string
  available_gym_days?: string[]
  availableGymDays?: string[]
  injuries_pain_areas?: string
  injuriesPainAreas?: string
  medical_caution_notes?: string
  medicalCautionNotes?: string
  supplement_usage?: string
  supplementUsage?: string
  daily_water_baseline_ml?: number
  dailyWaterBaselineMl?: number
  caffeine_intake?: string
  caffeineIntake?: string
  digestion_probiotic_habits?: string
  digestionProbioticHabits?: string
  budget_level?: string
  budgetLevel?: string
  preferred_foods?: string
  preferredFoods?: string
  onboarding_completed?: boolean
  onboardingCompleted?: boolean
  medical_caution_flags?: Record<string, boolean>
  medicalCautionFlags?: Record<string, boolean>
}

export function useNutritionCoach(date?: string) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null)
  const [profile, setProfile] = useState<NutritionProfile | null>(null)
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null)
  const [foodLog, setFoodLog] = useState<unknown[]>([])
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [metaRes, profileRes, dashRes, logRes, sumRes] = await Promise.all([
        api.fetchNutritionMeta(),
        api.fetchNutritionProfile(),
        api.fetchNutritionDashboard(),
        api.fetchFoodLog(date),
        api.fetchDailySummary(date),
      ])
      setMeta(metaRes as Record<string, unknown>)
      setProfile((profileRes as { profile?: NutritionProfile }).profile || null)
      setDashboard((dashRes as { dashboard?: Record<string, unknown> }).dashboard || null)
      setFoodLog((logRes as { items?: unknown[] }).items || [])
      setSummary((sumRes as { summary?: Record<string, unknown> }).summary || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load nutrition data')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    reload()
  }, [reload])

  return {
    loading,
    error,
    meta,
    profile,
    dashboard,
    foodLog,
    summary,
    reload,
    saveProfile: async (body: Record<string, unknown>) => {
      await api.saveNutritionProfile(body)
      await reload()
    },
    addFoodItem: async (body: Record<string, unknown>) => {
      await api.addFoodLogItem(body)
      await reload()
    },
    removeFoodItem: async (id: number | string) => {
      await api.deleteFoodLogItem(id)
      await reload()
    },
  }
}

export function useNutritionProfile() {
  const location = useLocation()
  const [profile, setProfile] = useState<NutritionProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.fetchNutritionProfile()
      setProfile((res as { profile?: NutritionProfile }).profile || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload, location.pathname])

  return {
    profile,
    loading,
    reload,
    onboardingCompleted: !!(profile?.onboarding_completed ?? profile?.onboardingCompleted),
  }
}
