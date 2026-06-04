import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { api } from '../../api/client'
import { CreateZohoPoStep } from './CreateZohoPoStep'
import { GeneratePlanStep } from './GeneratePlanStep'
import { LowStockUploadStep } from './LowStockUploadStep'
import { PurchasePlanningStatusCards } from './PurchasePlanningStatusCards'
import { PurchasePlanningStepper, StepPanel } from './PurchasePlanningStepper'
import { ReviewPlanStep } from './ReviewPlanStep'
import { VigilUploadStep } from './VigilUploadStep'
import { ZohoEnrichmentStep } from './ZohoEnrichmentStep'
import {
  PP_REQUEST_OPTS,
  PP_STEPS,
  EMPTY_FILTERS,
  computeWorkflow,
  enrichPlanWithPurchasePrices,
  ignoreCancelledPurchasePlanningRequest,
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
  const [activeStep, setActiveStep] = useState(null)
  const [removingLowStockId, setRemovingLowStockId] = useState(null)
  const loadAbortRef = useRef(null)

  const allPriceRows = useMemo(
    () => resolveAllPriceRows(getPref, prefsReady, prefsVersion),
    [getPref, prefsReady, prefsVersion]
  )

  const workflow = useMemo(
    () =>
      computeWorkflow({
        uploads,
        lowStock,
        enrichmentRunning,
        enrichmentError,
        activePlan,
        plans,
      }),
    [uploads, lowStock, enrichmentRunning, enrichmentError, activePlan, plans]
  )

  const currentStep = activeStep ?? workflow.suggestedStep

  const activePlanWithPrices = useMemo(
    () => enrichPlanWithPurchasePrices(activePlan, allPriceRows),
    [activePlan, allPriceRows]
  )

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
    const controller = new AbortController()
    const opts = { ...PP_REQUEST_OPTS, signal: controller.signal }
    setLoading(true)
    setLoadingLowStock(true)
    Promise.all([
      api.get('/api/purchase-planning/vigil-uploads', opts),
      api.get('/api/purchase-planning/plans', opts),
    ])
      .then(([uploadRes, planRes]) => {
        if (controller.signal.aborted) return
        setUploads(uploadRes.uploads || [])
        setPlans(planRes.plans || [])
      })
      .catch((err) => {
        if (ignoreCancelledPurchasePlanningRequest(err, controller.signal)) return
        setError(err.message || 'Failed to load purchase planning')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    api
      .get('/api/purchase-planning/low-stock', opts)
      .then((low) => {
        if (!controller.signal.aborted) setLowStock(low.items || [])
      })
      .catch((err) => {
        if (ignoreCancelledPurchasePlanningRequest(err, controller.signal)) return
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingLowStock(false)
      })

    return () => controller.abort()
  }, [])

  const refreshActivePlan = useCallback(async (id) => {
    const res = await api.get(`/api/purchase-planning/plans/${id}`, PP_REQUEST_OPTS)
    setActivePlan(res.plan)
    return res.plan
  }, [])

  const runEnrichmentPoll = useCallback(async () => {
    setEnrichmentRunning(true)
    setEnrichmentError(null)
    try {
      const result = await pollLowStockEnrichment({
        onTick: async (tick) => {
          setLowStock(tick.items)
          if (tick.lastSummary) setEnrichmentSummary(tick.lastSummary)
        },
      })
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
        if ((s.unmatched ?? 0) === 0) setActiveStep(4)
      }
    } catch (err) {
      setEnrichmentError(err.message || String(err))
      setError(err.message || 'Enrichment timed out')
    } finally {
      setEnrichmentRunning(false)
    }
  }, [])

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
    setNotice('')
    try {
      const res = await api.post('/api/purchase-planning/generate-plan', {}, PP_REQUEST_OPTS)
      setActivePlan(res.plan)
      setActiveStep(5)
      await load()
      setNotice(`Generated draft plan ${res.plan.planNumber}. Pending SKUs are now marked as planned.`)
    } catch (err) {
      setError(err.message || 'Plan generation failed')
    } finally {
      setBusy('')
    }
  }, [load])

  const deleteDraftPlan = useCallback(
    async (plan) => {
      const label = plan.planNumber || plan.id
      const ok = window.confirm(
        `Delete draft plan ${label}?\n\nThis cannot be undone. Deleting this draft will NOT return planned SKUs to pending — upload a new low-stock file to start another batch.`
      )
      if (!ok) return
      setBusy(`delete-plan-${plan.id}`)
      setError('')
      try {
        await api.delete(`/api/purchase-planning/plans/${plan.id}`, PP_REQUEST_OPTS)
        if (activePlan?.id === plan.id) {
          setActivePlan(null)
          setFilters(EMPTY_FILTERS)
          setPurchaseOrderNumber('')
        }
        setPlans((prev) => prev.filter((p) => p.id !== plan.id))
        await load()
        setNotice(`Deleted draft plan ${label}.`)
        setActiveStep(4)
      } catch (err) {
        setError(err.message || 'Failed to delete draft plan')
      } finally {
        setBusy('')
      }
    },
    [activePlan, load]
  )

  const openPlan = useCallback(
    async (id) => {
      setBusy(`plan-${id}`)
      setError('')
      try {
        const plan = await refreshActivePlan(id)
        setActiveStep(plan.status === 'sent_to_zoho' ? 6 : 5)
      } catch (err) {
        setError(err.message || 'Failed to open plan')
      } finally {
        setBusy('')
      }
    },
    [refreshActivePlan]
  )

  const updateItem = useCallback(
    async (itemId, patch) => {
      if (!activePlan || activePlan.status !== 'draft') return
      const optimisticItems = activePlan.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
      setActivePlan({ ...activePlan, items: optimisticItems })
      try {
        await api.put(`/api/purchase-planning/plans/${activePlan.id}/items/${itemId}`, patch, PP_REQUEST_OPTS)
        await refreshActivePlan(activePlan.id)
      } catch (err) {
        setError(err.message || 'Failed to update plan item')
        await refreshActivePlan(activePlan.id)
      }
    },
    [activePlan, refreshActivePlan]
  )

  const refreshPlanZohoData = useCallback(async () => {
    if (!activePlan || activePlan.status !== 'draft') return
    const ok = window.confirm(
      'Refresh Zoho stock, sales, and bundle usage?\n\nThis may overwrite manual quantity edits. Refresh uses the latest Vigil upload, not necessarily the upload stored on this plan.'
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
      setNotice(`Refreshed ${summary.refreshed ?? 0} line(s) from Zoho.`)
    } catch (err) {
      setError(err.message || 'Failed to refresh plan from Zoho')
    } finally {
      setBusy('')
    }
  }, [activePlan])

  const createPo = useCallback(async () => {
    const pricedPlan = activePlanWithPrices
    if (!pricedPlan || pricedPlan.status !== 'draft') return
    const poNumber = purchaseOrderNumber.trim()
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
      setActiveStep(6)
      setNotice(`Created Zoho purchase order ${res.zohoPurchaseOrderId || ''} (${res.sentLines} lines).`)
    } catch (err) {
      if (err.code === 'DUPLICATE_PO' || err.body?.code === 'DUPLICATE_PO') {
        setError('This plan was already sent to Zoho. Duplicate PO creation is blocked.')
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
      2: pending > 0 ? `${pending} pending SKU(s)` : null,
      3: enrichmentRunning
        ? 'Enrichment running…'
        : workflow.pendingWithoutZoho?.length
          ? `${workflow.pendingWithoutZoho.length} unmatched`
          : pending > 0
            ? 'Enrichment complete'
            : null,
      4: activePlan?.planNumber || workflow.hasDraft ? 'Draft available' : null,
      5: activePlanWithPrices ? `${activePlanWithPrices.items?.length ?? 0} lines` : null,
      6: activePlan?.status === 'sent_to_zoho' ? activePlan.zohoPurchaseOrderId : null,
    }
  }, [uploads, workflow, enrichmentRunning, activePlan, activePlanWithPrices])

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
            onRefreshZoho={refreshLowStockZoho}
            onRemoveUnmatched={removePendingLowStockSku}
            removingLowStockId={removingLowStockId}
            refreshBusy={busy === 'enrich-low'}
            hasPending={workflow.hasPendingUpload}
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
            onGoToStep={setActiveStep}
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
            readOnly={activePlanWithPrices?.status !== 'draft'}
            plans={plans}
            onOpenPlan={openPlan}
            onDeletePlan={deleteDraftPlan}
            deleteBusy={Boolean(busy?.startsWith('delete-plan'))}
          />
        )
      case 6:
        return (
          <CreateZohoPoStep
            plan={activePlanWithPrices}
            purchaseOrderNumber={purchaseOrderNumber}
            onPurchaseOrderNumberChange={setPurchaseOrderNumber}
            onCreatePo={createPo}
            busy={busy === 'po'}
          />
        )
      default:
        return null
    }
  }

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
      />

      <PurchasePlanningStepper
        activeStep={currentStep}
        stepStatuses={workflow.stepStatuses}
        onStepClick={setActiveStep}
      />

      {error && <div className="page-error">{error}</div>}
      {notice && <div className="pp-notice">{notice}</div>}

      <div className="pp-steps-stack">
        {PP_STEPS.map((step) => {
          const collapsed = currentStep !== step.id
          return (
            <StepPanel
              key={step.id}
              step={step}
              status={workflow.stepStatuses[step.id]}
              blocker={workflow.blockers[step.id]}
              collapsed={collapsed}
              onExpand={() => setActiveStep(step.id)}
              summary={stepSummaries[step.id]}
            >
              {renderStepContent(step.id)}
            </StepPanel>
          )
        })}
      </div>
    </div>
  )
}
