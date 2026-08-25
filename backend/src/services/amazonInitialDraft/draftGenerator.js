'use strict'

/**
 * Orchestration and cell-write policy for the Amazon UAE Initial Draft Generator.
 *
 * The whole pipeline is a pure function of the uploaded bytes plus the catalog rows it
 * resolves, so preview, draft and report all run it and always agree. Nothing is
 * persisted and the uploaded buffer is never mutated: the draft is a new buffer built
 * by patching a copy of the original package.
 */

const opc = require('./opcPackage')
const { openTemplateWorkbook } = require('./amazonTemplateWorkbook')
const { LIST_KEYS, MAPPED_KEYS, REPORT_ONLY_NOTES, neverWriteReason, resolveFieldsForItem } = require('./fieldMapping')
const { applyCellWrites } = require('./worksheetXml')
const { cleanText } = require('./specParsers')
const {
  assessCellApplicability,
  parseConditionalFormatting,
  parseDefinedNames,
  parseSheetProtection,
  parseStyles,
} = require('./cellApplicability')
const { buildValidationContext, pickAcceptedOption, resolveValidationOptions } = require('./validationOptions')

const DRAFT_NOTICE = 'Initial Draft — requires content enhancement and final Amazon validation before upload.'

/**
 * Whether an existing cell already says the same thing. Whitespace and letter case are
 * normalised, and numerals are compared numerically so `16.60` matches `16.6`. A cell
 * that already agrees is left exactly as it is rather than rewritten.
 */
function isSameValue(existing, incoming) {
  const left = cleanText(existing)
  const right = cleanText(incoming)
  if (!left && !right) return true

  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (left !== '' && right !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber === rightNumber
  }

  return left.toLowerCase() === right.toLowerCase()
}

/**
 * A unit cell only means something next to its own number. When the workbook already
 * holds a conflicting number that must be preserved, writing our unit beside it would
 * silently relabel the user's figure, so the unit is left blank and reported instead.
 */
const PAIRED_VALUE_KEY = new Map([
  ['capacity.unit', 'capacity.value'],
  ['item_package_weight.unit', 'item_package_weight.value'],
  ['item_package_dimensions.length.unit', 'item_package_dimensions.length.value'],
  ['item_package_dimensions.width.unit', 'item_package_dimensions.width.value'],
  ['item_package_dimensions.height.unit', 'item_package_dimensions.height.value'],
])

/**
 * Groups the workbook's columns by normalised key so multi-slot attributes can be
 * recognised. Only the first slot of an attribute is filled, except for the numbered
 * runs in `LIST_KEYS` such as `bullet_point`, where each slot takes the next list entry.
 */
function groupColumnsByKey(columns) {
  const grouped = new Map()
  for (const column of columns) {
    if (!grouped.has(column.normalizedKey)) grouped.set(column.normalizedKey, [])
    grouped.get(column.normalizedKey).push(column)
  }
  for (const slots of grouped.values()) slots.sort((a, b) => a.column - b.column)
  return grouped
}

function classifyColumns(workbook) {
  const writable = []
  const neverWrite = []

  for (const column of workbook.columns) {
    if (column.column === workbook.skuColumn) {
      neverWrite.push({ ...column, reason: 'seller-sku-column' })
      continue
    }
    const reason = neverWriteReason(column.technicalHeader)
    if (reason) {
      neverWrite.push({ ...column, reason })
      continue
    }
    writable.push(column)
  }

  return { writable, neverWrite }
}

/**
 * Runs the pipeline.
 *
 * @param {object} options
 * @param {Buffer} options.buffer the uploaded workbook, treated as read-only
 * @param {string} [options.filename]
 * @param {(skus: string[]) => Promise<Map<string, object>>} options.resolveCatalog
 */
