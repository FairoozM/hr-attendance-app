'use strict'

/**
 * Turns a Zoho barcode into the 14-digit GTIN Amazon expects, without mutating Zoho.
 *
 * This is an initial-draft helper, not a barcode-certification step. Life Smile stores
 * barcodes as 13-digit codes missing the packaging-indicator zero. A 13-digit numeric
 * string therefore gets exactly one leading 0; a 14-digit value is left alone.
 * Example: 6294015161236 → 06294015161236.
 *
 * GS1 check-digit validation is advisory only: an invalid check digit still produces a
 * GTIN for the draft, with the failure recorded for the report.
 */

function digitsOnly(raw) {
  return String(raw == null ? '' : raw).trim()
}

function isAllDigits(value) {
  return /^\d+$/.test(value)
}

/**
 * GS1 check digit for a digit string whose last character is the check digit.
 * Weights alternate 3,1,3,1… starting from the rightmost data digit.
 */
function computeGtinCheckDigit(bodyDigits) {
  let sum = 0
  const chars = String(bodyDigits)
  for (let i = 0; i < chars.length; i += 1) {
    const digit = Number(chars[chars.length - 1 - i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

function validateGtinCheckDigit(gtin) {
  if (!isAllDigits(gtin) || (gtin.length !== 8 && gtin.length !== 12 && gtin.length !== 13 && gtin.length !== 14)) {
    return false
  }
  const body = gtin.slice(0, -1)
  const expected = computeGtinCheckDigit(body)
  return Number(gtin.slice(-1)) === expected
}

/**
 * @param {unknown} rawZohoBarcode
 * @returns {{
 *   originalZohoBarcode: string,
 *   amazonGtin: string|null,
 *   leadingZeroAdded: 'Yes'|'No'|'',
 *   gtinLength: number|null,
 *   checkDigitStatus: 'valid'|'invalid'|'not-checked',
 *   ok: boolean,
 *   reason: string|null,
 *   warning: string|null,
 * }}
 */
function transformZohoBarcodeToGtin(rawZohoBarcode) {
  const original = digitsOnly(rawZohoBarcode)

  if (!original) {
    return {
      originalZohoBarcode: '',
      amazonGtin: null,
      leadingZeroAdded: '',
      gtinLength: null,
      checkDigitStatus: 'not-checked',
      ok: false,
      reason: 'zoho-barcode-blank',
      warning: null,
    }
  }

  if (!isAllDigits(original)) {
    return {
      originalZohoBarcode: original,
      amazonGtin: null,
      leadingZeroAdded: '',
      gtinLength: null,
      checkDigitStatus: 'not-checked',
      ok: false,
      reason: 'zoho-barcode-non-numeric',
      warning: null,
    }
  }

  let amazonGtin
  let leadingZeroAdded

  if (original.length === 13) {
    amazonGtin = `0${original}`
    leadingZeroAdded = 'Yes'
  } else if (original.length === 14) {
    amazonGtin = original
    leadingZeroAdded = 'No'
  } else {
    return {
      originalZohoBarcode: original,
      amazonGtin: null,
      leadingZeroAdded: '',
      gtinLength: original.length,
      checkDigitStatus: 'not-checked',
      ok: false,
      reason: 'zoho-barcode-unexpected-length',
      warning: null,
    }
  }

  const checkOk = validateGtinCheckDigit(amazonGtin)
  return {
    originalZohoBarcode: original,
    amazonGtin,
    leadingZeroAdded,
    gtinLength: amazonGtin.length,
    checkDigitStatus: checkOk ? 'valid' : 'invalid',
    ok: true,
    reason: null,
    warning: checkOk ? null : 'gtin-check-digit-invalid',
  }
}

module.exports = {
  computeGtinCheckDigit,
  transformZohoBarcodeToGtin,
  validateGtinCheckDigit,
}
