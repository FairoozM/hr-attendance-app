/**
 * Deploy-time type stripping for the backend artifact.
 *
 * The backend requires its TypeScript modules by their `.ts` path (Node type stripping in
 * development). Production runs a Node without type stripping, whose CommonJS loader still loads an
 * unknown extension as JavaScript. So inside the staged artifact every `.ts` file is replaced by
 * its type-stripped JavaScript under the same name; the source tree is never touched.
 *
 * Usage: node scripts/strip-backend-types.ts <staged backend dir>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { join, relative } from 'node:path'
import { compileFunction } from 'node:vm'

type Strip = (code: string, options: { mode: 'strip' | 'transform' }) => string

const strip = (nodeModule as unknown as { stripTypeScriptTypes?: Strip }).stripTypeScriptTypes
const root = process.argv[2]

if (!root) {
  console.error('Usage: node scripts/strip-backend-types.ts <staged backend dir>')
  process.exit(2)
}
if (typeof strip !== 'function') {
  console.error(`Node ${process.version} has no module.stripTypeScriptTypes; deploy with Node >= 22.13.`)
  process.exit(2)
}

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const files = tsFiles(root)
const failures: string[] = []
for (const file of files) {
  try {
    const js = strip(readFileSync(file, 'utf8'), { mode: 'strip' })
    // Must parse as a plain CommonJS module body, exactly how the production loader will run it.
    compileFunction(js, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: file })
    writeFileSync(file, js)
  } catch (err) {
    failures.push(`${relative(root, file)}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (failures.length) {
  console.error(`Type stripping failed for ${failures.length} file(s):\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`Stripped types from ${files.length} backend .ts file(s).`)
