#!/usr/bin/env node
/**
 * One-off: load .env, call Instagram Graph Business Discovery for a username, print a summary.
 * Usage: from repo root, `node backend/scripts/test-instagram-business-profile.js <username>`
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const { fetchInstagramBusinessProfile } = require('../src/services/instagramService')

const username = process.argv[2]
if (!username) {
  console.error('Usage: node backend/scripts/test-instagram-business-profile.js <username>')
  process.exit(1)
}

fetchInstagramBusinessProfile(username).then((r) => {
  if (r.success) {
    console.log(JSON.stringify({
      username: r.username,
      name: r.name,
      followers_count: r.followersCount,
      profile_picture_url: r.profilePictureUrl,
      error: null,
    }, null, 2))
  } else {
    console.log(JSON.stringify({
      username: r.username,
      name: null,
      followers_count: null,
      profile_picture_url: r.profilePictureUrl,
      error: r.errorMessage,
      errorCode: r.errorCode,
    }, null, 2))
  }
}).catch((e) => {
  console.error('Unexpected error:', e.message)
  process.exit(1)
})
