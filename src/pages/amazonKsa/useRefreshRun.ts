import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getKsaRun,
  isTerminalRunStatus,
  listKsaRuns,
  startKsaRefresh,
  startKsaSalesBackfill,
  type ManualJobType,
  type RefreshRun,
} from '../../api/amazonControlTower'

const POLL_MS = 2500

interface Options {
  /** Job types this page tracks; a run of one of them already in progress is picked up on mount. */
  watchJobTypes: string[]
  onFinished?: (run: RefreshRun) => void
}

/** Starts Control Tower jobs (202) and polls GET /runs/:id until the run is terminal. */
export function useRefreshRun({ watchJobTypes, onFinished }: Options) {
  const [run, setRun] = useState<RefreshRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  const watchKey = watchJobTypes.join(',')

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const poll = useCallback(async (id: string) => {
    stop()
    try {
      const next = await getKsaRun(id)
      if (!alive.current) return
      setRun(next)
      setError('')
      if (isTerminalRunStatus(next.status)) {
        onFinishedRef.current?.(next)
        return
      }
    } catch (err) {
      if (!alive.current) return
      setError(err instanceof Error ? err.message : String(err))
    }
    timer.current = setTimeout(() => void poll(id), POLL_MS)
  }, [])

  useEffect(() => {
    alive.current = true
    const types = watchKey.split(',')
    listKsaRuns(20)
      .then((runs) => {
        const active = runs.find((r) => !r.parentRunId && types.includes(r.jobType) && !isTerminalRunStatus(r.status))
        if (active && alive.current) void poll(active.id)
      })
      .catch(() => {})
    return () => {
      alive.current = false
      stop()
    }
  }, [poll, watchKey])

  const begin = useCallback(
    async (starter: () => Promise<{ runIds: string[] }>) => {
      setStarting(true)
      setError('')
      try {
        const res = await starter()
        if (res.runIds[0]) await poll(res.runIds[0])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStarting(false)
      }
    },
    [poll],
  )

  const start = useCallback((jobType: ManualJobType = 'refresh_all') => begin(() => startKsaRefresh(jobType)), [begin])
  const startBackfill = useCallback((days: number) => begin(() => startKsaSalesBackfill(days)), [begin])

  const busy = starting || (run != null && !isTerminalRunStatus(run.status))
  return { run, busy, starting, error, start, startBackfill }
}
