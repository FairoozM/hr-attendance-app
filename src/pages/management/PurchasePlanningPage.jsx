import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { api } from '../../api/client'
import { CreateZohoPoStep } from './CreateZohoPoStep'
import { GeneratePlanStep } from './GeneratePlanStep'
import { LatestSentPurchaseOrderPanel } from './LatestSentPurchaseOrderPanel'
import { LowStockUploadStep } from './LowStockUploadStep'
import { PurchasePlanningStatusCards } from './PurchasePlanningStatusCards'
import { PurchasePlanningStepper, StepPanel } from './PurchasePlanningStepper'
import { RecentPurchasePlansSection } from './RecentPurchasePlansSection'
import { ReviewPlanStep } from './ReviewPlanStep'
import { VigilUploadStep } from './VigilUploadStep'
import { ZohoEnrichmentStep } from './ZohoEnrichmentStep'
import {
  PP_REQUEST_OPTS,
  PP_STEPS,
  EMPTY_FILTERS,
  computeWorkflow,
  computePoReadiness,
  computePlanReviewSummary,
  enrichPlanWithPurchasePrices,
  getDefaultPurchasePlanningView,
  getLatestDraftPlan,
  getLatestSentPlan,
  getLatestVigilUpload,
  getPendingLowStock,
  ignoreCancelledPurchasePlanningRequest,
  isEditablePlanStatus,
  isOpenPlanStatus,
  isPlanSendStale,
  pollLowStockEnrichment,
  resolveAllPriceRows,
} from './purchasePlanningUtils'
import './DocumentExpiryPage.css'
import './PurchasePlanningPage.css'

