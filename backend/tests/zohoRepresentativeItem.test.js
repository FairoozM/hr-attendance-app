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
  assert.ok((fp.detail || []).some((d) => String(d).includes('frying')), fp.detail)
})

test('Acc1: biggest primary pot (casserole 28cm) over soup 24 and cookware set', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('LIFEP17-1', 'LIFEP17 Soup Pot 24cm', true) },
      { iid: '2', row: row('LIFEP17-2', 'LIFEP17 Casserole 28cm', true) },
      { iid: '3', row: row('LIFEP17-3', 'LIFEP17 Cookware Set 10pcs', true) },
    ],
    { familyLabel: 'Acc1' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
  assert.equal(r.zoho_representative_score != null, true)
})

test('Acc2: soup pot over cookware set in same LIF*S line', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('LIF-1', 'LIFEP17S Cookware Set 10pcs', true) },
      { iid: '2', row: row('LIF-2', 'LIFEP17S Soup Pot 24cm', true) },
    ],
    { familyLabel: 'Acc2' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
})

test('Acc3: biggest stock pot by cm 28 over 20 and 24', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: 'a', row: row('X-1', 'Stock Pot 20cm', true) },
      { iid: 'b', row: row('X-2', 'Stock Pot 24cm', true) },
      { iid: 'c', row: row('X-3', 'Stock Pot 28cm', true) },
    ],
    { familyLabel: 'Acc3' }
  )
  assert.equal(r.zoho_representative_item_id, 'c')
})

test('Acc4: largest saucepan 20 over 18, not cookware set 8pcs', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('P-1', 'Saucepan 18cm', true) },
      { iid: '2', row: row('P-2', 'Saucepan 20cm', true) },
      { iid: '3', row: row('P-3', 'Cookware Set 8pcs', true) },
    ],
    { familyLabel: 'Acc4' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
})

test('Acc5: only cookware + fry: pick set (no pot-like), not fry', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('S-1', 'Cookware Set 12pcs', true) },
      { iid: '2', row: row('F-1', 'Frying Pan 24cm', true) },
    ],
    { familyLabel: 'Acc5' }
  )
  assert.equal(r.zoho_representative_item_id, '1')
})

test('Acc6: only frying: largest cm last resort', () => {
  const r = selectRepresentativeZohoItemForFamily(
    [
      { iid: '1', row: row('F-1', 'Frying Pan 24cm', true) },
      { iid: '2', row: row('F-2', 'Frying Pan 28', true) },
    ],
    { familyLabel: 'Acc6' }
  )
  assert.equal(r.zoho_representative_item_id, '2')
})
