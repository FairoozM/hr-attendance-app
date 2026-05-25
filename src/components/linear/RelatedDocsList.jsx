/**
 * RelatedDocsList.jsx
 * Compact, reusable list of related docs for issue panels, dev/QA tabs, and releases.
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Copy, CheckCircle2, ArrowRight, ClipboardList } from 'lucide-react'
import { extractChecklistItems } from '../../lib/linearChecklistRuns'
import './RelatedDocsList.css'

const CAT_COLORS = {
  'Website':          '#3b82f6',
  'Android App':      '#10b981',
  'iOS App':          '#6366f1',
  'Backend/API':      '#f59e0b',
  'UX/UI':            '#ec4899',
  'Data & BI':        '#8b5cf6',
  'Releases':         '#0891b2',
  'QA':               '#059669',
  'Troubleshooting':  '#ef4444',
  'SOP':              '#7c3aed',
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      return true
    } catch { return false }
  }
}

function DocRow({ doc, onRunChecklist }) {
  const [copied, setCopied] = useState(false)
  const color = CAT_COLORS[doc.category] || '#9ca3af'
  const hasItems = extractChecklistItems(doc.content || '').length > 0

  const handleCopy = useCallback(async (e) => {
    e.stopPropagation()
    await copyText(doc.content || doc.summary || doc.title)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }, [doc])

  return (
    <div className="rdl__row">
      <span className="rdl__cat" style={{ '--rdl-cat': color }}>{doc.category}</span>
      <span className="rdl__title" title={doc.summary || doc.title}>{doc.title}</span>
      {onRunChecklist && hasItems && (
        <button
          type="button"
          className="rdl__run"
          onClick={(e) => { e.stopPropagation(); onRunChecklist(doc) }}
          title="Run checklist"
        >
          <ClipboardList size={11} />
          Run
        </button>
      )}
      <button
        type="button"
        className={`rdl__copy ${copied ? 'rdl__copy--ok' : ''}`}
        onClick={handleCopy}
        title="Copy doc content"
      >
        {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/**
 * @param {{
 *   docs: object[],
 *   emptyMessage?: string,
 *   showViewAll?: boolean,
 *   onRunChecklist?: (doc: object) => void,
 * }} props
 */
export function RelatedDocsList({ docs = [], emptyMessage = 'No related docs.', showViewAll = true, onRunChecklist }) {
  const navigate = useNavigate()

  if (docs.length === 0) {
    return (
      <div className="rdl rdl--empty">
        <BookOpen size={12} className="rdl__empty-icon" />
        <span className="rdl__empty-text">{emptyMessage}</span>
        {showViewAll && (
          <button type="button" className="rdl__view-all" onClick={() => navigate('/projects/linear/docs')}>
            <ArrowRight size={11} /> View Docs
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="rdl">
      {docs.map(d => <DocRow key={d.id} doc={d} onRunChecklist={onRunChecklist} />)}
      {showViewAll && (
        <button type="button" className="rdl__view-all" onClick={() => navigate('/projects/linear/docs')}>
          <ArrowRight size={11} /> View all docs
        </button>
      )}
    </div>
  )
}
