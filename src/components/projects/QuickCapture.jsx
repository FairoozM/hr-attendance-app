import { useState, useRef, useEffect } from 'react'
import { Zap, X } from 'lucide-react'
import { parseCapture, CATEGORY_META } from '../../lib/aiEngine'

export function QuickCapture({ onSubmit, projects = [], defaultProjectId = null, loading = false }) {
  const [text, setText]           = useState('')
  const [preview, setPreview]     = useState(null)
  const [projectId, setProjectId] = useState(defaultProjectId || '')
  const inputRef = useRef(null)

  // Parse in real-time as user types
  useEffect(() => {
    if (text.trim().length > 3) {
      setPreview(parseCapture(text))
    } else {
      setPreview(null)
    }
  }, [text])

  // Auto-select first project if none chosen
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id)
  }, [projects, projectId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim() || !projectId) return
    await onSubmit(text, Number(projectId))
    setText('')
    setPreview(null)
    inputRef.current?.focus()
  }

  const catMeta = preview ? CATEGORY_META[preview.category] : null

  return (
    <div className="ai-capture">
      <form className="ai-capture__form" onSubmit={handleSubmit}>
        <div className="ai-capture__icon" aria-hidden>
          <Zap size={16} />
        </div>
        <input
          ref={inputRef}
          className="ai-capture__input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder='Quick capture… e.g. "Check Amazon VAT invoices tomorrow at 10am"'
          aria-label="Quick capture task"
          autoComplete="off"
          spellCheck={false}
        />
        {text && (
          <button type="button" className="ai-capture__clear" onClick={() => { setText(''); setPreview(null) }} aria-label="Clear">
            <X size={14} />
          </button>
        )}
        {projects.length > 1 && (
          <select
            className="ai-capture__project"
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            aria-label="Target project"
          >
            {projects.filter(p => !p.archived).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="ai-capture__btn"
          disabled={!text.trim() || !projectId || loading}
        >
          {loading ? '…' : 'Add'}
        </button>
      </form>

      {/* Live AI preview */}
      {preview && (
        <div className="ai-capture__preview">
          <span className="ai-capture__preview-title">{preview.title}</span>
          <div className="ai-capture__preview-tags">
            {catMeta && (
              <span className="ai-capture__preview-tag" style={{ color: catMeta.color, background: catMeta.bg }}>
                {catMeta.icon} {preview.category}
              </span>
            )}
            {preview.suggestedDate && (
              <span className="ai-capture__preview-tag ai-capture__preview-tag--date">
                📅 {new Date(preview.suggestedDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
            )}
            {preview.suggestedTime && (
              <span className="ai-capture__preview-tag ai-capture__preview-tag--time">
                🕐 {preview.suggestedTime}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
