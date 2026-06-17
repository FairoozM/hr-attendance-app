/**
 * Unit tests: Instagram Graph API client (mocked fetch; no real Meta calls).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { mockFetch } = require('./_helpers')

test('normalizeInstagramUsername rejects invalid', async () => {
  const s = require('../src/services/instagramService')
  assert.equal(s.normalizeInstagramUsername(''), null)
  assert.equal(s.normalizeInstagramUsername('a b'), null)
  assert.equal(s.normalizeInstagramUsername('bad!'), null)
  assert.equal(s.normalizeInstagramUsername('@ok_user'), 'ok_user')
})

test('fetchInstagramBusinessProfile returns NOT_CONFIGURED without env', async () => {
  const savedT = process.env.META_ACCESS_TOKEN
  const savedI = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  try {
    delete process.env.META_ACCESS_TOKEN
    delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    delete require.cache[require.resolve('../src/services/instagramService')]
    const s = require('../src/services/instagramService')
    const r = await s.fetchInstagramBusinessProfile('someuser')
    assert.equal(r.success, false)
    assert.equal(r.errorCode, 'NOT_CONFIGURED')
  } finally {
    if (savedT !== undefined) process.env.META_ACCESS_TOKEN = savedT
    else delete process.env.META_ACCESS_TOKEN
    if (savedI !== undefined) process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = savedI
    else delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  }
})

test('fetchInstagramBusinessProfile success maps fields', async () => {
  const calls = []
  const restore = mockFetch((url) => {
    calls.push(String(url))
    return Promise.resolve(
      new Response(
        JSON.stringify({
          business_discovery: {
            id: 'x',
            username: 'acme',
            name: 'Acme Co',
            followers_count: 10,
            follows_count: 2,
            media_count: 3,
            biography: 'bio',
            website: 'https://example.com',
            profile_picture_url: 'https://cdn.net/p.jpg',
          },
        }),
        { status: 200 },
      ),
    )
  })
  const savedT = process.env.META_ACCESS_TOKEN
  const savedI = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  const savedV = process.env.META_GRAPH_API_VERSION
  try {
    process.env.META_ACCESS_TOKEN = 'test_token'
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = '1784'
    process.env.META_GRAPH_API_VERSION = 'v22.0'
    delete require.cache[require.resolve('../src/services/instagramService')]
    const s = require('../src/services/instagramService')
    const r = await s.fetchInstagramBusinessProfile('acme')
    assert.equal(r.success, true)
    assert.equal(r.username, 'acme')
    assert.equal(r.name, 'Acme Co')
    assert.equal(r.followersCount, 10)
    assert.equal(r.profilePictureUrl, 'https://cdn.net/p.jpg')
    assert.ok(calls[0] && /graph\.facebook\.com\/v22\.0\/1784/.test(calls[0]))
  } finally {
    restore()
    if (savedT !== undefined) process.env.META_ACCESS_TOKEN = savedT
    else delete process.env.META_ACCESS_TOKEN
    if (savedI !== undefined) process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = savedI
    else delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    if (savedV !== undefined) process.env.META_GRAPH_API_VERSION = savedV
    else delete process.env.META_GRAPH_API_VERSION
    delete require.cache[require.resolve('../src/services/instagramService')]
  }
})

test('fetchInstagramBusinessProfile maps Graph OAuth error', async () => {
  const restore = mockFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: { message: 'Invalid OAuth access token.', code: 190, type: 'OAuthException' },
        }),
        { status: 400 },
      ),
    ),
  )
  const savedT = process.env.META_ACCESS_TOKEN
  const savedI = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  try {
    process.env.META_ACCESS_TOKEN = 'bad'
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = '1'
    delete require.cache[require.resolve('../src/services/instagramService')]
    const s = require('../src/services/instagramService')
    const r = await s.fetchInstagramBusinessProfile('user')
    assert.equal(r.success, false)
    assert.equal(r.errorCode, 'OAUTH')
  } finally {
    restore()
    if (savedT !== undefined) process.env.META_ACCESS_TOKEN = savedT
    else delete process.env.META_ACCESS_TOKEN
    if (savedI !== undefined) process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = savedI
    else delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    delete require.cache[require.resolve('../src/services/instagramService')]
  }
})

test('fetchInstagramBusinessProfile success without picture logs path still returns success', async () => {
  const restore = mockFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          business_discovery: {
            username: 'nopic',
            name: 'No Pic',
            followers_count: 1,
            follows_count: 1,
            media_count: 0,
            profile_picture_url: null,
          },
        }),
        { status: 200 },
      ),
    ),
  )
  const savedT = process.env.META_ACCESS_TOKEN
  const savedI = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  try {
    process.env.META_ACCESS_TOKEN = 't'
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = '99'
    delete require.cache[require.resolve('../src/services/instagramService')]
    const s = require('../src/services/instagramService')
    const r = await s.fetchInstagramBusinessProfile('nopic')
    assert.equal(r.success, true)
    assert.equal(r.profilePictureUrl, null)
  } finally {
    restore()
    if (savedT !== undefined) process.env.META_ACCESS_TOKEN = savedT
    else delete process.env.META_ACCESS_TOKEN
    if (savedI !== undefined) process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = savedI
    else delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    delete require.cache[require.resolve('../src/services/instagramService')]
  }
})
