function SortHeader({ col, label, current, dir, onSort, style }) {
  const active = current === col
  return (
    <th className={`al-th-sort ${active ? 'al-th-sort--active' : ''}`} style={style} onClick={() => onSort(col)}>
      <span className="al-th-sort__label">{label}</span>
      <span className="al-th-sort__icon">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  )
}

export function AnnualLeaveTableHead({ showActions, sortBy, sortDir, onSort }) {
  return (
    <thead>
      <tr>
        <SortHeader col="name" label="Employee" current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader col="from_date" label="Leave period" current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader col="alternate" label="Alternate" current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader
          col="days"
          label="Days"
          current={sortBy}
          dir={sortDir}
          onSort={onSort}
          style={{ width: 72, textAlign: 'center' }}
        />
        <SortHeader col="status" label="Status" current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader col="return_date" label="Return" current={sortBy} dir={sortDir} onSort={onSort} />
        {showActions && <th>Actions</th>}
        <th />
      </tr>
    </thead>
  )
}
