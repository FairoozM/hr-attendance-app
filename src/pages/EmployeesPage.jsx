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
  return (
    <div className="page employees-page">
      {error && (
        <section className="page-section">
          <p className="page-error" role="alert">
            {error}
          </p>
        </section>
      )}
      {loading && (
        <section className="page-section page-section--fill employees-page__loading">
          <EmployeesTableSkeleton />
        </section>
      )}
      {!loading && (
        <section className="page-section page-section--fill">
          <EmployeeList employees={employees} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
        </section>
      )}
    </div>
  )
}
