import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const baselinePath = path.join(__dirname, 'full-app-baseline.json')

const protectedDirectories = [
  'src/pages',
  'src/components',
  'src/contexts',
  'src/lib',
  'src/utils',
  'backend/src',
]

function git(args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

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

const filesByDirectory = Object.fromEntries(
  protectedDirectories.map((directory) => [directory, listFiles(directory)]),
)
const countsByDirectory = Object.fromEntries(
  protectedDirectories.map((directory) => [directory, filesByDirectory[directory].length]),
)
const totalCount = Object.values(countsByDirectory).reduce((sum, count) => sum + count, 0)

const baseline = {
  generatedAt: new Date().toISOString(),
  branch: git(['branch', '--show-current']),
  commit: git(['rev-parse', 'HEAD']),
  commitMessage: git(['log', '-1', '--pretty=%s']),
  countsByDirectory,
  totalCount,
  filesByDirectory,
}

mkdirSync(path.dirname(baselinePath), { recursive: true })
writeFileSync(`${baselinePath}\n`.trim(), `${JSON.stringify(baseline, null, 2)}\n`)

console.log(`Generated ${path.relative(rootDir, baselinePath)}`)
console.log(`Baseline total files: ${totalCount}`)
for (const [directory, count] of Object.entries(countsByDirectory)) {
  console.log(`${directory}: ${count}`)
}
