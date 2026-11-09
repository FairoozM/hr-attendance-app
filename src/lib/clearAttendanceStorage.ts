/** Best-effort cleanup of legacy month keys from older builds (browser localStorage only). */
export function clearAllAttendanceStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    Object.keys(localStorage).forEach((key) => {
      if (/^hr-attendance-\d{4}-\d{2}$/.test(key)) localStorage.removeItem(key)
    })
  } catch {
    // Storage can be unavailable (privacy mode); nothing to clean up then.
  }
}
