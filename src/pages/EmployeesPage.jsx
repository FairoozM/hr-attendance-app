import { EmployeeList } from '../components/EmployeeList'
import { EmployeesTableSkeleton } from '../components/employees/EmployeesTableSkeleton'
import './Page.css'
import './EmployeesPage.css'

export function EmployeesPage({
  employees,
  onAdd,
  onEdit,
  onDelete,
  loading,
  error,
}) {
  // Only show the skeleton on the very first load (no data yet).
  // During background refetches, keep EmployeeList mounted so it
  // preserves its internal state (current page, filters, etc.).
  const initialLoad = loading && employees.length === 0

  return (
    <div className="page employees-page">
      {error && (
        <section className="page-section">
          <p className="page-error" role="alert">
            {error}
          </p>
        </section>
      )}
      {initialLoad && (
        <section className="page-section page-section--fill employees-page__loading">
          <EmployeesTableSkeleton />
        </section>
      )}
      {!initialLoad && (
        <section className="page-section page-section--fill">
          <EmployeeList employees={employees} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
        </section>
      )}
    </div>
  )
}
