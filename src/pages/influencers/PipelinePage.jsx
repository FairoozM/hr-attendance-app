import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfluencers, WORKFLOW_STAGES } from '../../contexts/InfluencersContext'
import { fmtDMY } from '../../utils/dateFormat'
import './influencers.css'

function approvalBadge(status) {
  if (status === 'Approved') return <span className="inf-badge inf-badge--approved">{status}</span>
  if (status === 'Rejected') return <span className="inf-badge inf-badge--rejected">{status}</span>
  if (status === 'Shortlisted') return <span className="inf-badge inf-badge--shortlisted">{status}</span>
  return null
}

function paymentBadge(status) {
  if (status === 'Paid') return <span className="inf-badge inf-badge--paid">Paid</span>
  if (status === 'Ready for Payment') return <span className="inf-badge inf-badge--ready">Pay Ready</span>
  return null
}

export function PipelinePage() {
  const { influencers, updateWorkflowStatus } = useInfluencers()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const dragItem = useRef(null)

  const filtered = influencers.filter(inf => {
    if (filter === 'active') return inf.approvalStatus !== 'Rejected' && inf.workflowStatus !== 'Closed'
    if (filter === 'approved') return inf.approvalStatus === 'Approved'
    if (filter === 'rejected') return inf.approvalStatus === 'Rejected'
    if (filter === 'payment') return inf.paymentStatus === 'Ready for Payment' || inf.workflowStatus === 'Payment Pending'
    if (filter === 'completed') return ['Uploaded', 'Paid', 'Closed'].includes(inf.workflowStatus)
    return true
  })

  const byStage = WORKFLOW_STAGES.reduce((acc, stage) => {
    acc[stage] = filtered.filter(i => i.workflowStatus === stage)
    return acc
  }, {})

  const handleDragStart = (e, inf) => {
    dragItem.current = inf
    setDragging(inf.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, stage) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(stage)
  }

  const handleDrop = (e, stage) => {
    e.preventDefault()
    if (dragItem.current && dragItem.current.workflowStatus !== stage) {
      updateWorkflowStatus(dragItem.current.id, stage)
    }
    setDragging(null)
    setDragOver(null)
    dragItem.current = null
  }

  const handleDragEnd = () => {
    setDragging(null)
    setDragOver(null)
    dragItem.current = null
  }

  return (
    <div className="inf-page" style={{ paddingBottom: '1rem' }}>
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Pipeline</h1>
          <p className="inf-page-subtitle">Drag cards between stages to update workflow</p>
        </div>
        <div className="inf-page-actions">
          <button className="inf-btn inf-btn--primary" onClick={() => navigate('/influencers/new')}>+ Add</button>
        </div>
      </div>

      {/* Filters */}
      <div className="inf-filter-chips" style={{ marginBottom: '1.25rem' }}>
        {[
          { id: 'all', label: `All (${influencers.length})` },
          { id: 'active', label: 'Active' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
          { id: 'payment', label: 'Payment Pending' },
          { id: 'completed', label: 'Completed' },
        ].map(f => (
          <button key={f.id} className={`inf-chip ${filter === f.id ? 'inf-chip--active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Kanban Board */}
      <div className="inf-pipeline">
        <div className="inf-pipeline-board">
          {WORKFLOW_STAGES.map(stage => (
            <div
              key={stage}
              className={`inf-pipeline-col ${dragOver === stage ? 'inf-pipeline-col--drag-over' : ''}`}
              onDragOver={e => handleDragOver(e, stage)}
              onDrop={e => handleDrop(e, stage)}
              onDragLeave={() => setDragOver(null)}
            >
              <div className="inf-pipeline-col__header">
                <span className="inf-pipeline-col__title">{stage}</span>
                <span className="inf-pipeline-col__count">{byStage[stage]?.length || 0}</span>
              </div>
              <div className="inf-pipeline-col__body">
                {byStage[stage]?.length === 0 && (
                  <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.5 }}>
                    Drop here
                  </div>
                )}
                {byStage[stage]?.map(inf => (
                  <div
                    key={inf.id}
                    className={`inf-pipeline-card ${dragging === inf.id ? 'inf-pipeline-card--dragging' : ''}`}
                    draggable
                    onDragStart={e => handleDragStart(e, inf)}
                    onDragEnd={handleDragEnd}
                    onClick={() => navigate(`/influencers/${inf.id}`)}
                  >
                    <div className="inf-pipeline-card__name">{inf.name}</div>
                    {inf.instagram?.handle && (
                      <div className="inf-pipeline-card__handle">{inf.instagram.handle}</div>
                    )}
                    <div className="inf-pipeline-card__meta">
                      {inf.basedIn && <span>{inf.basedIn}</span>}
                      {inf.niche && <span> · {inf.niche}</span>}
                    </div>
                    {inf.packagePrice && (
                      <div className="inf-pipeline-card__price">
                        {inf.currency} {Number(inf.packagePrice).toLocaleString()}
                      </div>
                    )}
                    {inf.shootDate && (
                      <div className="inf-pipeline-card__meta" style={{ marginTop: '0.25rem' }}>
                        📅 {fmtDMY(inf.shootDate)}
                      </div>
                    )}
                    <div className="inf-pipeline-card__badges">
                      {approvalBadge(inf.approvalStatus)}
                      {paymentBadge(inf.paymentStatus)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', paddingLeft: '0.5rem' }}>
        ℹ️ Rejected influencers remain in the system and can be moved back into active workflow at any time.
      </p>
    </div>
  )
}
