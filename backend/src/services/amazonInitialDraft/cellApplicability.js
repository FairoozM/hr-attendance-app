'use strict'

/**
 * Detects whether a template cell is applicable and editable.
 *
 * Amazon blacks or greys out cells that do not apply to the current row configuration.
 * Those appearances arrive in the upload as either a baked cell fill or a conditional-
 * formatting rule whose differential style is a dark/grey fill. This module reads those
 * signals from the workbook bytes; it never invents an applicability rule of its own and
 * it never branches the mapping on a product type string.
 */

const { columnLettersToIndex } = require('./worksheetXml')

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseRgb(hex) {
  if (!hex || hex.length < 6) return null
  const normalized = hex.slice(-6)
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

function luminance({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function isNearBlack(rgb) {
  return rgb && luminance(rgb) < 40
}

function isDisabledGrey(rgb) {
  if (!rgb) return false
  const lum = luminance(rgb)
  if (lum < 40 || lum > 200) return false
  const spread = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
  return spread < 25
}

/**
 * A differential or cell fill that Amazon uses to mark a cell as unavailable.
 * White editable fills and green "already filled" fills are deliberately not matched.
 */
function fillLooksDisabled(fillXml) {
  if (!fillXml || !/patternType="solid"/i.test(fillXml)) return false
  const bg = /bgColor[^>]*rgb="FF([0-9A-Fa-f]{6})"/i.exec(fillXml)
  const fg = /fgColor[^>]*rgb="FF([0-9A-Fa-f]{6})"/i.exec(fillXml)
  const bgRgb = bg ? parseRgb(bg[1]) : null
  const fgRgb = fg ? parseRgb(fg[1]) : null
  if (isNearBlack(bgRgb) || isDisabledGrey(bgRgb)) return true
  if (isNearBlack(fgRgb)) return true
  // theme="1" is dk1 (window text / black) in the Office theme.
  if (/fgColor[^>]*theme="1"/i.test(fillXml) && !/tint="/i.test(fillXml)) return true
  return false
}

function parseStyles(stylesXml) {
  if (!stylesXml) {
    return { fills: [], cellXfs: [], dxfs: [], disabledDxfIds: new Set() }
  }

  const fillBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)
  const fills = fillBlock
    ? [...fillBlock[1].matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((match) => match[1])
    : []

  const xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
  const cellXfs = xfBlock
    ? [...xfBlock[1].matchAll(/<xf\b([^>]*)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map((match) => {
        const attrs = match[1]
        const inner = match[2] || ''
        const protection = /<protection\b([^>]*)\/>/.exec(inner)
        const lockedAttr = protection ? /\blocked="([^"]*)"/.exec(protection[1]) : null
        return {
          fillId: Number(/\bfillId="(\d+)"/.exec(attrs)?.[1] || 0),
          applyFill: /\bapplyFill="1"/.test(attrs),
          // Excel's default is locked=true; an explicit locked="0" unlocks.
          locked: lockedAttr ? lockedAttr[1] !== '0' : true,
        }
      })
    : []

  const dxfBlock = /<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(stylesXml)
  const dxfs = dxfBlock
    ? [...dxfBlock[1].matchAll(/<dxf>([\s\S]*?)<\/dxf>/g)].map((match) => match[1])
    : []

  const disabledDxfIds = new Set()
  dxfs.forEach((xml, index) => {
    if (fillLooksDisabled(xml)) disabledDxfIds.add(index)
  })

  return { fills, cellXfs, dxfs, disabledDxfIds }
}

function parseSheetProtection(sheetXml) {
  const match = /<sheetProtection\b([^>]*)\/>/.exec(sheetXml || '')
  if (!match) return { protected: false, sheet: false }
  return {
    protected: true,
    sheet: !/\bsheet="0"/.test(match[1]),
  }
}

function sqrefCoversColumn(sqref, columnIndex) {
  if (!sqref) return false
  return String(sqref)
    .split(/\s+/)
    .some((range) => {
      const match = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(range)
      if (!match) return false
      const from = columnLettersToIndex(match[1])
      const to = match[3] ? columnLettersToIndex(match[3]) : from
      return columnIndex >= Math.min(from, to) && columnIndex <= Math.max(from, to)
    })
}

function parseConditionalFormatting(sheetXml) {
  const rules = []
  const blocks = sheetXml
    ? [...sheetXml.matchAll(/<conditionalFormatting sqref="([^"]*)">([\s\S]*?)<\/conditionalFormatting>/g)]
    : []

  for (const block of blocks) {
    const sqref = block[1]
    for (const ruleMatch of block[2].matchAll(/<cfRule\b([^>]*)(?:\/>|>([\s\S]*?)<\/cfRule>)/g)) {
      const attrs = ruleMatch[1]
      const inner = ruleMatch[2] || ''
      const formulaMatch = /<formula>([\s\S]*?)<\/formula>/.exec(inner)
      const dxfId = /\bdxfId="(\d+)"/.exec(attrs)
      const priority = Number(/\bpriority="(\d+)"/.exec(attrs)?.[1] || 0)
      rules.push({
        sqref,
        dxfId: dxfId ? Number(dxfId[1]) : null,
        priority,
        stopIfTrue: /\bstopIfTrue="1"/.test(attrs),
        formula: formulaMatch ? decodeXmlEntities(formulaMatch[1]) : null,
      })
    }
  }

  return rules.sort((a, b) => a.priority - b.priority)
}

/**
 * Minimal evaluator for the boolean formulas Amazon stores in applicability CF rules
 * and defined names. Supports AND/OR/NOT/IF/LEN/comparisons and sheet-cell references.
 * Anything it cannot evaluate safely returns null.
 */
function createFormulaEvaluator({ namedFormulas, rowNumber, cellValueAt }) {
  const cache = new Map()

  function cellRef(absoluteRef) {
    const match = /(?:'[^{']+'|[A-Za-z0-9_]+)!?\$?([A-Za-z]+)\$?(\d+)/.exec(absoluteRef)
    if (!match) return null
    const column = columnLettersToIndex(match[1])
    return cellValueAt(column, rowNumber)
  }

  function tokenize(expression) {
    const tokens = []
    const source = expression.replace(/\s+/g, '')
    let index = 0
    while (index < source.length) {
      const rest = source.slice(index)
      if (/^,/.test(rest)) {
        tokens.push({ type: ',' })
        index += 1
        continue
      }
      if (/^\(/.test(rest)) {
        tokens.push({ type: '(' })
        index += 1
        continue
      }
      if (/^\)/.test(rest)) {
        tokens.push({ type: ')' })
        index += 1
        continue
      }
      const comparison = /^(<>|<=|>=|=|<|>)/.exec(rest)
      if (comparison) {
        tokens.push({ type: 'op', value: comparison[1] })
        index += comparison[1].length
        continue
      }
      const stringLiteral = /^"([^"]*)"/.exec(rest)
      if (stringLiteral) {
        tokens.push({ type: 'string', value: stringLiteral[1] })
        index += stringLiteral[0].length
        continue
      }
      const numberLiteral = /^(\d+(?:\.\d+)?)/.exec(rest)
      if (numberLiteral) {
        tokens.push({ type: 'number', value: Number(numberLiteral[1]) })
        index += numberLiteral[1].length
        continue
      }
      const cell = /^((?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Za-z]+\$?\d+/.exec(rest)
      if (cell) {
        tokens.push({ type: 'cell', value: cell[0] })
        index += cell[0].length
        continue
      }
      const name = /^([A-Za-z_][A-Za-z0-9_.]*)/.exec(rest)
      if (name) {
        tokens.push({ type: 'name', value: name[1] })
        index += name[1].length
        continue
      }
      return null
    }
    return tokens
  }

  function asBoolean(value) {
    if (value === null || value === undefined) return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') return value.trim() !== ''
    return Boolean(value)
  }

  function compare(left, operator, right) {
    if (operator === '=') return String(left ?? '') === String(right ?? '')
    if (operator === '<>') return String(left ?? '') !== String(right ?? '')
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return null
    if (operator === '<') return leftNumber < rightNumber
    if (operator === '>') return leftNumber > rightNumber
    if (operator === '<=') return leftNumber <= rightNumber
    if (operator === '>=') return leftNumber >= rightNumber
    return null
  }

  function evaluateTokens(tokens) {
    if (!tokens) return null
    let index = 0

    function peek() {
      return tokens[index] || null
    }

    function consume() {
      const token = tokens[index]
      index += 1
      return token
    }

    function callFunction(name, args) {
      const upper = name.toUpperCase()
      if (upper === 'AND') return args.every((arg) => asBoolean(arg))
      if (upper === 'OR') return args.some((arg) => asBoolean(arg))
      if (upper === 'NOT') return !asBoolean(args[0])
      if (upper === 'LEN') return String(args[0] ?? '').length
      if (upper === 'IF') return asBoolean(args[0]) ? args[1] : args[2]
      if (upper === 'TRUE') return true
      if (upper === 'FALSE') return false
      return null
    }

    function parsePrimary() {
      const token = peek()
      if (!token) return null
      if (token.type === 'string' || token.type === 'number') {
        consume()
        return token.value
      }
      if (token.type === 'cell') {
        consume()
        return cellRef(token.value)
      }
      if (token.type === 'name') {
        consume()
        const name = token.value
        if (peek() && peek().type === '(') {
          consume()
          const args = []
          if (peek() && peek().type !== ')') {
            args.push(parseExpression())
            while (peek() && peek().type === ',') {
              consume()
              args.push(parseExpression())
            }
          }
          if (!peek() || peek().type !== ')') return null
          consume()
          return callFunction(name, args)
        }
        return evaluateNamed(name)
      }
      if (token.type === '(') {
        consume()
        const value = parseExpression()
        if (!peek() || peek().type !== ')') return null
        consume()
        return value
      }
      return null
    }

    function parseComparison() {
      const left = parsePrimary()
      const operator = peek()
      if (operator && operator.type === 'op') {
        consume()
        const right = parsePrimary()
        return compare(left, operator.value, right)
      }
      return left
    }

    function parseExpression() {
      return parseComparison()
    }

    const value = parseExpression()
    if (index !== tokens.length) return null
    return value
  }

  function evaluateNamed(name) {
    if (cache.has(name)) return cache.get(name)
    const formula = namedFormulas.get(name)
    if (!formula) {
      cache.set(name, null)
      return null
    }
    cache.set(name, false)
    const value = evaluate(formula)
    cache.set(name, value)
    return value
  }

  function evaluate(expression) {
    if (expression === null || expression === undefined) return null
    const tokens = tokenize(String(expression))
    if (!tokens) return null
    try {
      return evaluateTokens(tokens)
    } catch {
      return null
    }
  }

  return { evaluate, asBoolean }
}

function parseDefinedNames(workbookXml) {
  const names = new Map()
  if (!workbookXml) return names
  for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const name = /\bname="([^"]*)"/.exec(match[1])
    if (!name) continue
    names.set(name[1], decodeXmlEntities(match[2]))
  }
  return names
}

