import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useEmployees } from '../hooks/useEmployees'
import './RolesPermissionsPage.css'

const MODULES = [
  {
    key: 'attendance',
    label: 'Attendance',
    icon: '📋',
    permissions: [
      { key: 'view', label: 'View attendance records' },
      { key: 'manage', label: 'Mark & edit attendance (includes view)' },
    ],
  },
  {
    key: 'leave',
    label: 'Annual Leave',
    icon: '🏖️',
    permissions: [
      { key: 'view', label: 'View all leave requests' },
      { key: 'approve', label: 'Approve / reject leave (includes view)' },
    ],
  },
  {
    key: 'employees',
    label: 'Employees',
    icon: '👥',
    permissions: [
      { key: 'view', label: 'View employee list & details' },
      { key: 'edit', label: 'Add / edit / delete employees (includes view)' },
    ],
  },
  {
    key: 'roster',
    label: 'Weekly Off & Duty',
    icon: '📅',
    permissions: [{ key: 'view', label: 'View duty roster' }],
  },
]

function roleLabel(role) {
  const map = { employee: 'Employee', warehouse: 'Warehouse', admin: 'Admin' }
  return map[role] || role
}

function roleBadgeClass(role) {
  const map = { employee: 'badge--employee', warehouse: 'badge--warehouse', admin: 'badge--admin' }
  return `rbac-badge ${map[role] || ''}`
}

function initPermissionsState(raw) {
  const p = raw || {}
  const result = { department_only: Boolean(p.department_only) }
  for (const mod of MODULES) {
    result[mod.key] = {}
    for (const perm of mod.permissions) {
      result[mod.key][perm.key] = Boolean(p[mod.key]?.[perm.key])
    }
  }
  return result
}

function countPermissions(perms) {
  let n = 0
  for (const mod of MODULES) {
    for (const perm of mod.permissions) {
      if (perms[mod.key]?.[perm.key]) n++
    }
  }
  return n
}

function Toggle({ on, onChange, disabled }) {
  return (
    <span
      className={`rbac-toggle ${on ? 'rbac-toggle--on' : ''} ${disabled ? 'rbac-toggle--disabled' : ''}`}
      role="switch"
      aria-checked={on}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!on)}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onChange(!on)
        }
      }}
    >
      <span className="rbac-toggle__thumb" />
    </span>
  )
}

