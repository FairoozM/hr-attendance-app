import type { FilenameSuggestion } from '../types'

const EXT_RE = /\.[a-z0-9]+$/i

function stripExtension(filename: string): string {
  return String(filename || '').replace(EXT_RE, '').trim()
}

function humanize(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)([a-z])/g, (_, space, ch) => `${space}${ch.toUpperCase()}`)
}

/** End of a document-code token (underscore, dash separator to words, end, or extension remnant). */
const CODE_END = '(?=$|[^A-Z0-9])'

/**
 * Mirror of backend filename suggestion rules for client-side bulk metadata.
 * Suggestions only — user must confirm before submit.
 */
export function parseFilenameSuggestions(filename: string): FilenameSuggestion {
  const base = stripExtension(filename)
  const upper = base.toUpperCase()
  const empty: FilenameSuggestion = {
    title: humanize(base) || 'Untitled document',
    documentCode: null,
    documentType: null,
    categoryHint: null,
    revision: null,
    auditYear: null,
  }

  if (!base) return empty

  // LIF-QMS-M-ANX-01A .. 01E
  {
    const m = upper.match(new RegExp(`\\bLIF-QMS-M-ANX-0?1([A-E])${CODE_END}`))
    if (m) {
      return {
        title: `Quality Manual Annexure 01${m[1]}`,
        documentCode: `LIF-QMS-M-ANX-01${m[1]}`,
        documentType: 'Annexure',
        categoryHint: 'Quality Manual',
        revision: null,
        auditYear: null,
      }
    }
  }

  // LIF-QMS-M-01
  {
    const m = upper.match(new RegExp(`\\bLIF-QMS-M-0?1${CODE_END}`))
    if (m && !upper.includes('ANX')) {
      return {
        title: 'Quality Manual',
        documentCode: 'LIF-QMS-M-01',
        documentType: 'Quality Manual',
        categoryHint: 'Quality Manual',
        revision: null,
        auditYear: null,
      }
    }
  }

  // LIF-QMS-PR-01 .. PR-13
  {
    const m = upper.match(new RegExp(`\\bLIF-QMS-PR-(\\d{1,2})${CODE_END}`))
    if (m) {
      const n = Number(m[1])
      if (n >= 1 && n <= 13) {
        const code = `LIF-QMS-PR-${String(n).padStart(2, '0')}`
        return {
          title: `Procedure ${code}`,
          documentCode: code,
          documentType: 'Procedure',
          categoryHint: 'Procedures',
          revision: null,
          auditYear: null,
        }
      }
    }
  }

  // LIF-QMS-FO-* (forms / records)
  {
    const m = upper.match(new RegExp(`\\bLIF-QMS-FO-([0-9]{1,2}[A-Z]?)${CODE_END}`))
    if (m) {
      const code = `LIF-QMS-FO-${m[1]}`
      return {
        title: `Form ${code}`,
        documentCode: code,
        documentType: 'Form Template',
        categoryHint: 'Forms & Records',
        revision: null,
        auditYear: null,
      }
    }
  }

  // CA-89 .. CA-103 (and similar CA-nn)
  {
    const m = upper.match(new RegExp(`\\bCA-(\\d{2,3})${CODE_END}`))
    if (m) {
      return {
        title: `Corrective Action CA-${m[1]}`,
        documentCode: `CA-${m[1]}`,
        documentType: 'Corrective Action',
        categoryHint: 'Corrective Actions',
        revision: null,
        auditYear: null,
      }
    }
  }

  // MRM references e.g. MRM-02-2024
  {
    const m = upper.match(new RegExp(`\\bMRM[-_]?(\\d{2})-(\\d{4})${CODE_END}`))
    if (m) {
      const year = m[2]
      return {
        title: `Management Review ${m[1]}-${year}`,
        documentCode: `MRM-${m[1]}-${year}`,
        documentType: 'Management Review Record',
        categoryHint: 'Management Review',
        revision: null,
        auditYear: year,
      }
    }
  }

  // Audit schedules e.g. AUDIT-01-2024
  {
    const m = upper.match(new RegExp(`\\bAUDIT[-_]?(\\d{2})-(\\d{4})${CODE_END}`))
    if (m) {
      const year = m[2]
      return {
        title: `Audit Schedule ${m[1]}-${year}`,
        documentCode: `AUDIT-${m[1]}-${year}`,
        documentType: 'Audit Record',
        categoryHint: 'Internal Audit',
        revision: null,
        auditYear: year,
      }
    }
  }

  // Generic LIF-QMS-* code capture
  {
    const m = upper.match(new RegExp(`\\b(LIF-QMS-[A-Z0-9]+(?:-[A-Z0-9]+)*)${CODE_END}`))
    if (m) {
      return {
        ...empty,
        documentCode: m[1],
        title: humanize(base.replace(new RegExp(m[1], 'i'), '').trim()) || m[1],
      }
    }
  }

  // Revision hint Rev / R / Issue
  {
    const rev = upper.match(/\b(?:REV(?:ISION)?|R)[.\s_-]?([A-Z0-9]+)\b/)
    if (rev) empty.revision = rev[1]
  }

  return empty
}
