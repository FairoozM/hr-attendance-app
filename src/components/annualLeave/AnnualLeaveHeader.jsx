export function AnnualLeaveHeader({ isAdmin, onNewRequest, requestFormOpen }) {
  return (
    <div className="page-header al-page-hero">
      <div>
        <p className="al-page-hero__eyebrow">Workflow dashboard</p>
        <h1 className="page-title">Annual Leave</h1>
        <p className="al-page-hero__subtitle">
          {isAdmin
            ? 'Manage employee leave requests, approvals, returns, shop visits, and salary handovers.'
            : 'Submit leave requests and track your approval, return, and shop visit status.'}
        </p>
        <p className="al-page-hero__scope">
          {isAdmin ? 'Showing all employee leave requests' : 'Showing your leave requests only'}
        </p>
      </div>
      <button type="button" className="al-btn al-btn--primary al-page-hero__cta" onClick={onNewRequest}>
        {requestFormOpen ? 'Close request form' : 'New Leave Request'}
      </button>
    </div>
  )
}
