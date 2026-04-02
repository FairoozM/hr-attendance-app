import './EmployeesToolbar.css'

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
        <label htmlFor="employees-search" className="visually-hidden">
          Search employees
        </label>
        <span className="employees-toolbar__search-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </span>
        <input
          id="employees-search"
          type="search"
          className="employees-toolbar__input employees-toolbar__input--search"
          placeholder="Search name, ID, phone, email…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="employees-toolbar__filters">
        <select
          className="employees-toolbar__select"
          value={department}
          onChange={(e) => onDepartmentChange(e.target.value)}
          aria-label="Filter by department"
        >
          {departmentOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="employees-toolbar__select"
          value={designation}
          onChange={(e) => onDesignationChange(e.target.value)}
          aria-label="Filter by designation"
          title="Designation (when available on records)"
        >
          {designationOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="employees-toolbar__select"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="on_leave">On leave</option>
          <option value="resigned">Resigned</option>
        </select>
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
