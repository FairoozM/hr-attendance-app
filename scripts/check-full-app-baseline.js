import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const baselinePath = path.join(__dirname, 'full-app-baseline.json')
const allowedDropRatio = 0.10

function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(rootDir, relativeDirectory)
  if (!existsSync(absoluteDirectory)) {
    return []
  }

  const files = []

  function walk(currentDirectory) {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (entry.isFile()) {
        files.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'))
      }
    }
  }

  walk(absoluteDirectory)
  return files.sort()
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`
}

if (!existsSync(baselinePath)) {
  console.error(`Full-app baseline is missing: ${path.relative(rootDir, baselinePath)}`)
  console.error('Run: node scripts/generate-full-app-baseline.js')
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const directories = Object.keys(baseline.countsByDirectory || {})
const currentCountsByDirectory = Object.fromEntries(
  directories.map((directory) => [directory, listFiles(directory).length]),
)
const currentTotalCount = Object.values(currentCountsByDirectory).reduce(
  (sum, count) => sum + count,
  0,
)

const failures = []

for (const directory of directories) {
  const baselineCount = baseline.countsByDirectory[directory] || 0
  const currentCount = currentCountsByDirectory[directory] || 0
  const drop = baselineCount - currentCount
  const dropRatio = baselineCount > 0 ? drop / baselineCount : 0

  if (dropRatio > allowedDropRatio) {
    failures.push({
      scope: directory,
      baselineCount,
      currentCount,
      drop,
      dropRatio,
    })
  }
}

const totalDrop = baseline.totalCount - currentTotalCount
const totalDropRatio = baseline.totalCount > 0 ? totalDrop / baseline.totalCount : 0

if (totalDropRatio > allowedDropRatio) {
  failures.push({
    scope: 'total',
    baselineCount: baseline.totalCount,
    currentCount: currentTotalCount,
    drop: totalDrop,
    dropRatio: totalDropRatio,
  })
}

console.log('Full-app baseline check')
console.log(`Baseline commit: ${baseline.commit}`)
console.log(`Baseline total files: ${baseline.totalCount}`)
console.log(`Current total files: ${currentTotalCount}`)
for (const directory of directories) {
  console.log(
    `${directory}: baseline=${baseline.countsByDirectory[directory]}, current=${currentCountsByDirectory[directory]}`,
  )
}

if (failures.length === 0) {
  console.log('Full-app baseline check passed.')
  process.exit(0)
}

console.error('\nFull-app baseline check failed.')
console.error('Protected app areas dropped by more than 10%:')
for (const failure of failures) {
  console.error(
    `- ${failure.scope}: baseline=${failure.baselineCount}, current=${failure.currentCount}, ` +
      `drop=${failure.drop} (${formatPercent(failure.dropRatio)})`,
  )
}

if (process.env.ALLOW_BASELINE_DROP === 'YES') {
  console.error('\nALLOW_BASELINE_DROP=YES set; continuing despite baseline drop.')
  process.exit(0)
}

console.error('\nTo override only during an emergency, set ALLOW_BASELINE_DROP=YES.')
process.exit(1)
