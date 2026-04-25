/**
 * Deterministic family thumbnail for Zoho weekly reports: pick one `item_id` for
 * `/inventory/v1/items/{id}/image`. Some families are pinned to a specific catalog SKU
 * (see `FAMILY_TO_REPRESENTATIVE_SKU`). Otherwise: waterfall — biggest primary pot →
 * biggest secondary → cookware set → other → frying (last). Size from L + cm in SKU + name.
 */
const REPRESENTATIVE_IMAGE_SELECTION_VERSION = 8
const REPRESENTATIVE_IMAGE_CACHE_VERSION = 4

/** Same as `weeklyReportZohoData` — family display can include this suffix for unmapped Zoho families. */
const FAMILY_LABEL_SUFFIX_NOT_IN_GROUPS = ' (not found in groups)'

/**
 * When set, the weekly report / Excel thumbnail uses that Zoho item (match on `row.sku`)
 * instead of the default waterfall. Keys: normalized family label (see `familyKeyForSkuOverride`).
 */
const FAMILY_TO_REPRESENTATIVE_SKU = Object.freeze({
  lifep17s: 'LIFEP17S-40P-BEIGE',
  lifep5: 'LIFEP5-32N-GREEN',
  lifep2: 'LIFEP2-32-BEIGE',
})

const BONUS_IMAGE = 40
const BONUS_ACTIVE = 20

const BASE = {
  primary_pot: 1000,
  secondary_pot: 700,
  cookware_set: 300,
  other: 100,
  frying: -300,
}

const PENALTY_FRY_ADD = 150
const PENALTY_COOKWARE_WHEN_POT_IN_FAMILY = 200
const PENALTY_GENERIC_PAN = 50
const LITER_BONUS = 20
const CM_BONUS = 2

const ORG_40 = /lifep\d+[\s-]+40|lifeps\d*[\s-]+40/i
const ORG_40P = /lifep\d*s[\s-]+40p|lifeps\d*s[\s-]+40p/i
/** e.g. FLCM-40P-RED — soup/40P line in FLCM Family (Zoho org SKU). */
const ORG_FLCM_40P = /flcm[\s-]+40p|flcm\w*[\s-]40p/i

const RE_SOUP_POT =
  /(soup|stock|stew|(?:cook(?:ing)))[\s-]+pot|souppot|stockpot|stewpot|stew\s*pot|stewpot|stock\s*pot/i
const RE_PRIMARY = /(casserole|dutch\W*oven|\bhandi\b)/i

const RE_SECONDARY = /(milk|sauce)[\s-]+pot|milkpot|saucepot|saucepan\w*|\bsauce\s*pan\b|sauce[\s-]+pan|milk[\s-]pot|milkpot/i
const RE_COOKWARE_SET = new RegExp(
  'cookware[\\s-]+set|cooking[\\s-]+set|pots[\\s-]and[\\s-]pans[\\s-]+set|piece[\\s-]+set' +
    '|set[\\s-]of' +
    '|\\b\\d+\\s*pcs?\\b|\\b(6|8|10|12|14|16|18|20|24|28|32)(\\s|-)*pcs?\\b' +
    '|set[\\s-]\\d+',
  'i'
)

const RE_FRY = /fry(?:ing)?\s*pan|fry-?pan|fry\W*pan|frypan|grill[\s-]*pan|dosa\W*pan|dosa\W*tawa|crepe\W*pan|griddle|مقلاة|milk\W*pan(?!\W*pot)/i
const RE_WOK = /\b(wok|skillet|tawa)\b/
const RE_GENERIC_PAN = /\bpan(s)?\b/i
const LIFP_FP = /(lif|life)ep/i
const LIFP_FP_TOK = /\bfp\b/

const _logRemaining = 10
let _debugLogRemaining = _logRemaining
const isRepDebug = () => process.env.WEEKLY_REPORT_ZOHO_REP_DEBUG === '1'