async function runInitialDraftPipeline({ buffer, filename = 'template.xlsm', resolveCatalog }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error('Upload an Amazon template workbook.')
    error.code = 'FILE_REQUIRED'
    throw error
  }

  const workbook = openTemplateWorkbook(buffer)
  const { writable, neverWrite } = classifyColumns(workbook)
  const columnsByKey = groupColumnsByKey(writable)

  const stylesEntry = opc.findEntry(workbook.package, 'xl/styles.xml')
  const styles = parseStyles(stylesEntry ? opc.readEntryContent(stylesEntry).toString('utf8') : '')
  const sheetProtection = parseSheetProtection(workbook.sheetXml)
  const conditionalFormatting = parseConditionalFormatting(workbook.sheetXml)
  const workbookXmlEntry = opc.findEntry(workbook.package, 'xl/workbook.xml')
  const namedFormulas = parseDefinedNames(
    workbookXmlEntry ? opc.readEntryContent(workbookXmlEntry).toString('utf8') : ''
  )
  const validationContext = buildValidationContext(workbook)

  // Every distinct SKU in the sheet, resolved in a single round trip.
  const skusInOrder = []
  const skuRowCount = new Map()
  for (const row of workbook.dataRows) {
    if (!row.sku) continue
    const count = skuRowCount.get(row.sku) || 0
    skuRowCount.set(row.sku, count + 1)
    if (count === 0) skusInOrder.push(row.sku)
  }

  const catalog = skusInOrder.length ? await resolveCatalog(skusInOrder) : new Map()

  const writes = []
  const rows = []
  const populated = []
  const conflicts = []
  const preservedIdentical = []
  const missingValues = []
  const notApplicable = []
  const surplusListValues = []

  for (const row of workbook.dataRows) {
    if (!row.sku) {
      // An empty template row. Not a failure and not reported as an unmatched SKU.
      const hasAnyValue = [...row.cells.values()].some((cell) => cleanText(cell.value) !== '')
      if (hasAnyValue) {
        rows.push({ rowNumber: row.rowNumber, sku: '', status: 'skipped-no-sku', counts: emptyCounts() })
      }
      continue
    }

    const resolution = catalog.get(row.sku) || { status: 'unmatched', reason: 'not-in-catalog', candidates: [] }
    const duplicateOfSku = (skuRowCount.get(row.sku) || 0) > 1

    const rowRecord = {
      rowNumber: row.rowNumber,
      sku: row.sku,
      status: resolution.status,
      reason: resolution.reason || null,
      matchKind: resolution.matchKind || null,
      duplicateSkuInUpload: duplicateOfSku,
      productName: resolution.item ? cleanText(resolution.item.productName) : null,
      matchSource: resolution.item ? resolution.item.matchSource : null,
      // The catalog's own spelling, so a case-only match shows what it resolved to.
      catalogItemCode: resolution.item ? cleanText(resolution.item.itemCode) : null,
      candidates: resolution.candidates || [],
      counts: emptyCounts(),
    }

    if (resolution.status !== 'matched' || !resolution.item) {
      rows.push(rowRecord)
      continue
    }

    const fieldValues = resolveFieldsForItem(resolution.item)

    const cellValueAt = (columnIndex) => {
      const cell = row.cells.get(columnIndex)
      return cell ? String(cell.value || '').trim() : ''
    }

    // Decide every cell first, so paired value/unit cells can be reconciled before
    // anything is written.
    const decisions = []
    const decide = (normalizedKey, target, resolvedField) => {
      const existingCell = row.cells.get(target.column)
      const existingValue = existingCell ? cleanText(existingCell.value) : ''

      const applicability = assessCellApplicability({
        styles,
        sheetProtection,
        conditionalFormatting,
        namedFormulas,
        column: target,
        rowNumber: row.rowNumber,
        existingCell,
        cellValueAt,
      })

      if (!applicability.applicable) {
        decisions.push({
          normalizedKey,
          target,
          existingValue,
          resolvedField: {
            ok: false,
            reason: 'not-applicable',
            detail: applicability.reason,
          },
          outcome: 'not-applicable',
        })
        return
      }

      let field = resolvedField
      if (field.ok && Array.isArray(field.preferredLabels) && field.preferredLabels.length) {
        const validation = resolveValidationOptions(validationContext, target, row)
        if (!validation.options) {
          const notApplicableReason =
            validation.reason === 'validation-options-unresolved' ||
            validation.reason === 'product-type-required-for-validation'
          decisions.push({
            normalizedKey,
            target,
            existingValue,
            resolvedField: {
              ok: false,
              reason: notApplicableReason ? 'not-applicable' : validation.reason || 'validation-options-unresolved',
              detail: validation.reason || validation.source,
            },
            outcome: notApplicableReason ? 'not-applicable' : 'missing',
          })
          return
        }
        const accepted = pickAcceptedOption(validation.options, field.preferredLabels)
        if (!accepted) {
          decisions.push({
            normalizedKey,
            target,
            existingValue,
            resolvedField: {
              ok: false,
              reason: 'accepted-option-not-in-workbook',
              detail: field.preferredLabels.join(' | '),
            },
            outcome: 'missing',
          })
          return
        }
        field = { ...field, value: accepted }
      } else if (field.ok) {
        // Catalog-derived values: when the cell has a list validation, confirm the
        // proposed string is one of the accepted options before writing it.
        const validation = resolveValidationOptions(validationContext, target, row)
        if (validation.reason !== 'no-list-validation') {
          if (!validation.options) {
            decisions.push({
              normalizedKey,
              target,
              existingValue,
              resolvedField: {
                ok: false,
                reason: validation.reason || 'validation-options-unresolved',
                detail: validation.source,
              },
              outcome: 'missing',
            })
            return
          }
          const accepted = pickAcceptedOption(validation.options, [String(field.value)])
          if (!accepted) {
            decisions.push({
              normalizedKey,
              target,
              existingValue,
              resolvedField: {
                ok: false,
                reason: 'value-not-in-workbook-validation',
                detail: String(field.value),
              },
              outcome: 'missing',
            })
            return
          }
          field = { ...field, value: accepted }
        }
      }

      let outcome
      if (!field.ok) outcome = 'missing'
      else if (existingCell && existingCell.hasFormula) outcome = 'formula'
      else if (existingValue === '') outcome = 'populate'
      else if (isSameValue(existingValue, field.value)) outcome = 'identical'
      else outcome = 'conflict'

      decisions.push({ normalizedKey, target, existingValue, resolvedField: field, outcome })
    }

    for (const [normalizedKey, slots] of columnsByKey) {
      const resolvedField = fieldValues.get(normalizedKey)
      if (!resolvedField) continue // header present but not part of the approved mapping

      if (!LIST_KEYS.has(normalizedKey)) {
        decide(normalizedKey, slots[0], resolvedField)
        continue
      }

      // A numbered run of columns: entry n goes in column n, in the website's order.
      const values = resolvedField.ok ? resolvedField.values : []
      slots.forEach((target, index) => {
        const entry = values[index]
        decide(
          normalizedKey,
          target,
          entry === undefined
            ? { ok: false, reason: resolvedField.ok ? 'fewer-values-than-columns' : resolvedField.reason }
            : { ok: true, value: entry, source: resolvedField.source, slot: index + 1 }
        )
      })

      // Anything the workbook has no column for is surfaced rather than dropped silently.
      for (let index = slots.length; index < values.length; index += 1) {
        surplusListValues.push({
          rowNumber: row.rowNumber,
          sku: row.sku,
          field: `${slots[0].displayLabel} #${index + 1}`,
          value: String(values[index]),
          note: `The workbook has ${slots.length} ${slots[0].displayLabel} columns, so entry ${index + 1} was not written.`,
        })
      }
    }

    const outcomeByKey = new Map(decisions.map((decision) => [decision.normalizedKey, decision.outcome]))
    for (const decision of decisions) {
      const pairedValueKey = PAIRED_VALUE_KEY.get(decision.normalizedKey)
      if (!pairedValueKey || decision.outcome !== 'populate') continue
      if (outcomeByKey.get(pairedValueKey) === 'conflict') {
        decision.outcome = 'missing'
        decision.resolvedField = {
          ok: false,
          reason: 'paired-value-kept-from-workbook',
          detail: String(decision.resolvedField.value),
        }
      }
    }

    for (const { target, existingValue, resolvedField, outcome } of decisions) {
      const record = {
        rowNumber: row.rowNumber,
        sku: row.sku,
        column: target.letters,
        technicalHeader: target.technicalHeader,
        displayLabel: target.displayLabel,
        group: target.groupLabel,
      }

      if (outcome === 'not-applicable') {
        notApplicable.push({
          ...record,
          reason: resolvedField.detail || resolvedField.reason || 'not-applicable',
          existingValue,
        })
        rowRecord.counts.notApplicable += 1
      } else if (outcome === 'missing') {
        missingValues.push({ ...record, reason: resolvedField.reason, rawValue: resolvedField.detail })
        rowRecord.counts.missing += 1
      } else if (outcome === 'formula') {
        preservedIdentical.push({ ...record, existingValue, reason: 'formula-cell-preserved' })
        rowRecord.counts.preserved += 1
      } else if (outcome === 'populate') {
        writes.push({
          row: row.rowNumber,
          column: target.column,
          value: String(resolvedField.value),
          numeric: Boolean(resolvedField.numeric) && Number.isFinite(Number(resolvedField.value)),
        })
        populated.push({
          ...record,
          value: String(resolvedField.value),
          source: resolvedField.source,
          isConstant: Boolean(resolvedField.constant),
        })
        rowRecord.counts.populated += 1
      } else if (outcome === 'identical') {
        preservedIdentical.push({ ...record, existingValue, reason: 'already-identical' })
        rowRecord.counts.preserved += 1
      } else {
        conflicts.push({
          ...record,
          existingValue,
          databaseValue: String(resolvedField.value),
          source: resolvedField.source,
        })
        rowRecord.counts.conflicts += 1
      }
    }

    rows.push(rowRecord)
  }

  // Columns the workbook declares that this feature has no mapping for, plus the second
  // and later slots of attributes that span several columns.
  const describeColumn = (column, note) => ({
    column: column.letters,
    technicalHeader: column.technicalHeader,
    displayLabel: column.displayLabel,
    group: column.groupLabel,
    note: note || REPORT_ONLY_NOTES.get(column.normalizedKey) || null,
  })

  const ignoredColumns = []
  const additionalSlotColumns = []
  for (const [normalizedKey, slots] of columnsByKey) {
    if (!MAPPED_KEYS.has(normalizedKey)) {
      for (const column of slots) ignoredColumns.push(describeColumn(column))
      continue
    }
    // Every slot of a numbered run is filled, so none of them is left untouched.
    if (LIST_KEYS.has(normalizedKey)) continue
    for (const column of slots.slice(1)) {
      additionalSlotColumns.push(describeColumn(column, 'Additional slot of the same attribute; only the first slot is filled.'))
    }
  }

  const draftBuffer = buildDraftBuffer(workbook, writes)

  const summary = {
    fileName: filename,
    sheetName: workbook.sheet.name,
    headerRow: workbook.headerRow,
    firstDataRow: workbook.firstDataRow,
    firstDataRowBasis: workbook.firstDataRowBasis,
    skuColumn: workbook.skuColumnLetters,
    templateColumns: workbook.columns.length,
    dataRowsInSheet: workbook.dataRows.length,
    rowsWithSku: rows.filter((row) => row.sku).length,
    matched: rows.filter((row) => row.status === 'matched').length,
    matchedIgnoringCase: rows.filter((row) => row.matchKind === 'case-insensitive').length,
    unmatched: rows.filter((row) => row.status === 'unmatched').length,
    ambiguous: rows.filter((row) => row.status === 'ambiguous').length,
    duplicateSkuRows: rows.filter((row) => row.duplicateSkuInUpload).length,
    populatedCells: populated.length,
    preservedCells: preservedIdentical.length,
    conflictCells: conflicts.length,
    missingCells: missingValues.length,
    notApplicableCells: notApplicable.length,
    surplusListValueCount: surplusListValues.length,
    ignoredColumnCount: ignoredColumns.length,
    additionalSlotColumnCount: additionalSlotColumns.length,
    neverWriteColumnCount: neverWrite.length,
    notice: DRAFT_NOTICE,
  }

  return {
    notice: DRAFT_NOTICE,
    summary,
    rows,
    populated,
    conflicts,
    preservedIdentical,
    missingValues,
    notApplicable,
    surplusListValues,
    ignoredColumns,
    additionalSlotColumns,
    neverWriteColumns: neverWrite.map((column) => ({
      column: column.letters,
      technicalHeader: column.technicalHeader,
      displayLabel: column.displayLabel,
      reason: column.reason,
    })),
    reportOnlyFields: collectReportOnlyFields(rows, catalog),
    draftBuffer,
    sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, state: sheet.state })),
  }
}

