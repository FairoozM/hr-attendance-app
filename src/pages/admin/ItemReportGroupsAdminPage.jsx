import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { useItemReportGroups } from '../../hooks/useItemReportGroups'
import { BulkImportModal } from './BulkImportModal'
import { ImportLogModal } from './ImportLogModal'
import '../Page.css'
import './ItemReportGroupsAdminPage.css'

const EMPTY_FORM = {
  sku: '',
  item_id: '',
  item_name: '',
  report_group: '',
  active: true,
  notes: '',
}

const GROUP_KEY_HINT =
  'Lowercase letters, digits, "_" or "-". 2–64 characters, must start and end alphanumerically. e.g. slow_moving, other_family, high_priority.'

const GROUP_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/

/**
 * Convert any thrown API error into a structured shape the form can render.
 * Map known backend codes → field-targeted, user-friendly messages.
 */
function toFormError(err) {
  const code = err?.body?.code
  const field = err?.body?.field
  if (code === 'DUPLICATE_MAPPING') {
    return {
      message:
        err.body.error ||
        'A mapping with this SKU / item already exists in the same report group.',
      field, // 'sku' or 'item_name'
    }
  }
  if (err?.status === 401 || err?.status === 403) {
    return { message: 'You do not have permission to make this change.' }
  }
  if (err?.status >= 500) {
    return { message: err.message || 'Server error — try again in a moment.' }
  }
  return { message: err?.message || 'Failed to save mapping.' }
}

