import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import {
  LINEAR_ROLE_CAPABILITIES,
  canManageWorkspaceUsers,
} from '../../lib/linearPermissions'
import {
  listLinearWorkspaceUsersApi,
  updateLinearWorkspaceUserRoleApi,
} from '../../lib/linearWorkspaceApi'
import './LinearUserRolesPage.css'

type WorkspaceRole = 'viewer' | 'contributor' | 'developer' | 'qa' | 'manager' | 'admin'

type LinearWorkspaceUser = {
  id: string | number
  name: string
  email: string
  role: string
  designation: string | null
  linearWorkspaceRole: WorkspaceRole | null
  effectiveLinearRole: WorkspaceRole | null
  isAdmin: boolean
  active: boolean
}

type RowStatus = {
  saving?: boolean
  error?: string
  success?: string
}

const ROLE_ORDER: WorkspaceRole[] = ['admin', 'manager', 'developer', 'qa', 'contributor', 'viewer']
const FILTER_ROLE_OPTIONS: Array<{ value: string, label: string }> = [
  { value: 'all', label: 'All effective roles' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'no_access', label: 'No access' },
]

const SELECT_OPTIONS: Array<{ value: string, label: string }> = [
  { value: '__inherit__', label: 'Inherit default' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
]

function titleCase(value: string | null | undefined) {
  if (!value) return 'No access'
  return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

function appRoleLabel(role: string) {
  if (role === 'admin') return 'Admin'
  if (role === 'employee') return 'Employee'
  if (role === 'warehouse') return 'Warehouse'
  return role || 'Unknown'
}

export default function LinearUserRolesPage() {
  const { user, refreshUser } = useAuth()
  const [users, setUsers] = useState<LinearWorkspaceUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [banner, setBanner] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({})

  const canManage = canManageWorkspaceUsers(user)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await listLinearWorkspaceUsersApi()
      setUsers(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setUsers([])
      setError(err instanceof Error ? err.message : 'Failed to load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    loadUsers()
  }, [canManage, loadUsers])

  const summaryCounts = useMemo(() => {
    const counts: Record<WorkspaceRole, number> = {
      admin: 0,
      manager: 0,
      developer: 0,
      qa: 0,
      contributor: 0,
      viewer: 0,
    }
    for (const item of users) {
      if (item.effectiveLinearRole) counts[item.effectiveLinearRole] += 1
    }
    return counts
  }, [users])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((item) => {
      if (q) {
        const hay = `${item.name} ${item.email}`.toLowerCase()
        if (!hay.includes(q)) return false
      }

      if (roleFilter !== 'all') {
        if (roleFilter === 'no_access') {
          if (item.effectiveLinearRole) return false
        } else if (item.effectiveLinearRole !== roleFilter) {
          return false
        }
      }

      if (statusFilter === 'active' && !item.active) return false
      if (statusFilter === 'inactive' && item.active) return false

      return true
    })
  }, [roleFilter, search, statusFilter, users])

  const setSingleRowStatus = (userId: string | number, next: RowStatus) => {
    setRowStatus((prev) => ({ ...prev, [String(userId)]: next }))
  }

  const handleRoleChange = async (target: LinearWorkspaceUser, rawValue: string) => {
    const nextRole = rawValue === '__inherit__' ? null : rawValue as WorkspaceRole
    if ((target.linearWorkspaceRole || null) === nextRole) return

    const nextRoleLabel = nextRole ? titleCase(nextRole) : 'Inherit default'
    const selfDemotion =
      String(target.id) === String(user?.id) &&
      target.effectiveLinearRole === 'admin' &&
      nextRole !== 'admin'

    const confirmMessage = selfDemotion
      ? `You are changing your own Linear workspace role from Admin to ${nextRoleLabel}. If no other workspace admin remains, the server will block this change.\n\nDo you want to continue?`
      : `Change Linear workspace role for ${target.name} to ${nextRoleLabel}?`

    if (!window.confirm(confirmMessage)) return

    setBanner(null)
    setSingleRowStatus(target.id, { saving: true })

    try {
      const updated = await updateLinearWorkspaceUserRoleApi(target.id, nextRole)
      setUsers((prev) => prev.map((item) => (String(item.id) === String(target.id) ? updated : item)))
      setSingleRowStatus(target.id, { success: 'Saved' })
      setBanner({
        type: 'success',
        text: `Updated ${target.name}'s Linear workspace role.`,
      })

      if (String(target.id) === String(user?.id)) {
        await refreshUser()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update role.'
      setSingleRowStatus(target.id, { error: message })
      setBanner({ type: 'error', text: message })
    }
  }

  if (!canManage) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to manage Linear workspace roles."
      />
    )
  }

  return (
    <div className="lur-layout">
      <LinearSidebar />

      <main className="lur-main">
        <header className="lur-header">
          <div>
            <div className="lur-title-row">
              <Users size={20} className="lur-title-icon" />
              <h1>Users &amp; Roles</h1>
            </div>
            <p>Manage access to the product workspace.</p>
          </div>

          <button type="button" className="lur-refresh-btn" onClick={loadUsers} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'lur-spin' : ''} />
            Refresh
          </button>
        </header>

        {banner && (
          <div className={`lur-banner lur-banner--${banner.type}`}>
            {banner.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{banner.text}</span>
          </div>
        )}

        <section className="lur-summary-grid">
          {ROLE_ORDER.map((role) => (
            <article key={role} className={`lur-summary-card lur-summary-card--${role}`}>
              <div className="lur-summary-card__label">{titleCase(role)}s</div>
              <div className="lur-summary-card__value">{summaryCounts[role]}</div>
            </article>
          ))}
        </section>

        <section className="lur-controls">
          <label className="lur-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Search users by name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            {FILTER_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </section>

        <div className="lur-grid">
          <section className="lur-panel lur-panel--table">
            <div className="lur-panel__header">
              <div>
                <h2>User access</h2>
                <p>{filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'} shown</p>
              </div>
            </div>

            {loading ? (
              <div className="lur-state">
                <RefreshCw size={16} className="lur-spin" />
                Loading users…
              </div>
            ) : error ? (
              <div className="lur-state lur-state--error">
                <ShieldAlert size={16} />
                <span>{error}</span>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="lur-state">
                No users match the current search and filters.
              </div>
            ) : (
              <div className="lur-table-wrap">
                <table className="lur-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Existing app role / designation</th>
                      <th>Linear workspace role</th>
                      <th>Effective role</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((item) => {
                      const status = rowStatus[String(item.id)] || {}
                      return (
                        <tr key={item.id}>
                          <td>
                            <div className="lur-user-cell">
                              <strong>{item.name}</strong>
                              {String(item.id) === String(user?.id) && <span className="lur-pill lur-pill--self">You</span>}
                            </div>
                          </td>
                          <td className="lur-email">{item.email}</td>
                          <td>
                            <div className="lur-stack">
                              <span className={`lur-pill lur-pill--role lur-pill--app-${item.role}`}>{appRoleLabel(item.role)}</span>
                              <span className="lur-muted">{item.designation || '—'}</span>
                            </div>
                          </td>
                          <td>
                            <div className="lur-stack">
                              <select
                                value={item.linearWorkspaceRole || '__inherit__'}
                                onChange={(event) => handleRoleChange(item, event.target.value)}
                                disabled={!!status.saving}
                              >
                                {SELECT_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              {item.linearWorkspaceRole == null && (
                                <span className="lur-muted">Using fallback access</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className={`lur-pill lur-pill--effective lur-pill--${item.effectiveLinearRole || 'none'}`}>
                              {titleCase(item.effectiveLinearRole)}
                            </span>
                          </td>
                          <td>
                            <div className="lur-stack">
                              <span className={`lur-pill ${item.active ? 'lur-pill--active' : 'lur-pill--inactive'}`}>
                                {item.active ? 'Active' : 'Inactive'}
                              </span>
                              {item.isAdmin && <span className="lur-muted">App admin</span>}
                            </div>
                          </td>
                          <td>
                            <div className="lur-actions">
                              {status.saving && <span className="lur-saving">Saving…</span>}
                              {!status.saving && status.success && <span className="lur-success">{status.success}</span>}
                              {!status.saving && status.error && <span className="lur-error">{status.error}</span>}
                              {!status.saving && !status.success && !status.error && <span className="lur-muted">Ready</span>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="lur-panel lur-panel--roles">
            <div className="lur-panel__header">
              <div>
                <h2>Role guide</h2>
                <p>What each Linear workspace role can do.</p>
              </div>
              <ShieldCheck size={18} className="lur-role-guide__icon" />
            </div>

            <div className="lur-role-guide">
              {(['viewer', 'contributor', 'developer', 'qa', 'manager', 'admin'] as WorkspaceRole[]).map((role) => (
                <article key={role} className="lur-role-card">
                  <h3>{titleCase(role)}</h3>
                  <ul>
                    {LINEAR_ROLE_CAPABILITIES[role].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
