import { describe, expect, it } from 'vitest'
import { parseFilenameSuggestions } from './filenameSuggest'

describe('parseFilenameSuggestions', () => {
  it('recognizes quality manual', () => {
    const s = parseFilenameSuggestions('LIF-QMS-M-01_Quality_Manual.pdf')
    expect(s.documentCode).toBe('LIF-QMS-M-01')
    expect(s.documentType).toBe('Quality Manual')
  })

  it('recognizes annexure codes', () => {
    const s = parseFilenameSuggestions('LIF-QMS-M-ANX-01C.pdf')
    expect(s.documentCode).toBe('LIF-QMS-M-ANX-01C')
    expect(s.documentType).toBe('Annexure')
  })

  it('recognizes procedures PR-01..13', () => {
    const s = parseFilenameSuggestions('LIF-QMS-PR-11_Warehouse.pdf')
    expect(s.documentCode).toBe('LIF-QMS-PR-11')
    expect(s.documentType).toBe('Procedure')
  })

  it('recognizes form codes', () => {
    const s = parseFilenameSuggestions('LIF-QMS-FO-05B_Corrective_Action.docx')
    expect(s.documentCode).toBe('LIF-QMS-FO-05B')
    expect(s.documentType).toBe('Form Template')
  })

  it('recognizes CA numbers', () => {
    const s = parseFilenameSuggestions('CA-95_Root_Cause.xlsx')
    expect(s.documentCode).toBe('CA-95')
    expect(s.documentType).toBe('Corrective Action')
  })

  it('recognizes MRM year references', () => {
    const s = parseFilenameSuggestions('MRM-02-2025_Minutes.pdf')
    expect(s.documentCode).toBe('MRM-02-2025')
    expect(s.auditYear).toBe('2025')
  })

  it('falls back to humanized title without inventing codes', () => {
    const s = parseFilenameSuggestions('random_scan_photo.png')
    expect(s.documentCode).toBeNull()
    expect(s.title.toLowerCase()).toContain('random')
  })
})
