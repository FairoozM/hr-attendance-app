import { useState } from 'react'
import { EmployeeAvatar } from './EmployeeAvatar'
import { displayOrDash, formatJoiningDate, effectiveJoiningDate } from './employeeUtils'
import { ExcelStyleColumnFilter } from '../ExcelStyleColumnFilter'
import './EmployeesDataTable.css'

function SortChevron({ active, dir }) {
  return (
    <span className={`employees-table__sort-icon${active ? ' employees-table__sort-icon--active' : ''}`} aria-hidden>
      {active && dir === 'asc' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 6l-6 8h12l-6-8z" />
        </svg>
      ) : active && dir === 'desc' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 18l6-8H6l6 8z" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
          <path d="M7 10l5-5 5 5H7zm0 4l5 5 5-5H7z" />
        </svg>
      )}
    </span>
  )
}

function StatusBadge({ employmentStatus }) {
  const map = {
    active: { label: 'Active', className: 'employees-badge--active' },
    inactive: { label: 'Inactive', className: 'employees-badge--inactive' },
    on_leave: { label: 'On leave', className: 'employees-badge--leave' },
    resigned: { label: 'Resigned', className: 'employees-badge--resigned' },
  }
  const m = map[employmentStatus] || map.inactive
  return <span className={`employees-badge ${m.className}`}>{m.label}</span>
}