function styleIsDisabled(styleIndex, styles) {
  if (styleIndex === null || styleIndex === undefined || styleIndex === '') return false
  const xf = styles.cellXfs[Number(styleIndex)]
  if (!xf) return false
  if (!xf.applyFill && xf.fillId === 0) return false
  const fillXml = styles.fills[xf.fillId]
  return fillLooksDisabled(fillXml || '')
}

/**
 * @returns {{ applicable: boolean, reason: string|null, detail?: string }}
 */
function assessCellApplicability({
  styles,
  sheetProtection,
  conditionalFormatting,
  namedFormulas,
  column,
  rowNumber,
  existingCell,
  cellValueAt,
}) {
  if (existingCell && styleIsDisabled(existingCell.style, styles)) {
    return { applicable: false, reason: 'disabled-fill' }
  }

  if (sheetProtection?.protected && sheetProtection.sheet) {
    const styleIndex = existingCell ? existingCell.style : null
    const xf =
      styleIndex !== null && styleIndex !== undefined && styleIndex !== ''
        ? styles.cellXfs[Number(styleIndex)]
        : null
    if (!xf || xf.locked !== false) {
      return { applicable: false, reason: 'protected-cell' }
    }
  }

  const evaluator = createFormulaEvaluator({ namedFormulas, rowNumber, cellValueAt })
  const covering = conditionalFormatting.filter((rule) => sqrefCoversColumn(rule.sqref, column.column))

  for (const rule of covering) {
    if (rule.dxfId === null || !styles.disabledDxfIds.has(rule.dxfId)) {
      if (rule.stopIfTrue && rule.formula) {
        const value = evaluator.evaluate(rule.formula)
        if (value !== null && evaluator.asBoolean(value)) break
      }
      continue
    }
    if (!rule.formula) continue
    const value = evaluator.evaluate(rule.formula)
    if (value === null) {
      return { applicable: false, reason: 'applicability-unevaluable', detail: rule.formula.slice(0, 120) }
    }
    if (evaluator.asBoolean(value)) {
      return { applicable: false, reason: 'blacked-out-by-template' }
    }
    if (rule.stopIfTrue) break
  }

  return { applicable: true, reason: null }
}

module.exports = {
  assessCellApplicability,
  createFormulaEvaluator,
  fillLooksDisabled,
  parseConditionalFormatting,
  parseDefinedNames,
  parseSheetProtection,
  parseStyles,
  sqrefCoversColumn,
  styleIsDisabled,
}
