import { Fragment, useState } from 'react'
import { EmployeeAvatar } from './EmployeeAvatar'
import {
  displayOrDash,
  formatJoiningDate,
  effectiveJoiningDate,
  primaryWorkLocationLabel,
} from './employeeUtils'
import { ExcelStyleColumnFilter } from '../ExcelStyleColumnFilter'
import './EmployeesDataTable.css'

const TABLE_COLUMNS = [
  { id: 'sr', label: 'Sr.' },
  { id: 'photo', label: 'Photo' },
  { id: 'name', label: 'Employee name', sortKey: 'name', filterKey: 'name', filterId: 'emp-col-name' },
  { id: 'employeeId', label: 'Employee ID', filterKey: 'employeeId', filterId: 'emp-col-employeeId' },
  { id: 'department', label: 'Department', sortKey: 'department', filterKey: 'department', filterId: 'emp-col-department' },
  { id: 'designation', label: 'Designation', filterKey: 'designation', filterId: 'emp-col-designation' },
  {
    id: 'primaryLocation',
    label: 'Primary work location',
    sortKey: 'primaryLocation',
    filterKey: 'primaryLocation',
    filterId: 'emp-col-primary-location',
  },
  { id: 'phone', label: 'Contact', filterKey: 'phone', filterId: 'emp-col-phone' },
  { id: 'email', label: 'Email', filterKey: 'email', filterId: 'emp-col-email' },
  { id: 'joining', label: 'Joining date', sortKey: 'joiningDate', filterKey: 'joining', filterId: 'emp-col-joining' },
  { id: 'passport', label: 'Passport no.', filterKey: 'passport', filterId: 'emp-col-passport' },
  { id: 'nationality', label: 'Nationality', filterKey: 'nationality', filterId: 'emp-col-nationality' },
  { id: 'emirates', label: 'Emirates ID', filterKey: 'emirates', filterId: 'emp-col-emirates' },
  {
    id: 'status',
    label: 'Status',
    sortKey: 'employmentStatus',
    filterKey: 'status',
    filterId: 'emp-col-status',
    sticky: 'status',
  },
  { id: 'actions', label: 'Actions', sticky: 'actions' },
]

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
    <span className="employees-table__head-label">{text}</span>
  )

  const headCellClass = (column) => {
    let cls = `employees-table__head-cell employees-table__head-cell--${column.id}`
    if (column.sticky) cls += ` employees-table__head-cell--sticky-${column.sticky}`
    return cls
  }

  const bodyCellClass = (column) => {
    let cls = `employees-table__cell employees-table__cell--${column.id}`
    if (column.sticky) cls += ` employees-table__cell--sticky-${column.sticky}`
    return cls
  }

  const renderHeadContent = (column) => {
    const showFilter = Boolean(column.filterKey)
    return (
      <div className="employees-table__head-stack">
        {column.sortKey ? sortable(column.sortKey, column.label) : thLabel(column.label)}
        {showFilter && (
          <ExcelStyleColumnFilter
            filterId={column.filterId}
            openFilterId={openFilterId}
            onOpenFilterId={setOpenFilterId}
            ariaLabel={`Filter by ${column.label.toLowerCase()}`}
            options={opt[column.filterKey] || []}
            included={f[column.filterKey]}
            onIncludedChange={(next) => setInc(column.filterKey, next)}
          />
        )}
      </div>
    )
  }

  const renderBodyCell = (column, emp, sr, joinStr) => {
    switch (column.id) {
      case 'sr':
        return <td className={bodyCellClass(column)}>{sr}</td>
      case 'photo':
        return (
          <td className={bodyCellClass(column)}>
            <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size="sm" />
          </td>
        )
      case 'name':
        return (
          <td className={bodyCellClass(column)}>
            <span className="employees-table__name-primary">{emp.name}</span>
            {emp.designation ? (
              <span className="employees-table__name-sub">{emp.designation}</span>
            ) : emp.email ? (
              <span className="employees-table__name-sub employees-table__name-sub--muted">{emp.email}</span>
            ) : null}
          </td>
        )
      case 'employeeId':
        return <td className={`${bodyCellClass(column)} employees-table__cell--mono`}>{displayOrDash(emp.employeeId)}</td>
      case 'department':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.department || ''}>
            {displayOrDash(emp.department)}
          </td>
        )
      case 'designation':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.designation || ''}>
            {displayOrDash(emp.designation)}
          </td>
        )
      case 'primaryLocation': {
        const location = primaryWorkLocationLabel(emp)
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={location || ''}>
            {displayOrDash(location)}
          </td>
        )
      }
      case 'phone':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.phone || ''}>
            {displayOrDash(emp.phone)}
          </td>
        )
      case 'email':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.email || ''}>
            {displayOrDash(emp.email)}
          </td>
        )
      case 'joining':
        return <td className={`${bodyCellClass(column)} employees-table__cell--nowrap`}>{joinStr || '—'}</td>
      case 'passport':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.passportNumber || ''}>
            {displayOrDash(emp.passportNumber)}
          </td>
        )
      case 'nationality':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.nationality || ''}>
            {displayOrDash(emp.nationality)}
          </td>
        )
      case 'emirates':
        return (
          <td className={`${bodyCellClass(column)} employees-table__cell--truncate`} title={emp.emiratesId || ''}>
            {displayOrDash(emp.emiratesId)}
          </td>
        )
      case 'status':
        return (
          <td className={bodyCellClass(column)}>
            <StatusBadge employmentStatus={emp.employmentStatus} />
          </td>
        )
      case 'actions':
        return (
          <td className={bodyCellClass(column)}>
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
        )
      default:
        return <td className={bodyCellClass(column)}>—</td>
    }
  }

  return (
    <div className="employees-table-wrap">
      <div className="employees-table-scroll">
        <table className="employees-table">
          <colgroup>
            {TABLE_COLUMNS.map((column) => (
              <col key={column.id} className={`employees-table__col employees-table__col--${column.id}`} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((column) => (
                <th key={column.id} scope="col" className={headCellClass(column)}>
                  {renderHeadContent(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((emp, i) => {
              const sr = startIndex + i + 1
              const joinStr = formatJoiningDate(effectiveJoiningDate(emp))
              return (
                <tr key={emp.id} className="employees-table__row">
                  {TABLE_COLUMNS.map((column) => (
                    <Fragment key={column.id}>{renderBodyCell(column, emp, sr, joinStr)}</Fragment>
                  ))}
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
