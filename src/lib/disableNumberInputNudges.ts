/**
 * Disable native number-input nudging app-wide: scroll wheel and arrow keys must not
 * change values while a number field is focused. Spin buttons are hidden in index.css;
 * this removes the remaining browser behaviors users hit accidentally while typing.
 */
export function installDisableNumberInputNudges(): void {
  if (typeof document === 'undefined') return
  const doc = document as Document & { __numberInputNudgesInstalled?: boolean }
  if (doc.__numberInputNudgesInstalled) return
  doc.__numberInputNudgesInstalled = true

  const isFocusedNumberInput = () =>
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.type === 'number'

  const blockNudgeKeys = (event: KeyboardEvent) => {
    if (!isFocusedNumberInput()) return
    if (
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown'
    ) {
      event.preventDefault()
    }
  }

  const blockWheelNudge = (event: WheelEvent) => {
    if (!isFocusedNumberInput()) return
    event.preventDefault()
  }

  document.addEventListener('keydown', blockNudgeKeys, true)
  document.addEventListener('wheel', blockWheelNudge, { capture: true, passive: false })
}