function normalizeText(s) {
  if (s == null) return ''
  return String(s)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[,'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function combinedText(sku, name) {
  return `${normalizeText(sku)} ${normalizeText(name)}`.replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} t
 * @returns {boolean}
 */
function isPrimaryType(t) {
  if (!t) return false
  if (RE_SOUP_POT.test(t) && !/cooking[\s-]+set/i.test(t)) return true
  if (RE_PRIMARY.test(t)) return true
  if (ORG_40.test(t) || ORG_40P.test(t) || ORG_FLCM_40P.test(t)) return true
  return false
}

/**
 * @param {string} t
 * @returns {boolean}
 */
function isLifepFryChild(t) {
  return LIFP_FP.test(t) && LIFP_FP_TOK.test(t) && !ORG_40.test(t) && !ORG_40P.test(t)
}

/**
 * @param {string} t
 * @returns {boolean}
 */
function isFryingType(t) {
  if (!t) return false
  if (isPrimaryType(t) || RE_SECONDARY.test(t)) return false
  if (isLifepFryChild(t)) return true
  if (RE_FRY.test(t)) return true
  if (RE_WOK.test(t)) return true
  return false
}

/**
 * @param {string} sku
 * @param {string} name
 * @returns {'primary_pot'|'secondary_pot'|'cookware_set'|'frying'|'other'}
 */
function classifyRepresentativeType(sku, name) {
  const t = combinedText(sku, name)
  if (!t) return 'other'
  if (isPrimaryType(t)) return 'primary_pot'
  if (RE_SECONDARY.test(t)) return 'secondary_pot'
  if (isFryingType(t)) return 'frying'
  if (RE_COOKWARE_SET.test(t)) return 'cookware_set'
  return 'other'
}

function findAllRe(t, re, cap) {
  const out = []
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m
  while ((m = rx.exec(t)) != null) {
    const n = cap(m)
    if (n != null && Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * @param {string} sku
 * @param {string} name
 * @returns {number|null}
 */
function extractCapacityLiters(sku, name) {
  const t = combinedText(sku, name)
  if (!t) return null
  const vals = [
    ...findAllRe(
      t,
      /(\d+(?:[.,]\d+)?)\s*(l|lt|litre|liters?|litre)\b/gi,
      (m) => parseFloat(String(m[1]).replace(',', '.'))
    ),
    ...findAllRe(
      t,
      /(\d+(?:[.,]\d+)?)\s*L\b/gi,
      (m) => parseFloat(String(m[1]).replace(',', '.'))
    ),
  ]
  if (!vals.length) return null
  return Math.max(...vals)
}

/**
 * @param {string} sku
 * @param {string} name
 * @returns {number|null}
 */
function extractDiameterCm(sku, name) {
  const t = combinedText(sku, name)
  if (!t) return null
  const vals = [
    ...findAllRe(t, /(\d+(?:[.,]\d+)?)\s*cm\b/gi, (m) => parseFloat(String(m[1]).replace(',', '.'))),
    ...findAllRe(
      t,
      /\bcm[:\s-]*(\d+(?:[.,]\d+)?)\b/gi,
      (m) => parseFloat(String(m[1]).replace(',', '.'))
    ),
  ]
  // Bare 2-digit width often means cm in titles (e.g. "Frying pan 28") but not 6/8/10/12 pcs.
  if (!vals.length) {
    const m = t.match(/\b(1[4-9]|[2-3][0-9]|4[0-2])\b\s*$/i)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 14 && n <= 42 && !/\b\d{1,2}\s*pcs?/i.test(t)) {
        vals.push(n)
      }
    }
  }
  if (!vals.length) return null
  return Math.max(...vals)
}

/**
 * @param {string} sku
 * @param {string} name
 * @returns {{ liters: number|null, cm: number|null }}
 */
function extractRepresentativeSize(sku, name) {
  return { liters: extractCapacityLiters(sku, name), cm: extractDiameterCm(sku, name) }
}

/**
 * @param {object} c
 */
function rowToView(c) {
  const iid = String(c.iid != null ? c.iid : '').trim()
  const row = c && c.row
  if (!row) {
    return { c, iid, sku: '', item_name: '', fullText: '', cat: 'other', liters: null, cm: null, hasImage: false, isActive: true }
  }
  const sku = String(row.sku != null ? row.sku : '')
  const itemName = String(row.item_name != null ? row.item_name : '')
  const fullText = combinedText(sku, itemName)
  return {
    c,
    iid,
    sku,
    item_name: itemName,
    fullText,
    cat: classifyRepresentativeType(sku, itemName),
    liters: extractCapacityLiters(sku, itemName),
    cm: extractDiameterCm(sku, itemName),
    hasImage: !!(row._zoho && row._zoho.has_image),
    isActive: row._zoho && Object.prototype.hasOwnProperty.call(row._zoho, 'is_active') ? row._zoho.is_active : true,
  }
}

function compareStratum(a, b) {
  const aL = a.liters != null ? a.liters : -1e9
  const bL = b.liters != null ? b.liters : -1e9
  if (bL !== aL) return bL - aL
  const aC = a.cm != null ? a.cm : -1e9
  const bC = b.cm != null ? b.cm : -1e9
  if (bC !== aC) return bC - aC
  if (a.hasImage !== b.hasImage) return (b.hasImage ? 1 : 0) - (a.hasImage ? 1 : 0)
  if (a.isActive !== b.isActive) return (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0)
  const ka = `${a.sku} ${a.item_name}`.toLowerCase()
  const kb = `${b.sku} ${b.item_name}`.toLowerCase()
  if (ka !== kb) return ka < kb ? -1 : 1
  return String(a.iid).localeCompare(String(b.iid), 'en')
}

/**
 * @param {object} v view
 * @param {object} fam
 * @param {boolean} [forDisplayOnly]
 * @returns {number}
 */
function scoreRepresentativeItem(v, fam, forDisplayOnly) {
  const t = v.fullText
  const cat = v.cat
  const base = BASE[cat] != null ? BASE[cat] : 0
  const L = v.liters != null ? v.liters * LITER_BONUS : 0
  const Cm = v.cm != null ? v.cm * CM_BONUS : 0
  const img = v.hasImage ? BONUS_IMAGE : 0
  const act = v.isActive ? BONUS_ACTIVE : 0
  let pen = 0
  if (cat === 'frying' && (isFryingType(t) || isLifepFryChild(t))) {
    if (!/souppot|soup\W*pot|stock\W*pot|stockpot/i.test(t)) pen += PENALTY_FRY_ADD
  }
  if (cat === 'cookware_set' && (fam.hasPrimary || fam.hasSecondary) && forDisplayOnly) {
    pen += PENALTY_COOKWARE_WHEN_POT_IN_FAMILY
  }
  if (cat === 'other' && t) {
    if (RE_GENERIC_PAN.test(t) && !/saucepan|sauce\W*pan|sauce\W*pot|milk\W*pot/i.test(t) && !isPrimaryType(t)) {
      if (!/soup|stock|stew|dutch|casserole|milk|sauce\W*pot|handi/i.test(t)) pen += PENALTY_GENERIC_PAN
    }
  }
  return base + L + Cm + img + act - pen
}

function firstInStratum(views, cat) {
  const f = views.filter((v) => v.cat === cat)
  if (!f.length) return undefined
  f.sort(compareStratum)
  return f[0]
}

/**
 * @param {Array<{ iid: string, row: object }>} candidates
 * @returns {object|undefined} chosen view
 */
function pickByWaterfall(candidates) {
  const views = candidates.map(rowToView).filter((v) => v && v.iid)
  if (views.length === 0) return undefined
  const s = (cat) => firstInStratum(views, cat)
  return s('primary_pot') || s('secondary_pot') || s('cookware_set') || s('other') || s('frying')
}

/**
 * @param {string} sku
 * @param {string} name
 * @returns {{ text: number, detail: string[] }}
 */
function scoreZohoNameSkuText(sku, name) {
  const t = combinedText(sku, name)
  if (!t) {
    return { text: 0, detail: ['(empty)'] }
  }
  const cat = classifyRepresentativeType(sku, name)
  const b = BASE[cat] != null ? BASE[cat] : 0
  return { text: b, detail: [cat, `base=${b}`] }
}

/**
 * e.g. "LIFEP5 Family" / "LIFEP5" / "LIFEP5 (not found in groups)" → "lifep5" for `FAMILY_TO_REPRESENTATIVE_SKU` lookup
 * @param {string} [familyLabel]
 * @returns {string}
 */
function familyKeyForSkuOverride(familyLabel) {
  if (familyLabel == null || String(familyLabel).trim() === '') return ''
  let s = String(familyLabel).trim()
  if (s.endsWith(FAMILY_LABEL_SUFFIX_NOT_IN_GROUPS)) {
    s = s.slice(0, -FAMILY_LABEL_SUFFIX_NOT_IN_GROUPS.length).trim()
  }
  s = normalizeText(s)
  s = s.replace(/\s+family\s*$/i, '').trim()
  s = s.replace(/\s/g, '')
  return s
}

/**
 * Collapse internal spaces so `LIFEP5- 32N -GREEN` still matches the pinned SKU.
 * @param {string} s
 * @returns {string}
 */
function normalizeSkuKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

/**
 * @param {Array<{ iid: string, row: object }>} candidates
 * @param {string} targetSku
 * @returns {object|undefined} raw candidate
 */
function findCandidateBySku(candidates, targetSku) {
  const want = normalizeSkuKey(targetSku)
  if (!want) return undefined
  for (const c of candidates) {
    const sku = c && c.row && c.row.sku != null ? String(c.row.sku) : ''
    if (normalizeSkuKey(sku) === want) return c
  }
  return undefined
}

function scoreZohoItemForFamilyThumb(c) {
  const v = rowToView(c)
  if (!c || !c.row) {
    return {
      total: -1e6,
      text: 0,
      imageBonus: 0,
      activeBonus: 0,
      hasImage: false,
      isActive: true,
      iid: null,
      reasonParts: ['(no row)'],
    }
  }
  return {
    total: 0,
    text: 0,
    imageBonus: v.hasImage ? BONUS_IMAGE : 0,
    activeBonus: v.isActive ? BONUS_ACTIVE : 0,
    hasImage: v.hasImage,
    isActive: v.isActive,
    iid: v.iid,
    reasonParts: [v.cat],
  }
}

/**
 * @param {Array<{ iid: string, row: object }>} candidates
 * @param {{ familyLabel?: string }} [ctx]
 */
function selectRepresentativeZohoItemForFamily(candidates, ctx = {}) {
  const out = {
    zoho_representative_item_id: null,
    zoho_representative_sku: null,
    zoho_representative_name: null,
    zoho_representative_reason: '',
    zoho_representative_score: null,
    zoho_representative_image_selection_version: REPRESENTATIVE_IMAGE_SELECTION_VERSION,
    _rejected: null,
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    out.zoho_representative_reason = `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION}:no_candidates`
    return out
  }
  const byIid = new Map()
  for (const c of candidates) {
    if (!c || c.iid == null || String(c.iid).trim() === '') continue
    byIid.set(String(c.iid).trim(), c)
  }
  const uniq = [...byIid.values()]
  if (uniq.length === 0) {
    out.zoho_representative_reason = `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION}:empty`
    return out
  }

  const allViews = uniq.map(rowToView)
  const fam = {
    hasPrimary: allViews.some((x) => x.cat === 'primary_pot'),
    hasSecondary: allViews.some((x) => x.cat === 'secondary_pot'),
  }

  const famKey = familyKeyForSkuOverride((ctx && ctx.familyLabel) || '')
  const forcedSku = FAMILY_TO_REPRESENTATIVE_SKU[famKey]
  let w
  let usedSkuOverride = false
  if (forcedSku) {
    const cForced = findCandidateBySku(uniq, forcedSku)
    if (cForced) {
      w = rowToView(cForced)
      usedSkuOverride = true
    }
  }
  if (!w) w = pickByWaterfall(uniq)
  if (!w) {
    out.zoho_representative_reason = `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION}:no_winner`
    return out
  }
  const total = scoreRepresentativeItem(w, fam, true)
  out.zoho_representative_item_id = w.iid
  out.zoho_representative_sku = w.sku || null
  out.zoho_representative_name = w.item_name || null
  out.zoho_representative_score = Math.round(total * 100) / 100
  const cookwareBeaten = allViews.some(
    (x) => x.cat === 'cookware_set' && w.cat !== 'cookware_set' && (fam.hasPrimary || fam.hasSecondary)
  )
  const overrideNote = usedSkuOverride && forcedSku ? ` sku_override=${forcedSku}` : ''
  out.zoho_representative_reason =
    `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION} ` +
    (usedSkuOverride ? 'fixed_sku ' : '') +
    `cat=${w.cat} ` +
    `L=${w.liters == null ? '—' : w.liters} ` +
    `cm=${w.cm == null ? '—' : w.cm} ` +
    `img=${w.hasImage ? 1 : 0} ` +
    `act=${w.isActive ? 1 : 0} ` +
    `score=${out.zoho_representative_score}` +
    overrideNote +
    (cookwareBeaten ? ' ;cookware_set_rejected:family_has_individual_pot' : '')

  if (cookwareBeaten) {
    out._rejected = 'cookware_set_not_used_individual_pot_present'
  }

  const famL = (ctx && ctx.familyLabel) || 'unknown'
  if (isRepDebug() && _debugLogRemaining > 0) {
    _debugLogRemaining -= 1
    // eslint-disable-next-line no-console
    console.log(
      `[zoho-rep] family=${famL} | chosen_sku=${w.sku || '—'} | chosen_name=${(w.item_name || '—').slice(0, 64)}` +
        ` | category=${w.cat} | liters_L=${w.liters == null ? '—' : w.liters} | diameter_cm=${w.cm == null ? '—' : w.cm} | ` +
        `selected_reason=${out.zoho_representative_reason}` +
        (cookwareBeaten ? ' | cookware_set_rejected:yes' : ' | cookware_set_rejected:no')
    )
  }

  return out
}

function normalizeZohoTextForScoring(s) {
  return normalizeText(s)
}

const TIER1 = RE_SOUP_POT
const TIER2 = RE_SECONDARY
const TIER3_POT = 30
const PENALTY_FRY = 300

/**
 * @param {object} itemCandidate
 * @param {Array} familyCandidates
 * @returns {number}
 */
function publicScore(itemCandidate, familyCandidates) {
  const v = rowToView(itemCandidate)
  const views = (familyCandidates || []).map(rowToView)
  const fam = {
    hasPrimary: views.some((x) => x.cat === 'primary_pot'),
    hasSecondary: views.some((x) => x.cat === 'secondary_pot'),
  }
  return scoreRepresentativeItem(v, fam, true)
}

module.exports = {
  REPRESENTATIVE_IMAGE_SELECTION_VERSION,
  REPRESENTATIVE_IMAGE_CACHE_VERSION,
  TIER1,
  TIER2,
  TIER3_POT,
  PENALTY_FRY,
  normalizeZohoTextForScoring,
  normalizeText,
  classifyRepresentativeType,
  extractCapacityLiters,
  extractDiameterCm,
  extractRepresentativeSize,
  scoreRepresentativeItem: publicScore,
  scoreZohoNameSkuText,
  scoreZohoItemForFamilyThumb,
  selectRepresentativeZohoItemForFamily,
}
