/**
 * Legacy entry point — delegates to the vitest suite in src/utils/influencerPerformanceUtils.test.ts
 */
import { spawnSync } from 'node:child_process'

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'src/utils/influencerPerformanceUtils.test.ts'],
  { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname },
)

process.exit(result.status ?? 1)
