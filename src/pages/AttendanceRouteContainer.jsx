import { useMemo } from 'react'
import { useUrlIntParamState } from '../hooks/useUrlSearchParamState'
import { useAttendanceManagedEmployees } from '../hooks/useAttendanceManagedEmployees'
import { useAttendance } from '../hooks/useAttendance'
import { useWeeklyHolidayDay } from '../hooks/useWeeklyHolidayDay'
import { employeesForAttendance } from '../utils/employeeAttendance'
import { AttendancePage } from './AttendancePage'

const currentDate = new Date()

/** Attendance route: month/year synced to URL so refresh keeps the selected period. */
export function AttendanceRouteContainer() {
  const [month, setMonth] = useUrlIntParamState('month', {
    defaultValue: currentDate.getMonth(),
    min: 0,
    max: 11,
  })
  const [year, setYear] = useUrlIntParamState('year', {
    defaultValue: currentDate.getFullYear(),
    min: 2000,
    max: 2100,
  })
  const [weeklyHolidayDay, setWeeklyHolidayDay] = useWeeklyHolidayDay()

  const { employees: managedEmployees, loading: managedEmployeesLoading } =
    useAttendanceManagedEmployees()

  const attendanceScopeEmployees = useMemo(
    () => employeesForAttendance(managedEmployees),
    [managedEmployees],
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

  const daysInMonth = useMemo(() => {
    const d = new Date(year, month + 1, 0)
    return d.getDate()
  }, [month, year])

  const yearOptions = useMemo(() => {
    const current = currentDate.getFullYear()
    return Array.from({ length: 5 }, (_, i) => current - 2 + i)
  }, [])

  return (
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
  )
}