function MappingFormModal({
  open,
  mode,
  initialValue,
  knownGroups,
  saving,
  error,
  errorField,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(initialValue || EMPTY_FORM)
  const [groupMode, setGroupMode] = useState('existing')
  const [touched, setTouched] = useState({})

  useEffect(() => {
    if (!open) return
    setForm(initialValue || EMPTY_FORM)
    setTouched({})
    const initialGroup = (initialValue?.report_group || '').toLowerCase()
    const isKnown = knownGroups.some((g) => g.report_group === initialGroup)
    setGroupMode(initialGroup && isKnown ? 'existing' : 'new')
  }, [open, initialValue, knownGroups])

  const setField = (key) => (e) => {
    const value =
      e?.target?.type === 'checkbox' ? e.target.checked : e?.target?.value ?? ''
    setForm((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => ({ ...prev, [key]: true }))
  }

  // Inline, real-time validation — does NOT block submission until user
  // touches the field, so empty forms aren't yelling at first paint.
  const inlineErrors = (() => {
    const e = {}
    const sku = String(form.sku || '').trim()
    const itemId = String(form.item_id || '').trim()
    const itemName = String(form.item_name || '').trim()
    const grp = String(form.report_group || '').trim().toLowerCase()
    if (!sku && !itemId && !itemName) {
      e._identifier = 'Provide at least one of SKU, Item ID, or Item Name. (SKU is strongly preferred.)'
    }
    if (!grp) {
      e.report_group = 'A report group is required.'
    } else if (!GROUP_KEY_RE.test(grp)) {
      e.report_group = GROUP_KEY_HINT
    }
    if (sku.length > 100) e.sku = 'SKU must be ≤ 100 characters.'
    if (itemId.length > 100) e.item_id = 'Item ID must be ≤ 100 characters.'
    if (itemName.length > 255) e.item_name = 'Item Name must be ≤ 255 characters.'
    return e
  })()

  const fieldHasIssue = (field) =>
    (touched[field] && Boolean(inlineErrors[field])) || errorField === field

  const blockSubmit = saving || Boolean(Object.keys(inlineErrors).length)

  const submit = (e) => {
    e.preventDefault()
    if (blockSubmit) {
      // Reveal all errors so the user knows why the button looked enabled-then-blocked.
      setTouched({
        sku: true, item_id: true, item_name: true, report_group: true,
      })
      return
    }
    onSave({
      ...form,
      report_group: String(form.report_group || '').trim().toLowerCase(),
      sku: String(form.sku || '').trim(),
      item_id: String(form.item_id || '').trim(),
      item_name: String(form.item_name || '').trim(),
      notes: String(form.notes || '').trim(),
    })
  }

  const inputStyleFor = (field) =>
    fieldHasIssue(field) ? { borderColor: 'var(--danger)' } : undefined

  return (
    <Modal
      title={mode === 'edit' ? 'Edit Item ↔ Group Mapping' : 'Add Item ↔ Group Mapping'}
      open={open}
      onClose={onClose}
      panelClassName="modal-panel--wide"
    >
      <form className="irg-form" onSubmit={submit} noValidate>
        <div className="irg-form__grid">
          <label>
            SKU <span style={{ color: 'var(--text-muted)' }}>(primary match key)</span>
            <input
              value={form.sku}
              onChange={setField('sku')}
              placeholder="e.g. FL-SHINE-001"
              autoFocus
              style={inputStyleFor('sku')}
              aria-invalid={fieldHasIssue('sku')}
            />
            {touched.sku && inlineErrors.sku ? (
              <span className="irg-form__field-err">{inlineErrors.sku}</span>
            ) : null}
          </label>

          <label>
            Item ID <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
            <input
              value={form.item_id}
              onChange={setField('item_id')}
              placeholder="Zoho item_id"
              style={inputStyleFor('item_id')}
              aria-invalid={fieldHasIssue('item_id')}
            />
            {touched.item_id && inlineErrors.item_id ? (
              <span className="irg-form__field-err">{inlineErrors.item_id}</span>
            ) : null}
          </label>

          <label className="irg-form__full">
            Item Name <span style={{ color: 'var(--text-muted)' }}>(optional, displayed in reports)</span>
            <input
              value={form.item_name}
              onChange={setField('item_name')}
              placeholder="e.g. FL SHINE"
              style={inputStyleFor('item_name')}
              aria-invalid={fieldHasIssue('item_name')}
            />
            {touched.item_name && inlineErrors.item_name ? (
              <span className="irg-form__field-err">{inlineErrors.item_name}</span>
            ) : null}
          </label>

          {(touched.sku || touched.item_id || touched.item_name) && inlineErrors._identifier ? (
            <span className="irg-form__field-err irg-form__full">{inlineErrors._identifier}</span>
          ) : null}

          <label>
            Report Group *
            <select value={groupMode} onChange={(e) => setGroupMode(e.target.value)}>
              <option value="existing">Pick existing group</option>
              <option value="new">Create new group key</option>
            </select>
          </label>

          {groupMode === 'existing' ? (
            <label>
              Existing Group *
              <select
                value={form.report_group}
                onChange={setField('report_group')}
                required
                style={inputStyleFor('report_group')}
                aria-invalid={fieldHasIssue('report_group')}
              >
                <option value="">Select a group…</option>
                {knownGroups.map((g) => (
                  <option key={g.report_group} value={g.report_group}>
                    {g.report_group} ({g.total})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              New Group Key *
              <input
                value={form.report_group}
                onChange={setField('report_group')}
                placeholder="e.g. high_priority"
                required
                style={inputStyleFor('report_group')}
                aria-invalid={fieldHasIssue('report_group')}
              />
            </label>
          )}

          {touched.report_group && inlineErrors.report_group ? (
            <span className="irg-form__field-err irg-form__full">
              {inlineErrors.report_group}
            </span>
          ) : null}

          <p className="irg-form__hint irg-form__full">
            <strong>SKU is the primary match key</strong> the backend uses against Zoho rows.
            At least one of <code>sku</code>, <code>item_id</code>, or <code>item_name</code>{' '}
            must be provided. New entries should always include a SKU.
          </p>
          <p className="irg-form__hint irg-form__full">
            <strong>Group key:</strong> {GROUP_KEY_HINT}
          </p>

          <label className="irg-form__full">
            Notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={setField('notes')}
              placeholder="Why is this item in this group? Anything future-you needs to know."
            />
          </label>

          <div className="irg-form__row-toggle">
            <input
              id="irg-active"
              type="checkbox"
              checked={form.active !== false}
              onChange={setField('active')}
            />
            <label htmlFor="irg-active" style={{ color: 'var(--text)' }}>
              Active — include this item when the report runs
            </label>
          </div>
        </div>

        {error ? <p className="irg-form__err" role="alert">{error}</p> : null}

        <div className="irg-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={blockSubmit}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Add Mapping'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function HelpNote() {
  return (
    <div className="irg-help" role="note" aria-label="How report groups work">
      <strong>How report groups work</strong>
      <ul>
        <li>
          Report groups control which items are <em>eligible</em> for each
          weekly report (e.g. <code>slow_moving</code>, <code>other_family</code>).
        </li>
        <li>
          The actual rows that appear in a report still depend on whether
          Zoho returns data for the item in the selected week.
        </li>
        <li>
          <strong>Inactive</strong> entries are ignored by every report.
          Deactivating is a safe alternative to deleting — historical reports
          remain reproducible.
        </li>
      </ul>
    </div>
  )
}

export function ItemReportGroupsAdminPage() {
  const {
    items,
    groupKeys,
    stats,
    filters,
    setFilters,
    loading,
    error,
    createItem,
    updateItem,
    toggleActive,
    deleteItem,
    bulkImportDryRun,
    bulkImport,
    fetchImportLog,
  } = useItemReportGroups()

  const [modalOpen, setModalOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  // Bumped after every successful bulk import so the open Import Log modal
  // re-fetches without needing a manual close/reopen.
  const [logRefreshKey, setLogRefreshKey] = useState(0)
  const [modalMode, setModalMode] = useState('create')
  const [modalError, setModalError] = useState('')
  const [modalErrorField, setModalErrorField] = useState(null)
  const [modalSaving, setModalSaving] = useState(false)
  const [editing, setEditing] = useState(null)

  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [toggling, setToggling] = useState(null)        // row pending confirm
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState('')

  const openCreate = () => {
    setModalMode('create')
    setEditing({ ...EMPTY_FORM })
    setModalError('')
    setModalErrorField(null)
    setModalOpen(true)
  }

  const openEdit = (row) => {
    setModalMode('edit')
    setEditing({
      __id: row.id,
      sku: row.sku || '',
      item_id: row.item_id || '',
      item_name: row.item_name || '',
      report_group: row.report_group || '',
      active: row.active !== false,
      notes: row.notes || '',
    })
    setModalError('')
    setModalErrorField(null)
    setModalOpen(true)
  }

  const saveModal = async (form) => {
    setModalSaving(true)
    setModalError('')
    setModalErrorField(null)
    try {
      if (modalMode === 'edit') await updateItem(editing.__id, form)
      else await createItem(form)
      setModalOpen(false)
    } catch (err) {
      const fe = toFormError(err)
      setModalError(fe.message)
      setModalErrorField(fe.field || null)
    } finally {
      setModalSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteItem(deleting.id)
      setDeleting(null)
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete')
    } finally {
      setDeleteBusy(false)
    }
  }

  const confirmToggle = async () => {
    if (!toggling) return
    setToggleBusy(true)
    setToggleError('')
    try {
      await toggleActive(toggling.id, !toggling.active)
      setToggling(null)
    } catch (err) {
      setToggleError(err.message || 'Failed to update mapping')
    } finally {
      setToggleBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="irg-page">
        <div className="irg-page__hero">
          <div>
            <h1 className="irg-page__title">Item Report Groups</h1>
            <p className="irg-page__subtitle">
              Manage which items belong to each weekly report group
              (slow_moving, other_family, …). The Zoho-sourced reports use this
              table — and only this table — to decide what to display.
            </p>
            <div className="irg-stats" style={{ marginTop: 12 }}>
              <span className="irg-stat">Total<strong>{stats.total}</strong></span>
              <span className="irg-stat">Active<strong>{stats.active}</strong></span>
              <span className="irg-stat">Distinct groups<strong>{groupKeys.length}</strong></span>
            </div>
          </div>
          <div className="irg-page__hero-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setLogOpen(true)}>
              Import Log
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setBulkOpen(true)}>
              Bulk Import
            </button>
            <button type="button" className="btn btn--primary" onClick={openCreate}>
              Add Mapping
            </button>
          </div>
        </div>

        <HelpNote />

        <div className="irg-filters">
          <input
            type="search"
            placeholder="Search SKU, item ID, item name, notes…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <select
            value={filters.group}
            onChange={(e) => setFilters({ ...filters, group: e.target.value })}
          >
            <option value="">Group: All</option>
            {groupKeys.map((g) => (
              <option key={g.report_group} value={g.report_group}>
                Group: {g.report_group} ({g.total})
              </option>
            ))}
          </select>
          <select
            value={filters.active}
            onChange={(e) => setFilters({ ...filters, active: e.target.value })}
          >
            <option value="all">Status: All</option>
            <option value="active">Status: Active</option>
            <option value="inactive">Status: Inactive</option>
          </select>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setFilters({ group: '', search: '', active: 'all' })
            }
          >
            Clear Filters
          </button>
        </div>

        {error ? <p className="page-error">{error}</p> : null}

        <div className="irg-table-wrap">
          {loading ? (
            <div className="irg-empty">Loading mappings…</div>
          ) : items.length === 0 ? (
            <div className="irg-empty">
              {filters.group || filters.search || filters.active !== 'all' ? (
                <>
                  No mappings match these filters.
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setFilters({ group: '', search: '', active: 'all' })}
                    >
                      Clear Filters
                    </button>
                  </div>
                </>
              ) : (
                <>
                  No mappings yet. Click <strong>Add Mapping</strong> above to
                  create your first <code>slow_moving</code> /{' '}
                  <code>other_family</code> entry.
                </>
              )}
            </div>
          ) : (
            <table className="irg-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Group</th>
                  <th>SKU</th>
                  <th>Item Name</th>
                  <th>Item ID</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr key={row.id}>
                    <td>{idx + 1}</td>
                    <td>
                      <span className="irg-pill irg-pill--group">{row.report_group}</span>
                    </td>
                    <td className="irg-mono">{row.sku || '—'}</td>
                    <td>{row.item_name || '—'}</td>
                    <td className="irg-mono">{row.item_id || '—'}</td>
                    <td>
                      <span
                        className={`irg-pill ${row.active ? 'irg-pill--active' : 'irg-pill--inactive'}`}
                      >
                        {row.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{row.notes || '—'}</td>
                    <td>
                      {row.updated_at
                        ? new Date(row.updated_at).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                    <td>
                      <div className="irg-actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => {
                            setToggleError('')
                            setToggling(row)
                          }}
                        >
                          {row.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => {
                            setDeleteError('')
                            setDeleting(row)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <MappingFormModal
        open={modalOpen}
        mode={modalMode}
        initialValue={editing}
        knownGroups={groupKeys}
        saving={modalSaving}
        error={modalError}
        errorField={modalErrorField}
        onClose={() => (modalSaving ? null : setModalOpen(false))}
        onSave={saveModal}
      />

      <Modal
        title="Delete Mapping"
        open={Boolean(deleting)}
        onClose={() => (deleteBusy ? null : setDeleting(null))}
      >
        <p className="delete-confirm-text">
          Remove <strong>{deleting?.sku || deleting?.item_name || deleting?.item_id}</strong>{' '}
          from the <code>{deleting?.report_group}</code> report group? This cannot be undone.
          (Tip: deactivate instead if you might need it again.)
        </p>
        {deleteError ? <p className="irg-form__err" role="alert">{deleteError}</p> : null}
        <div className="irg-form__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setDeleting(null)}
            disabled={deleteBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={confirmDelete}
            disabled={deleteBusy}
            aria-busy={deleteBusy}
          >
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>

      <BulkImportModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDryRun={bulkImportDryRun}
        onImport={async (csv, opts) => {
          const result = await bulkImport(csv, opts)
          // Make the next Import Log open (or live re-fetch, if it's already
          // open) reflect this attempt.
          setLogRefreshKey((k) => k + 1)
          return result
        }}
      />

      <ImportLogModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onFetch={fetchImportLog}
        refreshKey={logRefreshKey}
      />

      <Modal
        title={toggling?.active ? 'Deactivate Mapping' : 'Activate Mapping'}
        open={Boolean(toggling)}
        onClose={() => (toggleBusy ? null : setToggling(null))}
      >
        <p className="delete-confirm-text">
          {toggling?.active ? (
            <>
              Deactivate <strong>{toggling?.sku || toggling?.item_name || toggling?.item_id}</strong>{' '}
              in the <code>{toggling?.report_group}</code> report group?
              <br />
              Inactive mappings are ignored by every weekly report until you
              reactivate them. Existing data is preserved.
            </>
          ) : (
            <>
              Reactivate <strong>{toggling?.sku || toggling?.item_name || toggling?.item_id}</strong>{' '}
              in the <code>{toggling?.report_group}</code> report group?
              The next weekly report will include it again.
            </>
          )}
        </p>
        {toggleError ? <p className="irg-form__err" role="alert">{toggleError}</p> : null}
        <div className="irg-form__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setToggling(null)}
            disabled={toggleBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${toggling?.active ? 'btn--danger' : 'btn--primary'}`}
            onClick={confirmToggle}
            disabled={toggleBusy}
            aria-busy={toggleBusy}
          >
            {toggleBusy
              ? 'Saving…'
              : toggling?.active
                ? 'Deactivate'
                : 'Activate'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default ItemReportGroupsAdminPage
