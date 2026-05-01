import { useState, useMemo, useCallback } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsContext } from './contexts/SettingsContext'
import { InfluencersProvider } from './contexts/InfluencersContext'
import { useAppSettings } from './hooks/useAppSettings'
import { Layout } from './components/Layout'
import { HomeRoute } from './components/HomeRoute'
import { RequireAuth } from './components/RequireAuth'
import { PermissionGuard } from './components/PermissionGuard'
import { LoginPage } from './pages/LoginPage'
import { EmployeeAccountPage } from './pages/EmployeeAccountPage'
import { AttendancePage } from './pages/AttendancePage'
import { EmployeesPage } from './pages/EmployeesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AnnualLeavePage } from './pages/AnnualLeavePage'
import { EmployeeProfileAdminPage } from './pages/EmployeeProfileAdminPage'
import { RolesPermissionsPage } from './pages/RolesPermissionsPage'
import { ItemReportGroupsAdminPage } from './pages/admin/ItemReportGroupsAdminPage'
import BulkZohoInvoicePage from './pages/admin/BulkZohoInvoicePage'
import { InfluencerListPage } from './pages/influencers/InfluencerListPage'
import { AddInfluencerPage } from './pages/influencers/AddInfluencerPage'
import { PipelinePage } from './pages/influencers/PipelinePage'
/** /influencers/:id (legacy profile URL) — send users straight to the editor. */
function InfluencerIdToEditRedirect() {
  const { id } = useParams()
  return <Navigate to={`/influencers/${encodeURIComponent(id)}/edit`} replace />
}
import { ShootSchedulePage } from './pages/influencers/ShootSchedulePage'
import { PaymentsPage } from './pages/influencers/PaymentsPage'
import { AgreementsPage } from './pages/influencers/AgreementsPage'
import { ReportsPage } from './pages/influencers/ReportsPage'
import { InfluencerPerformancePage } from './pages/influencers/InfluencerPerformancePage'
import { SimCardsPage } from './pages/SimCardsPage'
import { DocumentExpiryPage } from './pages/management/DocumentExpiryPage'
import { PaymentsPage as CompanyPaymentsPage } from './pages/management/PaymentsPage'
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
import { AIPlannerProvider } from './contexts/AIPlannerContext'
import { useEmployees } from './hooks/useEmployees'
import { useAttendanceManagedEmployees } from './hooks/useAttendanceManagedEmployees'
import { useAttendance, clearAllAttendanceStorage } from './hooks/useAttendance'
import { useWeeklyHolidayDay } from './hooks/useWeeklyHolidayDay'
import { employeesForAttendance } from './utils/employeeAttendance'
import './App.css'

const currentDate = new Date()

function AppContent() {
  const [month, setMonth] = useState(currentDate.getMonth())
  const [year, setYear] = useState(currentDate.getFullYear())
  const [weeklyHolidayDay, setWeeklyHolidayDay] = useWeeklyHolidayDay()
  const {
    employees,
    loading: employeesLoading,
    error: employeesError,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    resetToDefault,
  } = useEmployees()

  const {
    employees: managedEmployees,
    loading: managedEmployeesLoading,
  } = useAttendanceManagedEmployees()

  const attendanceScopeEmployees = useMemo(
    () => employeesForAttendance(managedEmployees),
    [managedEmployees]
  )

  const {
    attendance,
    sickLeaveDocuments,
    setAttendance,
    uploadSickLeaveDocument,
    removeSickLeaveDocument,
    loading: attendanceLoading,
    error: attendanceError,
  } = useAttendance(attendanceScopeEmployees, month, year)

  const handleResetDemoData = useCallback(() => {
    clearAllAttendanceStorage()
    resetToDefault()
    window.location.reload()
  }, [resetToDefault])

  const daysInMonth = useMemo(() => {
    const d = new Date(year, month + 1, 0)
    return d.getDate()
  }, [month, year])

  const yearOptions = useMemo(() => {
    const current = currentDate.getFullYear()
    return Array.from({ length: 5 }, (_, i) => current - 2 + i)
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AIPlannerProvider>
              <Layout />
            </AIPlannerProvider>
          </RequireAuth>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="account" element={<EmployeeAccountPage />} />
        <Route path="annual-leave" element={<AnnualLeavePage />} />
        <Route
          path="attendance"
          element={
            <PermissionGuard module="attendance" action="view">
              <AttendancePage
                month={month}
                year={year}
                setMonth={setMonth}
                setYear={setYear}
                employees={attendanceScopeEmployees}
                attendance={attendance}
                setAttendance={setAttendance}
                sickLeaveDocuments={sickLeaveDocuments}
                uploadSickLeaveDocument={uploadSickLeaveDocument}
                removeSickLeaveDocument={removeSickLeaveDocument}
                daysInMonth={daysInMonth}
                yearOptions={yearOptions}
                weeklyHolidayDay={weeklyHolidayDay}
                onWeeklyHolidayDayChange={setWeeklyHolidayDay}
                loading={attendanceLoading || managedEmployeesLoading}
                error={attendanceError}
              />
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
          path="management/payments"
          element={
            <PermissionGuard module="document_expiry" action="view">
              <CompanyPaymentsPage />
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
        <Route path="admin/item-report-groups" element={<ItemReportGroupsAdminPage />} />
        <Route
          path="admin/zoho/bulk-invoice"
          element={
            <PermissionGuard module="weekly_reports" action="view">
              <BulkZohoInvoicePage />
            </PermissionGuard>
          }
        />

        {/* AI Planner Module */}
        <Route path="projects" element={<ProjectsIndexPage />} />
        <Route path="projects/dashboard" element={<ProjectDashboardPage />} />
        <Route path="projects/today" element={<ProjectDetailPage />} />
        <Route path="projects/trash" element={<TrashPage />} />

        {/* Reports Module */}
        <Route path="reports">
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
              <PermissionGuard module="weekly_reports" action="view">
                <KsaVatReportPage />
              </PermissionGuard>
            }
          />
        </Route>

        {/* Influencers Module */}
        <Route path="influencers">
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
          <Route path="pipeline" element={
            <PermissionGuard module="influencers" action="view">
              <PipelinePage />
            </PermissionGuard>
          } />
          <Route path="schedule" element={
            <PermissionGuard module="influencers" action="view">
              <ShootSchedulePage />
            </PermissionGuard>
          } />
          <Route path="payments" element={
            <PermissionGuard module="influencers" action="payments">
              <PaymentsPage />
            </PermissionGuard>
          } />
          <Route path="agreements" element={
            <PermissionGuard module="influencers" action="agreements">
              <AgreementsPage />
            </PermissionGuard>
          } />
          <Route path="reports" element={
            <PermissionGuard module="influencers" action="view">
              <ReportsPage />
            </PermissionGuard>
          } />
          <Route path="performance" element={
            <PermissionGuard module="influencers" action="view">
              <InfluencerPerformancePage />
            </PermissionGuard>
          } />
          <Route path=":id" element={
            <PermissionGuard module="influencers" action="view">
              <InfluencerIdToEditRedirect />
            </PermissionGuard>
          } />
          <Route path=":id/edit" element={
            <PermissionGuard module="influencers" action="view">
              <AddInfluencerPage />
            </PermissionGuard>
          } />
        </Route>
      </Route>
    </Routes>
  )
}

function App() {
  const settings = useAppSettings()
  return (
    <AuthProvider>
      <SettingsContext.Provider value={settings}>
        <InfluencersProvider>
            <AppContent />
        </InfluencersProvider>
      </SettingsContext.Provider>
    </AuthProvider>
  )
}

export default App
