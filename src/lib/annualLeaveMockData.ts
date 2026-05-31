/**
 * LOCAL DEV ONLY — mock annual leave *requests* for CEO view UI testing.
 * Each record is one annual leave request (not balance installments).
 * NOT production source of truth.
 */

import { alDaysBetween } from '../utils/annualLeaveUtils'

export const ANNUAL_LEAVE_STORAGE_KEY = 'employeeAnnualLeaveMockData'

export type AnnualLeaveMockRecord = {
  id: string
  employeeId: string
  employeeName: string
  department: string
  designation: string
  profileImage: string
  employeeJoiningDate: string
  upcomingLeaveStartDate: string
  upcomingLeaveEndDate: string
  alternateEmployeeId: string
  alternateEmployeeName: string
  alternateEmployeePhoto: string
  approvalStatus: 'Approved' | 'Pending' | 'Rejected'
  notes: string
}

/** One mock record = one annual leave request with alternate cover. */
export const annualLeaveMockData: AnnualLeaveMockRecord[] = [
  {
    id: 'leave-001',
    employeeId: 'emp-001',
    employeeName: 'Abdur Rahman',
    department: 'Web & App Dev',
    designation: 'Web & App Developer',
    profileImage: '',
    employeeJoiningDate: '2026-01-20',
    upcomingLeaveStartDate: '2026-08-12',
    upcomingLeaveEndDate: '2026-09-10',
    alternateEmployeeId: 'emp-005',
    alternateEmployeeName: 'Muhammad Afsal',
    alternateEmployeePhoto: '',
    approvalStatus: 'Pending',
    notes: 'Single annual leave block — alternate confirmed.',
  },
  {
    id: 'leave-002',
    employeeId: 'emp-002',
    employeeName: 'Ms. Margaret Sebastian',
    department: 'Operations',
    designation: 'Operations Executive',
    profileImage: '',
    employeeJoiningDate: '2025-05-23',
    upcomingLeaveStartDate: '2026-08-15',
    upcomingLeaveEndDate: '2026-09-15',
    alternateEmployeeId: 'emp-011',
    alternateEmployeeName: 'Muhammd Abdullah',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: '',
  },
  {
    id: 'leave-003',
    employeeId: 'emp-003',
    employeeName: 'Hamdan Ali',
    department: 'Warehouse',
    designation: 'Warehouse Coordinator',
    profileImage: '',
    employeeJoiningDate: '2024-06-01',
    upcomingLeaveStartDate: '2026-07-01',
    upcomingLeaveEndDate: '2026-07-05',
    alternateEmployeeId: 'emp-012',
    alternateEmployeeName: 'Mohammed Ajmal Sharaf',
    alternateEmployeePhoto: '',
    approvalStatus: 'Pending',
    notes: 'Pending CEO review.',
  },
  {
    id: 'leave-004',
    employeeId: 'emp-004',
    employeeName: 'Abobecker Siddique',
    department: 'Accounting & Finance',
    designation: 'Accountant',
    profileImage: '',
    employeeJoiningDate: '2025-09-16',
    upcomingLeaveStartDate: '2026-08-31',
    upcomingLeaveEndDate: '2026-10-01',
    alternateEmployeeId: 'emp-011',
    alternateEmployeeName: 'Muhammd Abdullah',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: '',
  },
  {
    id: 'leave-005',
    employeeId: 'emp-005',
    employeeName: 'Muhammad Afsal',
    department: 'Web & App Dev',
    designation: 'Web Developer',
    profileImage: '',
    employeeJoiningDate: '2025-11-20',
    upcomingLeaveStartDate: '2026-09-14',
    upcomingLeaveEndDate: '2026-10-14',
    alternateEmployeeId: 'emp-001',
    alternateEmployeeName: 'Abdur Rahman',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: '',
  },
  {
    id: 'leave-006',
    employeeId: 'emp-006',
    employeeName: 'Ali Shan Nizami',
    department: 'Warehouse',
    designation: 'Warehouse Associate',
    profileImage: '',
    employeeJoiningDate: '',
    upcomingLeaveStartDate: '2026-09-15',
    upcomingLeaveEndDate: '2026-11-15',
    alternateEmployeeId: 'emp-013',
    alternateEmployeeName: 'Ajmal Nazim Nizami',
    alternateEmployeePhoto: '',
    approvalStatus: 'Pending',
    notes: '',
  },
  {
    id: 'leave-007',
    employeeId: 'emp-007',
    employeeName: 'Faizan',
    department: 'Content Creation',
    designation: 'Content Creator',
    profileImage: '',
    employeeJoiningDate: '2025-03-10',
    upcomingLeaveStartDate: '2026-10-01',
    upcomingLeaveEndDate: '2026-10-30',
    alternateEmployeeId: 'emp-008',
    alternateEmployeeName: 'Suffian',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: '',
  },
  {
    id: 'leave-008',
    employeeId: 'emp-008',
    employeeName: 'Suffian',
    department: 'Content Creation',
    designation: 'Content Specialist',
    profileImage: '',
    employeeJoiningDate: '2024-11-05',
    upcomingLeaveStartDate: '2026-11-01',
    upcomingLeaveEndDate: '2026-11-30',
    alternateEmployeeId: 'emp-007',
    alternateEmployeeName: 'Faizan',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: '',
  },
  {
    id: 'leave-009',
    employeeId: 'emp-009',
    employeeName: 'Ms. Wafa',
    department: 'Social Media',
    designation: 'Social Media Manager',
    profileImage: '',
    employeeJoiningDate: '2025-07-14',
    upcomingLeaveStartDate: '2026-06-12',
    upcomingLeaveEndDate: '2026-06-18',
    alternateEmployeeId: 'emp-014',
    alternateEmployeeName: 'Huda',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: '',
  },
  {
    id: 'leave-010',
    employeeId: 'emp-010',
    employeeName: 'Abdullah Abbas',
    department: 'Ecommerce',
    designation: 'Ecommerce Executive',
    profileImage: '',
    employeeJoiningDate: '2025-02-01',
    upcomingLeaveStartDate: '2026-05-20',
    upcomingLeaveEndDate: '2026-06-08',
    alternateEmployeeId: 'emp-015',
    alternateEmployeeName: 'Omar Hassan',
    alternateEmployeePhoto: '',
    approvalStatus: 'Approved',
    notes: 'Currently on leave.',
  },
]

