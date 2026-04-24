/** Family parsing; no Zoho network. */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseFamilyFromZohoItem,
  normalizeZohoInventoryItem,
} = require('../src/integrations/zoho/zohoItemFamily')

test('parseFamilyFromZohoItem: empty when no custom_fields', () => {
  assert.equal(parseFamilyFromZohoItem({}, 'cf-1'), '')
  assert.equal(parseFamilyFromZohoItem({ custom_fields: [] }, 'cf-1'), '')
})

test('parseFamilyFromZohoItem: matches customfield_id and returns trimmed value', () => {
  const item = {
    custom_fields: [
      { customfield_id: 'other', value: 'X' },
      { customfield_id: 'cf-family', value: '  Wood  ' },
    ],
  }
  assert.equal(parseFamilyFromZohoItem(item, 'cf-family'), 'Wood')
})

test('parseFamilyFromZohoItem: no familyFieldId returns empty when no label===Family field', () => {
  const item = {
    custom_fields: [{ customfield_id: 'a', value: 'Should not pick' }],
  }
  assert.equal(parseFamilyFromZohoItem(item, null), '')
})

test('parseFamilyFromZohoItem: label fallback returns value when field has label===Family', () => {
  const item = {
    custom_fields: [
      { customfield_id: 'cf-other', label: 'Color', value: 'Red' },
      { customfield_id: 'cf-123456', label: 'Family', value: '  Slow Moving  ' },
    ],
  }
  assert.equal(parseFamilyFromZohoItem(item, null), 'Slow Moving')
})

test('parseFamilyFromZohoItem: label fallback returns empty when Family field has no value', () => {
  const item = {
    custom_fields: [{ customfield_id: 'cf-123456', label: 'Family', value: '' }],
  }
  assert.equal(parseFamilyFromZohoItem(item, null), '')
})

test('normalizeZohoInventoryItem: strings + family', () => {
  const raw = {
    item_id: 42,
    sku: '  SK-1 ',
    name: 'Item A',
    custom_fields: [{ customfield_id: 'f1', value: 'FAM' }],
  }
  const n = normalizeZohoInventoryItem(raw, 'f1')
  assert.deepEqual(n, {
    item_id: '42',
    sku: 'SK-1',
    name: 'Item A',
    family: 'FAM',
  })
})

test('normalizeZohoInventoryItem: missing ids become empty strings', () => {
  const n = normalizeZohoInventoryItem(
    { sku: 's', name: 'n' },
    null,
  )
  assert.deepEqual(n, {
    item_id: '',
    sku: 's',
    name: 'n',
    family: '',
  })
})
