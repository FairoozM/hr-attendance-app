'use strict'

/**
 * Home MacBook / laptop safeguards when talking to live AWS RDS.
 *
 * Production and normal local Postgres leave these env flags unset so boot
 * still runs schema ensure steps and the usual startup background jobs.
 */

function isTruthyEnvFlag(name, env = process.env) {
  return /^(1|true|yes)$/i.test(String(env[name] || ''))
}

function isFalsyEnvFlag(name, defaultValue = '', env = process.env) {
  return /^(0|false|no)$/i.test(String(env[name] ?? defaultValue))
}

function shouldSkipSchemaChanges(env = process.env) {
  return isTruthyEnvFlag('DB_SKIP_SCHEMA_CHANGES', env)
}

/**
 * Which automatic boot-time jobs should run for this process.
 * Request-path / user-initiated jobs are intentionally not covered here.
 */
function planAutomaticStartupJobs(env = process.env) {
  const disableAll = isTruthyEnvFlag('DISABLE_STARTUP_BACKGROUND_JOBS', env)
  return {
    disableAll,
    zohoAutoSync: !disableAll && isTruthyEnvFlag('ZOHO_AUTO_SYNC_ON_START', env),
    // Default warm-on-start remains enabled when the flag is unset (production).
    inventoryHealthWarm: !disableAll && !isFalsyEnvFlag('INVENTORY_HEALTH_WARM_ON_START', '1', env),
    subscriptionSync: !disableAll,
  }
}

/**
 * Always probe connectivity first. Schema ensure/migrate runs only when skip is off.
 * `applySchema` is injected so unit tests never touch a real database.
 */
async function runStartupDbGate({ query, skipSchemaChanges, applySchema }) {
  if (typeof query !== 'function') {
    throw new Error('runStartupDbGate requires a query function')
  }
  const result = await query('SELECT NOW()')
  const now = result?.rows?.[0]?.now
  if (skipSchemaChanges) {
    return { now, schemaApplied: false }
  }
  if (typeof applySchema !== 'function') {
    throw new Error('runStartupDbGate requires applySchema when schema changes are enabled')
  }
  await applySchema()
  return { now, schemaApplied: true }
}

module.exports = {
  isTruthyEnvFlag,
  isFalsyEnvFlag,
  shouldSkipSchemaChanges,
  planAutomaticStartupJobs,
  runStartupDbGate,
}