export function RolesPermissionsPage() {
  const { user: currentAdmin, refreshUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [localPerms, setLocalPerms] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRole, setFilterRole] = useState('')

  // Attendance assignment state
  const { employees: allEmployees = [] } = useEmployees()
  const [assignedEmpIds, setAssignedEmpIds] = useState(new Set())
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [empSearch, setEmpSearch] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/admin/users-permissions')
      setUsers(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const selectUser = useCallback(async (u) => {
    setSelectedUser(u)
    setLocalPerms(initPermissionsState(u.has_account ? u.permissions : {}))
    setSaveMsg(null)
    setEmpSearch('')
    setAssignedEmpIds(new Set())

    if (u.has_account && u.id) {
      setAssignmentsLoading(true)
      try {
        const data = await api.get(`/api/admin/users/${u.id}/attendance-assignments`)
        const ids = Array.isArray(data) ? data.map((r) => String(r.assigned_employee_id)) : []
        setAssignedEmpIds(new Set(ids))
      } catch (_) {
        setAssignedEmpIds(new Set())
      } finally {
        setAssignmentsLoading(false)
      }
    }
  }, [])

  const togglePerm = useCallback((modKey, permKey) => {
    setLocalPerms((prev) => {
      const next = { ...prev, [modKey]: { ...prev[modKey], [permKey]: !prev[modKey][permKey] } }
      // manage implies view; edit implies view; approve implies view
      if (permKey === 'manage' && next[modKey].manage) next[modKey].view = true
      if (permKey === 'edit' && next[modKey].edit) next[modKey].view = true
      if (permKey === 'approve' && next[modKey].approve) next[modKey].view = true
      // unsetting view clears dependent permissions
      if (permKey === 'view' && !next[modKey].view) {
        if (next[modKey].manage != null) next[modKey].manage = false
        if (next[modKey].edit != null) next[modKey].edit = false
        if (next[modKey].approve != null) next[modKey].approve = false
      }
      return next
    })
    setSaveMsg(null)
  }, [])

  const grantAll = useCallback((modKey) => {
    setLocalPerms((prev) => {
      const next = { ...prev }
      const mod = MODULES.find((m) => m.key === modKey)
      if (!mod) return prev
      next[modKey] = {}
      for (const p of mod.permissions) next[modKey][p.key] = true
      return next
    })
    setSaveMsg(null)
  }, [])

  const revokeAll = useCallback((modKey) => {
    setLocalPerms((prev) => {
      const next = { ...prev }
      const mod = MODULES.find((m) => m.key === modKey)
      if (!mod) return prev
      next[modKey] = {}
      for (const p of mod.permissions) next[modKey][p.key] = false
      return next
    })
    setSaveMsg(null)
  }, [])

  const savePermissions = useCallback(async () => {
    if (!selectedUser) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await api.put(`/api/admin/users/${selectedUser.id}/permissions`, { permissions: localPerms })

      // Save attendance assignments alongside permissions (convert string IDs back to numbers for the API)
      if (selectedUser.id) {
        await api.put(`/api/admin/users/${selectedUser.id}/attendance-assignments`, {
          employeeIds: Array.from(assignedEmpIds).map(Number).filter(Boolean),
        })
      }

      setSaveMsg({ type: 'success', text: 'Permissions and attendance assignments saved. Changes take effect immediately.' })
      if (currentAdmin && String(selectedUser.id) === String(currentAdmin.id)) {
        await refreshUser()
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === selectedUser.id ? { ...u, permissions: { ...localPerms } } : u
        )
      )
      setSelectedUser((prev) => prev ? { ...prev, permissions: { ...localPerms } } : prev)
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message || 'Failed to save permissions' })
    } finally {
      setSaving(false)
    }
  }, [selectedUser, localPerms, assignedEmpIds])

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase()
    const matchQ =
      !q ||
      (u.employee_full_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q) ||
      (u.employee_code || '').toLowerCase().includes(q)
    const matchRole = !filterRole || u.role === filterRole
    return matchQ && matchRole
  })

  const displayName = (u) => u.employee_full_name || u.username

  // Employees available for attendance assignment (active, excluding the selected user's own employee record)
  const filteredAssignableEmps = useMemo(() => {
    const q = empSearch.toLowerCase()
    return allEmployees.filter((e) => {
      if (!e.isActive) return false
      if (!q) return true
      return (
        (e.name || '').toLowerCase().includes(q) ||
        (e.employeeId || '').toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q)
      )
    })
  }, [allEmployees, empSearch, selectedUser])

  const toggleEmpAssignment = useCallback((empId) => {
    setAssignedEmpIds((prev) => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
    setSaveMsg(null)
  }, [])

  const selectAllVisible = useCallback(() => {
    setAssignedEmpIds((prev) => {
      const next = new Set(prev)
      filteredAssignableEmps.forEach((e) => next.add(e.id))
      return next
    })
    setSaveMsg(null)
  }, [filteredAssignableEmps])

  const clearAllVisible = useCallback(() => {
    setAssignedEmpIds((prev) => {
      const next = new Set(prev)
      filteredAssignableEmps.forEach((e) => next.delete(e.id))
      return next
    })
    setSaveMsg(null)
  }, [filteredAssignableEmps])

  const attendanceManageOn = Boolean(localPerms?.attendance?.manage)

  return (
    <div className="page rbac-page">
      <div className="rbac-header">
        <div>
          <h1 className="rbac-header__title">Roles &amp; Permissions</h1>
          <p className="rbac-header__sub">
            Control which modules each user can access. Admin always has full access.
          </p>
        </div>
      </div>

      {error && <div className="rbac-alert rbac-alert--error">{error}</div>}

      <div className="rbac-layout">
        {/* ── Left: user list ── */}
        <div className="rbac-user-panel">
          <div className="rbac-user-panel__toolbar">
            <input
              className="rbac-search"
              type="search"
              placeholder="Search users…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="rbac-filter"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
            >
              <option value="">All roles</option>
              <option value="employee">Employee</option>
              <option value="warehouse">Warehouse</option>
            </select>
          </div>

          {loading ? (
            <div className="rbac-loading">Loading users…</div>
          ) : filteredUsers.length === 0 ? (
            <div className="rbac-empty">No users found</div>
          ) : (
              <ul className="rbac-user-list">
              {filteredUsers.map((u) => {
                const n = u.has_account ? countPermissions(initPermissionsState(u.permissions)) : 0
                const isSelected = selectedUser?.employee_id === u.employee_id && selectedUser?.id === u.id
                const rowKey = u.id ? `user-${u.id}` : `emp-${u.employee_id}`
                return (
                  <li key={rowKey}>
                    <button
                      type="button"
                      className={`rbac-user-item ${isSelected ? 'rbac-user-item--active' : ''} ${!u.has_account ? 'rbac-user-item--no-account' : ''}`}
                      onClick={() => selectUser(u)}
                    >
                      <div className="rbac-user-item__avatar">
                        {(displayName(u)[0] || '?').toUpperCase()}
                      </div>
                      <div className="rbac-user-item__info">
                        <span className="rbac-user-item__name">{displayName(u)}</span>
                        {u.has_account
                          ? <span className="rbac-user-item__email">{u.username}</span>
                          : <span className="rbac-user-item__no-account">No portal account</span>
                        }
                        {u.department && (
                          <span className="rbac-user-item__dept">{u.department}</span>
                        )}
                      </div>
                      <div className="rbac-user-item__meta">
                        <span className={roleBadgeClass(u.role)}>{roleLabel(u.role)}</span>
                        {n > 0 && (
                          <span className="rbac-perm-count" title={`${n} permission(s) granted`}>
                            {n}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ── Right: permission editor ── */}
        <div className="rbac-editor">
          {!selectedUser ? (
            <div className="rbac-editor__empty">
              <div className="rbac-editor__empty-icon">🔐</div>
              <p>Select a user from the list to manage their permissions</p>
            </div>
          ) : (
            <>
              <div className="rbac-editor__header">
                <div className="rbac-editor__user-info">
                  <div className="rbac-editor__avatar">
                    {(displayName(selectedUser)[0] || '?').toUpperCase()}
                  </div>
                  <div>
                    <h2 className="rbac-editor__name">{displayName(selectedUser)}</h2>
                    {selectedUser.has_account
                      ? <span className="rbac-editor__email">{selectedUser.username}</span>
                      : <span className="rbac-editor__email rbac-editor__email--dim">No portal account</span>
                    }
                    <span className={roleBadgeClass(selectedUser.role)}>
                      {roleLabel(selectedUser.role)}
                    </span>
                  </div>
                </div>
              </div>

              {!selectedUser.has_account && (
                <div className="rbac-alert rbac-alert--info">
                  This employee has no portal login account yet. Create a portal account for them
                  (in the Employees section) before assigning permissions.
                </div>
              )}

              {selectedUser.has_account && selectedUser.role === 'warehouse' && (
                <div className="rbac-alert rbac-alert--info">
                  Warehouse users have built-in access to Attendance, Employees, and Annual Leave.
                  Permission toggles apply to any additional custom access.
                </div>
              )}


              <div className={`rbac-modules ${!selectedUser.has_account ? 'rbac-modules--disabled' : ''}`}>
                {MODULES.map((mod) => {
                  const modPerms = localPerms[mod.key] || {}
                  const anyGranted = selectedUser.has_account && mod.permissions.some((p) => modPerms[p.key])
                  const allGranted = selectedUser.has_account && mod.permissions.every((p) => modPerms[p.key])
                  return (
                    <div key={mod.key} className={`rbac-module ${anyGranted ? 'rbac-module--active' : ''}`}>
                      <div className="rbac-module__head">
                        <span className="rbac-module__icon">{mod.icon}</span>
                        <h3 className="rbac-module__label">{mod.label}</h3>
                        <div className="rbac-module__actions">
                          {!allGranted && (
                            <button
                              type="button"
                              className="rbac-btn-sm rbac-btn-sm--grant"
                              onClick={() => grantAll(mod.key)}
                            >
                              Grant all
                            </button>
                          )}
                          {anyGranted && (
                            <button
                              type="button"
                              className="rbac-btn-sm rbac-btn-sm--revoke"
                              onClick={() => revokeAll(mod.key)}
                            >
                              Revoke all
                            </button>
                          )}
                        </div>
                      </div>
                      <ul className="rbac-module__perms">
                        {mod.permissions.map((perm) => {
                          const checked = Boolean(modPerms[perm.key])
                          return (
                            <li key={perm.key} className="rbac-perm-row">
                              <label className="rbac-perm-label">
                                <Toggle
                                  on={checked}
                                  onChange={() => togglePerm(mod.key, perm.key)}
                                  disabled={!selectedUser.has_account}
                                />
                                <span className="rbac-perm-label__text">{perm.label}</span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>

              {/* Attendance Assignment Panel — only shown when attendance manage is on */}
              {selectedUser.has_account && attendanceManageOn && (
                <div className="rbac-assign-panel">
                  <div className="rbac-assign-panel__head">
                    <span className="rbac-assign-panel__icon">👥</span>
                    <div>
                      <h3 className="rbac-assign-panel__title">Assigned Employees (Attendance Scope)</h3>
                      <p className="rbac-assign-panel__desc">
                        Choose exactly which employees this user can view and manage attendance for.
                        They will <strong>only</strong> see employees checked here.
                      </p>
                    </div>
                  </div>

                  {assignmentsLoading ? (
                    <div className="rbac-assign-loading">Loading current assignments…</div>
                  ) : (
                    <>
                      <div className="rbac-assign-toolbar">
                        <input
                          className="rbac-assign-search"
                          type="search"
                          placeholder="Search employees…"
                          value={empSearch}
                          onChange={(e) => setEmpSearch(e.target.value)}
                        />
                        <span className="rbac-assign-count">
                          {assignedEmpIds.size} selected
                        </span>
                        <button type="button" className="rbac-btn-sm rbac-btn-sm--grant" onClick={selectAllVisible}>
                          Select all
                        </button>
                        <button type="button" className="rbac-btn-sm rbac-btn-sm--revoke" onClick={clearAllVisible}>
                          Clear all
                        </button>
                      </div>

                      <ul className="rbac-assign-list">
                        {filteredAssignableEmps.length === 0 ? (
                          <li className="rbac-assign-empty">No employees match your search</li>
                        ) : filteredAssignableEmps.map((emp) => {
                          const checked = assignedEmpIds.has(String(emp.id))
                          return (
                            <li
                              key={emp.id}
                              className={`rbac-assign-item ${checked ? 'rbac-assign-item--checked' : ''}`}
                              onClick={() => toggleEmpAssignment(String(emp.id))}
                            >
                              <div className="rbac-assign-item__avatar">
                                {emp.photoUrl
                                  ? <img src={emp.photoUrl} alt="" />
                                  : (emp.name?.[0] || '?').toUpperCase()
                                }
                              </div>
                              <div className="rbac-assign-item__info">
                                <span className="rbac-assign-item__name">{emp.name}</span>
                                <span className="rbac-assign-item__meta">
                                  {emp.employeeId}
                                  {emp.department && ` · ${emp.department}`}
                                  {emp.designation && ` · ${emp.designation}`}
                                </span>
                              </div>
                              <div className="rbac-assign-item__check">
                                <span className={`rbac-assign-checkbox ${checked ? 'rbac-assign-checkbox--on' : ''}`}>
                                  {checked ? '✓' : ''}
                                </span>
                              </div>
                            </li>
                          )
                        })}
                      </ul>

                      {assignedEmpIds.size === 0 && (
                        <div className="rbac-assign-warn">
                          ⚠️ No employees assigned — this user will see an empty attendance list.
                          Assign at least one employee above.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {saveMsg && (
                <div className={`rbac-alert rbac-alert--${saveMsg.type}`}>{saveMsg.text}</div>
              )}

              {selectedUser.has_account && (
                <div className="rbac-editor__footer">
                  <button
                    type="button"
                    className="rbac-save-btn"
                    onClick={savePermissions}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save permissions'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
