/**
 * IssueAIAssistant — AI tab inside IssueDetailPanel.
 * Drafts titles, descriptions, acceptance criteria, QA checklists,
 * Cursor prompts, and release notes — powered by the backend.
 *
 * Safety: outputs are NEVER saved automatically. The user must
 * explicitly click Insert / Append / Replace.
 */
import { useState, useCallback } from 'react'
import { Sparkles, Copy, Check, ChevronDown, ChevronRight, AlertCircle, Loader2 } from 'lucide-react'
import { linearIssueAiAssist } from '../../lib/projectsApi'
import './IssueAIAssistant.css'

const ACTIONS = [
  { id: 'improve_title',       label: 'Improve Title',       hint: 'Get 3 alternative title options' },
  { id: 'draft_description',   label: 'Draft Description',   hint: 'Context · Problem · Outcome · Notes' },
  { id: 'acceptance_criteria', label: 'Acceptance Criteria', hint: 'Checklist of done conditions' },
  { id: 'qa_checklist',        label: 'QA Checklist',        hint: 'Platform-adapted test checklist' },
  { id: 'cursor_prompt',       label: 'Cursor Prompt',       hint: 'Cursor-ready implementation prompt' },
  { id: 'release_note',        label: 'Release Note',        hint: 'Short internal release note' },
]

/**
 * Parse "improve_title" output into an array of 3 options.
 * The model returns them newline-separated.
 */
function parseTitleOptions(output = '') {
  return output
    .split('\n')
    .map((l) => l.replace(/^[\d.\-*)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

export function IssueAIAssistant({ issue, project, onInsertDescription, onAppendDescription, onReplaceTitle }) {
  const [activeAction, setActiveAction] = useState(null)
  const [loading, setLoading]           = useState(false)
  const [output, setOutput]             = useState('')
  const [error, setError]               = useState('')
  const [copied, setCopied]             = useState(false)
  const [selectedTitle, setSelectedTitle] = useState(null)
  const [extraContext, setExtraContext]  = useState('')
  const [extraOpen, setExtraOpen]       = useState(false)

  const run = useCallback(async (actionId) => {
    if (!issue || !project) return
    setActiveAction(actionId)
    setLoading(true)
    setOutput('')
    setError('')
    setSelectedTitle(null)
    try {
      const result = await linearIssueAiAssist(project.id, issue.id, actionId, extraContext)
      setOutput(result.output)
    } catch (err) {
      setError(err.message || 'AI request failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [issue, project, extraContext])

  const handleCopy = useCallback(() => {
    const text = activeAction === 'improve_title' && selectedTitle ? selectedTitle : output
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Fallback: select all text in a temporary textarea
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Copy not available in this context
      }
    })
  }, [output, activeAction, selectedTitle])

  const handleInsert = useCallback(() => {
    onInsertDescription?.(output)
  }, [output, onInsertDescription])

  const handleAppend = useCallback(() => {
    onAppendDescription?.(output)
  }, [output, onAppendDescription])

  const handleReplaceTitle = useCallback(() => {
    if (selectedTitle) onReplaceTitle?.(selectedTitle)
  }, [selectedTitle, onReplaceTitle])

  const isTitleAction = activeAction === 'improve_title'
  const titleOptions  = isTitleAction && output ? parseTitleOptions(output) : []

  return (
    <div className="iai">
      <div className="iai__header">
        <Sparkles size={15} className="iai__header-icon" aria-hidden="true" />
        <span className="iai__header-title">AI Assistant</span>
        <span className="iai__header-hint">Draft clearer specs, QA checks, and Cursor prompts.</span>
      </div>

      {/* Action buttons */}
      <div className="iai__actions">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`iai__action-btn ${activeAction === a.id ? 'iai__action-btn--active' : ''}`}
            onClick={() => run(a.id)}
            disabled={loading}
            title={a.hint}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Optional extra context */}
      <div className="iai__extra">
        <button
          type="button"
          className="iai__extra-toggle"
          onClick={() => setExtraOpen((v) => !v)}
        >
          {extraOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Extra context (optional)
        </button>
        {extraOpen && (
          <textarea
            className="iai__extra-input"
            rows={2}
            placeholder="Add any extra context to guide the AI…"
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
          />
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="iai__loading" aria-live="polite">
          <Loader2 size={16} className="iai__spinner" aria-hidden="true" />
          Generating…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="iai__error" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Output area */}
      {output && !loading && !error && (
        <div className="iai__output-wrap">
          {/* Title options selector */}
          {isTitleAction && titleOptions.length > 0 ? (
            <div className="iai__title-options">
              <p className="iai__title-options-label">Select an option to replace title:</p>
              {titleOptions.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  className={`iai__title-option ${selectedTitle === opt ? 'iai__title-option--selected' : ''}`}
                  onClick={() => setSelectedTitle(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <pre className="iai__output">{output}</pre>
          )}

          {/* Action toolbar */}
          <div className="iai__toolbar">
            <button
              type="button"
              className="iai__toolbar-btn"
              onClick={handleCopy}
              title="Copy to clipboard"
            >
              {copied
                ? <><Check size={13} /> Copied</>
                : <><Copy size={13} /> Copy</>
              }
            </button>

            {isTitleAction ? (
              <button
                type="button"
                className="iai__toolbar-btn iai__toolbar-btn--primary"
                onClick={handleReplaceTitle}
                disabled={!selectedTitle}
                title="Replace issue title with selected option"
              >
                Replace Title
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="iai__toolbar-btn iai__toolbar-btn--primary"
                  onClick={handleInsert}
                  title="Replace description with this output"
                >
                  Insert into Description
                </button>
                <button
                  type="button"
                  className="iai__toolbar-btn"
                  onClick={handleAppend}
                  title="Append to existing description"
                >
                  Append to Description
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
