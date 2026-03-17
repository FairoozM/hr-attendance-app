import { EmployeeList } from '../components/EmployeeList'
import './Page.css'

export function EmployeesPage({
  employees,
  onAdd,
  onEdit,
  onDelete,
  loading,
  error,
}) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Employees</h1>
      </div>
      {error && (
        <section className="page-section">
          <p className="page-error" role="alert">{error}</p>
        </section>
      )}
      {loading && (
        <section className="page-section">
          <p className="page-loading">Loading…</p>
        </section>
      )}
      {!loading && (
        <section className="page-section page-section--fill">
          <EmployeeList
            employees={employees}
            onAdd={onAdd}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </section>
      )}
    </div>
  )
}
