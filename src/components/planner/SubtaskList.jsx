import { useState, useRef, useEffect } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'

function SubtaskRow({ taskId, sub }) {
  const { toggleSubtask, updateSubtask, deleteSubtask } = useAIPlanner()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sub.title)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commitEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== sub.title) {
      updateSubtask(taskId, sub.id, trimmed)
    } else {
      setDraft(sub.title)
    }
    setEditing(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') { setDraft(sub.title); setEditing(false) }
  }

  return (
    <div className="aip-sub-row">
      {/* Checkbox */}
      <button
        className={`aip-sub-check ${sub.done ? 'checked' : ''}`}
        onClick={() => toggleSubtask(taskId, sub.id)}
        aria-label={sub.done ? 'Mark incomplete' : 'Mark complete'}
      />

      {/* Title — inline editable */}
      {editing ? (
        <input
          ref={inputRef}
          className="aip-sub-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span
          className={`aip-sub-title ${sub.done ? 'done' : ''}`}
          onDoubleClick={() => !sub.done && setEditing(true)}
          title="Double-click to edit"
        >
          {sub.title}
        </span>
      )}

      {/* Delete */}
      <button
        className="aip-sub-delete"
        onClick={() => deleteSubtask(taskId, sub.id)}
        aria-label="Delete subtask"
        title="Delete subtask"
      >
        ✕
      </button>
    </div>
  )
}

export function SubtaskList({ taskId, subtasks = [] }) {
  const { addSubtask } = useAIPlanner()
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  function handleAdd() {
    const trimmed = newTitle.trim()
    if (trimmed) {
      addSubtask(taskId, trimmed)
      setNewTitle('')
      // keep focus for rapid entry
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') { setNewTitle(''); setAdding(false) }
  }

  const doneCount = subtasks.filter((s) => s.done).length
  const pct = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0

  return (
    <div className="aip-subtasks">
      {/* Header */}
      <div className="aip-subtasks__head">
        <span className="aip-subtasks__label">
          Subtasks
          {subtasks.length > 0 && (
            <span className="aip-subtasks__count">{doneCount}/{subtasks.length}</span>
          )}
        </span>
        {subtasks.length > 0 && (
          <div className="aip-subtasks__progress">
            <div className="aip-subtasks__progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {/* List */}
      {subtasks.length > 0 && (
        <div className="aip-subtasks__list">
          {subtasks.map((sub) => (
            <SubtaskRow key={sub.id} taskId={taskId} sub={sub} />
          ))}
        </div>
      )}

      {/* Add new subtask */}
      {adding ? (
        <div className="aip-sub-add-row">
          <div className="aip-sub-check-placeholder" />
          <input
            ref={inputRef}
            className="aip-sub-input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (!newTitle.trim()) setAdding(false) }}
            placeholder="Subtask title… (Enter to add, Esc to cancel)"
          />
        </div>
      ) : (
        <button className="aip-sub-add-btn" onClick={() => setAdding(true)}>
          + Add subtask
        </button>
      )}
    </div>
  )
}
