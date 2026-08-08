import { useCallback } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth, hasPermission } from './contexts/AuthContext'
import { UserPreferencesProvider } from './contexts/UserPreferencesContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { SettingsContext } from './contexts/SettingsContext'
import { InfluencersProvider } from './contexts/InfluencersContext'
import { useAppSettings } from './hooks/useAppSettings'
import { Layout } from './components/Layout'
import { HomeRoute } from './components/HomeRoute'
import { RequireAuth } from './components/RequireAuth'
import { PermissionGuard, LeaveSelfServiceGuard } from './components/PermissionGuard'
import { LoginPage } from './pages/LoginPage'
import { EmployeeAccountPage } from './pages/EmployeeAccountPage'
import { AttendanceRouteContainer } from './pages/AttendanceRouteContainer'
import { EmployeesPage } from './pages/EmployeesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AnnualLeavePage } from './pages/AnnualLeavePage'
import { EmployeeProfileAdminPage } from './pages/EmployeeProfileAdminPage'
import { RolesPermissionsPage } from './pages/RolesPermissionsPage'
import { ItemReportGroupsAdminPage } from './pages/admin/ItemReportGroupsAdminPage'
import BulkZohoInvoicePage from './pages/admin/BulkZohoInvoicePage'
import BulkQuantityAdjustmentPage from './pages/admin/zoho/bulkQuantityAdjustment/BulkQuantityAdjustmentPage'
import { InfluencerListPage } from './pages/influencers/InfluencerListPage'
import { AddInfluencerPage } from './pages/influencers/AddInfluencerPage'
import { InfluencerModuleLayout } from './components/influencers/InfluencerModuleLayout'
import { InfluencerDetailPage } from './pages/influencers/InfluencerDetailPage'

