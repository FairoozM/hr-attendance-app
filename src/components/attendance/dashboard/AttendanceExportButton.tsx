type Props = {
  onExport: () => void
  disabled?: boolean
  label?: string
}

export function AttendanceExportButton({
  onExport,
  disabled,
  label = 'Export CSV',
}: Props) {
  return (
    <button
      type="button"
      className="adash__btn adash__btn--export"
      onClick={onExport}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
