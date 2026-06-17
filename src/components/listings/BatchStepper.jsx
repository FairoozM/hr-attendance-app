const STEPS = [
  'Upload Amazon Flat File',
  'Detect Columns & SKUs',
  'Batch Defaults & Rules',
  'Validate Required Fields',
  'Generate AI Content',
  'Review Exceptions',
  'Export Amazon Flat File',
]

export function BatchStepper({ currentStep = 0 }) {
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {STEPS.map((step, index) => (
        <div
          key={step}
          className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
            index <= currentStep
              ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
              : 'border-white/10 bg-white/[0.03] text-slate-400'
          }`}
        >
          <span className="block text-[10px] uppercase tracking-[0.16em] opacity-70">Step {index + 1}</span>
          {step}
        </div>
      ))}
    </div>
  )
}
