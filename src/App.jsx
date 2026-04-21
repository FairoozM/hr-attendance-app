import { useState, useMemo, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
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
import { InfluencerListPage } from './pages/influencers/InfluencerListPage'
import { AddInfluencerPage } from './pages/influencers/AddInfluencerPage'
import { PipelinePage } from './pages/influencers/PipelinePage'
import { InfluencerProfilePage } from './pages/influencers/InfluencerProfilePage'
import { ShootSchedulePage } from './pages/influencers/ShootSchedulePage'
import { PaymentsPage } from './pages/influencers/PaymentsPage'
import { AgreementsPage } from './pages/influencers/AgreementsPage'
import { ReportsPage } from './pages/influencers/ReportsPage'
import { SimCardsPage } from './pages/SimCardsPage'
import { DocumentExpiryPage } from './pages/management/DocumentExpiryPage'
import { WeeklyAdsReportPage } from './pages/reports/WeeklyAdsReportPage'
import ProjectsIndexPage from './pages/projects/ProjectsIndexPage'
import ProjectDetailPage from './pages/projects/ProjectDetailPage'
import ProjectDashboardPage from './pages/projects/ProjectDashboardPage'
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
            <Layout />
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
          path="employees/:id/profile"
          element={
            <PermissionGuard module="employees" action="view">
              <EmployeeProfileAdminPage />
            </PermissionGuard>
          }
        />
        <Route path="roles-permissions" element={<RolesPermissionsPage />} />

        {/* AI Planner Module */}
        <Route path="projects" element={<AIPlannerProvider><ProjectsIndexPage /></AIPlannerProvider>} />
        <Route path="projects/dashboard" element={<AIPlannerProvider><ProjectDashboardPage /></AIPlannerProvider>} />
        <Route path="projects/today" element={<AIPlannerProvider><ProjectDetailPage /></AIPlannerProvider>} />

        {/* Reports Module */}
        <Route path="reports">
          <Route path="weekly-report">
            <Route
              path="weekly-ads"
              element={
                <PermissionGuard module="weekly_reports" action="view">
                  <WeeklyAdsReportPage />
                </PermissionGuard>
              }
            />
          </Route>
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
          <Route path=":id" element={
            <PermissionGuard module="influencers" action="view">
              <InfluencerProfilePage />
            </PermissionGuard>
          } />
          <Route path=":id/edit" element={
            <PermissionGuard module="influencers" action="manage">
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
