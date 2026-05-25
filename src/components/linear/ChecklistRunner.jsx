/**
 * ChecklistRunner.jsx
 * Modal for executing a doc checklist against an issue or release context.
 * State persisted to shared backend (Phase 14A). Falls back to localStorage.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X, CheckSquare, Square, RotateCcw, Copy, CheckCircle2,
  ClipboardList, CheckCheck,
} from 'lucide-react'
import {
  loadRun, saveRun, deleteRun,
  extractChecklistItems, itemKey, buildRunResultText,
} from '../../lib/linearChecklistRuns'
import {
  listChecklistRunsApi, upsertChecklistRunApi, deleteChecklistRunApi,
} from '../../lib/linearWorkspaceApi'
import './ChecklistRunner.css'

// ── Clipboard helper ───────────────────────────────────────────────────────

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true }
  catch {
    try {
      const ta = Object.assign(document.createElement('textarea'), {
        value: text, style: 'position:fixed;opacity:0',
      })
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      return true
    } catch { return false }
  }
}

// ── Main component ────────────────────────────────────────────────────────

/**
 * @param {{
 *   doc: object,
 *   contextType: "issue" | "release",
 *   contextId: string,
 *   contextLabel: string,
 *   onClose: () => void,
 * }} props
 */
export function ChecklistRunner({ doc, contextType, contextId, contextLabel, onClose }) {
  const items = useMemo(() => extractChecklistItems(doc?.content || ''), [doc?.id])

  const [completedItems, setCompletedItems] = useState({})
  const [notes, setNotes]                   = useState('')
  const [copied, setCopied]                 = useState(false)
  const backendRunId = useRef(null)   // server-assigned id for PATCH/DELETE

  // Load persisted run on mount — try backend first, fall back to localStorage
  useEffect(() => {
    if (!doc || !contextId) return
    let cancelled = false
    ;(async () => {
      try {
        const runs = await listChecklistRunsApi({ context_type: contextType, context_id: contextId })
        if (cancelled) return
        const docIdNum = typeof doc.id === 'number' ? doc.id : null
        const match = runs.find(r =>
          (docIdNum && r.doc_id === docIdNum) ||
          r.doc_title === doc.title
        )
        if (match) {
          backendRunId.current = match.id
          setCompletedItems(typeof match.completed_items === 'object' ? match.completed_items : {})
          setNotes(match.notes || '')
          return
        }
      } catch { /* fall through to localStorage */ }
      // localStorage fallback
      const run = loadRun(contextType, contextId, doc.id)
      if (run) {
        setCompletedItems(run.completedItems || {})
        setNotes(run.notes || '')
      } else {
        setCompletedItems({})
        setNotes('')
      }
    })()
    return () => { cancelled = true }
  }, [doc?.id, contextType, contextId])

  // Persist after every state change (debounced via the effect dep array)
  useEffect(() => {
    if (!doc || !contextId) return
    const docIdNum = typeof doc.id === 'number' ? doc.id : null
    // Always keep localStorage cache in sync
    saveRun(contextType, {
      id: `${contextId}__${doc.id}`,
      contextType, contextId,
      docId: doc.id, docTitle: doc.title,
      completedItems, notes,
    })
    // Try backend upsert
    upsertChecklistRunApi({
      context_type:    contextType,
      context_id:      contextId,
      doc_id:          docIdNum,
      doc_title:       doc.title,
      completed_items: completedItems,
      notes,
    }).then(result => {
      if (result?.id) backendRunId.current = result.id
    }).catch(() => { /* silently ignore — localStorage already updated */ })
  }, [completedItems, notes])

  // Computed progress
  const doneCount = useMemo(() => {
    return items.filter(it => completedItems[itemKey(doc.id, it)]).length
  }, [items, completedItems, doc?.id])

  const progressPct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  const toggleItem = useCallback((it) => {
    const k = itemKey(doc.id, it)
    setCompletedItems(prev => ({ ...prev, [k]: !prev[k] }))
  }, [doc?.id])

  const markAll = useCallback(() => {
    const next = {}
    for (const it of items) next[itemKey(doc.id, it)] = true
    setCompletedItems(next)
  }, [items, doc?.id])

  const reset = useCallback(() => {
    setCompletedItems({})
    setNotes('')
    if (doc && contextId) {
      deleteRun(contextType, contextId, doc.id)
      if (backendRunId.current) {
        deleteChecklistRunApi(backendRunId.current).catch(() => {})
        backendRunId.current = null
      }
    }
  }, [doc?.id, contextType, contextId])

  const handleCopy = useCallback(async () => {
    const text = buildRunResultText({ doc, contextLabel, items, completedItems, notes })
    await copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }, [doc, contextLabel, items, completedItems, notes])

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!doc) return null

  const allDone = items.length > 0 && doneCount === items.length

  return createPortal(
    <div className="cr-backdrop" role="dialog" aria-modal="true" aria-label={`Run checklist: ${doc.title}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cr-modal">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="cr-header">
          <div className="cr-header-left">
            <ClipboardList size={14} className="cr-header-icon" />
            <div>
              <p className="cr-title">{doc.title}</p>
              <p className="cr-context">{contextLabel}</p>
            </div>
          </div>
          <button type="button" className="cr-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* ── Progress bar ─────────────────────────────────────────────────── */}
        {items.length > 0 && (
          <div className="cr-progress-wrap">
            <div className="cr-progress-bar">
              <div
                className={`cr-progress-fill ${allDone ? 'cr-progress-fill--done' : ''}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="cr-progress-label">
              {allDone
                ? <><CheckCheck size={12} /> All done</>
                : <>{doneCount}/{items.length} complete</>
              }
            </span>
          </div>
        )}

        {/* ── Checklist items ──────────────────────────────────────────────── */}
        <div className="cr-body">
          {items.length === 0 ? (
            <p className="cr-empty">This doc has no checklist items.</p>
          ) : (
            <ul className="cr-items">
              {items.map((it, idx) => {
                const k    = itemKey(doc.id, it)
                const done = !!completedItems[k]
                return (
                  <li key={k} className={`cr-item ${done ? 'cr-item--done' : ''}`}>
                    <button
                      type="button"
                      className="cr-item-toggle"
                      onClick={() => toggleItem(it)}
                      aria-checked={done}
                      role="checkbox"
                      aria-label={it}
                    >
                      {done
                        ? <CheckSquare size={14} className="cr-item-icon cr-item-icon--done" />
                        : <Square size={14} className="cr-item-icon" />
                      }
                    </button>
                    <span className="cr-item-text">{it}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {/* ── Notes ───────────────────────────────────────────────────────── */}
          <div className="cr-notes-wrap">
            <label className="cr-notes-label" htmlFor="cr-notes">Notes</label>
            <textarea
              id="cr-notes"
              className="cr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add run notes, findings, or observations…"
              rows={3}
            />
          </div>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="cr-actions">
          <button type="button" className="cr-action cr-action--mark-all" onClick={markAll} disabled={allDone}>
            <CheckCheck size={12} /> Mark all complete
          </button>
          <button type="button" className="cr-action cr-action--reset" onClick={reset}>
            <RotateCcw size={12} /> Reset
          </button>
          <button
            type="button"
            className={`cr-action cr-action--copy ${copied ? 'cr-action--copied' : ''}`}
            onClick={handleCopy}
          >
            {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy result'}
          </button>
        </div>

      </div>
    </div>,
    document.body
  )
}
