'use strict'

const { after, before, describe, it } = require('node:test')
const assert = require('node:assert/strict')

const catalogDb = require('../src/db/lifesmileWebsiteDb')

const { ENV_VAR, assertReadOnlyStatement, describeConnection, isConfigured, readQuery } = catalogDb

describe('website catalog database — statement guard', () => {
  it('allows a plain SELECT and a CTE', () => {
    assert.doesNotThrow(() => assertReadOnlyStatement('SELECT 1'))
    assert.doesNotThrow(() => assertReadOnlyStatement('  \n SELECT a FROM products WHERE id = $1'))
    assert.doesNotThrow(() => assertReadOnlyStatement('WITH x AS (SELECT 1) SELECT * FROM x'))
    assert.doesNotThrow(() => assertReadOnlyStatement('-- a comment\nSELECT 1'))
    assert.doesNotThrow(() => assertReadOnlyStatement('/* block */ SELECT 1'))
    assert.doesNotThrow(() => assertReadOnlyStatement('SELECT 1;'))
  })

  it('rejects every data-modifying statement', () => {
    const statements = [
      'INSERT INTO products (name) VALUES ($1)',
      'UPDATE products SET name = $1',
      'update  products  set name = $1',
      'DELETE FROM products',
      'TRUNCATE products',
      'MERGE INTO products USING x ON true',
      'CALL some_procedure()',
      'COPY products FROM $1',
      'COPY products TO $1',
    ]
    for (const sql of statements) {
      assert.throws(() => assertReadOnlyStatement(sql), (error) => error.code === 'CATALOG_QUERY_REJECTED', sql)
    }
  })

  it('rejects DDL and privilege changes, including role creation', () => {
    const statements = [
      'CREATE TABLE t (id int)',
      'CREATE ROLE attacker LOGIN',
      'CREATE USER attacker',
      'ALTER TABLE products ADD COLUMN x int',
      'ALTER ROLE amazon_catalog_reader SUPERUSER',
      'DROP TABLE products',
      'DROP SCHEMA public CASCADE',
      'CREATE EXTENSION dblink',
      'GRANT ALL ON products TO amazon_catalog_reader',
      'REVOKE SELECT ON products FROM amazon_catalog_reader',
    ]
    for (const sql of statements) {
      assert.throws(() => assertReadOnlyStatement(sql), (error) => error.code === 'CATALOG_QUERY_REJECTED', sql)
    }
  })

  it('rejects attempts to turn the read-only session off', () => {
    for (const sql of [
      'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
      'SET TRANSACTION READ WRITE',
      'SET ROLE postgres',
      'SET LOCAL default_transaction_read_only = off',
      'RESET ALL',
    ]) {
      assert.throws(() => assertReadOnlyStatement(sql), (error) => error.code === 'CATALOG_QUERY_REJECTED', sql)
    }
  })

  it('rejects a write smuggled after a SELECT', () => {
    for (const sql of [
      'SELECT 1; DROP TABLE products',
      'SELECT 1; INSERT INTO products (name) VALUES (1)',
      'SELECT 1;\n-- comment\nDELETE FROM products',
      'SELECT * INTO new_table FROM products',
    ]) {
      assert.throws(() => assertReadOnlyStatement(sql), (error) => error.code === 'CATALOG_QUERY_REJECTED', sql)
    }
  })

  it('rejects a DO block, maintenance commands and server-side file access', () => {
    for (const sql of [
      "DO $$ BEGIN PERFORM 1; END $$",
      'VACUUM products',
      'REINDEX TABLE products',
      'LOCK TABLE products',
      "SELECT pg_read_file('/etc/passwd')",
      'SELECT pg_terminate_backend(1)',
      'SELECT pg_sleep(60)',
    ]) {
      assert.throws(() => assertReadOnlyStatement(sql), (error) => error.code === 'CATALOG_QUERY_REJECTED', sql)
    }
  })

  it('does not mistake a keyword inside a string literal for a statement', () => {
    assert.doesNotThrow(() =>
      assertReadOnlyStatement("SELECT * FROM products WHERE name = 'insert into stock; drop table x'")
    )
    assert.doesNotThrow(() => assertReadOnlyStatement("SELECT 'grant' AS word"))
  })

  it('rejects an empty or non-string statement', () => {
    for (const sql of ['', '   ', null, undefined, 42, {}]) {
      assert.throws(() => assertReadOnlyStatement(sql), (error) => error.code === 'CATALOG_QUERY_REJECTED')
    }
  })
})

describe('website catalog database — parameter discipline', () => {
  it('refuses a query without a bind-parameter array, so interpolation is not an option', async () => {
    for (const params of [undefined, null, 'LS-1', { sku: 'LS-1' }]) {
      await assert.rejects(
        () => readQuery('SELECT 1', params),
        (error) => error.code === 'CATALOG_QUERY_REJECTED'
      )
    }
  })

  it('checks the statement before it can reach a pool', async () => {
    // Rejected by the guard, so no connection is attempted even without configuration.
    await assert.rejects(
      () => readQuery('DELETE FROM products', []),
      (error) => error.code === 'CATALOG_QUERY_REJECTED'
    )
  })
})

describe('website catalog database — configuration reporting', () => {
  const original = process.env[ENV_VAR]

  before(() => {
    delete process.env[ENV_VAR]
  })

  after(() => {
    if (original === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = original
  })

  it('reports itself unconfigured rather than falling back to another database', () => {
    assert.equal(isConfigured(), false)
    assert.deepEqual(describeConnection(), { configured: false })
  })

  it('fails with a specific code when a query is attempted while unconfigured', async () => {
    await assert.rejects(
      () => readQuery('SELECT 1', []),
      (error) => error.code === 'CATALOG_QUERY_FAILED' || error.code === 'CATALOG_DB_NOT_CONFIGURED'
    )
  })

  it('reports health without throwing when unconfigured', async () => {
    assert.deepEqual(await catalogDb.checkHealth(), { configured: false, reachable: false, readOnly: null })
  })

  it('never exposes the password or the raw connection string', () => {
    process.env[ENV_VAR] = 'postgresql://amazon_catalog_reader:sup3rs3cr3t@db.example.com:5432/lifesmiledbnew?sslmode=require'

    const described = describeConnection()
    const serialized = JSON.stringify(described)

    assert.equal(described.configured, true)
    assert.equal(described.host, 'db.example.com')
    assert.equal(described.database, 'lifesmiledbnew')
    assert.equal(described.readOnlySession, true)
    assert.ok(!serialized.includes('sup3rs3cr3t'), 'the password must not appear in the description')
    assert.ok(!serialized.includes('postgresql://'), 'the DSN must not appear in the description')
    assert.ok(!Object.prototype.hasOwnProperty.call(described, 'password'))
    assert.ok(!Object.prototype.hasOwnProperty.call(described, 'connectionString'))
  })
})
