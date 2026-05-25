/**
 * AttachmentAIAnalysis
 *
 * Fetches AI vision analysis for an image attachment and presents:
 *   - Summary
 *   - Observations
 *   - Suggested Issue Description (+ Append to Issue button)
 *   - Acceptance Criteria (+ Append button)
 *   - QA Checklist (+ Copy button)
 *   - Cursor Prompt (+ Copy button)
 *   - Classify As (+ set kind without auto-save)
 *
 * Does NOT auto-save. All actions require explicit user interaction.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles, X, Copy, Check, ChevronDown, ChevronUp,
  AlertCircle, Loader2, Plus, Tag,
} from 'lucide-react'
import { analyzeIssueAttachment } from '../../lib/projectsApi'
import './AttachmentAIAnalysis.css'

// Classify options shown in the AI panel (subset relevant to AI context)
const AI_CLASSIFY_OPTIONS = [
  { value: 'bug_evidence',     label: 'Bug Evidence' },
  { value: 'qa_proof',         label: 'QA Proof' },
  { value: 'design_reference', label: 'Design Reference' },
  { value: 'release_evidence', label: 'Release Evidence' },
  { value: 'before',           label: 'Before' },
  { value: 'after',            label: 'After' },
]

// ── Copy helper ────────────────────────────────────────────────────────────────

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
  }
  return legacyCopy(text)
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch { /* ignore */ }
  return Promise.resolve()
}

// ── CopyBtn ────────────────────────────────────────────────────────────────────

function CopyBtn({ text, label = 'Copy', size = 'sm' }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      type="button"
      className={`aaa__copy-btn aaa__copy-btn--${size} ${copied ? 'aaa__copy-btn--done' : ''}`}
      onClick={handleCopy}
      title={label}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Section ────────────────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="aaa__section">
      <button
        type="button"
        className="aaa__section-header"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="aaa__section-title">{title}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && <div className="aaa__section-body">{children}</div>}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * @param {{
 *   projectId: number,
 *   taskId: number,
 *   attachmentId: number,
 *   fileName: string,
 *   onClose: () => void,
 *   onAppendDescription: (text: string) => void,
 *   onClassify?: (kind: string) => void,
 * }} props
 */
