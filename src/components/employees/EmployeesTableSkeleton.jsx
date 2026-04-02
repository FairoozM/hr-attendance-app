import './EmployeesTableSkeleton.css'

export function EmployeesTableSkeleton() {
  return (
    <div className="employees-skeleton" aria-busy="true" aria-label="Loading employees">
      <div className="employees-skeleton__cards">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="employees-skeleton__card" />
        ))}
      </div>
      <div className="employees-skeleton__toolbar">
        <div className="employees-skeleton__bar employees-skeleton__bar--search" />
        <div className="employees-skeleton__bar employees-skeleton__bar--sm" />
        <div className="employees-skeleton__bar employees-skeleton__bar--sm" />
      </div>
      <div className="employees-skeleton__table">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
          <div key={r} className="employees-skeleton__row">
            <div className="employees-skeleton__cell employees-skeleton__cell--shimmer" />
            <div className="employees-skeleton__cell employees-skeleton__cell--shimmer" />
            <div className="employees-skeleton__cell employees-skeleton__cell--shimmer" />
            <div className="employees-skeleton__cell employees-skeleton__cell--shimmer" />
            <div className="employees-skeleton__cell employees-skeleton__cell--shimmer" />
          </div>
        ))}
      </div>
    </div>
  )
}
