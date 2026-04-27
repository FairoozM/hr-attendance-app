import { SHOP_VISIT_FILTER_TABS } from './ShopVisitWorkflow'

const FILTER_TABS = [
  { key: 'All', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Upcoming' },
  { key: 'Ongoing', label: 'On leave' },
  { key: 'ReturnPending', label: 'Return pending' },
  { key: 'Completed', label: 'Completed' },
  { key: 'Overstayed', label: 'Overstayed' },
  { key: 'Rejected', label: 'Rejected' },
]

/**
 * @param {object} p
 * @param {Record<string, number>} p.tabCounts
 * @param {string} p.filterStatus
 * @param {(k: string) => void} p.setFilterStatus
 * @param {string} p.search
 * @param {(s: string) => void} p.setSearch
 * @param {string} p.deptFilter
 * @param {(d: string) => void} p.setDeptFilter
 * @param {string[]} p.departments
 * @param {boolean} p.isAdmin
 * @param {string} p.shopVisitFilter
 * @param {(k: string) => void} p.setShopVisitFilter
 */
export function AnnualLeaveFilters({
  tabCounts,
  filterStatus,
  setFilterStatus,
  search,
  setSearch,
  deptFilter,
  setDeptFilter,
  departments,
  isAdmin,
  shopVisitFilter,
  setShopVisitFilter,
}) {
  return (
    <>
      <div className="al-filter-bar al-filter-bar--sticky">
        <div className="al-filter-tabs">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`al-filter-tab ${filterStatus === t.key ? 'al-filter-tab--active' : ''}`}
              onClick={() => setFilterStatus(t.key)}
            >
              {t.label}
              {tabCounts[t.key] > 0 && <span className="al-filter-tab__count">{tabCounts[t.key]}</span>}
            </button>
          ))}
        </div>
        <div className="al-filter-bar__right">
          {departments.length > 0 && (
            <select className="al-filter-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <input
            className="al-search"
            type="search"
            placeholder="Search employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search employees"
          />
        </div>
      </div>
      {isAdmin && (
        <div className="al-filter-bar al-filter-bar--shop">
          <span className="al-filter-bar__shop-label">Main shop</span>
          <div className="al-filter-tabs al-filter-tabs--wrap">
            {SHOP_VISIT_FILTER_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`al-filter-tab ${shopVisitFilter === t.key ? 'al-filter-tab--active' : ''}`}
                onClick={() => setShopVisitFilter(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
