'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  shouldSkipSchemaChanges,
  planAutomaticStartupJobs,
  runStartupDbGate,
} = require('../src/config/startupSafeguards')

test('production defaults leave schema changes enabled', () => {
  assert.equal(shouldSkipSchemaChanges({}), false)
  assert.equal(shouldSkipSchemaChanges({ DB_SKIP_SCHEMA_CHANGES: '0' }), false)
})

test('DB_SKIP_SCHEMA_CHANGES enables schema skip', () => {
  assert.equal(shouldSkipSchemaChanges({ DB_SKIP_SCHEMA_CHANGES: '1' }), true)
  assert.equal(shouldSkipSchemaChanges({ DB_SKIP_SCHEMA_CHANGES: 'true' }), true)
  assert.equal(shouldSkipSchemaChanges({ DB_SKIP_SCHEMA_CHANGES: 'YES' }), true)
})

test('production defaults keep inventory warm and subscription sync on', () => {
  const plan = planAutomaticStartupJobs({})
  assert.deepEqual(plan, {
    disableAll: false,
    zohoAutoSync: false,
    inventoryHealthWarm: true,
    subscriptionSync: true,
  })
})

test('ZOHO_AUTO_SYNC_ON_START alone enables only Zoho boot sync', () => {
  const plan = planAutomaticStartupJobs({ ZOHO_AUTO_SYNC_ON_START: '1' })
  assert.equal(plan.zohoAutoSync, true)
  assert.equal(plan.inventoryHealthWarm, true)
  assert.equal(plan.subscriptionSync, true)
  assert.equal(plan.disableAll, false)
})

test('INVENTORY_HEALTH_WARM_ON_START=0 disables warm but keeps subscription sync', () => {
  const plan = planAutomaticStartupJobs({ INVENTORY_HEALTH_WARM_ON_START: '0' })
  assert.equal(plan.inventoryHealthWarm, false)
  assert.equal(plan.subscriptionSync, true)
  assert.equal(plan.zohoAutoSync, false)
})

test('DISABLE_STARTUP_BACKGROUND_JOBS turns off every automatic boot job', () => {
  const plan = planAutomaticStartupJobs({
    DISABLE_STARTUP_BACKGROUND_JOBS: '1',
    ZOHO_AUTO_SYNC_ON_START: '1',
    INVENTORY_HEALTH_WARM_ON_START: '1',
  })
  assert.deepEqual(plan, {
    disableAll: true,
    zohoAutoSync: false,
    inventoryHealthWarm: false,
    subscriptionSync: false,
  })
})

test('runStartupDbGate always pings before deciding on schema', async () => {
  const calls = []
  const result = await runStartupDbGate({
    query: async (sql) => {
      calls.push(sql)
      return { rows: [{ now: '2026-01-02T03:04:05.000Z' }] }
    },
    skipSchemaChanges: true,
    applySchema: async () => {
      calls.push('APPLY_SCHEMA')
    },
  })
  assert.deepEqual(calls, ['SELECT NOW()'])
  assert.equal(result.schemaApplied, false)
  assert.equal(result.now, '2026-01-02T03:04:05.000Z')
})

test('runStartupDbGate still fails when connectivity ping fails', async () => {
  await assert.rejects(
    () =>
      runStartupDbGate({
        query: async () => {
          throw new Error('connect ECONNREFUSED')
        },
        skipSchemaChanges: true,
        applySchema: async () => {
          throw new Error('schema should not run')
        },
      }),
    /ECONNREFUSED/
  )
})

test('runStartupDbGate applies schema when skip is off', async () => {
  const calls = []
  const result = await runStartupDbGate({
    query: async (sql) => {
      calls.push(sql)
      return { rows: [{ now: 'now' }] }
    },
    skipSchemaChanges: false,
    applySchema: async () => {
      calls.push('APPLY_SCHEMA')
    },
  })
  assert.deepEqual(calls, ['SELECT NOW()', 'APPLY_SCHEMA'])
  assert.equal(result.schemaApplied, true)
})