function IconView() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function EmployeesDataTable({
  rows,
  startIndex,
  sortKey,
  sortDir,
  onSort,
  onView,
  onEdit,
  onDelete,
  page,
  pageSize,
  totalFiltered,
  onPageChange,
  columnFilters,
  onColumnFilterIncludedChange,
  filterOptionsByKey,
}) {
  const [openFilterId, setOpenFilterId] = useState(null)
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1)
  const from = totalFiltered === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalFiltered)

  const sortable = (key, label) => (
    <button
      type="button"
      className="employees-table__th-btn"
      onClick={() => onSort(key)}
      aria-sort={
        sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      {label}
      <SortChevron active={sortKey === key} dir={sortDir} />
    </button>
  )

  const f = columnFilters || {}
  const opt = filterOptionsByKey || {}
  const setInc = onColumnFilterIncludedChange || (() => {})

  const thLabel = (text) => (
    <span className="employees-table__th-label">{text}</span>
  )

  return (
    <div className="employees-table-wrap">
      <div className="employees-table-scroll">
        <table className="employees-table">
          <thead>
            <tr>
              <th className="employees-table__th employees-table__th--num">
                <div className="employees-table__th-stack">{thLabel('Sr.')}</div>
              </th>
              <th className="employees-table__th employees-table__th--avatar">
                <div className="employees-table__th-stack">{thLabel('Photo')}</div>
              </th>
              <th className="employees-table__th employees-table__th--name">
                <div className="employees-table__th-stack">
                  {sortable('name', 'Employee name')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-name"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by employee name"
                    options={opt.name || []}
                    included={f.name}
                    onIncludedChange={(next) => setInc('name', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Employee ID')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-employeeId"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by employee ID"
                    options={opt.employeeId || []}
                    included={f.employeeId}
                    onIncludedChange={(next) => setInc('employeeId', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {sortable('department', 'Department')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-department"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by department"
                    options={opt.department || []}
                    included={f.department}
                    onIncludedChange={(next) => setInc('department', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Designation')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-designation"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by designation"
                    options={opt.designation || []}
                    included={f.designation}
                    onIncludedChange={(next) => setInc('designation', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Contact')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-phone"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by contact number"
                    options={opt.phone || []}
                    included={f.phone}
                    onIncludedChange={(next) => setInc('phone', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Email')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-email"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by email"
                    options={opt.email || []}
                    included={f.email}
                    onIncludedChange={(next) => setInc('email', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {sortable('joiningDate', 'Joining date')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-joining"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by joining date"
                    options={opt.joining || []}
                    included={f.joining}
                    onIncludedChange={(next) => setInc('joining', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Passport no.')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-passport"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by passport number"
                    options={opt.passport || []}
                    included={f.passport}
                    onIncludedChange={(next) => setInc('passport', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Nationality')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-nationality"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by nationality"
                    options={opt.nationality || []}
                    included={f.nationality}
                    onIncludedChange={(next) => setInc('nationality', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {thLabel('Emirates ID')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-emirates"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by Emirates ID"
                    options={opt.emirates || []}
                    included={f.emirates}
                    onIncludedChange={(next) => setInc('emirates', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th">
                <div className="employees-table__th-stack">
                  {sortable('employmentStatus', 'Status')}
                  <ExcelStyleColumnFilter
                    filterId="emp-col-status"
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel="Filter by employment status"
                    options={opt.status || []}
                    included={f.status}
                    onIncludedChange={(next) => setInc('status', next)}
                  />
                </div>
              </th>
              <th className="employees-table__th employees-table__th--actions">
                <div className="employees-table__th-stack">{thLabel('Actions')}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((emp, i) => {
              const sr = startIndex + i + 1
              const joinStr = formatJoiningDate(effectiveJoiningDate(emp))
              return (
                <tr key={emp.id} className="employees-table__row">
                  <td className="employees-table__td employees-table__td--num">{sr}</td>
                  <td className="employees-table__td employees-table__td--avatar">
                    <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size="sm" />
                  </td>
                  <td className="employees-table__td employees-table__td--name">
                    <span className="employees-table__name-primary">{emp.name}</span>
                    {emp.designation ? (
                      <span className="employees-table__name-sub">{emp.designation}</span>
                    ) : emp.email ? (
                      <span className="employees-table__name-sub employees-table__name-sub--muted">
                        {emp.email}
                      </span>
                    ) : null}
                  </td>
                  <td className="employees-table__td employees-table__td--mono">{displayOrDash(emp.employeeId)}</td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.department}>
                    {displayOrDash(emp.department)}
                  </td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.designation || ''}>
                    {displayOrDash(emp.designation)}
                  </td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.phone || ''}>
                    {displayOrDash(emp.phone)}
                  </td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.email || ''}>
                    {displayOrDash(emp.email)}
                  </td>
                  <td className="employees-table__td employees-table__td--nowrap">{joinStr || '—'}</td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.passportNumber || ''}>
                    {displayOrDash(emp.passportNumber)}
                  </td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.nationality || ''}>
                    {displayOrDash(emp.nationality)}
                  </td>
                  <td className="employees-table__td employees-table__td--truncate" title={emp.emiratesId || ''}>
                    {displayOrDash(emp.emiratesId)}
                  </td>
                  <td className="employees-table__td">
                    <StatusBadge employmentStatus={emp.employmentStatus} />
                  </td>
                  <td className="employees-table__td employees-table__td--actions">
                    <div className="employees-table__actions">
                      <button
                        type="button"
                        className="employees-table__action-btn"
                        onClick={() => onView(emp)}
                        title="View"
                        aria-label={`View ${emp.name}`}
                      >
                        <IconView />
                      </button>
                      <button
                        type="button"
                        className="employees-table__action-btn"
                        onClick={() => onEdit(emp.id)}
                        title="Edit"
                        aria-label={`Edit ${emp.name}`}
                      >
                        <IconEdit />
                      </button>
                      <button
                        type="button"
                        className="employees-table__action-btn employees-table__action-btn--danger"
                        onClick={() => onDelete(emp.id)}
                        title="Delete"
                        aria-label={`Delete ${emp.name}`}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="employees-table-footer">
        <p className="employees-table-footer__count" role="status">
          {totalFiltered === 0
            ? 'No employees to show'
            : `Showing ${from}–${to} of ${totalFiltered} employee${totalFiltered === 1 ? '' : 's'}`}
        </p>
        {totalFiltered > pageSize && (
          <div className="employees-table-footer__pager">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              Previous
            </button>
            <span className="employees-table-footer__page-num">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