function isDevEnvironment(): boolean {
  try {
    return Boolean(import.meta.env.DEV)
  } catch {
    return false
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  } catch {
    return false
  }
}

function isValidMockRecord(value: unknown): value is AnnualLeaveMockRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<AnnualLeaveMockRecord>
  return (
    typeof row.id === 'string' &&
    typeof row.employeeId === 'string' &&
    typeof row.employeeName === 'string' &&
    typeof row.upcomingLeaveStartDate === 'string' &&
    typeof row.upcomingLeaveEndDate === 'string' &&
    row.upcomingLeaveStartDate.length > 0 &&
    row.upcomingLeaveEndDate.length > 0
  )
}

/** Maps one mock leave request → CEO view API row shape (dev fallback only). */
export function mapMockRecordToCeoRow(mock: AnnualLeaveMockRecord) {
  const fromDate = mock.upcomingLeaveStartDate
  const toDate = mock.upcomingLeaveEndDate
  const leaveDays = alDaysBetween(fromDate, toDate)
  const today = new Date().toISOString().slice(0, 10)
  const onLeave = fromDate <= today && toDate >= today && mock.approvalStatus === 'Approved'

  let status = mock.approvalStatus === 'Pending' ? 'Pending' : 'Approved'
  let effectiveStatus = onLeave ? 'Ongoing' : status === 'Pending' ? 'Pending' : 'Approved'
  if (mock.approvalStatus === 'Rejected') {
    status = 'Rejected'
    effectiveStatus = 'Rejected'
  }

  return {
    id: mock.id,
    employee_id: mock.employeeId,
    full_name: mock.employeeName,
    department: mock.department,
    designation: mock.designation,
    photo_url: mock.profileImage || null,
    from_date: fromDate,
    to_date: toDate,
    status,
    effective_status: effectiveStatus,
    leave_days: leaveDays,
    employee_joining_date: mock.employeeJoiningDate || null,
    alternate_employee_id: mock.alternateEmployeeId || null,
    alternate_employee_full_name: mock.alternateEmployeeName || null,
    alternate_employee_photo_url: mock.alternateEmployeePhoto || null,
    _devMockNotes: mock.notes || null,
    _devMockSource: true as const,
  }
}

export function seedAnnualLeaveMockDataIfEmpty(): void {
  if (!isDevEnvironment() || !hasLocalStorage()) return
  try {
    if (window.localStorage.getItem(ANNUAL_LEAVE_STORAGE_KEY) != null) return
    saveAnnualLeaveDataToLocalStorage(annualLeaveMockData)
  } catch {
    /* ignore */
  }
}

export function getAnnualLeaveDataFromLocalStorage(): AnnualLeaveMockRecord[] {
  if (!isDevEnvironment() || !hasLocalStorage()) return []
  try {
    const raw = window.localStorage.getItem(ANNUAL_LEAVE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidMockRecord)
  } catch {
    return []
  }
}

export function saveAnnualLeaveDataToLocalStorage(data: AnnualLeaveMockRecord[]): void {
  if (!isDevEnvironment() || !hasLocalStorage()) return
  try {
    window.localStorage.setItem(ANNUAL_LEAVE_STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export function clearAnnualLeaveMockData(): void {
  if (!hasLocalStorage()) return
  try {
    window.localStorage.removeItem(ANNUAL_LEAVE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function getCeoRowsFromMockStorage(): ReturnType<typeof mapMockRecordToCeoRow>[] {
  return getAnnualLeaveDataFromLocalStorage().map(mapMockRecordToCeoRow)
}