export function PurchasePlanningPage() {
  const { ready: prefsReady, getPref, prefsVersion } = useUserPreferences()
  const [lowStock, setLowStock] = useState([])
  const [uploads, setUploads] = useState([])
  const [plans, setPlans] = useState([])
  const [activePlan, setActivePlan] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [loading, setLoading] = useState(true)
  const [loadingLowStock, setLoadingLowStock] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('')
  const [enrichmentRunning, setEnrichmentRunning] = useState(false)
  const [enrichmentError, setEnrichmentError] = useState(null)
  const [enrichmentSummary, setEnrichmentSummary] = useState(null)
  const [enrichmentProgress, setEnrichmentProgress] = useState(null)
  const [activeStep, setActiveStep] = useState(null)
  const [viewMode, setViewMode] = useState('workflow')
  const [removingLowStockId, setRemovingLowStockId] = useState(null)
  const loadAbortRef = useRef(null)
  const initialViewAppliedRef = useRef(false)
  const itemWriteSeqRef = useRef(new Map())
  const enrichmentPollRef = useRef(null)

  const scrollToStep = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('pp-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const goToStep = useCallback(
    (stepId) => {
      setActiveStep(stepId)
      scrollToStep()
    },
    [scrollToStep]
  )

  const pricesReady = Boolean(prefsReady)
  const allPriceRows = useMemo(
    () => resolveAllPriceRows(getPref, prefsReady, prefsVersion),
    [getPref, prefsReady, prefsVersion]
  )

  const activePlanWithPrices = useMemo(
    () => enrichPlanWithPurchasePrices(activePlan, allPriceRows),
    [activePlan, allPriceRows]
  )

  const attemptedPoNumber = activePlan?.status === 'failed' ? activePlan.purchaseOrderNumber || '' : ''
  useEffect(() => {
    if (attemptedPoNumber) setPurchaseOrderNumber((current) => current || attemptedPoNumber)
  }, [activePlan?.id, attemptedPoNumber])

  const workflow = useMemo(
    () =>
      computeWorkflow({
        uploads,
        lowStock,
        enrichmentRunning,
        enrichmentError,
        activePlan,
        activePlanWithPrices,
        plans,
        currentStep: activeStep,
        pricesReady,
      }),
    [uploads, lowStock, enrichmentRunning, enrichmentError, activePlan, activePlanWithPrices, plans, activeStep, pricesReady]
  )

  const currentStep = activeStep ?? workflow.suggestedStep

  const poReadiness = useMemo(
    () => computePoReadiness(activePlanWithPrices, { pricesReady }),
    [activePlanWithPrices, pricesReady]
  )

  const latestSentPlan = useMemo(() => getLatestSentPlan(plans), [plans])
  const latestDraftPlan = useMemo(() => getLatestDraftPlan(plans), [plans])

  const showLatestSentPanel = useMemo(() => {
    if (!latestSentPlan || latestDraftPlan) return false
    const noPendingBatch = getPendingLowStock(lowStock).length === 0
    return (
      viewMode === 'sent_review' ||
      viewMode === 'history' ||
      activePlanWithPrices?.status === 'sent_to_zoho' ||
      noPendingBatch
    )
  }, [latestSentPlan, latestDraftPlan, viewMode, activePlanWithPrices?.status, lowStock])

  const latestSentPanelPlan = useMemo(() => {
    if (activePlanWithPrices?.status === 'sent_to_zoho') return activePlanWithPrices
    return latestSentPlan
  }, [activePlanWithPrices, latestSentPlan])

  const latestSentPanelSummary = useMemo(() => {
    if (!latestSentPanelPlan) return null
    if (latestSentPanelPlan.items?.length) {
      return computePlanReviewSummary(latestSentPanelPlan)
    }
    return {
      includedCount: latestSentPanelPlan.includedCount,
      totalFinalQty: latestSentPanelPlan.totalFinalQty,
      estimatedValue: latestSentPanelPlan.estimatedTotalValue,
    }
  }, [latestSentPanelPlan])

  const load = useCallback(async () => {
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const opts = { ...PP_REQUEST_OPTS, signal: controller.signal }
    setError('')
    setLoadingLowStock(true)
    try {
      const lowStockPromise = api
        .get('/api/purchase-planning/low-stock', opts)
        .then((low) => {
          if (!controller.signal.aborted) setLowStock(low.items || [])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingLowStock(false)
        })
      const [uploadRes, planRes] = await Promise.all([
        api.get('/api/purchase-planning/vigil-uploads', opts),
        api.get('/api/purchase-planning/plans', opts),
      ])
      if (controller.signal.aborted) return
      setUploads(uploadRes.uploads || [])
      setPlans(planRes.plans || [])
      await lowStockPromise
    } catch (err) {
      if (ignoreCancelledPurchasePlanningRequest(err, controller.signal)) return
      setError(err.message || 'Failed to load purchase planning')
      setLoadingLowStock(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    load().finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      loadAbortRef.current?.abort()
    }
  }, [load])

  const refreshActivePlan = useCallback(async (id) => {
    const res = await api.get(`/api/purchase-planning/plans/${id}`, PP_REQUEST_OPTS)
    setActivePlan(res.plan)
    return res.plan
  }, [])

  const runEnrichmentPoll = useCallback(async () => {
    enrichmentPollRef.current?.abort()
    const controller = new AbortController()
    enrichmentPollRef.current = controller
    setEnrichmentRunning(true)
    setEnrichmentError(null)
    try {
      const result = await pollLowStockEnrichment({
        signal: controller.signal,
        onTick: async (tick) => {
          setLowStock(tick.items || [])
          if (tick.lastSummary) setEnrichmentSummary(tick.lastSummary)
          setEnrichmentProgress(
            tick.running && tick.progress
              ? `${tick.resumed ? 'Resumed after a server restart. ' : ''}${tick.progress}…`
              : null
          )
        },
      })
      if (!result) return
      setLowStock(result.items)
      if (result.lastError) {
        setEnrichmentError(result.lastError)
        setError(`Zoho enrichment failed: ${result.lastError}`)
      } else if (result.lastSummary) {
        setEnrichmentSummary(result.lastSummary)
        const s = result.lastSummary
        setNotice(
          `Enriched ${s.refreshed ?? 0} SKU(s): ${s.matched ?? 0} matched, ${s.unmatched ?? 0} unmatched in Zoho.`
        )
        if ((s.unmatched ?? 0) === 0) {
          setActiveStep((current) => (current == null || current === 3 ? 4 : current))
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setEnrichmentError(err.message || String(err))
      setError(err.message || 'Enrichment timed out')
    } finally {
      if (enrichmentPollRef.current === controller) {
        enrichmentPollRef.current = null
        setEnrichmentRunning(false)
        setEnrichmentProgress(null)
      }
    }
  }, [])

  useEffect(() => () => enrichmentPollRef.current?.abort(), [])

  useEffect(() => {
    api
      .get('/api/purchase-planning/low-stock/enrichment-status', PP_REQUEST_OPTS)
      .then((statusRes) => {
        if (statusRes.running) runEnrichmentPoll()
        else if (statusRes.lastSummary) setEnrichmentSummary(statusRes.lastSummary)
        if (statusRes.lastError) setEnrichmentError(statusRes.lastError)
      })
      .catch(() => {})
  }, [runEnrichmentPoll])

  const handleLowStockUploaded = useCallback(
    async (res) => {
      setError('')
      setLowStock(res.items || [])
      setLoadingLowStock(false)
      setActiveStep(3)
      if (res.enrichmentQueued) {
        setNotice('Saved low-stock SKUs. Enriching from Zoho…')
        await runEnrichmentPoll()
        return
      }
      const uploaded = Number(res.summary?.uploaded ?? 0)
      setNotice(`Saved ${uploaded} low-stock SKU(s).`)
    },
    [runEnrichmentPoll]
  )

  const removePendingLowStockSku = useCallback(async (item) => {
    if (!item?.id) return
    const ok = window.confirm(
      `Remove "${item.sku}" from this low-stock batch?\n\nIt will no longer block plan generation.`
    )
    if (!ok) return
    setRemovingLowStockId(item.id)
    setError('')
    try {
      const res = await api.delete(`/api/purchase-planning/low-stock/${item.id}`, PP_REQUEST_OPTS)
      const items = res.items || []
      setLowStock(items)
      const stillUnmatched = items.filter(
        (row) => row.status === 'pending' && !String(row.zohoItemId || '').trim()
      )
      setNotice(`Removed ${item.sku} from pending low-stock.`)
      if (stillUnmatched.length === 0 && items.some((row) => row.status === 'pending')) {
        setActiveStep(4)
        setNotice(`Removed ${item.sku}. Step 3 is clear — proceed to Generate Draft Plan (Step 4).`)
      }
    } catch (err) {
      setError(err.message || 'Failed to remove low-stock SKU')
    } finally {
      setRemovingLowStockId(null)
    }
  }, [])

  const refreshLowStockZoho = useCallback(async () => {
    const ok = window.confirm('Refresh Zoho data for all pending uploaded SKUs? This may call Zoho APIs.')
    if (!ok) return
    setBusy('enrich-low')
    setError('')
    setNotice('')
    try {
      await api.post('/api/purchase-planning/low-stock/refresh-zoho', {}, PP_REQUEST_OPTS)
      setNotice('Refreshing Zoho enrichment…')
      await runEnrichmentPoll()
    } catch (err) {
      setEnrichmentRunning(false)
      setError(err.message || 'Zoho refresh failed')
    } finally {
      setBusy('')
    }
  }, [runEnrichmentPoll])

  const generatePlan = useCallback(async () => {
    setBusy('generate')
    setError('')
    setNotice('Generating draft plan from enriched SKUs and Vigil stock…')
    try {
      const res = await api.post('/api/purchase-planning/generate-plan', {}, PP_REQUEST_OPTS)
      if (!res?.plan?.id) {
        throw new Error('Server returned an empty plan. Check backend logs or try again.')
      }
      setActivePlan(res.plan)
      setViewMode('draft_review')
      setPlans((prev) => {
        const without = prev.filter((p) => p.id !== res.plan.id)
        return [
          {
            id: res.plan.id,
            planNumber: res.plan.planNumber,
            status: res.plan.status,
            itemsCount: res.plan.items?.length ?? 0,
            totalFinalQty: (res.plan.items || []).reduce(
              (sum, item) => sum + (item.included ? Number(item.finalQty || 0) : 0),
              0
            ),
            createdAt: res.plan.createdAt,
          },
          ...without,
        ]
      })
      setActiveStep(5)
      setNotice(
        `Generated draft plan ${res.plan.planNumber}. Review lines below, then click Continue to Step 6 to create the Zoho PO.`
      )
      load().catch(() => {})
    } catch (err) {
      const code = err.body?.code || err.code
      const detail =
        err.body?.details?.unmatchedCount != null
          ? ` (${err.body.details.unmatchedCount} unmatched)`
          : ''
      setError(
        code
          ? `${err.message || 'Plan generation failed'} (${code})${detail}`
          : err.message || 'Plan generation failed'
      )
    } finally {
      setBusy('')
    }
  }, [load])

  const deleteDraftPlan = useCallback(
    async (plan) => {
      const label = plan.planNumber || plan.id
      const ok = window.confirm(
        `Delete draft plan ${label}?\n\nSKUs from this draft that are still marked planned return to the pending batch. A plan already sent to Zoho is not affected.`
      )
      if (!ok) return
      setBusy(`delete-plan-${plan.id}`)
      setError('')
      try {
        const deleted = await api.delete(`/api/purchase-planning/plans/${plan.id}`, PP_REQUEST_OPTS)
        if (activePlan?.id === plan.id) {
          setActivePlan(null)
          setFilters(EMPTY_FILTERS)
          setPurchaseOrderNumber('')
        }
        setPlans((prev) => prev.filter((p) => p.id !== plan.id))
        await load()
        const restored = Number(deleted?.restoredSkuCount ?? 0)
        setNotice(
          restored > 0
            ? `Deleted ${label}. ${restored} SKU(s) are pending again.`
            : `Deleted ${label}.`
        )
        const remainingPlans = plans.filter((p) => p.id !== plan.id)
        const view = getDefaultPurchasePlanningView({
          uploads,
          lowStock,
          enrichmentRunning,
          enrichmentError,
          plans: remainingPlans,
          selectedPlan: null,
        })
        setViewMode(view.mode)
        setActiveStep(view.activeStep)
        if (view.selectedPlanId) {
          await refreshActivePlan(view.selectedPlanId)
        }
      } catch (err) {
        setError(err.message || 'Failed to delete draft plan')
      } finally {
        setBusy('')
      }
    },
    [activePlan, load, plans, uploads, lowStock, enrichmentRunning, enrichmentError, refreshActivePlan]
  )

  const openPlan = useCallback(
    async (id) => {
      setBusy(`plan-${id}`)
      setError('')
      try {
        const plan = await refreshActivePlan(id)
        if (plan.status === 'sent_to_zoho') {
          setViewMode('sent_review')
          setActiveStep(5)
          scrollToStep(5)
          setNotice(`Opened sent plan ${plan.planNumber} (read-only).`)
        } else if (plan.status === 'sending') {
          setViewMode('draft_review')
          setActiveStep(6)
          scrollToStep(6)
        } else if (isEditablePlanStatus(plan.status)) {
          setViewMode('draft_review')
          setActiveStep(5)
          scrollToStep(5)
          if (plan.status === 'failed') {
            setNotice(`Opened ${plan.planNumber}. The last Zoho send failed — fix the lines and try again.`)
          }
        } else {
          setViewMode('workflow')
          setActiveStep(5)
        }
      } catch (err) {
        setError(err.message || 'Failed to open plan')
      } finally {
        setBusy('')
      }
    },
    [refreshActivePlan, scrollToStep]
  )

  const startNewPurchasePlan = useCallback(() => {
    setActivePlan(null)
    setFilters(EMPTY_FILTERS)
    setPurchaseOrderNumber('')
    setViewMode('workflow')
    const hasVigil = Boolean(getLatestVigilUpload(uploads))
    const nextStep = hasVigil ? 2 : 1
    setActiveStep(nextStep)
    setNotice(
      hasVigil
        ? 'Upload a new low-stock file in Step 2 to start a new batch. Previously sent plans remain in history.'
        : 'Upload Vigil wholesale stock in Step 1 to begin a new purchase plan.'
    )
    scrollToStep(nextStep)
  }, [uploads, scrollToStep])

  useEffect(() => {
    if (loading || loadingLowStock || initialViewAppliedRef.current) return
    initialViewAppliedRef.current = true
    const view = getDefaultPurchasePlanningView({
      uploads,
      lowStock,
      enrichmentRunning,
      enrichmentError,
      plans,
      selectedPlan: null,
    })
    setViewMode(view.mode)
    setActiveStep(view.activeStep)
    if (view.selectedPlanId) {
      refreshActivePlan(view.selectedPlanId)
        .then((plan) => {
          if (plan?.status === 'sent_to_zoho') {
            setViewMode('sent_review')
            setActiveStep(5)
          } else if (isOpenPlanStatus(plan?.status)) {
            setViewMode('draft_review')
            setActiveStep(plan.status === 'sending' ? 6 : 5)
          }
        })
        .catch((err) => {
          setError(err.message || 'Failed to load default plan')
        })
    }
  }, [
    loading,
    loadingLowStock,
    uploads,
    lowStock,
    enrichmentRunning,
    enrichmentError,
    plans,
    refreshActivePlan,
  ])

  const updateItem = useCallback(
    async (itemId, patch) => {
      const seq = (itemWriteSeqRef.current.get(itemId) || 0) + 1
      itemWriteSeqRef.current.set(itemId, seq)
      let planId = null
      setActivePlan((current) => {
        if (!current || !isEditablePlanStatus(current.status)) return current
        planId = current.id
        return {
          ...current,
          items: (current.items || []).map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
        }
      })
      if (!planId) return
      try {
        const res = await api.put(
          `/api/purchase-planning/plans/${planId}/items/${itemId}`,
          patch,
          PP_REQUEST_OPTS
        )
        if (itemWriteSeqRef.current.get(itemId) !== seq) return
        const saved = res?.item
        setActivePlan((current) => {
          if (!current || current.id !== planId) return current
          return {
            ...current,
            items: (current.items || []).map((item) =>
              item.id === itemId ? { ...item, ...(saved || {}), ...patch } : item
            ),
          }
        })
      } catch (err) {
        if (itemWriteSeqRef.current.get(itemId) !== seq) return
        setError(err.message || 'Failed to update plan item')
        await refreshActivePlan(planId)
      }
    },
    [refreshActivePlan]
  )

  const refreshPlanZohoData = useCallback(async () => {
    if (!activePlan || !isEditablePlanStatus(activePlan.status)) return
    const ok = window.confirm(
      'Refresh Zoho stock, sales, and bundle usage?\n\nThis may overwrite manual quantity edits. Wholesale availability comes from the Vigil upload this plan was built from.'
    )
    if (!ok) return
    setBusy('refresh-plan-zoho')
    setError('')
    try {
      const res = await api.post(
        `/api/purchase-planning/plans/${activePlan.id}/refresh-zoho-data`,
        {},
        PP_REQUEST_OPTS
      )
      setActivePlan(res.plan)
      const summary = res.summary || {}
      const vigilNote =
        summary.vigilSource === 'latest_fallback'
          ? ' The original Vigil upload is gone, so the latest upload was used.'
          : ''
      setNotice(`Refreshed ${summary.refreshed ?? 0} line(s) from Zoho.${vigilNote}`)
    } catch (err) {
      setError(err.message || 'Failed to refresh plan from Zoho')
    } finally {
      setBusy('')
    }
  }, [activePlan])

  const createPo = useCallback(async () => {
    const pricedPlan = activePlanWithPrices
    if (!pricedPlan) return
    const finishingInterruptedSend = isPlanSendStale(pricedPlan)
    if (!isEditablePlanStatus(pricedPlan.status) && !finishingInterruptedSend) return
    const poNumber = finishingInterruptedSend
      ? String(pricedPlan.purchaseOrderNumber || '').trim()
      : purchaseOrderNumber.trim()
    if (!poNumber) {
      setError('Enter a PO number before sending to Zoho')
      return
    }
    const selectedItems = (pricedPlan.items || []).filter(
      (item) => item.included && Number(item.finalQty || 0) > 0 && String(item.zohoItemId || '').trim()
    )
    const missingPriceItems = selectedItems.filter(
      (item) => !Number.isFinite(Number(item.purchasePrice)) || Number(item.purchasePrice) <= 0
    )
    if (missingPriceItems.length > 0) {
      setError(
        `Add purchase prices in All Prices for: ${missingPriceItems
          .slice(0, 5)
          .map((item) => item.sku)
          .join(', ')}${missingPriceItems.length > 5 ? '…' : ''}`
      )
      return
    }
    const ok = window.confirm(
      `Create Zoho purchase order ${poNumber} from ${pricedPlan.planNumber}?\n\n${selectedItems.length} line(s), total qty ${selectedItems.reduce((s, i) => s + Number(i.finalQty || 0), 0)}.`
    )
    if (!ok) return
    setBusy('po')
    setError('')
    setNotice('')
    try {
      const purchasePrices = selectedItems.map((item) => ({
        planItemId: item.id,
        sku: item.sku,
        purchasePrice: Number(item.purchasePrice),
      }))
      const res = await api.post(
        `/api/purchase-planning/plans/${pricedPlan.id}/create-zoho-po`,
        { purchaseOrderNumber: poNumber, purchasePrices },
        PP_REQUEST_OPTS
      )
      await refreshActivePlan(pricedPlan.id)
      await load()
      setViewMode('sent_review')
      setActiveStep(6)
      setNotice(
        res.reconciled
          ? `Zoho already had PO ${res.purchaseOrderNumber || poNumber} from an earlier attempt, so it was linked instead of creating a second one. Check its lines in Zoho.`
          : `Created Zoho purchase order ${res.purchaseOrderNumber || poNumber} (${res.sentLines} lines). Plan is now read-only.`
      )
    } catch (err) {
      const code = err.code || err.body?.code
      if (code === 'DUPLICATE_PO') {
        setError('This plan was already sent to Zoho. Duplicate PO creation is blocked.')
      } else if (code === 'PO_SEND_IN_PROGRESS') {
        setError('This plan is already being sent to Zoho. Reload in a moment to see the result.')
      } else {
        setError(err.message || 'Zoho purchase order failed')
      }
      await refreshActivePlan(pricedPlan.id).catch(() => {})
    } finally {
      setBusy('')
    }
  }, [activePlanWithPrices, load, purchaseOrderNumber, refreshActivePlan])

  const stepSummaries = useMemo(() => {
    const latest = uploads[0]
    const pending = workflow.pending?.length ?? 0
    return {
      1: latest ? `${latest.rowsCount} rows · ${latest.fileName}` : null,
      2: pending > 0 ? `${pending} pending SKU(s)` : workflow.batchConsumed ? 'Batch planned' : null,
      3: enrichmentRunning
        ? 'Enrichment running…'
        : workflow.pendingWithoutZoho?.length
          ? `${workflow.pendingWithoutZoho.length} unmatched`
          : pending > 0
            ? 'Enrichment complete'
            : null,
      4: activePlan?.planNumber || (workflow.hasOpenPlan ? 'Draft available' : null),
      5: activePlanWithPrices
        ? `${poReadiness.includedLines.length} ready · ${activePlanWithPrices.items?.length ?? 0} lines`
        : null,
      6: activePlan?.status === 'sent_to_zoho' ? activePlan.zohoPurchaseOrderId : null,
    }
  }, [uploads, workflow, enrichmentRunning, activePlan, activePlanWithPrices, poReadiness.includedLines.length])

  const renderStepContent = (stepId) => {
    switch (stepId) {
      case 1:
        return <VigilUploadStep uploads={uploads} onUploaded={load} status={workflow.stepStatuses[1]} />
      case 2:
        return (
          <LowStockUploadStep
            lowStock={lowStock}
            loading={loadingLowStock}
            onUploaded={handleLowStockUploaded}
            hasVigil={workflow.hasVigil}
            hasOpenDraft={workflow.hasOpenPlan}
            onRemoveUnmatched={removePendingLowStockSku}
            removingLowStockId={removingLowStockId}
          />
        )
      case 3:
        return (
          <ZohoEnrichmentStep
            lowStock={lowStock}
            enrichmentRunning={enrichmentRunning}
            enrichmentError={enrichmentError}
            enrichmentSummary={enrichmentSummary}
            enrichmentProgress={enrichmentProgress}
            onRefreshZoho={refreshLowStockZoho}
            onRemoveUnmatched={removePendingLowStockSku}
            removingLowStockId={removingLowStockId}
            refreshBusy={busy === 'enrich-low'}
            hasPending={workflow.hasPendingUpload}
            batchConsumed={workflow.batchConsumed}
          />
        )
      case 4:
        return (
          <GeneratePlanStep
            uploads={uploads}
            workflow={workflow}
            plans={plans}
            activePlan={activePlan}
            busy={busy === 'generate'}
            onGenerate={generatePlan}
            onOpenPlan={openPlan}
            onDeletePlan={deleteDraftPlan}
            onGoToStep={goToStep}
          />
        )
      case 5:
        return (
          <ReviewPlanStep
            plan={activePlanWithPrices}
            filters={filters}
            onFiltersChange={setFilters}
            onItemChange={updateItem}
            onRefreshZohoData={refreshPlanZohoData}
            refreshBusy={busy === 'refresh-plan-zoho'}
            readOnly={!isEditablePlanStatus(activePlanWithPrices?.status)}
            pricesReady={pricesReady}
            plans={plans}
            onOpenPlan={openPlan}
            onDeletePlan={deleteDraftPlan}
            deleteBusy={Boolean(busy?.startsWith('delete-plan'))}
            onContinueToPo={() => {
              goToStep(6)
              setNotice('Enter the PO number, then create the draft in Zoho.')
            }}
            currentStep={currentStep}
          />
        )
      case 6:
        return (
          <CreateZohoPoStep
            plan={activePlanWithPrices}
            purchaseOrderNumber={purchaseOrderNumber}
            onPurchaseOrderNumberChange={setPurchaseOrderNumber}
            onCreatePo={createPo}
            onReload={() => {
              if (activePlan?.id) refreshActivePlan(activePlan.id).catch(() => {})
            }}
            busy={busy === 'po'}
            pricesReady={pricesReady}
          />
        )
      default:
        return null
    }
  }

  const activeStepDef = PP_STEPS.find((step) => step.id === currentStep) || PP_STEPS[0]
  const nextStatus = workflow.stepStatuses[currentStep + 1]
  const canGoNext = currentStep < 6 && Boolean(nextStatus) && nextStatus !== 'blocked' && nextStatus !== 'not_started'

  if (loading) {
    return (
      <div className="page">
        <p className="page-loading">Loading Purchase Planning…</p>
      </div>
    )
  }

  return (
    <div className="page pp-page">
      <header className="doc-page-hero pp-hero">
        <div>
          <h1 className="doc-page-title">Purchase Planning</h1>
          <p className="doc-page-subtitle">
            Create Zoho draft purchase orders from low-stock SKUs, Vigil wholesale availability, Zoho stock, sales, and
            bundle usage.
          </p>
        </div>
      </header>

      <PurchasePlanningStatusCards
        uploads={uploads}
        lowStock={lowStock}
        enrichmentRunning={enrichmentRunning}
        enrichmentError={enrichmentError}
        plans={plans}
        activePlan={activePlan}
        onOpenLatestSent={openPlan}
        onStartNewPlan={startNewPurchasePlan}
      />

      {showLatestSentPanel && latestSentPanelPlan && (
        <LatestSentPurchaseOrderPanel
          plan={latestSentPanelPlan}
          summary={latestSentPanelSummary}
          onOpenSentPlan={openPlan}
          onStartNew={startNewPurchasePlan}
        />
      )}

      <PurchasePlanningStepper
        activeStep={currentStep}
        stepStatuses={workflow.stepStatuses}
        blockers={workflow.blockers}
        onStepClick={goToStep}
      />

      {error && <div className="page-error">{error}</div>}
      {notice && <div className="pp-notice">{notice}</div>}
      {workflow.hasPendingUpload && workflow.hasOpenPlan && (
        <div className="pp-notice">
          A new low-stock batch is in progress. The open draft stays available from Review until you replace it.
        </div>
      )}

      {activeStepDef && (
        <section id="pp-workspace" className="pp-workspace">
          <StepPanel
            id={`pp-step-${activeStepDef.id}`}
            step={activeStepDef}
            status={workflow.stepStatuses[activeStepDef.id]}
            blocker={workflow.blockers[activeStepDef.id]}
            collapsed={false}
            summary={stepSummaries[activeStepDef.id]}
          >
            {renderStepContent(activeStepDef.id)}
          </StepPanel>
          <div className="pp-workspace__nav">
            <button type="button" className="btn" disabled={currentStep <= 1} onClick={() => goToStep(currentStep - 1)}>
              Back
            </button>
            <p className="pp-workspace__nav-note">{workflow.blockers[currentStep] || stepSummaries[currentStep] || ''}</p>
            <button type="button" className="btn" disabled={!canGoNext} onClick={() => goToStep(currentStep + 1)}>
              Next
            </button>
          </div>
        </section>
      )}

      <RecentPurchasePlansSection
        plans={plans}
        activePlanId={activePlan?.id}
        onOpenPlan={openPlan}
        onDeletePlan={deleteDraftPlan}
        deleteBusy={Boolean(busy?.startsWith('delete-plan'))}
      />
    </div>
  )
}