function AdminOnly({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/account" replace />
  return children
}

/** AI usage dashboard & Amazon listing — operators with planner, prices, warehouse, or admin. */
function AiHubGuard({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  const can = (module, action) => hasPermission(user, module, action)
  const hasPlannerAccess = user.role === 'admin' || can('planner', 'view')
  const allowed =
    user.role === 'admin' ||
    user.role === 'warehouse' ||
    hasPlannerAccess ||
    can('prices', 'view')
  if (!allowed) return <Navigate to="/account" replace />
  return children
}
import { AgreementsPage } from './pages/influencers/AgreementsPage'
import { InfluencerPerformancePage } from './pages/influencers/InfluencerPerformancePage'
import { SimCardsPage } from './pages/SimCardsPage'
import { DocumentExpiryPage } from './pages/management/DocumentExpiryPage'
import { SubscriptionsPage } from './pages/management/subscriptions/SubscriptionsPage'
import { PaymentsPage as CompanyPaymentsPage } from './pages/management/PaymentsPage'
import { PurchasePlanningPage } from './pages/management/PurchasePlanningPage'
import { AmazonPaymentClearingPage } from './pages/management/amazonPaymentClearing/AmazonPaymentClearingPage'
import { NoonPaymentClearingPage } from './pages/management/noonPaymentClearing/NoonPaymentClearingPage'
import { AmazonReturnReconciliationPage } from './pages/management/amazonReturnReconciliation/AmazonReturnReconciliationPage'
import { InventoryHealthDashboardPage } from './pages/management/inventoryHealth/InventoryHealthDashboardPage'
import { AccountBalanceWatchlistPage } from './pages/management/accountBalanceWatchlist/AccountBalanceWatchlistPage'
import { AllPricesPage } from './pages/management/AllPricesPage'
import { AllUaePricesCustomPage } from './pages/management/AllUaePricesCustomPage'
import { KsaPricingPage } from './pages/management/ksaPricing/KsaPricingPage'
import { DuplicatePriceCleanupPage } from './pages/management/DuplicatePriceCleanupPage'
import { HistoricalPricesPage } from './pages/management/HistoricalPricesPage'
import { CompositeItemsPricesPage } from './pages/prices/CompositeItemsPricesPage'
import { CompositeItemsPricesCustomPage } from './pages/prices/CompositeItemsPricesCustomPage'
import { SavedCompositeItemsPage } from './pages/prices/SavedCompositeItemsPage'
import { SavedCompositeItemsCustomPage } from './pages/prices/SavedCompositeItemsCustomPage'
import { CompositeItemsPriceReportsPage } from './pages/prices/CompositeItemsPriceReportsPage'
import { WeeklyAdsReportPage } from './pages/reports/WeeklyAdsReportPage'
import { WeeklySalesReportPage } from './pages/reports/WeeklySalesReportPage'
import { WeeklyCombinedSalesReportPage } from './pages/reports/WeeklyCombinedSalesReportPage'
import { KsaVatReportPage } from './pages/reports/KsaVatReportPage'
import SalesVsExpensesReportPage from './pages/reports/SalesVsExpensesReportPage'
import { ZohoItemImageFetcherPage } from './pages/reports/ZohoItemImageFetcherPage'
import ProjectsIndexPage from './pages/projects/ProjectsIndexPage'
import ProjectDetailPage from './pages/projects/ProjectDetailPage'
import ProjectDashboardPage from './pages/projects/ProjectDashboardPage'
import TrashPage from './pages/projects/TrashPage'
import TeamProjectsPage from './pages/projects/TeamProjectsPage'
import LinearPlannerPage from './pages/linear/LinearPlannerPage'
import LinearDashboardPage from './pages/linear/LinearDashboardPage'
import LinearNotificationsPage from './pages/linear/LinearNotificationsPage'
import LinearNotificationSettingsPage from './pages/linear/LinearNotificationSettingsPage'
import LinearDigestOutboxPage from './pages/linear/LinearDigestOutboxPage'
import LinearSearchPage from './pages/linear/LinearSearchPage'
import LinearProjectsPage from './pages/linear/LinearProjectsPage'
import LinearWeeklyReportPage from './pages/linear/LinearWeeklyReportPage'
import LinearDocsPage from './pages/linear/LinearDocsPage'
import LinearTeamPage from './pages/linear/LinearTeamPage'
import LinearRoadmapPage from './pages/linear/LinearRoadmapPage'
import LinearWorkloadPage from './pages/linear/LinearWorkloadPage'
import LinearInboxPage from './pages/linear/LinearInboxPage'
import LinearReleasesPage from './pages/linear/LinearReleasesPage'
import LinearLaunchControlPage from './pages/linear/LinearLaunchControlPage'
import LinearLaunchHistoryPage from './pages/linear/LinearLaunchHistoryPage'
import LinearSettingsPage from './pages/linear/LinearSettingsPage'
import LinearHealthPage from './pages/linear/LinearHealthPage'
import LinearSmokeTestsPage from './pages/linear/LinearSmokeTestsPage'
import LinearAuditPage from './pages/linear/LinearAuditPage'
import LinearAdminBackupPage from './pages/linear/LinearAdminBackupPage'
import LinearUserRolesPage from './pages/linear/LinearUserRolesPage'
import LinearPermissionsAuditPage from './pages/linear/LinearPermissionsAuditPage'
import { AiUsageDashboard } from './pages/AiUsageDashboard'
import { AmazonListingGenerator } from './pages/AmazonListingGenerator'
import { AmazonSpApiTestPage } from './pages/AmazonSpApiTestPage'
import { AmazonOrdersPage } from './pages/AmazonOrdersPage'
import { AmazonOrdersDashboardPage } from './pages/AmazonOrdersDashboardPage'
import { AmazonSyncHealthPage } from './pages/AmazonSyncHealthPage'
import { AmazonZohoStockPage } from './pages/AmazonZohoStockPage'
import { SkuChannelCoveragePage } from './pages/SkuChannelCoveragePage'
import { AmazonOutOfStockClearancePage } from './pages/AmazonOutOfStockClearancePage'
import { AmazonKsaRtoLabelingPage } from './pages/AmazonKsaRtoLabelingPage'
import { AmazonKsaRtoAgentViewPage } from './pages/AmazonKsaRtoAgentViewPage'
import { AmazonFlatFileBulkGenerator } from './pages/AmazonFlatFileBulkGenerator'
import { AmazonReturnReportPage } from './pages/agent/AmazonReturnReportPage'
import NoonIntegrationPage from './pages/NoonIntegrationPage'
import { ListingBatchesPage } from './pages/ListingBatchesPage'
import { AiBudgetSettingsPage } from './pages/admin/AiBudgetSettingsPage'
import { NutritionCoachShell } from './pages/nutrition/NutritionCoachShell'
import { NutritionDashboardPage } from './pages/nutrition/NutritionDashboardPage'
import { FoodLogPage } from './pages/nutrition/FoodLogPage'
import { NutrientGapPage } from './pages/nutrition/NutrientGapPage'
import { MealPlanPage } from './pages/nutrition/MealPlanPage'
import { FitnessPlanPage } from './pages/nutrition/FitnessPlanPage'
import { ProgressTrackerPage } from './pages/nutrition/ProgressTrackerPage'
import { FoodLibraryPage } from './pages/nutrition/FoodLibraryPage'
import { NutritionSettingsPage } from './pages/nutrition/NutritionSettingsPage'
import { NutritionOnboardingWizard } from './pages/nutrition/NutritionOnboardingWizard'
import { HealthCalculatorsPage } from './pages/nutrition/HealthCalculatorsPage'
import { AIPlannerProvider } from './contexts/AIPlannerContext'
import { TeamProjectsProvider } from './contexts/TeamProjectsContext'
import { useEmployees } from './hooks/useEmployees'
import { clearAllAttendanceStorage } from './hooks/useAttendance'
import './App.css'

function AppContent() {
  const {
    employees,
    loading: employeesLoading,
    error: employeesError,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    resetToDefault,
  } = useEmployees()

  const handleResetDemoData = useCallback(() => {
    clearAllAttendanceStorage()
    resetToDefault()
    window.location.reload()
  }, [resetToDefault])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/agent/amazon-return-report/:publicToken" element={<AmazonReturnReportPage />} />
      <Route path="/rto-agent/:shareToken" element={<AmazonKsaRtoAgentViewPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <TeamProjectsProvider>
              <AIPlannerProvider>
                <Layout />
              </AIPlannerProvider>
            </TeamProjectsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="account" element={<EmployeeAccountPage />} />
        <Route
          path="annual-leave"
          element={
            <LeaveSelfServiceGuard>
              <AnnualLeavePage />
            </LeaveSelfServiceGuard>
          }
        />
        <Route
          path="attendance"
          element={
            <PermissionGuard module="attendance" action="view">
              <AttendanceRouteContainer />
            </PermissionGuard>
          }
        />
        <Route
          path="employees"
          element={
            <PermissionGuard module="employees" action="view">
              <EmployeesPage
                employees={employees}
                onAdd={addEmployee}
                onEdit={updateEmployee}
                onDelete={deleteEmployee}
                loading={employeesLoading}
                error={employeesError}
              />
            </PermissionGuard>
          }
        />
        <Route
          path="settings"
          element={<SettingsPage onResetDemoData={handleResetDemoData} />}
        />
        <Route
          path="lists/sim-cards"
          element={
            <PermissionGuard module="sim_cards" action="view">
              <SimCardsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="management/document-expiry"
          element={
            <PermissionGuard module="document_expiry" action="view">
              <DocumentExpiryPage />
            </PermissionGuard>
          }
        />
        <Route
          path="management/subscriptions"
          element={
            <PermissionGuard module="subscriptions" action="view">
              <SubscriptionsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="management/payments"
          element={
            <PermissionGuard module="company_payments" action="view">
              <CompanyPaymentsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="management/purchase-planning"
          element={
            <AdminOnly>
              <PurchasePlanningPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-payment-clearing"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-payment-clearing/:stepKey"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-payment-clearing/batch/:batchId"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-payment-clearing/batch/:batchId/:stepKey"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-uae-payment-clearing"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-uae-payment-clearing/:stepKey"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-uae-payment-clearing/batch/:batchId"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-uae-payment-clearing/batch/:batchId/:stepKey"
          element={
            <AdminOnly>
              <AmazonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/noon-payment-clearing"
          element={
            <AdminOnly>
              <NoonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/noon-payment-clearing/:stepKey"
          element={
            <AdminOnly>
              <NoonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/noon-payment-clearing/batch/:batchId"
          element={
            <AdminOnly>
              <NoonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/noon-payment-clearing/batch/:batchId/:stepKey"
          element={
            <AdminOnly>
              <NoonPaymentClearingPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/amazon-return-reconciliation"
          element={
            <AdminOnly>
              <AmazonReturnReconciliationPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/inventory-health"
          element={
            <AdminOnly>
              <InventoryHealthDashboardPage />
            </AdminOnly>
          }
        />
        <Route
          path="management/account-balance-watchlist"
          element={
            <AdminOnly>
              <AccountBalanceWatchlistPage />
            </AdminOnly>
          }
        />
        <Route path="management/all-prices" element={<Navigate to="/prices/all-prices" replace />} />
        <Route
          path="prices/all-prices"
          element={
            <PermissionGuard module="prices" action="view">
              <AllPricesPage market="uae" />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/all-prices-custom"
          element={
            <PermissionGuard module="prices" action="view">
              <AllUaePricesCustomPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/all-prices-ksa"
          element={
            <PermissionGuard module="prices" action="view">
              <KsaPricingPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/historical-prices"
          element={
            <PermissionGuard module="prices" action="view">
              <HistoricalPricesPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/duplicate-cleanup"
          element={
            <PermissionGuard module="prices" action="view">
              <DuplicatePriceCleanupPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/composite-items/reports"
          element={
            <PermissionGuard module="prices" action="view">
              <CompositeItemsPriceReportsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/composite-items"
          element={
            <PermissionGuard module="prices" action="view">
              <CompositeItemsPricesPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/composite-items-custom"
          element={
            <PermissionGuard module="prices" action="view">
              <CompositeItemsPricesCustomPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/saved-composite-items"
          element={
            <PermissionGuard module="prices" action="view">
              <SavedCompositeItemsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="prices/saved-composite-items-custom"
          element={
            <PermissionGuard module="prices" action="view">
              <SavedCompositeItemsCustomPage />
            </PermissionGuard>
          }
        />
        <Route
          path="employees/:id/profile"
          element={
            <PermissionGuard module="employees" action="view">
              <EmployeeProfileAdminPage />
            </PermissionGuard>
          }
        />
        <Route path="roles-permissions" element={<RolesPermissionsPage />} />
        <Route
          path="admin/ai-budget"
          element={
            <AdminOnly>
              <AiBudgetSettingsPage />
            </AdminOnly>
          }
        />
        <Route path="admin/item-report-groups" element={<ItemReportGroupsAdminPage />} />
        <Route
          path="admin/zoho/bulk-invoice"
          element={
            <PermissionGuard module="weekly_reports" action="view">
              <BulkZohoInvoicePage />
            </PermissionGuard>
          }
        />
        <Route
          path="admin/zoho/bulk-quantity-adjustment"
          element={
            <AdminOnly>
              <BulkQuantityAdjustmentPage />
            </AdminOnly>
          }
        />

        <Route
          path="ai/usage"
          element={
            <AiHubGuard>
              <AiUsageDashboard />
            </AiHubGuard>
          }
        />
        <Route
          path="ai/noon-integration"
          element={
            <AdminOnly>
              <NoonIntegrationPage />
            </AdminOnly>
          }
        />
        <Route
          path="ai/amazon-spapi-test"
          element={
            <AiHubGuard>
              <AmazonSpApiTestPage />
            </AiHubGuard>
          }
        />
        <Route
          path="ai/amazon-orders"
          element={
            <AiHubGuard>
              <AmazonOrdersPage />
            </AiHubGuard>
          }
        />
        <Route
          path="ai/amazon-dashboard"
          element={
            <AiHubGuard>
              <AmazonOrdersDashboardPage />
            </AiHubGuard>
          }
        />
        <Route
          path="ai/amazon-sync-health"
          element={
            <AdminOnly>
              <AmazonSyncHealthPage />
            </AdminOnly>
          }
        />
        <Route
          path="ai/amazon-zoho-stock"
          element={
            <AdminOnly>
              <AmazonZohoStockPage />
            </AdminOnly>
          }
        />
        <Route
          path="ai/sku-channel-coverage"
          element={
            <AdminOnly>
              <SkuChannelCoveragePage />
            </AdminOnly>
          }
        />
        <Route
          path="ai/amazon-out-of-stock-clearance"
          element={
            <AdminOnly>
              <AmazonOutOfStockClearancePage />
            </AdminOnly>
          }
        />
        <Route
          path="amazon/ksa-rto-labeling"
          element={<AmazonKsaRtoLabelingPage />}
        />
        <Route
          path="ai/amazon-listing"
          element={
            <AiHubGuard>
              <AmazonListingGenerator />
            </AiHubGuard>
          }
        />
        <Route
          path="ai/amazon-bulk-listing"
          element={
            <AiHubGuard>
              <AmazonFlatFileBulkGenerator />
            </AiHubGuard>
          }
        />
        <Route
          path="ai/listing-batches"
          element={
            <AiHubGuard>
              <ListingBatchesPage />
            </AiHubGuard>
          }
        />

        {/* AI Planner Module */}
        <Route
          path="projects"
          element={
            <PermissionGuard module="planner" action="view">
              <ProjectsIndexPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/dashboard"
          element={
            <PermissionGuard module="planner" action="view">
              <ProjectDashboardPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/today"
          element={
            <PermissionGuard module="planner" action="view">
              <ProjectDetailPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/trash"
          element={
            <PermissionGuard module="planner" action="view">
              <TrashPage />
            </PermissionGuard>
          }
        />
        {/* /projects/team: kept accessible by URL but not promoted in nav.
            Deprecated in favour of the new Linear-style issue tracker. */}
        <Route
          path="projects/team"
          element={
            <PermissionGuard module="planner" action="view">
              <TeamProjectsPage />
            </PermissionGuard>
          }
        />
        {/* Linear-style issue tracker — Phase 2.
            This is the new primary issue tracker at /projects/linear.
            /projects (AI Planner) remains completely untouched. */}
        <Route
          path="projects/linear/dashboard"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearDashboardPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/reports/weekly"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearWeeklyReportPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/docs"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearDocsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearPlannerPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/notifications"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearNotificationsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/notifications/settings"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearNotificationSettingsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/notifications/outbox"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearDigestOutboxPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/search"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearSearchPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/intake"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearSearchPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/projects"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearProjectsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/team"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearTeamPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/roadmap"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearRoadmapPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/workload"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearWorkloadPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/inbox"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearInboxPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/releases"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearReleasesPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/launch"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearLaunchControlPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/launch/history"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearLaunchHistoryPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/settings"
          element={
            <PermissionGuard module="planner" action="manage">
              <LinearSettingsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/smoke-tests"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearSmokeTestsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/health"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearHealthPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/audit"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearAuditPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/admin/backup"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearAdminBackupPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/admin/users"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearUserRolesPage />
            </PermissionGuard>
          }
        />
        <Route
          path="projects/linear/admin/permissions"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearPermissionsAuditPage />
            </PermissionGuard>
          }
        />
        {/* Wildcard for any other /projects/linear/* sub-routes — keep Issues page */}
        <Route
          path="projects/linear/*"
          element={
            <PermissionGuard module="planner" action="view">
              <LinearPlannerPage />
            </PermissionGuard>
          }
        />

        {/* Reports Module */}
        <Route path="reports">
          <Route
            path="sales-vs-expenses/:reportId"
            element={
              <PermissionGuard module="weekly_reports" action="view">
                <SalesVsExpensesReportPage />
              </PermissionGuard>
            }
          />
          <Route
            path="sales-vs-expenses"
            element={
              <PermissionGuard module="weekly_reports" action="view">
                <SalesVsExpensesReportPage />
              </PermissionGuard>
            }
          />
          <Route
            path="zoho-item-images"
            element={
              <PermissionGuard module="weekly_reports" action="view">
                <ZohoItemImageFetcherPage />
              </PermissionGuard>
            }
          />
          <Route path="weekly-report">
            <Route
              path="weekly-ads"
              element={
                <PermissionGuard module="weekly_reports" action="view">
                  <WeeklyAdsReportPage />
                </PermissionGuard>
              }
            />
            {/* Combined page: both Slow Moving + Other Family in one view */}
            <Route
              path="sales"
              element={
                <PermissionGuard module="weekly_reports" action="view">
                  <WeeklyCombinedSalesReportPage />
                </PermissionGuard>
              }
            />
            {/* Keep individual routes for direct links / backward compat */}
            <Route
              path="slow-moving"
              element={
                <PermissionGuard module="weekly_reports" action="view">
                  <WeeklySalesReportPage
                    reportGroup="slow_moving"
                    title="Weekly Slow Moving Sales Report"
                    subtitle="Live Zoho-sourced totals for the slow-moving item group"
                  />
                </PermissionGuard>
              }
            />
            <Route
              path="other-family"
              element={
                <PermissionGuard module="weekly_reports" action="view">
                  <WeeklySalesReportPage
                    reportGroup="other_family"
                    title="Weekly Other Family Sales Report"
                    subtitle="Live Zoho-sourced totals for the other-family item group"
                  />
                </PermissionGuard>
              }
            />
          </Route>
        </Route>

        {/* Taxation Module */}
        <Route path="taxation">
          <Route
            path="ksa-vat"
            element={
              <PermissionGuard module="taxation" action="view">
                <KsaVatReportPage />
              </PermissionGuard>
            }
          />
        </Route>

        {/* Influencers Module */}
        <Route path="influencers">
          <Route element={<InfluencerModuleLayout />}>
            <Route index element={<Navigate to="performance" replace />} />
            <Route path="performance" element={
              <PermissionGuard module="influencers" action="performance">
                <InfluencerPerformancePage />
              </PermissionGuard>
            } />
            <Route path=":influencerId" element={
              <PermissionGuard module="influencers" action="view">
                <InfluencerDetailPage />
              </PermissionGuard>
            } />
          </Route>
          {/* Legacy routes — preserved until migrated into module sections */}
          <Route path="list" element={
            <PermissionGuard module="influencers" action="view">
              <InfluencerListPage />
            </PermissionGuard>
          } />
          <Route path="new" element={
            <PermissionGuard module="influencers" action="manage">
              <AddInfluencerPage />
            </PermissionGuard>
          } />
          <Route path="agreements" element={
            <PermissionGuard module="influencers" action="agreements">
              <AgreementsPage />
            </PermissionGuard>
          } />
          <Route path=":id/edit" element={
            <PermissionGuard module="influencers" action="view">
              <AddInfluencerPage />
            </PermissionGuard>
          } />
        </Route>
        <Route path="health-fitness" element={<NutritionCoachShell />}>
          <Route path="onboarding" element={<NutritionOnboardingWizard />} />
          <Route path="dashboard" element={<NutritionDashboardPage />} />
          <Route path="food-log" element={<FoodLogPage />} />
          <Route path="nutrient-gaps" element={<NutrientGapPage />} />
          <Route path="meal-plan" element={<MealPlanPage />} />
          <Route path="fitness-plan" element={<FitnessPlanPage />} />
          <Route path="progress" element={<ProgressTrackerPage />} />
          <Route path="food-library" element={<FoodLibraryPage />} />
          <Route path="calculators" element={<HealthCalculatorsPage />} />
          <Route path="settings" element={<NutritionSettingsPage />} />
          <Route index element={<Navigate to="dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}

function AppWithSettings() {
  const settings = useAppSettings()
  return (
    <SettingsContext.Provider value={settings}>
      <InfluencersProvider>
        <AppContent />
      </InfluencersProvider>
    </SettingsContext.Provider>
  )
}

function App() {
  return (
    <AuthProvider>
      <UserPreferencesProvider>
        <ThemeProvider>
          <AppWithSettings />
        </ThemeProvider>
      </UserPreferencesProvider>
    </AuthProvider>
  )
}

export default App
