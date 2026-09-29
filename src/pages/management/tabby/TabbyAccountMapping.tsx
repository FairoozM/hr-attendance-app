import { useCallback, useEffect, useState } from 'react'
import {
  clearTabbyAccount,
  getTabbyAccounts,
  saveTabbyAccount,
  type TabbyAccountRole,
  type TabbyChartAccount,
} from '../../../api/tabbyClearing'
import { SearchableZohoAccountPicker } from '../../../components/zoho/SearchableZohoAccountPicker'
import { humanize } from './tabbyFormat'

const SOURCE_LABEL: Record<string, string> = {
  MAPPING: 'Admin mapping',
  EXACT_NAME: 'Exact name',
  KNOWN_EQUIVALENT: 'Known equivalent',
}

function RoleRow({
  role,
  chart,
  onChanged,
}: {
  role: TabbyAccountRole
  chart: TabbyChartAccount[]
  onChanged: () => Promise<void>
}) {
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eligible = chart.filter((a) => role.types.includes(String(a.accountType).toLowerCase()))

  async function save() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      await saveTabbyAccount(role.role, picked)
      setPicked('')
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the mapping.')
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    setError(null)
    try {
      await clearTabbyAccount(role.role)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the mapping.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td>
        <strong>{role.label}</strong>
        <div className="tabby-page__sub">{role.types.map(humanize).join(' / ')}</div>
      </td>
      <td>
        {role.resolved ? (
          <>
            <div>
              {role.resolved.accountName}
              {role.resolved.accountCode ? ` (${role.resolved.accountCode})` : ''}
            </div>
            <div className="tabby-page__sub tabby-page__mono">
              {role.resolved.accountId} · {SOURCE_LABEL[role.resolved.source || ''] || role.resolved.source}
            </div>
          </>
        ) : (
          <span className="tabby-pill tabby-pill--bad">Not mapped</span>
        )}
        {role.problem ? <div className="tabby-page__issue">{role.problem.message}</div> : null}
        {role.problem?.suggestions?.length ? (
          <div className="tabby-page__sub">
            Suggested:{' '}
            {role.problem.suggestions.map((s) => (
              <button
                key={s.accountId}
                type="button"
                className="tabby-page__link"
                disabled={busy}
                onClick={() => setPicked(s.accountId)}
              >
                {s.accountName}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <div className="tabby-page__issue">{error}</div> : null}
      </td>
      <td>
        <div className="tabby-page__picker">
          <SearchableZohoAccountPicker
            accounts={eligible}
            selectedId={picked}
            placeholder={`Search ${role.label}…`}
            onSelected={setPicked}
          />
          <div className="tabby-page__actions">
            <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={!picked || busy} onClick={save}>
              Save mapping
            </button>
            {role.mapping ? (
              <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy} onClick={clear}>
                Use automatic
              </button>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  )
}

/** Zoho accounts are chosen here, never created: posting stays blocked until every role resolves. */
export function TabbyAccountMapping({ onChanged }: { onChanged?: () => void }) {
  const [roles, setRoles] = useState<TabbyAccountRole[]>([])
  const [chart, setChart] = useState<TabbyChartAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await getTabbyAccounts()
      setRoles(res.roles)
      setChart(res.chartAccounts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Zoho accounts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reload = useCallback(async () => {
    await load()
    onChanged?.()
  }, [load, onChanged])

  const missing = roles.filter((r) => !r.resolved || r.problem).length

  return (
    <section className="tabby-page__card">
      <header className="tabby-page__card-head">
        <h2>Zoho account mapping</h2>
        {loading ? null : missing ? (
          <span className="tabby-pill tabby-pill--bad">{missing} need attention</span>
        ) : (
          <span className="tabby-pill tabby-pill--ok">All resolved</span>
        )}
      </header>
      <p className="tabby-page__note">
        Accounts resolve by exact name, then by known equivalent. Pick an account for any role that does not resolve;
        nothing is created in Zoho.
      </p>
      {error ? <div className="tabby-page__banner tabby-page__banner--error">{error}</div> : null}
      {loading ? (
        <p className="tabby-page__note">Loading Zoho chart of accounts…</p>
      ) : (
        <div className="tabby-page__scroll">
          <table className="tabby-page__table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Resolved account</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <RoleRow key={role.role} role={role} chart={chart} onChanged={reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
