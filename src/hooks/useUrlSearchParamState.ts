import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mergeSearchParams, readEnumParam, readIntParam, readStringParam, writeParam } from '../lib/urlSearchParams'

type StringOptions<T extends string> = {
  defaultValue: T
  allowed?: readonly T[]
  replace?: boolean
}

type IntOptions = {
  defaultValue: number
  min?: number
  max?: number
  replace?: boolean
}

/** Sync a string search param with React state (enum-validated when `allowed` is set). */
export function useUrlSearchParamState<T extends string>(
  key: string,
  options: StringOptions<T>,
): [T, (value: T) => void] {
  const { defaultValue, allowed, replace = true } = options
  const [searchParams, setSearchParams] = useSearchParams()

  const value = useMemo(() => {
    if (allowed?.length) {
      return readEnumParam(searchParams, key, allowed, defaultValue)
    }
    return readStringParam(searchParams, key, defaultValue) as T
  }, [searchParams, key, allowed, defaultValue])

  const setValue = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) =>
          mergeSearchParams(prev, (params) => {
            writeParam(params, key, next, defaultValue)
          }),
        { replace },
      )
    },
    [setSearchParams, key, defaultValue, replace],
  )

  // Strip invalid enum values from the URL on load.
  useEffect(() => {
    if (!allowed?.length) return
    const raw = searchParams.get(key)
    if (raw == null || raw === '') return
    if (!(allowed as readonly string[]).includes(raw)) {
      setSearchParams(
        (prev) =>
          mergeSearchParams(prev, (params) => {
            params.delete(key)
          }),
        { replace: true },
      )
    }
  }, [searchParams, key, allowed, setSearchParams])

  return [value, setValue]
}

/** Sync a free-form string search param (e.g. search query). */
export function useUrlStringParamState(
  key: string,
  defaultValue = '',
  replace = true,
): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()

  const value = useMemo(
    () => readStringParam(searchParams, key, defaultValue),
    [searchParams, key, defaultValue],
  )

  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) =>
          mergeSearchParams(prev, (params) => {
            writeParam(params, key, next, defaultValue)
          }),
        { replace },
      )
    },
    [setSearchParams, key, defaultValue, replace],
  )

  return [value, setValue]
}

/** Sync an integer search param. */
export function useUrlIntParamState(
  key: string,
  options: IntOptions,
): [number, (value: number) => void] {
  const { defaultValue, min, max, replace = true } = options
  const [searchParams, setSearchParams] = useSearchParams()

  const value = useMemo(
    () => readIntParam(searchParams, key, defaultValue, { min, max }),
    [searchParams, key, defaultValue, min, max],
  )

  const setValue = useCallback(
    (next: number) => {
      setSearchParams(
        (prev) =>
          mergeSearchParams(prev, (params) => {
            writeParam(params, key, String(next), String(defaultValue))
          }),
        { replace },
      )
    },
    [setSearchParams, key, defaultValue, replace],
  )

  return [value, setValue]
}

/** Batch-update multiple search params in one navigation. */
export function useUrlSearchParamBatch() {
  const [, setSearchParams] = useSearchParams()

  return useCallback(
    (
      updates: Record<string, string | number | null | undefined>,
      replace = true,
    ) => {
      setSearchParams(
        (prev) =>
          mergeSearchParams(prev, (params) => {
            for (const [key, val] of Object.entries(updates)) {
              if (val == null || val === '') {
                params.delete(key)
              } else {
                params.set(key, String(val))
              }
            }
          }),
        { replace },
      )
    },
    [setSearchParams],
  )
}
