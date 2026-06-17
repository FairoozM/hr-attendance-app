import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listListingBatches } from '../api/listingBatches'

export function ListingBatchesPage() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    listListingBatches()
      .then((res) => setItems(res.items || []))
      .catch((err) => setError(err.message || 'Failed to load batches'))
  }, [])

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/10 via-transparent to-emerald-600/10 p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Amazon flat files</p>
        <h1 className="mt-1 text-3xl font-bold text-white">Listing Batches</h1>
        <p className="mt-2 text-sm text-slate-400">Resume previous uploads, continue generation, review approvals, and export completed files.</p>
      </header>
      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3">SKUs</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Generated</th>
              <th className="px-4 py-3">Approved</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-slate-200">
            {items.map((batch) => (
              <tr key={batch.id}>
                <td className="px-4 py-3">
                  <p className="font-bold">{batch.batch_name}</p>
                  <p className="text-xs text-slate-500">{batch.original_filename}</p>
                </td>
                <td className="px-4 py-3">{new Date(batch.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">{batch.imported_count} / 330</td>
                <td className="px-4 py-3">{batch.status}</td>
                <td className="px-4 py-3">{batch.summary_counts?.Generated || 0}</td>
                <td className="px-4 py-3">{batch.summary_counts?.Approved || 0}</td>
                <td className="px-4 py-3">
                  <Link className="rounded-lg px-3 py-1 text-xs font-bold text-violet-200 ring-1 ring-violet-400/30" to={`/ai/amazon-bulk-listing?batch=${batch.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 ? <tr><td className="px-4 py-10 text-center text-slate-400" colSpan="7">No listing batches yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
