/**
 * Deterministic “family product shot” for Zoho weekly reports: pick one `item_id` (and SKU / name)
 * to fetch `/inventory/v1/items/{id}/image`. Scoring prefers soup / stock / casserole / saucepan
 * over similar-looking frying-pan packshots. Zoho parent/child variation is not always exposed
 * on list items — we use SKU + name + has_image + active only.
 */
const REPRESENTATIVE_IMAGE_SELECTION_VERSION = 3
const BONUS_IMAGE = 25
const BONUS_ACTIVE = 10
const TIER1 = 100
const TIER2 = 60
const TIER3_POT = 30
const PENALTY_FRY = -80
const PENALTY_GENERIC_PAN = -30

let _debugLogRemaining = 5
const isRepDebug = () => process.env.WEEKLY_REPORT_ZOHO_REP_DEBUG === '1'

const REPRESENTATIVE_IMAGE_CACHE_VERSION = 2

function normalizeZohoTextForScoring(s) {
  if (s == null) return ''
  return String(s)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zoho / org naming: soup–stock (–40) line vs child fry SKU (LIF…–FP) in the same family. */
const RE_ORG_LIFEP_40 = /lifep\d+[\s-]+40|lifeps\d*[\s-]+40/i

const RE_TIER1 =
  /(soup[\s-]*pot|souppot|stock[\s-]*pot|stockpot|stew[\s-]*pot|stewpot|cook(?:ing)?[\s-]*pot|casserole|dutch[\s-]*oven|handi|stew\s*pot)/i
const RE_TIER2 = /(milk[\s-]+pot|sauce[\s-]+pot|saucepan\w*|\bsauce\s+pan\b)/i
function isTier3Pot(t) {
  if (RE_TIER1.test(t) || RE_TIER2.test(t)) return false
  if (/(coffee|butter(?!y)|butter\W*milk|honey|soap|paint|flower|plant|nursery)\s+pot|teapot|tea\s*pot(?!\s*holder)/.test(t)) {
    return false
  }
  return /\b(pot|pots)\b/.test(t) && !/spotify|potion|i\.pot\./.test(t)
}

const RE_HARD_FRY =
  /(fry(?:ing)?\s*pan|fry-?pan|frypan|fry[\s-]+pan|grill[\s-]*pan|dosa\W*pan|dosa\W*tawa|tawa|milk\W*pan(?!\W*pot)|griddle|crepe\W*pan|مقلاة|wok|skillet)/i

/**
 * @param {string} sku
 * @param {string} name
 * @returns {{ text: number, detail: string[] }}
 */
function scoreZohoNameSkuText(sku, name) {
  const t = `${normalizeZohoTextForScoring(sku)} ${normalizeZohoTextForScoring(name)}`.replace(/\s+/g, ' ').trim()
  if (!t) {
    return { text: 0, detail: ['(empty)'] }
  }
  const detail = []

  const orgLifep40 = RE_ORG_LIFEP_40.test(t)
  const tier1 = RE_TIER1.test(t) || orgLifep40
  const tier2 = !tier1 && RE_TIER2.test(t)
  const tier3 = !tier1 && !tier2 && isTier3Pot(t)

  let text = 0
  if (tier1) {
    text = TIER1
    detail.push(RE_TIER1.test(t) ? 'tier1' : 'org_lifep_40')
  } else if (tier2) {
    text = TIER2
    detail.push('tier2')
  } else if (tier3) {
    text = TIER3_POT
    detail.push('tier3_pot')
  }

  if (RE_HARD_FRY.test(t)) {
    text += PENALTY_FRY
    detail.push('fry_tawa(−80)')
  } else {
    const isSaucep = /\bsaucepan\w*|\bsauce\s+pan\b/.test(t)
    const isFryShape = /fry(ing)?\W*pan|fry-?pan|fry\W*pan|grill\W*pan|dosa|tawa|wok|skillet|milk\W*pot|soup|stock|stew/.test(
      t
    )
    if (!isSaucep && !isFryShape) {
      const toks = t.split(/\s+/).filter(Boolean)
      if (toks.some((w) => w === 'pan' || w === 'pans')) {
        if (!toks.includes('saucepan') && !t.includes('sauce pan')) {
          text += PENALTY_GENERIC_PAN
          detail.push('generic_pan(−30)')
        }
      }
    }
  }

  // LIF* … -FP- … (hyphens → spaces): "lifep17 fp 1" — org fry-child SKUs, not "fry pan" in the name.
  if (
    !RE_HARD_FRY.test(t) &&
    !tier1 &&
    !tier2 &&
    /(lif|life)ep/i.test(t) &&
    /\bfp\b/.test(t) &&
    !RE_ORG_LIFEP_40.test(t) &&
    !RE_TIER1.test(t) &&
    !RE_TIER2.test(t)
  ) {
    text += PENALTY_FRY
    detail.push('org_fry_sku_fp(−80)')
  }

  return { text, detail }
}

function scoreZohoItemForFamilyThumb(c, iidFallback = '') {
  const row = c && c.row
  if (!row) {
    return {
      total: -1e6,
      text: 0,
      imageBonus: 0,
      activeBonus: 0,
      hasImage: false,
      isActive: true,
      reasonParts: ['(no row)'],
    }
  }
  const sku = String(row.sku != null ? row.sku : '')
  const name = String(row.item_name != null ? row.item_name : '')
  const { text, detail } = scoreZohoNameSkuText(sku, name)
  const hasImage = !!(row._zoho && row._zoho.has_image)
  const isActive = row._zoho && Object.prototype.hasOwnProperty.call(row._zoho, 'is_active') ? row._zoho.is_active : true
  const imageBonus = hasImage ? BONUS_IMAGE : 0
  const activeBonus = isActive ? BONUS_ACTIVE : 0
  const total = text + imageBonus + activeBonus
  return {
    total,
    text,
    imageBonus,
    activeBonus,
    hasImage,
    isActive,
    sku,
    name,
    iid: String(c.iid != null ? c.iid : iidFallback),
    reasonParts: detail,
  }
}

/**
 * @param {Array<{ iid: string, row: object }>} candidates
 * @param {{ familyLabel?: string }} [ctx]
 */
function selectRepresentativeZohoItemForFamily(candidates, ctx = {}) {
  const v = {
    zoho_representative_item_id: null,
    zoho_representative_sku: null,
    zoho_representative_name: null,
    zoho_representative_reason: '',
    zoho_representative_image_selection_version: REPRESENTATIVE_IMAGE_SELECTION_VERSION,
    _rejected: null,
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    v.zoho_representative_reason = `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION}:no_candidates`
    return v
  }
  const byIid = new Map()
  for (const c of candidates) {
    if (!c || c.iid == null || String(c.iid).trim() === '') continue
    byIid.set(String(c.iid).trim(), c)
  }
  const uniq = [...byIid.values()]
  if (uniq.length === 0) {
    v.zoho_representative_reason = `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION}:empty`
    return v
  }

  const scored = uniq.map((c) => {
    const s = scoreZohoItemForFamilyThumb(c)
    return { c, s }
  })

  const withImage = scored.filter((x) => x.s.hasImage)
  const pool = withImage.length > 0 ? withImage : scored

  const sorted = pool.slice().sort((A, B) => {
    if (B.s.total !== A.s.total) return B.s.total - A.s.total
    if (B.s.hasImage !== A.s.hasImage) return (B.s.hasImage ? 1 : 0) - (A.s.hasImage ? 1 : 0)
    if (B.s.isActive !== A.s.isActive) return (B.s.isActive ? 1 : 0) - (A.s.isActive ? 1 : 0)
    const ka = `${A.s.sku} ${A.s.name}`.toLowerCase()
    const kb = `${B.s.sku} ${B.s.name}`.toLowerCase()
    if (ka !== kb) return ka < kb ? -1 : 1
    return String(A.s.iid).localeCompare(String(B.s.iid), 'en')
  })

  const w = sorted[0]
  const s = w.s
  v.zoho_representative_item_id = s.iid
  v.zoho_representative_sku = s.sku || null
  v.zoho_representative_name = s.name || null
  v.zoho_representative_reason = `v${REPRESENTATIVE_IMAGE_SELECTION_VERSION} total=${s.total} text=${s.text} image=${s.imageBonus} act=${s.activeBonus} [${(s.reasonParts && s.reasonParts.join(', ')) || '—'}]${withImage.length ? '' : '; pool=no_image_in_family'}`

  const others = pool.filter((x) => x !== w).map((x) => x.s)
  const friers = others.filter((o) => RE_HARD_FRY.test((o.sku + ' ' + o.name).toLowerCase()))
  if (friers.length) {
    const top = friers.sort((a, b) => b.total - a.total || String(a.sku).localeCompare(String(b.sku)))[0]
    v._rejected = `${top.sku || 'no-sku'} total=${top.total}`
  }

  const fam = (ctx && ctx.familyLabel) || 'unknown'
  if (isRepDebug() && _debugLogRemaining > 0) {
    _debugLogRemaining -= 1
    // eslint-disable-next-line no-console
    console.log(
      `[zoho-rep] family=${fam} -> item=${s.iid} sku=${s.sku || '—'} name=${(s.name || '—').slice(0, 64)}` +
        ` | ${v.zoho_representative_reason}` +
        (v._rejected ? ` | not_using=${v._rejected}` : '')
    )
  }

  return v
}

module.exports = {
  REPRESENTATIVE_IMAGE_SELECTION_VERSION,
  REPRESENTATIVE_IMAGE_CACHE_VERSION,
  TIER1,
  TIER2,
  TIER3_POT,
  PENALTY_FRY,
  normalizeZohoTextForScoring,
  scoreZohoNameSkuText,
  scoreZohoItemForFamilyThumb,
  selectRepresentativeZohoItemForFamily,
}
