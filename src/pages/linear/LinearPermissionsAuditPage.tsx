import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { canManageWorkspaceUsers } from '../../lib/linearPermissions'
import {
  getLinearPermissionsAuditApi,
  simulateLinearPermissionsApi,
} from '../../lib/linearWorkspaceApi'
import './LinearPermissionsAuditPage.css'

type WorkspaceRole = 'viewer' | 'contributor' | 'developer' | 'qa' | 'manager' | 'admin'

type PermissionSummary = Record<string, boolean>
type AuditAction = { key: string, label: string }
type ProtectedRoute = {
  method: string
  path: string
  requiredPermission: string
  allowedRoles: WorkspaceRole[]
}
type CurrentUserSummary = {
  id: string
  name: string
  email: string
  effectiveLinearRole: WorkspaceRole | null
  permissions: PermissionSummary
  isAdmin?: boolean
  linearWorkspaceRole?: WorkspaceRole | null
}
type AuditPayload = {
  roles: Record<WorkspaceRole, PermissionSummary>
  actions: AuditAction[]
  protectedRoutes: ProtectedRoute[]
  currentUser: CurrentUserSummary | null
}
type SimulationPayload = {
  role: WorkspaceRole
  permissions: PermissionSummary
  allowedActions: string[]
  deniedActions: string[]
}

const ROLE_ORDER: WorkspaceRole[] = ['viewer', 'contributor', 'developer', 'qa', 'manager', 'admin']
const ACTION_ORDER = [
  'viewWorkspace',
  'createIssue',
  'editIssue',
  'deleteIssue',
  'comment',
  'uploadAttachment',
  'manageDocs',
  'manageIntake',
  'approveQA',
  'approveRelease',
  'manageReleasesDeployments',
  'syncGitHubPr',
  'manageGitHubSettings',
  'viewAudit',
  'exportWorkspace',
  'restoreWorkspace',
  'manageRoles',
]

const SIMULATOR_ITEMS = [
  ['viewWorkspace', 'Can view'],
  ['createIssue', 'Can create'],
  ['editIssue', 'Can edit'],
  ['deleteIssue', 'Can delete'],
  ['approveQA', 'Can approve QA'],
  ['approveRelease', 'Can approve release'],
  ['manageGitHub', 'Can manage GitHub'],
  ['viewAudit', 'Can view audit'],
  ['exportWorkspace', 'Can export'],
  ['restoreWorkspace', 'Can restore'],
  ['manageRoles', 'Can manage roles'],
] as const

