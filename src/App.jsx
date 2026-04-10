import { useState, useMemo, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsContext } from './contexts/SettingsContext'
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
import { WeeklyRosterPage } from './pages/WeeklyRosterPage'
import { RolesPermissionsPage } from './pages/RolesPermissionsPage'
import { useEmployees } from './hooks/useEmployees'
import { useAttendanceManagedEmployees } from './hooks/useAttendanceManagedEmployees'
import { useAttendance, clearAllAttendanceStorage } from './hooks/useAttendance'
import { useWeeklyHolidayDay } from './hooks/useWeeklyHolidayDay'
import { deriveEffectiveAttendance } from './utils/attendanceHelpers'
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

  // Employees for the full employees page (respects role/permissions of useEmployees)
  const attendanceEmployees = useMemo(
    () => employeesForAttendance(employees),
    [employees]
  )

  // Scoped employees for the attendance grid — backend enforces assignment-based filtering
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

  const effectiveAttendance = useMemo(
    () =>
      deriveEffectiveAttendance(
        attendance,
        attendanceScopeEmployees,
        year,
        month,
        daysInMonth,
        weeklyHolidayDay
      ),
    [attendance, attendanceScopeEmployees, year, month, daysInMonth, weeklyHolidayDay]
  )

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
          <Route
            index
            element={
              <HomeRoute
                month={month}
                year={year}
                setMonth={setMonth}
                setYear={setYear}
                employees={attendanceScopeEmployees}
                effectiveAttendance={effectiveAttendance}
                daysInMonth={daysInMonth}
                yearOptions={yearOptions}
                weeklyHolidayDay={weeklyHolidayDay}
                onWeeklyHolidayDayChange={setWeeklyHolidayDay}
                loading={employeesLoading || managedEmployeesLoading}
                error={employeesError}
              />
            }
          />
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
            path="employees/:id/profile"
            element={
              <PermissionGuard module="employees" action="view">
                <EmployeeProfileAdminPage />
              </PermissionGuard>
            }
          />
          <Route
            path="roster"
            element={
              <PermissionGuard module="roster" action="view">
                <WeeklyRosterPage />
              </PermissionGuard>
            }
          />
          <Route path="roles-permissions" element={<RolesPermissionsPage />} />
        </Route>
      </Routes>
  )
}

function App() {
  const settings = useAppSettings()
  return (
    <AuthProvider>
      <SettingsContext.Provider value={settings}>
        <AppContent />
      </SettingsContext.Provider>
    </AuthProvider>
  )
}

export default App
