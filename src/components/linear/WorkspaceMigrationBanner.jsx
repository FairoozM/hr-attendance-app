/**
 * WorkspaceMigrationBanner.jsx
 * Shows a one-time prompt to import local workspace data into the shared backend.
 * Appears only when: backend is empty for a given resource AND localStorage has data.
 */
import React, { useState } from 'react'
import { Upload, X, AlertTriangle } from 'lucide-react'
import './WorkspaceMigrationBanner.css'
import { markMigrated } from '../../lib/linearWorkspaceApi'

export default function WorkspaceMigrationBanner({
  localItemCount = 0,
  resourceLabel  = 'workspace data',
  onImport,         // async fn — returns true on success
  onDismiss,
}) {
  const [state, setState] = useState('idle') // idle | loading | error | done

  async function handleImport() {
    setState('loading')
    try {
      const ok = await onImport()
      if (ok === false) throw new Error('Import returned false')
      markMigrated()
      setState('done')
    } catch {
      setState('error')
    }
  }

  if (state === 'done') return null

  return (
    <div className="wmb">
      <div className="wmb__icon">
        <AlertTriangle size={15} />
      </div>
      <div className="wmb__text">
        <strong>Local {resourceLabel} found</strong>
        <span className="wmb__sub">
          {localItemCount} item{localItemCount !== 1 ? 's' : ''} stored locally.
          Import to shared workspace so your team can see them?
        </span>
        {state === 'error' && (
          <span className="wmb__err">Import failed — please try again.</span>
        )}
      </div>
      <div className="wmb__actions">
        <button
          className="wmb__btn wmb__btn--import"
          onClick={handleImport}
          disabled={state === 'loading'}
        >
          <Upload size={13} />
          {state === 'loading' ? 'Importing…' : 'Import'}
        </button>
        <button className="wmb__btn wmb__btn--dismiss" onClick={onDismiss} aria-label="Dismiss">
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