function titleCase(value: string | null | undefined) {
  if (!value) return 'No access'
  return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

export default function LinearPermissionsAuditPage() {
  const { user } = useAuth()
  const [audit, setAudit] = useState<AuditPayload | null>(null)
  const [simulation, setSimulation] = useState<SimulationPayload | null>(null)
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>('developer')
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [loadingSimulation, setLoadingSimulation] = useState(true)
  const [auditError, setAuditError] = useState('')
  const [simulationError, setSimulationError] = useState('')

  const canManage = canManageWorkspaceUsers(user)

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true)
    setAuditError('')
    try {
      const data = await getLinearPermissionsAuditApi()
      setAudit(data)
      const currentRole = data?.currentUser?.effectiveLinearRole
      if (currentRole && ROLE_ORDER.includes(currentRole)) {
        setSelectedRole(currentRole)
      }
    } catch (err) {
      setAudit(null)
      setAuditError(err instanceof Error ? err.message : 'Failed to load permissions audit.')
    } finally {
      setLoadingAudit(false)
    }
  }, [])

  const loadSimulation = useCallback(async (role: WorkspaceRole) => {
    setLoadingSimulation(true)
    setSimulationError('')
    try {
      const data = await simulateLinearPermissionsApi(role)
      setSimulation(data)
    } catch (err) {
      setSimulation(null)
      setSimulationError(err instanceof Error ? err.message : 'Failed to simulate role.')
    } finally {
      setLoadingSimulation(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    loadAudit()
  }, [canManage, loadAudit])

  useEffect(() => {
    if (!canManage) return
    loadSimulation(selectedRole)
  }, [canManage, loadSimulation, selectedRole])

  const actionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of audit?.actions || []) map.set(item.key, item.label)
    return map
  }, [audit?.actions])

  const allowedCurrentUserActions = useMemo(() => {
    if (!audit?.currentUser?.permissions) return []
    return ACTION_ORDER.filter((key) => audit.currentUser?.permissions?.[key]).map((key) => actionMap.get(key) || key)
  }, [actionMap, audit?.currentUser?.permissions])

  const redFlags = useMemo(() => {
    if (!audit?.roles || !audit?.protectedRoutes) return []
    const flags: string[] = []
    const roles = audit.roles

    if (roles.viewer?.deleteIssue) flags.push('Viewer can delete issues.')
    if (roles.viewer?.editIssue) flags.push('Viewer can edit issues.')
    if (roles.viewer?.exportWorkspace) flags.push('Viewer can export workspace data.')
    if (roles.developer?.exportWorkspace || roles.developer?.restoreWorkspace) {
      flags.push('Developer can export or restore workspace data.')
    }
    if (roles.qa?.exportWorkspace || roles.qa?.restoreWorkspace) {
      flags.push('QA can export or restore workspace data.')
    }
    if (roles.contributor?.deleteIssue) flags.push('Contributor can delete issues.')
    if (roles.manager?.restoreWorkspace) flags.push('Manager can restore workspace data, which is not intended.')

    const adminOnlyRouteExposed = audit.protectedRoutes.some((route) => {
      const adminPath = route.path.includes('/admin/')
      const adminPermission = ['exportWorkspace', 'restoreWorkspace', 'manageRoles'].includes(route.requiredPermission)
      return (adminPath || adminPermission) && route.allowedRoles.some((role) => role !== 'admin')
    })
    if (adminOnlyRouteExposed) flags.push('An admin-only route appears accessible to a non-admin role.')

    if (audit.currentUser && !audit.currentUser.isAdmin) {
      flags.push('Current user has no app-admin fallback. Access depends on the explicit Linear workspace role.')
    }

    return flags
  }, [audit])

  if (!canManage) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to view the permissions audit."
      />
    )
  }

  return (
    <div className="lpa-layout">
      <LinearSidebar />

      <main className="lpa-main">
        <header className="lpa-header">
          <div>
            <div className="lpa-title-row">
              <Eye size={20} className="lpa-title-icon" />
              <h1>Permissions Audit</h1>
            </div>
            <p>Verify access rules for product workspace roles.</p>
          </div>

          <button type="button" className="lpa-refresh-btn" onClick={loadAudit} disabled={loadingAudit}>
            <RefreshCw size={14} className={loadingAudit ? 'lpa-spin' : ''} />
            Refresh audit
          </button>
        </header>

        <div className="lpa-grid">
          <section className="lpa-card">
            <div className="lpa-card__header">
              <div>
                <h2>Current user</h2>
                <p>Admin session summary for this workspace.</p>
              </div>
            </div>

            {loadingAudit ? (
              <div className="lpa-state">
                <RefreshCw size={16} className="lpa-spin" />
                Loading current user audit…
              </div>
            ) : auditError ? (
              <div className="lpa-state lpa-state--error">
                <AlertTriangle size={16} />
                {auditError}
              </div>
            ) : audit?.currentUser ? (
              <div className="lpa-current-user">
                <div className="lpa-current-user__identity">
                  <strong>{audit.currentUser.name}</strong>
                  <span>{audit.currentUser.email}</span>
                  <span className="lpa-pill lpa-pill--role">{titleCase(audit.currentUser.effectiveLinearRole)}</span>
                </div>
                <div className="lpa-current-user__permissions">
                  {allowedCurrentUserActions.length > 0 ? allowedCurrentUserActions.map((item) => (
                    <span key={item} className="lpa-pill lpa-pill--allowed">{item}</span>
                  )) : (
                    <span className="lpa-muted">No workspace permissions.</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="lpa-state">No current user summary available.</div>
            )}
          </section>

          <section className="lpa-card">
            <div className="lpa-card__header">
              <div>
                <h2>Role simulator</h2>
                <p>Read-only simulation. No session or user changes.</p>
              </div>
              <SlidersHorizontal size={18} className="lpa-card__icon" />
            </div>

            <div className="lpa-simulator-controls">
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as WorkspaceRole)}>
                {ROLE_ORDER.map((role) => (
                  <option key={role} value={role}>{titleCase(role)}</option>
                ))}
              </select>
            </div>

            {loadingSimulation ? (
              <div className="lpa-state">
                <RefreshCw size={16} className="lpa-spin" />
                Simulating role…
              </div>
            ) : simulationError ? (
              <div className="lpa-state lpa-state--error">
                <AlertTriangle size={16} />
                {simulationError}
              </div>
            ) : simulation ? (
              <div className="lpa-simulator">
                <div className="lpa-simulator-grid">
                  {SIMULATOR_ITEMS.map(([key, label]) => {
                    const allowed = !!simulation.permissions?.[key]
                    return (
                      <div key={key} className={`lpa-sim-item ${allowed ? 'lpa-sim-item--allowed' : 'lpa-sim-item--denied'}`}>
                        {allowed ? <ShieldCheck size={15} /> : <ShieldX size={15} />}
                        <span>{label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section className="lpa-card">
          <div className="lpa-card__header">
            <div>
              <h2>Role comparison matrix</h2>
              <p>Allowed and denied capabilities across all workspace roles.</p>
            </div>
          </div>

          {loadingAudit ? (
            <div className="lpa-state">
              <RefreshCw size={16} className="lpa-spin" />
              Loading role matrix…
            </div>
          ) : audit?.roles ? (
            <div className="lpa-table-wrap">
              <table className="lpa-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    {ROLE_ORDER.map((role) => (
                      <th key={role}>{titleCase(role)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACTION_ORDER.map((actionKey) => (
                    <tr key={actionKey}>
                      <td>{actionMap.get(actionKey) || actionKey}</td>
                      {ROLE_ORDER.map((role) => {
                        const allowed = !!audit.roles?.[role]?.[actionKey]
                        return (
                          <td key={`${actionKey}-${role}`}>
                            <span className={`lpa-matrix-cell ${allowed ? 'lpa-matrix-cell--allowed' : 'lpa-matrix-cell--denied'}`}>
                              {allowed ? 'Allowed' : 'Denied'}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="lpa-state">No role matrix available.</div>
          )}
        </section>

        <section className="lpa-card">
          <div className="lpa-card__header">
            <div>
              <h2>Protected routes</h2>
              <p>Backend route map and expected allowed roles.</p>
            </div>
          </div>

          {loadingAudit ? (
            <div className="lpa-state">
              <RefreshCw size={16} className="lpa-spin" />
              Loading protected routes…
            </div>
          ) : audit?.protectedRoutes?.length ? (
            <div className="lpa-table-wrap">
              <table className="lpa-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Route</th>
                    <th>Required permission</th>
                    <th>Allowed roles</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.protectedRoutes.map((route) => (
                    <tr key={`${route.method}:${route.path}`}>
                      <td><span className={`lpa-method lpa-method--${route.method.toLowerCase()}`}>{route.method}</span></td>
                      <td className="lpa-route">{route.path}</td>
                      <td>{route.requiredPermission}</td>
                      <td>{route.allowedRoles.map(titleCase).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="lpa-state">No protected routes available.</div>
          )}
        </section>

        <section className="lpa-card">
          <div className="lpa-card__header">
            <div>
              <h2>Red flag checks</h2>
              <p>Warnings for accidental access gaps.</p>
            </div>
          </div>

          {loadingAudit ? (
            <div className="lpa-state">
              <RefreshCw size={16} className="lpa-spin" />
              Running red flag checks…
            </div>
          ) : redFlags.length > 0 ? (
            <ul className="lpa-flags">
              {redFlags.map((flag) => (
                <li key={flag} className="lpa-flag">
                  <AlertTriangle size={15} />
                  <span>{flag}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="lpa-state lpa-state--success">
              <CheckCircle2 size={16} />
              No red flags detected for the current permission configuration.
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
