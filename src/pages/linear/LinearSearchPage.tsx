import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ClipboardList,
  Copy,
  FileText,
  History,
  Loader2,
  Package,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import { CommandMenu } from '../../components/linear/CommandMenu'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import { isAbortError } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { canViewAudit } from '../../lib/linearPermissions'
import {
  buildLinearSearchHref,
  getBuiltinLinearSearches,
  LINEAR_SAVED_SEARCHES_KEY,
  LinearBuiltinSearch,
  LinearSavedSearch,
  LinearSearchType,
  LinearWorkspaceSearchResult,
  normalizeLinearSavedSearches,
  normalizeLinearSearchType,
  removeLinearSavedSearch,
  upsertLinearSavedSearch,
} from '../../lib/linearSavedSearches'
import { searchLinearWorkspaceApi } from '../../lib/linearWorkspaceApi'
import './LinearSearchPage.css'

const BASE_FILTERS: Array<{ value: LinearSearchType, label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'issues', label: 'Issues' },
  { value: 'docs', label: 'Docs' },
  { value: 'intake', label: 'Intake' },
  { value: 'releases', label: 'Releases' },
  { value: 'deployments', label: 'Deployments' },
]

function resultIcon(type: LinearWorkspaceSearchResult['type']) {
  if (type === 'doc') return BookOpen
  if (type === 'intake') return ClipboardList
  if (type === 'mobile_release') return Package
  if (type === 'deployment') return Server
  if (type === 'audit') return History
  return FileText
}

function formatDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function metaChips(meta: Record<string, any> = {}) {
  const entries: string[] = []
  for (const [key, value] of Object.entries(meta)) {
    if (value == null || value === '' || key === 'updatedAt' || key === 'createdAt') continue
    if (Array.isArray(value)) {
      value.filter(Boolean).slice(0, 3).forEach((item) => entries.push(String(item)))
      continue
    }
    entries.push(String(value))
  }
  return entries.slice(0, 5)
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string) {
  const cleanText = String(text || '')
  const terms = Array.from(new Set(
    query
      .trim()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
  )).slice(0, 8)

  if (!cleanText || terms.length === 0) return cleanText
  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'ig')
  const exactPattern = new RegExp(`^(${terms.map(escapeRegex).join('|')})$`, 'i')
  const parts = cleanText.split(pattern)
  return parts.map((part, index) => (
    exactPattern.test(part)
      ? <mark key={`${part}-${index}`} className="lsearch-mark">{part}</mark>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>
  ))
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      return true
    } catch {
      return false
    }
  }
}

function toAbsoluteHashUrl(url: string) {
  if (!url) return window.location.href
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('#')) return `${window.location.origin}${window.location.pathname}${url}`
  return url
}

function summarizeResult(result: LinearWorkspaceSearchResult) {
  return [result.title, result.subtitle, result.snippet].filter(Boolean).join('\n\n')
}

function buildIssuePrompt(result: LinearWorkspaceSearchResult) {
  const meta = result.meta || {}
  const lines = [
    `Issue: ${meta.issueKey || result.title}`,
    `Title: ${meta.issueTitle || result.subtitle || result.title}`,
    meta.project ? `Project: ${meta.project}` : '',
    meta.status ? `Status: ${meta.status}` : '',
    meta.priority ? `Priority: ${meta.priority}` : '',
    meta.repo ? `Repo: ${meta.repo}` : '',
    meta.branchName ? `Branch: ${meta.branchName}` : '',
    meta.prUrl ? `PR: ${meta.prUrl}` : '',
    '',
    result.snippet ? `Context:\n${result.snippet}` : '',
    '',
    'Please investigate the root cause, suggest the safest implementation, and include any relevant test coverage.',
  ].filter(Boolean)
  return lines.join('\n')
}

