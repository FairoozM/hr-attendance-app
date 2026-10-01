import { useCallback, useEffect, useState } from 'react'
import {
  clearPosAccount,
  getPosAccounts,
  listPosTerminals,
  removePosTerminal,
  savePosAccount,
  savePosTerminal,
  type PosAccountRole,
  type PosChannel,
  type PosChartAccount,
  type PosTerminalMapping,
} from '../../../api/posSettlements'
import { SearchableZohoAccountPicker } from '../../../components/zoho/SearchableZohoAccountPicker'
import { channelLabel, humanize } from './posFormat'

const SOURCE_LABEL: Record<string, string> = {
  MAPPING: 'Admin mapping',
  EXACT_NAME: 'Exact name',
  KNOWN_EQUIVALENT: 'Known equivalent',
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function AccountRow({ role, chart, onChanged }: { role: PosAccountRole; chart: PosChartAccount[]; onChanged: () => Promise<void> }) {
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eligible = chart.filter((a) => role.types.includes(String(a.accountType).toLowerCase()))

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setPicked('')
      await onChanged()
    } catch (err) {
      setError(errorText(err, fallback))
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
              <button key={s.accountId} type="button" className="tabby-page__link" disabled={busy} onClick={() => setPicked(s.accountId)}>
                {s.accountName}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <div className="tabby-page__issue">{error}</div> : null}
      </td>
      <td>
        <div className="tabby-page__picker">
          <SearchableZohoAccountPicker accounts={eligible} selectedId={picked} placeholder={`Search ${role.label}…`} onSelected={setPicked} />
          <div className="tabby-page__actions">
            <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={!picked || busy} onClick={() => run(() => savePosAccount(role.role, picked), 'Could not save the mapping.')}>
              Save mapping
            </button>
            {role.mapping ? (
              <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy} onClick={() => run(() => clearPosAccount(role.role), 'Could not clear the mapping.')}>
                Use automatic
              </button>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  )
}

/** Zoho accounts are chosen here, never created; posting stays blocked until every role resolves. */
export function PosAccountMapping({ onChanged }: { onChanged?: () => void }) {
  const [roles, setRoles] = useState<PosAccountRole[]>([])
  const [chart, setChart] = useState<PosChartAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await getPosAccounts()
      setRoles(res.roles)
      setChart(res.chartAccounts)
    } catch (err) {
      setError(errorText(err, 'Could not load Zoho accounts.'))
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
        {loading ? null : missing ? <span className="tabby-pill tabby-pill--bad">{missing} need attention</span> : <span className="tabby-pill tabby-pill--ok">All resolved</span>}
      </header>
      <p className="tabby-page__note">
        POS accounts resolve by exact name, then by known equivalent. Stripe clearing accounts (1019, 1013, 2270) are refused. Nothing is created in Zoho.
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
                <AccountRow key={role.role} role={role} chart={chart} onChanged={reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const EMPTY_TERMINAL = { merchantId: '', terminalId: '', channel: 'BURJUMAN_SHOP' as PosChannel, location: '', notes: '' }

/** Merchant / terminal → channel. A channel is an analytical label; it never splits a payout. */
export function PosTerminalMapping({ onChanged }: { onChanged?: () => void }) {
  const [terminals, setTerminals] = useState<PosTerminalMapping[]>([])
  const [channels, setChannels] = useState<PosChannel[]>([])
  const [draft, setDraft] = useState(EMPTY_TERMINAL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await listPosTerminals()
      setTerminals(res.terminals)
      setChannels(res.channels.filter((c) => c !== 'UNKNOWN'))
      setError(null)
    } catch (err) {
      setError(errorText(err, 'Could not load terminal mappings.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      onChanged?.()
      return true
    } catch (err) {
      setError(errorText(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (await run(() => savePosTerminal(draft), 'Could not save the terminal mapping.')) setDraft(EMPTY_TERMINAL)
  }

  return (
    <section className="tabby-page__card">
      <header className="tabby-page__card-head">
        <h2>Terminal → channel mapping</h2>
        <span className={`tabby-pill tabby-pill--${terminals.length ? 'ok' : 'warn'}`}>{terminals.length} mapped</span>
      </header>
      <p className="tabby-page__note">
        Channel comes from the website order first, then this mapping, then the Zoho customer. A disagreement blocks posting. Leave the terminal empty to map a whole merchant ID.
      </p>
      {error ? <div className="tabby-page__banner tabby-page__banner--error">{error}</div> : null}
      <div className="tabby-page__upload">
        <input aria-label="Merchant ID" placeholder="Merchant ID (MID)" value={draft.merchantId} onChange={(e) => setDraft({ ...draft, merchantId: e.target.value })} disabled={busy} />
        <input aria-label="Terminal ID" placeholder="Terminal ID (TID, optional)" value={draft.terminalId} onChange={(e) => setDraft({ ...draft, terminalId: e.target.value })} disabled={busy} />
        <select aria-label="Channel" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value as PosChannel })} disabled={busy}>
          {channels.map((c) => (
            <option key={c} value={c}>
              {channelLabel(c)}
            </option>
          ))}
        </select>
        <input aria-label="Location" placeholder="Location (optional)" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} disabled={busy} />
        <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={busy || !draft.merchantId.trim()} onClick={add}>
          Add mapping
        </button>
      </div>
      {terminals.length ? (
        <div className="tabby-page__scroll">
          <table className="tabby-page__table">
            <thead>
              <tr>
                <th>MID</th>
                <th>TID</th>
                <th>Channel</th>
                <th>Location</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terminals.map((t) => (
                <tr key={t.id}>
                  <td className="tabby-page__mono">{t.merchantId}</td>
                  <td className="tabby-page__mono">{t.terminalId || 'all terminals'}</td>
                  <td>{channelLabel(t.channel)}</td>
                  <td>{t.location || '—'}</td>
                  <td className="tabby-page__sub">{t.createdBy || '—'}</td>
                  <td>
                    <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy} onClick={() => run(() => removePosTerminal(t.id), 'Could not remove the mapping.')}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="tabby-page__note">No terminals mapped yet. Mashreq MID / TID values appear in the transactions of an imported file.</p>
      )}
    </section>
  )
}
