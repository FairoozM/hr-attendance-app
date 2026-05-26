#!/usr/bin/env node
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

const { readNoonConfig } = require('../src/services/noon/noonConfig')
const { isNoonServiceError } = require('../src/services/noon/noonErrors')
const { getWhoami } = require('../src/services/noon/noonProductService')

function safeConfigSnapshot() {
  const config = readNoonConfig()
  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    userAgent: config.userAgent,
    jsonPath: config.jsonPath,
    jsonPathExists: config.jsonPathExists,
    projectCodeConfigured: config.projectCodeConfigured,
    apiMode: config.apiMode,
    missing: config.missing,
    errors: config.errors,
  }
}

async function main() {
  const config = safeConfigSnapshot()
  console.log('Noon config:')
  console.log(JSON.stringify(config, null, 2))

  if (!config.enabled || !config.configured) {
    console.log('FAILED: Noon config is not ready for whoami test.')
    process.exit(1)
  }

  try {
    const whoami = await getWhoami()
    console.log('SUCCESS: Noon whoami fetched')
    console.log(
      JSON.stringify(
        {
          summary: whoami.summary,
        },
        null,
        2
      )
    )
  } catch (error) {
    if (isNoonServiceError(error)) {
      console.log('FAILED: Noon whoami request failed')
      console.log(
        JSON.stringify(
          {
            code: error.code,
            message: error.message,
            details: error.details || [],
          },
          null,
          2
        )
      )
      process.exit(1)
    }

    console.log('FAILED: Noon whoami request failed')
    process.exit(1)
  }
}

main().catch(() => {
  console.log('FAILED: Noon health script crashed unexpectedly')
  process.exit(1)
})