export default function LinearSearchPage() {
  const { user } = useAuth()
  const { getPref, setPref, prefsVersion } = useUserPreferences()
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const canSeeAudit = canViewAudit(user)
  const isIntakeAlias = location.pathname.endsWith('/projects/linear/intake')

  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const allowedFilters = useMemo(
    () => (canSeeAudit ? [...BASE_FILTERS, { value: 'audit' as LinearSearchType, label: 'Audit' }] : BASE_FILTERS),
    [canSeeAudit]
  )
  const builtinSearches = useMemo(() => getBuiltinLinearSearches(canSeeAudit), [canSeeAudit])
  const savedSearches = useMemo(
    () => normalizeLinearSavedSearches(getPref(LINEAR_SAVED_SEARCHES_KEY, []), canSeeAudit),
    [getPref, prefsVersion, canSeeAudit]
  )

  const [query, setQuery] = useState(params.get('q') || '')
  const [type, setType] = useState<LinearSearchType>(
    allowedFilters.some((item) => item.value === params.get('type'))
      ? (params.get('type') as LinearSearchType)
      : (isIntakeAlias ? 'intake' : 'all')
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<LinearWorkspaceSearchResult[]>([])
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setCmdMenuOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    setQuery(params.get('q') || '')
    const nextType = params.get('type')
    if (allowedFilters.some((item) => item.value === nextType)) {
      setType(nextType as LinearSearchType)
    } else {
      setType(isIntakeAlias ? 'intake' : 'all')
    }
  }, [params, allowedFilters, isIntakeAlias])

  useEffect(() => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (type !== 'all') next.set('type', type)
    const nextSearch = next.toString() ? `?${next.toString()}` : ''
    if (nextSearch !== location.search) {
      navigate(`${location.pathname}${nextSearch}`, { replace: true })
    }
  }, [query, type, location.pathname, location.search, navigate])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setLoading(false)
      setError('')
      setExpandedIds([])
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const handle = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await searchLinearWorkspaceApi(
          { q: query.trim(), type, limit: 20 },
          { signal: controller.signal }
        )
        if (!cancelled) setResults(Array.isArray(data?.results) ? data.results : [])
      } catch (searchError: any) {
        if (isAbortError(searchError)) return
        if (!cancelled) {
          setError(searchError?.message || 'Failed to search workspace.')
          setResults([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(handle)
    }
  }, [query, type])

  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
  }, [])

  const flashMessage = useCallback((typeValue: 'success' | 'error', text: string) => {
    setFeedback({ type: typeValue, text })
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 2200)
  }, [])

  const applySearch = useCallback((nextQuery: string, nextType: LinearSearchType) => {
    const safeType = normalizeLinearSearchType(nextType, canSeeAudit)
    const nextParams = new URLSearchParams()
    if (nextQuery) nextParams.set('q', nextQuery)
    if (safeType !== 'all') nextParams.set('type', safeType)
    setQuery(nextQuery)
    setType(safeType)
    setExpandedIds([])
    navigate(`/projects/linear/search${nextParams.toString() ? `?${nextParams.toString()}` : ''}`)
  }, [canSeeAudit, navigate])

  const openResult = useCallback((result: LinearWorkspaceSearchResult) => {
    if (result.url?.startsWith('#')) {
      window.location.hash = result.url
      return
    }
    navigate(result.url || '/projects/linear/search')
  }, [navigate])

  const handleCopy = useCallback(async (text: string, successText: string) => {
    const ok = await copyText(text)
    flashMessage(ok ? 'success' : 'error', ok ? successText : 'Copy failed.')
  }, [flashMessage])

  const handleSaveCurrentSearch = useCallback(() => {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length < 2) {
      flashMessage('error', 'Type at least 2 characters before saving a search.')
      return
    }
    setSaveName(trimmedQuery)
    setSaveModalOpen(true)
  }, [flashMessage, query])

  const confirmSaveCurrentSearch = useCallback(() => {
    const trimmedName = saveName.trim()
    const trimmedQuery = query.trim()
    if (!trimmedName || trimmedQuery.length < 2) {
      flashMessage('error', 'Search name and query are required.')
      return
    }
    setPref(
      LINEAR_SAVED_SEARCHES_KEY,
      upsertLinearSavedSearch(savedSearches, {
        name: trimmedName,
        query: trimmedQuery,
        type,
      })
    )
    setSaveModalOpen(false)
    setSaveName('')
    flashMessage('success', 'Saved search updated.')
  }, [flashMessage, query, saveName, savedSearches, setPref, type])

  const handleDeleteSavedSearch = useCallback((search: LinearSavedSearch) => {
    if (!window.confirm(`Delete saved search "${search.name}"?`)) return
    setPref(LINEAR_SAVED_SEARCHES_KEY, removeLinearSavedSearch(savedSearches, search))
    flashMessage('success', 'Saved search deleted.')
  }, [flashMessage, savedSearches, setPref])

  const toggleExpanded = useCallback((resultKey: string) => {
    setExpandedIds((current) => (
      current.includes(resultKey)
        ? current.filter((item) => item !== resultKey)
        : [...current, resultKey]
    ))
  }, [])

  const renderResultActions = useCallback((result: LinearWorkspaceSearchResult) => {
    const actions: Array<{ label: string, onClick: () => void }> = []
    const meta = result.meta || {}

    if (result.type === 'issue') {
      actions.push({ label: 'Open Issue', onClick: () => openResult(result) })
      actions.push({ label: 'Copy Issue Key', onClick: () => handleCopy(meta.issueKey || result.title, 'Issue key copied.') })
      actions.push({ label: 'Copy Title', onClick: () => handleCopy(meta.issueTitle || result.subtitle || result.title, 'Issue title copied.') })
      actions.push({ label: 'Copy Dev Prompt', onClick: () => handleCopy(buildIssuePrompt(result), 'Dev prompt copied.') })
      return actions
    }

    if (result.type === 'doc') {
      actions.push({ label: 'Open Doc', onClick: () => openResult(result) })
      actions.push({ label: 'Copy Doc Content', onClick: () => handleCopy(summarizeResult(result), 'Doc content copied.') })
      return actions
    }

    if (result.type === 'intake') {
      actions.push({ label: 'Open Intake', onClick: () => openResult(result) })
      actions.push({ label: 'Copy Intake Summary', onClick: () => handleCopy(summarizeResult(result), 'Intake summary copied.') })
      return actions
    }

    if (result.type === 'mobile_release' || result.type === 'deployment') {
      actions.push({ label: 'Open Releases', onClick: () => openResult(result) })
      actions.push({ label: 'Copy Summary', onClick: () => handleCopy(summarizeResult(result), 'Summary copied.') })
      return actions
    }

    if (result.type === 'audit') {
      actions.push({ label: 'Open Audit', onClick: () => openResult(result) })
      actions.push({ label: 'Copy Audit Summary', onClick: () => handleCopy(summarizeResult(result), 'Audit summary copied.') })
      return actions
    }

    actions.push({ label: 'Open', onClick: () => openResult(result) })
    actions.push({ label: 'Copy Summary', onClick: () => handleCopy(summarizeResult(result), 'Summary copied.') })
    return actions
  }, [handleCopy, openResult])

  return (
    <div className="lsearch-shell">
      <LinearSidebar />

      <main className="lsearch-page">
        <header className="lsearch-header">
          <div>
            <h1>Search</h1>
            <p>Find issues, docs, intake, releases, deployments, and workspace history.</p>
          </div>
          <button type="button" className="lsearch-btn lsearch-btn--primary" onClick={handleSaveCurrentSearch}>
            <Plus size={14} />
            Save Current Search
          </button>
        </header>

        {feedback && (
          <div className={`lsearch-banner ${feedback.type === 'error' ? 'lsearch-banner--error' : 'lsearch-banner--success'}`}>
            {feedback.text}
          </div>
        )}

        <div className="lsearch-layout">
          <aside className="lsearch-side">
            <section className="lsearch-panel">
              <div className="lsearch-panel__header">
                <div>
                  <h2>Saved Searches</h2>
                  <p>Personal search shortcuts for this workspace.</p>
                </div>
              </div>

              <div className="lsearch-current">
                <div className="lsearch-current__label">Current search</div>
                <div className="lsearch-current__value">{query.trim() || 'No query yet'}</div>
                <div className="lsearch-current__meta">{type === 'all' ? 'All results' : type}</div>
              </div>

              <div className="lsearch-saved-list">
                {savedSearches.length === 0 && (
                  <div className="lsearch-side__empty">No saved searches yet.</div>
                )}

                {savedSearches.map((search) => (
                  <div key={`${search.createdAt}-${search.name}`} className="lsearch-saved-item">
                    <button
                      type="button"
                      className="lsearch-saved-item__body"
                      onClick={() => applySearch(search.query, search.type)}
                    >
                      <strong>{search.name}</strong>
                      <span>{search.query}</span>
                      <span>{search.type === 'all' ? 'All results' : search.type}</span>
                    </button>

                    <div className="lsearch-saved-item__actions">
                      <button type="button" className="lsearch-icon-btn" onClick={() => applySearch(search.query, search.type)}>
                        Run
                      </button>
                      <button type="button" className="lsearch-icon-btn lsearch-icon-btn--danger" onClick={() => handleDeleteSavedSearch(search)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="lsearch-panel">
              <div className="lsearch-panel__header">
                <div>
                  <h2>Built-in Searches</h2>
                  <p>Quick starting points for common workspace searches.</p>
                </div>
              </div>

              <div className="lsearch-saved-list">
                {builtinSearches.map((search: LinearBuiltinSearch) => (
                  <button
                    key={search.id}
                    type="button"
                    className="lsearch-builtin-item"
                    onClick={() => applySearch(search.query, search.type)}
                  >
                    <strong>{search.name}</strong>
                    <span>{search.description}</span>
                    <span>{search.query} · {search.type === 'all' ? 'All results' : search.type}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="lsearch-main">
            <section className="lsearch-searchbar">
              <div className="lsearch-searchbar__input">
                <Search size={16} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search the workspace"
                  aria-label="Search workspace"
                  autoComplete="off"
                />
              </div>

              <div className="lsearch-filters">
                {allowedFilters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`lsearch-chip ${type === filter.value ? 'lsearch-chip--active' : ''}`}
                    onClick={() => setType(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="lsearch-url-state">
                URL state is preserved for this search.
              </div>
            </section>

            {query.trim().length < 2 && (
              <div className="lsearch-empty">Type at least 2 characters to search the workspace.</div>
            )}

            {loading && (
              <div className="lsearch-empty">
                <Loader2 size={16} className="lsearch-spin" />
                Searching workspace…
              </div>
            )}

            {error && !loading && <div className="lsearch-empty lsearch-empty--error">{error}</div>}

            {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
              <div className="lsearch-empty">No matching workspace results found.</div>
            )}

            {!loading && !error && results.length > 0 && (
              <section className="lsearch-results">
                {results.map((result) => {
                  const resultKey = `${result.type}-${result.id}`
                  const Icon = resultIcon(result.type)
                  const chips = metaChips(result.meta)
                  const dateValue = result.meta?.updatedAt || result.meta?.createdAt || ''
                  const isExpanded = expandedIds.includes(resultKey)
                  const snippet = result.snippet || ''
                  const isLongSnippet = snippet.length > 220
                  const previewSnippet = !isLongSnippet || isExpanded
                    ? snippet
                    : `${snippet.slice(0, 220).trim()}…`
                  const actions = renderResultActions(result)

                  return (
                    <article key={resultKey} className="lsearch-result">
                      <div className="lsearch-result__icon">
                        <Icon size={16} />
                      </div>

                      <div className="lsearch-result__body">
                        <div className="lsearch-result__header">
                          <div>
                            <h2>{highlightText(result.title, query)}</h2>
                            {result.subtitle && <p>{highlightText(result.subtitle, query)}</p>}
                          </div>
                          <button type="button" className="lsearch-btn" onClick={() => openResult(result)}>
                            Open
                          </button>
                        </div>

                        {previewSnippet && (
                          <div className="lsearch-result__snippet">
                            {highlightText(previewSnippet, query)}
                          </div>
                        )}

                        {isLongSnippet && (
                          <button
                            type="button"
                            className="lsearch-inline-btn"
                            onClick={() => toggleExpanded(resultKey)}
                          >
                            {isExpanded ? 'Collapse preview' : 'Expand preview'}
                          </button>
                        )}

                        <div className="lsearch-result__actions">
                          {actions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              className="lsearch-action-btn"
                              onClick={action.onClick}
                            >
                              {action.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="lsearch-action-btn"
                            onClick={() => handleCopy(toAbsoluteHashUrl(result.url), 'Link copied.')}
                          >
                            <Copy size={13} />
                            Copy Link
                          </button>
                        </div>

                        <div className="lsearch-result__meta">
                          <span className="lsearch-type">{result.type.replace(/_/g, ' ')}</span>
                          {chips.map((chip) => <span key={chip} className="lsearch-meta-chip">{chip}</span>)}
                          {dateValue && <span className="lsearch-date">{formatDate(dateValue)}</span>}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </section>
            )}
          </section>
        </div>
      </main>

      {saveModalOpen && (
        <div
          className="lsearch-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Save current search"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSaveModalOpen(false)
              setSaveName('')
            }
          }}
        >
          <div className="lsearch-modal__card">
            <div className="lsearch-modal__header">
              <div>
                <h2>Save Current Search</h2>
                <p>Store this search for quick reuse.</p>
              </div>
              <button type="button" className="lsearch-icon-btn" onClick={() => { setSaveModalOpen(false); setSaveName('') }}>
                <X size={14} />
              </button>
            </div>

            <label className="lsearch-modal__field">
              <span>Search name</span>
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder="Checkout issues"
                autoFocus
              />
            </label>

            <div className="lsearch-modal__summary">
              <div><strong>Query:</strong> {query.trim()}</div>
              <div><strong>Type:</strong> {type === 'all' ? 'All results' : type}</div>
              <div><strong>URL:</strong> {buildLinearSearchHref({ query: query.trim(), type })}</div>
            </div>

            <div className="lsearch-modal__actions">
              <button type="button" className="lsearch-btn" onClick={() => { setSaveModalOpen(false); setSaveName('') }}>
                Cancel
              </button>
              <button type="button" className="lsearch-btn lsearch-btn--primary" onClick={confirmSaveCurrentSearch}>
                Save Search
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandMenu
        open={cmdMenuOpen}
        onClose={() => setCmdMenuOpen(false)}
        allIssues={[]}
        allCycles={[]}
        allViews={[]}
        allProjects={[]}
        allMembers={[]}
        projectMap={{}}
        activeIssue={null}
        onNewIssue={() => {}}
        onApplyView={() => {}}
        onSetGroupBy={() => {}}
        onSetActiveLabel={() => {}}
        onSetActiveCycle={() => {}}
        onSetActiveProject={() => {}}
        onSetActiveAssignee={() => {}}
        onClearFilters={() => {}}
        onManageCycles={() => {}}
        onSelectIssue={() => {}}
      />
    </div>
  )
}
