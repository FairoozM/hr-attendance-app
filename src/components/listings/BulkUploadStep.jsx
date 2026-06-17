export function BulkUploadStep({ file, batchName, busy, onFileChange, onBatchNameChange, onUpload }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="text-lg font-bold text-white">Upload Amazon flat file</h2>
      <p className="mt-1 text-sm text-slate-400">
        Upload the Seller Central flat file after you fill product identity and business fields. The Template sheet remains
        the source of truth.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="block text-xs font-semibold text-slate-400">
          Batch name
          <input
            value={batchName}
            onChange={(e) => onBatchNameChange(e.target.value)}
            placeholder="Life Smile Amazon UAE batch"
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-400">
          Flat file (.xlsx, .xlsm, .xls)
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={(e) => onFileChange(e.target.files?.[0] || null)}
            className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-violet-500/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-violet-100"
          />
        </label>
        <button
          type="button"
          disabled={!file || busy}
          onClick={onUpload}
          className="self-end rounded-xl bg-violet-500 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Uploading...' : 'Upload'}
        </button>
      </div>
    </section>
  )
}