export function AttachmentAIAnalysis({
  projectId,
  taskId,
  attachmentId,
  fileName,
  onClose,
  onAppendDescription,
  onClassify,
}) {
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [analysis, setAnalysis] = useState(null)

  // Track which "Append"/"Classify" buttons showed a success flash
  const [appended,    setAppended]    = useState({})
  const [classified,  setClassified]  = useState(null) // currently set kind

  const flash = useCallback((key) => {
    setAppended((p) => ({ ...p, [key]: true }))
    setTimeout(() => setAppended((p) => ({ ...p, [key]: false })), 1800)
  }, [])

  // Fetch on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await analyzeIssueAttachment(projectId, taskId, attachmentId)
        if (cancelled) return
        if (res?.success && res.analysis) {
          setAnalysis(res.analysis)
        } else {
          setError(res?.message || 'Image analysis is not configured.')
        }
      } catch (err) {
        if (cancelled) return
        setError(err.message || 'Image analysis failed. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, taskId, attachmentId])

  // Helpers for appending to the issue description
  const handleAppendDescription = () => {
    if (!analysis?.suggestedIssueDescription) return
    onAppendDescription(analysis.suggestedIssueDescription)
    flash('description')
  }

  const handleAppendAC = () => {
    if (!analysis?.acceptanceCriteria?.length) return
    const text = analysis.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    onAppendDescription(`**Acceptance Criteria**\n\n${text}`)
    flash('ac')
  }

  const handleClassify = (kindValue) => {
    if (!onClassify) return
    onClassify(kindValue)
    setClassified(kindValue)
  }

  const listText = (items) =>
    Array.isArray(items) ? items.map((s) => `- ${s}`).join('\n') : ''

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="aaa" role="dialog" aria-label="AI Analysis">
      {/* Header */}
      <div className="aaa__header">
        <span className="aaa__header-icon">
          <Sparkles size={14} />
        </span>
        <span className="aaa__header-title">
          AI Analysis
          {fileName && (
            <span className="aaa__header-file" title={fileName}>
              {' — '}{fileName.length > 30 ? `${fileName.slice(0, 27)}…` : fileName}
            </span>
          )}
        </span>
        <button type="button" className="aaa__close" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="aaa__body">
        {loading && (
          <div className="aaa__loading">
            <Loader2 size={18} className="aaa__spin" />
            <span>Analyzing screenshot with AI…</span>
          </div>
        )}

        {!loading && error && (
          <div className="aaa__error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && analysis && (
          <>
            {/* Summary */}
            <Section title="Summary">
              <p className="aaa__summary">{analysis.summary}</p>
              <div className="aaa__row-actions">
                <CopyBtn text={analysis.summary} label="Copy Summary" />
              </div>
            </Section>

            {/* Observations */}
            {analysis.observations?.length > 0 && (
              <Section title="Observations">
                <ul className="aaa__list">
                  {analysis.observations.map((obs, i) => (
                    <li key={i}>{obs}</li>
                  ))}
                </ul>
                <div className="aaa__row-actions">
                  <CopyBtn text={listText(analysis.observations)} label="Copy All" />
                </div>
              </Section>
            )}

            {/* Suggested Description */}
            {analysis.suggestedIssueDescription && (
              <Section title="Suggested Issue Description">
                <p className="aaa__para">{analysis.suggestedIssueDescription}</p>
                <div className="aaa__row-actions">
                  <CopyBtn text={analysis.suggestedIssueDescription} label="Copy" />
                  <button
                    type="button"
                    className={`aaa__append-btn ${appended.description ? 'aaa__append-btn--done' : ''}`}
                    onClick={handleAppendDescription}
                    title="Append to issue description"
                  >
                    {appended.description
                      ? <><Check size={12} /> Appended</>
                      : <><Plus size={12} /> Append to Description</>
                    }
                  </button>
                </div>
              </Section>
            )}

            {/* Acceptance Criteria */}
            {analysis.acceptanceCriteria?.length > 0 && (
              <Section title="Acceptance Criteria">
                <ol className="aaa__list aaa__list--ordered">
                  {analysis.acceptanceCriteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ol>
                <div className="aaa__row-actions">
                  <CopyBtn
                    text={analysis.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
                    label="Copy"
                  />
                  <button
                    type="button"
                    className={`aaa__append-btn ${appended.ac ? 'aaa__append-btn--done' : ''}`}
                    onClick={handleAppendAC}
                    title="Append acceptance criteria to issue description"
                  >
                    {appended.ac
                      ? <><Check size={12} /> Appended</>
                      : <><Plus size={12} /> Append to Description</>
                    }
                  </button>
                </div>
              </Section>
            )}

            {/* QA Checklist */}
            {analysis.qaChecklist?.length > 0 && (
              <Section title="QA Checklist">
                <ul className="aaa__list">
                  {analysis.qaChecklist.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
                <div className="aaa__row-actions">
                  <CopyBtn
                    text={analysis.qaChecklist.map((c) => `- [ ] ${c}`).join('\n')}
                    label="Copy QA Checklist"
                  />
                </div>
              </Section>
            )}

            {/* Cursor Prompt */}
            {analysis.cursorPrompt && (
              <Section title="Cursor Prompt" defaultOpen={false}>
                <pre className="aaa__pre">{analysis.cursorPrompt}</pre>
                <div className="aaa__row-actions">
                  <CopyBtn text={analysis.cursorPrompt} label="Copy Cursor Prompt" />
                </div>
              </Section>
            )}

            {/* Classify screenshot */}
            {onClassify && (
              <Section title="Classify Screenshot" defaultOpen={true}>
                <p className="aaa__classify-hint">
                  Save this screenshot to the issue under a specific category.
                </p>
                <div className="aaa__classify-grid">
                  {AI_CLASSIFY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`aaa__classify-btn ${classified === opt.value ? 'aaa__classify-btn--active' : ''}`}
                      onClick={() => handleClassify(opt.value)}
                      title={`Classify as ${opt.label}`}
                    >
                      {classified === opt.value ? <Check size={11} /> : <Tag size={11} />}
                      {opt.label}
                      {classified === opt.value && <span className="aaa__classify-check"> ✓</span>}
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
