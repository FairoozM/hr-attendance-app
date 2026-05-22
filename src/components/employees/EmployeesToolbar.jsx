import { ModernSearchInput } from '../ui/ModernSearchInput'
import { ModernSelect } from '../ui/ModernSelect'
import './EmployeesToolbar.css'

const STATUS_OPTIONS = [
  { value: 'all',      label: 'All statuses' },
  { value: 'active',   label: 'Active'       },
  { value: 'inactive', label: 'Inactive'     },
  { value: 'on_leave', label: 'On leave'     },
  { value: 'resigned', label: 'Resigned'     },
]

export function EmployeesToolbar({
  search,
  onSearchChange,
  department,
  onDepartmentChange,
  departmentOptions,
  status,
  onStatusChange,
  designation,
  onDesignationChange,
  designationOptions,
  onClearFilters,
  hasActiveFilters,
}) {
  return (
    <div className="employees-toolbar">
      <div className="employees-toolbar__search">
        <ModernSearchInput
          id="employees-search"
          placeholder="Search name, ID, phone, email…"
          value={search}
          onChange={onSearchChange}
        />
      </div>
      <div className="employees-toolbar__filters">
        <ModernSelect
          value={department}
          options={departmentOptions}
          onChange={onDepartmentChange}
          aria-label="Filter by department"
        />
        <ModernSelect
          value={designation}
          options={designationOptions}
          onChange={onDesignationChange}
          aria-label="Filter by designation"
        />
        <ModernSelect
          value={status}
          options={STATUS_OPTIONS}
          onChange={onStatusChange}
          aria-label="Filter by status"
        />
        <button
          type="button"
          className="employees-toolbar__clear btn btn--ghost btn--sm"
          onClick={onClearFilters}
          disabled={!hasActiveFilters}
        >
          Clear filters
        </button>
      </div>
    </div>
  )
}
