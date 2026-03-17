import { useState, useMemo, useCallback } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsContext } from './contexts/SettingsContext'
import { useAppSettings } from './hooks/useAppSettings'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { AttendancePage } from './pages/AttendancePage'
import { EmployeesPage } from './pages/EmployeesPage'
import { SettingsPage } from './pages/SettingsPage'
import { useEmployees } from './hooks/useEmployees'
import { useAttendance, clearAllAttendanceStorage } from './hooks/useAttendance'
import { useWeeklyHolidayDay } from './hooks/useWeeklyHolidayDay'
import { deriveEffectiveAttendance } from './utils/attendanceHelpers'
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
  const { attendance, setAttendance, loading: attendanceLoading, error: attendanceError } = useAttendance(
    employees,
    month,
    year
  )

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
        employees,
        year,
        month,
        daysInMonth,
        weeklyHolidayDay
      ),
    [attendance, employees, year, month, daysInMonth, weeklyHolidayDay]
  )

  const yearOptions = useMemo(() => {
    const current = currentDate.getFullYear()
    return Array.from({ length: 5 }, (_, i) => current - 2 + i)
  }, [])

  return (
    <BrowserRouter>
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
              <DashboardPage
                month={month}
                year={year}
                setMonth={setMonth}
                setYear={setYear}
                employees={employees}
                effectiveAttendance={effectiveAttendance}
                daysInMonth={daysInMonth}
                yearOptions={yearOptions}
                weeklyHolidayDay={weeklyHolidayDay}
                onWeeklyHolidayDayChange={setWeeklyHolidayDay}
                loading={employeesLoading}
                error={employeesError}
              />
            }
          />
          <Route
            path="attendance"
            element={
              <AttendancePage
                month={month}
                year={year}
                setMonth={setMonth}
                setYear={setYear}
                employees={employees}
                attendance={attendance}
                setAttendance={setAttendance}
                daysInMonth={daysInMonth}
                yearOptions={yearOptions}
                weeklyHolidayDay={weeklyHolidayDay}
                onWeeklyHolidayDayChange={setWeeklyHolidayDay}
                loading={attendanceLoading}
                error={attendanceError}
              />
            }
          />
          <Route
            path="employees"
            element={
              <EmployeesPage
                employees={employees}
                onAdd={addEmployee}
                onEdit={updateEmployee}
                onDelete={deleteEmployee}
                loading={employeesLoading}
                error={employeesError}
              />
            }
          />
          <Route
            path="settings"
            element={<SettingsPage onResetDemoData={handleResetDemoData} />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
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
