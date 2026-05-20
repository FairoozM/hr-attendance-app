/**
 * @see backend/src/lib/avatarThumbnail.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { _internals } = require('../src/lib/avatarThumbnail')

test('avatarThumbnail: resize large buffer to small jpeg', async () => {
  const sharp = require('sharp')
  const big = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: { r: 120, g: 80, b: 200 },
    },
  })
    .png({ compressionLevel: 0 })
    .toBuffer()

  assert.ok(big.length > 100_000, `fixture should be sizable, got ${big.length}`)

  const thumb = await _internals.resizeToAvatarJpeg(big)
  assert.ok(thumb.length < big.length / 10, `thumb should be much smaller than ${big.length}`)
  assert.ok(thumb.length < 30_000, `thumb bytes ${thumb.length}`)
})