function emptyCounts() {
  return { populated: 0, preserved: 0, conflicts: 0, missing: 0, notApplicable: 0 }
}

/**
 * Backend values that are deliberately not written but are useful to whoever finishes
 * the draft: the excluded attributes and every specification key the catalog holds.
 */
function collectReportOnlyFields(rows, catalog) {
  const out = []
  for (const row of rows) {
    if (row.status !== 'matched') continue
    const resolution = catalog.get(row.sku)
    if (!resolution || !resolution.item) continue
    const item = resolution.item

    const fields = [
      { field: 'variant_type (website)', value: cleanText(item.variantType), note: REPORT_ONLY_NOTES.get('variation_theme.name') },
      { field: 'material (website)', value: cleanText(item.material), note: REPORT_ONLY_NOTES.get('material.value') },
      { field: 'category', value: cleanText(item.categoryName), note: 'Context only.' },
      { field: 'sub_category', value: cleanText(item.subCategoryName), note: 'Context only.' },
      { field: 'website_status', value: cleanText(item.status), note: 'Context only.' },
    ]

    for (const entry of item.specs.entries) {
      fields.push({ field: `en_specifications.${entry.key}`, value: entry.value, note: 'Specification value, not mapped universally.' })
    }
    for (const entry of item.weightDimensions.entries) {
      fields.push({ field: `weight_dimensions.${entry.key}`, value: entry.value, note: 'Measurement value as stored.' })
    }
    fields.push({
      field: 'long_description (raw HTML)',
      value: cleanText(item.longDescription),
      note: 'Original markup, for the content-enhancement step.',
    })

    for (const field of fields) {
      if (field.value) out.push({ rowNumber: row.rowNumber, sku: row.sku, ...field })
    }
  }
  return out
}

/**
 * Produces the draft by rewriting only the template worksheet part inside a copy of the
 * uploaded package. Every other zip entry keeps its original compressed bytes, so VBA,
 * validations, conditional formatting, defined names and hidden sheets are untouched by
 * construction rather than by best effort.
 */
function buildDraftBuffer(workbook, writes) {
  if (!writes.length) {
    return opc.writePackage(workbook.package)
  }
  const { xml } = applyCellWrites(workbook.sheetXml, writes)
  return opc.writePackage(workbook.package, new Map([[workbook.sheet.partName, Buffer.from(xml, 'utf8')]]))
}

module.exports = {
  DRAFT_NOTICE,
  buildDraftBuffer,
  classifyColumns,
  groupColumnsByKey,
  isSameValue,
  runInitialDraftPipeline,
}
