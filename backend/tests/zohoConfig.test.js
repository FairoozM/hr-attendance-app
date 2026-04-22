/**
 * Env resolution for Zoho (no network).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { readZohoConfig, orgEnvHint } = require('../src/integrations/zoho/zohoConfig')

const base = {
  ZOHO_CLIENT_ID: 'id',
  ZOHO_CLIENT_SECRET: 'sec',
  ZOHO_REFRESH_TOKEN: 'ref',
}

const keysToReset = new Set([
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_ORGANIZATION_ID',
  'ZOHO_INVENTORY_ORGANIZATION_ID',
  'ZOHO_API_BASE_URL',
  'ZOHO_INVENTORY_API_BASE',
])

function withEnv(overrides, fn) {
  const prev = {}
  for (const k of keysToReset) {
    prev[k] = process.env[k]
  }
  try {
    for (const k of keysToReset) {
      delete process.env[k]
    }
    Object.assign(process.env, base, overrides)
    fn()
  } finally {
    for (const k of keysToReset) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

test('readZohoConfig: ZOHO_ORGANIZATION_ID preferred over legacy key', () => {
  withEnv(
    { ZOHO_ORGANIZATION_ID: 'org-new', ZOHO_INVENTORY_ORGANIZATION_ID: 'org-old' },
    () => {
      const c = readZohoConfig()
      assert.equal(c.code, 'ok')
      assert.equal(c.organizationId, 'org-new')
    }
  )
})

test('readZohoConfig: falls back to ZOHO_INVENTORY_ORGANIZATION_ID', () => {
  withEnv({ ZOHO_INVENTORY_ORGANIZATION_ID: 'only-legacy' }, () => {
    const c = readZohoConfig()
    assert.equal(c.code, 'ok')
    assert.equal(c.organizationId, 'only-legacy')
  })
})

test('readZohoConfig: ZOHO_API_BASE_URL preferred over ZOHO_INVENTORY_API_BASE', () => {
  withEnv(
    {
      ZOHO_ORGANIZATION_ID: '1',
      ZOHO_API_BASE_URL: 'https://api.example',
      ZOHO_INVENTORY_API_BASE: 'https://ignored',
    },
    () => {
      const c = readZohoConfig()
      assert.equal(c.apiBase, 'https://api.example')
    }
  )
})

test('readZohoConfig: not configured when org missing', () => {
  withEnv(
    { ZOHO_ORGANIZATION_ID: '', ZOHO_INVENTORY_ORGANIZATION_ID: '' },
    () => {
      const c = readZohoConfig()
      assert.equal(c.code, 'ZOHO_NOT_CONFIGURED')
    }
  )
})

test('orgEnvHint mentions org env names', () => {
  assert.match(orgEnvHint(), /ZOHO_ORGANIZATION_ID/)
})
