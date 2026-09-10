import { describe, expect, it } from 'vitest'
import { hasPermission, hasAnyModulePermission, isAuditorUser } from '../../contexts/AuthContext'
import { parseFilenameSuggestions } from './utils/filenameSuggest'

describe('ISO & QMS nav permissions', () => {
  it('identifies auditor users', () => {
    expect(isAuditorUser({ role: 'auditor' })).toBe(true)
    expect(isAuditorUser({ role: 'employee' })).toBe(false)
  })

  it('gives auditors iso_qms view only (no warehouse-style bypass)', () => {
    const auditor = { role: 'auditor', permissions: {} }
    expect(hasPermission(auditor, 'iso_qms', 'view')).toBe(true)
    expect(hasPermission(auditor, 'iso_qms', 'edit')).toBe(false)
    expect(hasPermission(auditor, 'iso_qms', 'approve')).toBe(false)
    expect(hasPermission(auditor, 'attendance', 'view')).toBe(false)
    expect(hasPermission(auditor, 'employees', 'view')).toBe(false)
    expect(hasAnyModulePermission(auditor, 'iso_qms')).toBe(true)
    expect(hasAnyModulePermission(auditor, 'attendance')).toBe(false)
  })

  it('allows manage_audits when explicitly granted to auditor', () => {
    const auditor = { role: 'auditor', permissions: { iso_qms: { manage_audits: true } } }
    expect(hasPermission(auditor, 'iso_qms', 'manage_audits')).toBe(true)
    expect(hasPermission(auditor, 'iso_qms', 'edit')).toBe(false)
  })

  it('implies iso_qms view from write permissions for employees', () => {
    const user = { role: 'employee', permissions: { iso_qms: { approve: true } } }
    expect(hasPermission(user, 'iso_qms', 'view')).toBe(true)
    expect(hasPermission(user, 'iso_qms', 'approve')).toBe(true)
  })
})

describe('ISO filename suggestions smoke', () => {
  it('suggests procedure codes used in sidebar document upload flow', () => {
    expect(parseFilenameSuggestions('LIF-QMS-PR-03.pdf').documentCode).toBe('LIF-QMS-PR-03')
  })
})
