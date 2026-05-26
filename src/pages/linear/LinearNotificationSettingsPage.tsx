import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BellRing, Loader2, Save, Settings2 } from 'lucide-react'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { useAuth } from '../../contexts/AuthContext'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import {
  getLinearNotificationPreferencesApi,
  listAuditLogApi,
  listDeploymentsApi,
  listIntakeApi,
  listMobileReleasesApi,
  updateLinearNotificationPreferencesApi,
} from '../../lib/linearWorkspaceApi'
import { getGithubAuditLog } from '../../lib/projectsApi'
import { canManageGitHub, canManageWorkspaceUsers } from '../../lib/linearPermissions'
import {
  LINEAR_NOTIFICATION_CATEGORY_FIELDS,
  LINEAR_NOTIFICATION_WEEKLY_DAYS,
  buildDigestText,
  buildWorkspaceNotifications,
  normalizeNotificationPreferences,
} from '../../lib/linearNotifications'
import './LinearNotificationSettingsPage.css'

type PreviewType = 'daily' | 'weekly' | 'release'

function safeArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : []
}

export default function LinearNotificationSettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const {
    projects,
    members,
    getTasksForProject,
    actions,
    loadingProjects,
    loadingTasks,
  } = useTeamProjectsContext()

  const [preferences, setPreferences] = useState(() => normalizeNotificationPreferences(null))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [previewType, setPreviewType] = useState<PreviewType>('daily')

  const [mobileReleases, setMobileReleases] = useState<any[]>([])
  const [deployments, setDeployments] = useState<any[]>([])
  const [intakeItems, setIntakeItems] = useState<any[]>([])
  const [githubAuditItems, setGithubAuditItems] = useState<any[]>([])
  const [adminAuditItems, setAdminAuditItems] = useState<any[]>([])
  const [loadingPreviewData, setLoadingPreviewData] = useState(false)

  const fetchedRef = useRef(false)

  useEffect(() => {
    const preview = new URLSearchParams(location.search).get('preview')
    if (preview === 'daily' || preview === 'weekly' || preview === 'release') {
      setPreviewType(preview)
    }
  }, [location.search])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  useEffect(() => {
    if (!projects.length) return
    projects.forEach((project) => {
      actions.fetchTasks(project.id)
    })
  }, [projects, actions])

  useEffect(() => {
    let cancelled = false
    const loadPreferences = async () => {
      setLoading(true)
      setError('')
      try {
        const result = await getLinearNotificationPreferencesApi()
        if (!cancelled) setPreferences(normalizeNotificationPreferences(result))
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'Failed to load notification preferences.')
          setPreferences(normalizeNotificationPreferences(null))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadPreferences()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadPreviewData = async () => {
      setLoadingPreviewData(true)
      try {
        const requests: Promise<any>[] = [
          listIntakeApi(),
          listMobileReleasesApi(),
          listDeploymentsApi(),
        ]
        if (canManageGitHub(user)) requests.push(getGithubAuditLog({ limit: 40 }))
        if (canManageWorkspaceUsers(user)) requests.push(listAuditLogApi({ limit: 80 }))
        const results = await Promise.all(requests)
        if (cancelled) return

        setIntakeItems(safeArray(results[0]))
        setMobileReleases(safeArray(results[1]))
        setDeployments(safeArray(results[2]))

        let nextIndex = 3
        if (canManageGitHub(user)) {
          setGithubAuditItems(safeArray(results[nextIndex]))
          nextIndex += 1
        } else {
          setGithubAuditItems([])
        }

        if (canManageWorkspaceUsers(user)) {
          setAdminAuditItems(safeArray(results[nextIndex]))
        } else {
          setAdminAuditItems([])
        }
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || 'Failed to load digest preview data.')
      } finally {
        if (!cancelled) setLoadingPreviewData(false)
      }
    }
    loadPreviewData()
    return () => {
      cancelled = true
    }
  }, [user])

  const projectsMap = useMemo(() => {
    const map: Record<string | number, any> = {}
    projects.forEach((project) => {
      map[project.id] = project
    })
    return map
  }, [projects])

  const membersMap = useMemo(() => {
    const map: Record<string | number, any> = {}
    members.forEach((member) => {
      map[String(member.id)] = member
      map[member.id] = member
    })
    return map
  }, [members])

  const issues = useMemo(
    () => projects.flatMap((project) => getTasksForProject(project.id) || []),
    [projects, getTasksForProject]
  )

  const notifications = useMemo(
    () => buildWorkspaceNotifications({
      user,
      issues,
      projectsMap,
      membersMap,
      mobileReleases,
      deployments,
      intakeItems,
      githubAuditItems,
      adminAuditItems,
    }),
    [user, issues, projectsMap, membersMap, mobileReleases, deployments, intakeItems, githubAuditItems, adminAuditItems]
  )

  const digestContext = useMemo(() => ({
    user,
    issues,
    projectsMap,
    membersMap,
    mobileReleases,
    deployments,
    notifications,
  }), [user, issues, projectsMap, membersMap, mobileReleases, deployments, notifications])

  const previewText = useMemo(
    () => buildDigestText(previewType, 'markdown', digestContext),
    [previewType, digestContext]
  )

  const handleSave = async () => {
    setSaving(true)
    setSuccess('')
    setError('')
    try {
      const result = await updateLinearNotificationPreferencesApi(preferences)
      setPreferences(normalizeNotificationPreferences(result))
      setSuccess('Notification preferences saved.')
      window.setTimeout(() => setSuccess(''), 2400)
    } catch (saveError: any) {
      setError(saveError?.message || 'Failed to save notification preferences.')
    } finally {
      setSaving(false)
    }
  }

  const setCategory = (key: string, checked: boolean) => {
    setPreferences((current) => ({
      ...current,
      categories: {
        ...current.categories,
        [key]: checked,
      },
    }))
  }

  const isBusy = loading || loadingProjects || Object.values(loadingTasks || {}).some(Boolean)

  return (
    <div className="lns-shell">
      <LinearSidebar />

      <main className="lns-page">
        <header className="lns-header">
          <div>
            <div className="lns-header__eyebrow">
              <BellRing size={16} />
              Notification Settings
            </div>
            <h1>Notification Preferences</h1>
            <p>Choose channels, digest timing, and future notification categories for the Linear-style workspace.</p>
          </div>

          <div className="lns-header__actions">
            <button type="button" className="lns-btn" onClick={() => navigate('/projects/linear/notifications')}>
              Back to Notifications
            </button>
            <button type="button" className="lns-btn lns-btn--primary" onClick={handleSave} disabled={saving || loading}>
              <Save size={14} />
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        </header>

        {(error || success) && (
          <div className={`lns-banner ${error ? 'lns-banner--error' : 'lns-banner--success'}`}>
            {error || success}
          </div>
        )}

        {isBusy && (
          <div className="lns-loading">
            <Loader2 size={16} className="lns-spin" />
            Loading notification settings…
          </div>
        )}

        {!isBusy && (
          <div className="lns-grid">
            <section className="lns-card">
              <div className="lns-card__header">
                <h2><Settings2 size={16} /> Channels</h2>
              </div>

              <label className="lns-check">
                <input
                  type="checkbox"
                  checked={preferences.channel_in_app}
                  onChange={(event) => setPreferences((current) => ({ ...current, channel_in_app: event.target.checked }))}
                />
                <span>In-app enabled</span>
              </label>

              <label className="lns-check">
                <input
                  type="checkbox"
                  checked={preferences.channel_email}
                  onChange={(event) => setPreferences((current) => ({ ...current, channel_email: event.target.checked }))}
                />
                <span>Email future channel</span>
              </label>

              <label className="lns-field">
                <span>Email address</span>
                <input
                  type="email"
                  value={preferences.email_address || ''}
                  onChange={(event) => setPreferences((current) => ({ ...current, email_address: event.target.value || null }))}
                  placeholder="name@lifesmile.ae"
                />
              </label>

              <label className="lns-check">
                <input
                  type="checkbox"
                  checked={preferences.channel_whatsapp}
                  onChange={(event) => setPreferences((current) => ({ ...current, channel_whatsapp: event.target.checked }))}
                />
                <span>WhatsApp future channel</span>
              </label>

              <label className="lns-field">
                <span>WhatsApp number</span>
                <input
                  type="tel"
                  value={preferences.whatsapp_number || ''}
                  onChange={(event) => setPreferences((current) => ({ ...current, whatsapp_number: event.target.value || null }))}
                  placeholder="+971 50 123 4567"
                />
              </label>

              <p className="lns-note">
                Email/WhatsApp sending is not active yet. These settings prepare future digests.
              </p>
            </section>

            <section className="lns-card">
              <div className="lns-card__header">
                <h2>Digest schedule</h2>
              </div>

              <label className="lns-check">
                <input
                  type="checkbox"
                  checked={preferences.digest_daily}
                  onChange={(event) => setPreferences((current) => ({ ...current, digest_daily: event.target.checked }))}
                />
                <span>Daily digest</span>
              </label>

              <label className="lns-field">
                <span>Daily time</span>
                <input
                  type="time"
                  value={preferences.daily_digest_time}
                  onChange={(event) => setPreferences((current) => ({ ...current, daily_digest_time: event.target.value }))}
                />
              </label>

              <label className="lns-check">
                <input
                  type="checkbox"
                  checked={preferences.digest_weekly}
                  onChange={(event) => setPreferences((current) => ({ ...current, digest_weekly: event.target.checked }))}
                />
                <span>Weekly digest</span>
              </label>

              <label className="lns-field">
                <span>Weekly day</span>
                <select
                  value={preferences.weekly_digest_day}
                  onChange={(event) => setPreferences((current) => ({ ...current, weekly_digest_day: event.target.value as typeof preferences.weekly_digest_day }))}
                >
                  {LINEAR_NOTIFICATION_WEEKLY_DAYS.map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </label>

              <label className="lns-check">
                <input
                  type="checkbox"
                  checked={preferences.digest_release}
                  onChange={(event) => setPreferences((current) => ({ ...current, digest_release: event.target.checked }))}
                />
                <span>Release digest</span>
              </label>
            </section>

            <section className="lns-card lns-card--wide">
              <div className="lns-card__header">
                <h2>Notification categories</h2>
              </div>

              <div className="lns-category-grid">
                {LINEAR_NOTIFICATION_CATEGORY_FIELDS.map((field) => (
                  <label className="lns-check" key={field.key}>
                    <input
                      type="checkbox"
                      checked={preferences.categories[field.key]}
                      onChange={(event) => setCategory(field.key, event.target.checked)}
                    />
                    <span>{field.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="lns-card lns-card--wide">
              <div className="lns-card__header">
                <h2>Preview</h2>
                <p>Use the existing digest logic to preview copy without sending anything.</p>
              </div>

              <div className="lns-preview__actions">
                <button type="button" className={`lns-btn ${previewType === 'daily' ? 'lns-btn--active' : ''}`} onClick={() => setPreviewType('daily')}>
                  Preview Daily Digest
                </button>
                <button type="button" className={`lns-btn ${previewType === 'weekly' ? 'lns-btn--active' : ''}`} onClick={() => setPreviewType('weekly')}>
                  Preview Weekly Digest
                </button>
                <button type="button" className={`lns-btn ${previewType === 'release' ? 'lns-btn--active' : ''}`} onClick={() => setPreviewType('release')}>
                  Preview Release Digest
                </button>
              </div>

              <textarea
                className="lns-preview"
                readOnly
                value={loadingPreviewData ? 'Loading preview…' : previewText}
                aria-label="Digest preview"
              />
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
