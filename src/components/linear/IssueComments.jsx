/**
 * IssueComments — plain-text comments for an issue.
 */
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Send } from 'lucide-react'
import { commentsApi } from '../../lib/projectsApi'

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function IssueComments({ projectId, issueId, refreshKey = 0 }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async () => {
    if (!projectId || !issueId) return
    setLoading(true)
    setError('')
    try {
      const rows = await commentsApi.list(projectId, issueId)
      setComments(rows)
    } catch (err) {
      setError(err.message || 'Failed to load comments')
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [projectId, issueId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function handlePost(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setPosting(true)
    setError('')
    try {
      await commentsApi.create(projectId, issueId, text)
      setBody('')
      await load()
    } catch (err) {
      setError(err.message || 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="icm">
      {loading && (
        <div className="icm__status">
          <Loader2 size={14} className="icm__spin" aria-hidden="true" />
          Loading comments…
        </div>
      )}

      {error && (
        <div className="icm__error" role="alert">{error}</div>
      )}

      {!loading && comments.length === 0 && !error && (
        <p className="icm__empty">No comments yet. Start the discussion below.</p>
      )}

      <ul className="icm__list">
        {comments.map((c) => (
          <li key={c.id} className="icm__item">
            <div className="icm__meta">
              <span className="icm__author">{c.authorName}</span>
              <time className="icm__time" dateTime={c.createdAt}>{fmtWhen(c.createdAt)}</time>
            </div>
            <p className="icm__body">{c.body}</p>
          </li>
        ))}
      </ul>

      <form className="icm__form" onSubmit={handlePost}>
        <textarea
          className="icm__input"
          rows={3}
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={posting}
        />
        <button
          type="submit"
          className="icm__submit"
          disabled={posting || !body.trim()}
        >
          {posting ? (
            <Loader2 size={14} className="icm__spin" aria-hidden="true" />
          ) : (
            <Send size={14} strokeWidth={2} aria-hidden="true" />
          )}
          Comment
        </button>
      </form>
    </div>
  )
}

export default IssueComments
