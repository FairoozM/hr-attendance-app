/** Read a string search param, falling back when missing or empty. */
export function readStringParam(
  params: URLSearchParams,
  key: string,
  defaultValue = '',
): string {
  const raw = params.get(key)
  if (raw == null || raw === '') return defaultValue
  return raw
}

/** Read an enum-like param; invalid values return defaultValue. */
export function readEnumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const raw = params.get(key)
  if (raw == null || raw === '') return defaultValue
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue
}

/** Read integer param; invalid values return defaultValue. */
export function readIntParam(
  params: URLSearchParams,
  key: string,
  defaultValue: number,
  options?: { min?: number; max?: number },
): number {
  const raw = params.get(key)
  if (raw == null || raw === '') return defaultValue
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return defaultValue
  if (options?.min != null && n < options.min) return defaultValue
  if (options?.max != null && n > options.max) return defaultValue
  return n
}

/** Set or delete a param when value equals default (keeps URLs clean). */
export function writeParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue = '',
): void {
  if (value === defaultValue || value === '') {
    params.delete(key)
  } else {
    params.set(key, value)
  }
}

/** Clone search params and apply a mutator. */
export function mergeSearchParams(
  prev: URLSearchParams,
  mutator: (next: URLSearchParams) => void,
): URLSearchParams {
  const next = new URLSearchParams(prev)
  mutator(next)
  return next
}
