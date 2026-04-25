const test = require('node:test')
const assert = require('node:assert/strict')
const {
  selectRepresentativeZohoItemForFamily,
  scoreZohoNameSkuText,
} = require('../src/services/zohoRepresentativeItem')

function row(sku, name, hasImage, isActive = true) {
  return {
    sku,
    item_name: name,
    _zoho: { has_image: hasImage, is_active: isActive },
  }
}

test('Family A: soup pot beats frying pan', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('ABC-FRYING-PAN-24', 'x', true) },
      { iid: '2', row: row('ABC-SOUP-POT-24', 'x', true) },
    ],
    { familyLabel: 'A' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
  assert.match(r.zoho_representative_sku || '', /SOUP-POT/i)
})

test('Family B: casserole beats FRY pan', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('XYZ-FRY-PAN-28', 'x', true) },
      { iid: '2', row: row('XYZ-CASSEROLE-28', 'x', true) },
    ],
    { familyLabel: 'B' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
})

test('Family C: only frying — pick best total (alpha tiebreak)', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '9', row: row('A-FRY-PAN-1', 'fry pan 1', true) },
      { iid: '8', row: row('B-FRY-PAN-1', 'fry pan 2', true) },
    ],
    { familyLabel: 'C' }
  )
  assert.equal(r.zoho_representative_item_id, '9', 'A-FRY before B-FRY alphabetically')
})

test('Family D: SAUCEPAN not penalized as generic pan; beats fry', () => {
  const t = scoreZohoNameSkuText('ACME-SAUCEPAN-8', 'x')
  assert.ok(t.text >= 60, `expected tier2+ got ${t.text}`)
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('FRY-1', 'fry pan', true) },
      { iid: '2', row: row('ACME-SAUCEPAN-8', 'cook', true) },
    ],
    { familyLabel: 'D' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
})

test('Family E: soup no image, casserole with image — pick casserole (fetchable)', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('SOUP-POT-1', 'soup', false) },
      { iid: '2', row: row('CASS-1', 'casserole', true) },
    ],
    { familyLabel: 'E' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
})

test('LIF* -FP- in SKU (no "fry pan" in name) is penalized like a fry line', () => {
  const fp = scoreZohoNameSkuText('LIFEP17-FP-1', 'Fry 2')
  const stock = scoreZohoNameSkuText('LIFEP17-40-BLUE', 'Stock')
  assert.ok(fp.text < 0, `expected negative text score, got ${fp.text}`)
  assert.ok(stock.text > fp.text, `expected stock > fp: ${stock.text} vs ${fp.text}`)
  assert.ok((fp.detail || []).some((d) => String(d).includes('org_fry_sku_fp')), fp.detail)
})
