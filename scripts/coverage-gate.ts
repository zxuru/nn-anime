#!/usr/bin/env bun
/**
 * Puerta de cobertura.
 *
 * `bun test --coverage` informa, pero no falla: el objetivo del 80 % del spec
 * quedaba como aspiración y nadie lo miraba. Esto lo convierte en un comando que
 * sale con 1 cuando no se cumple.
 *
 * Además imprime **los archivos que la medición no ve**. `bun test --coverage`
 * sólo mide los archivos que algún test carga, así que un porcentaje alto puede
 * convivir con puntos de entrada sin ninguna prueba. Un número sin su alcance es
 * una afirmación más firme que la realidad, y este proyecto ya ha pagado varias.
 *
 * Uso: `bun run coverage:gate [objetivo]` con el objetivo entre 0 y 1.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './workspaces'

/** Paquetes con objetivo numérico, según la estrategia de pruebas del spec. */
const MEASURED_PACKAGES: readonly string[] = ['core', 'catalog-store', 'recsys', 'provider-sdk']

const COVERAGE_DIR = `${ROOT}.tmp/coverage`
const LCOV = join(COVERAGE_DIR, 'lcov.info')

interface FileCoverage {
  readonly lines: number
  readonly hit: number
}

function parseLcov(text: string): ReadonlyMap<string, FileCoverage> {
  const files = new Map<string, FileCoverage>()
  let path: string | undefined
  let lines = 0
  let hit = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) path = line.slice(3)
    else if (line.startsWith('LF:')) lines = Number(line.slice(3))
    else if (line.startsWith('LH:')) hit = Number(line.slice(3))
    else if (line === 'end_of_record' && path !== undefined) {
      files.set(path, { lines, hit })
      path = undefined
    }
  }

  return files
}

/** Todos los archivos de código del repositorio, sin tests ni dependencias. */
function sourceFiles(): readonly string[] {
  const found: string[] = []

  for (const dir of ['packages', 'scripts']) {
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
        const path = `${relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(path)
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          found.push(path)
        }
      }
    }
    walk(dir)
  }

  return found.sort()
}

function target(): number {
  const given = Number(Bun.argv[2] ?? '0.8')
  if (!Number.isFinite(given) || given < 0 || given > 1) {
    process.stderr.write(`coverage:gate: objetivo inválido: ${Bun.argv[2]}\n`)
    process.exit(2)
  }

  return given
}

const goal = target()

const runner = Bun.spawn(
  ['bun', 'test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${COVERAGE_DIR}`],
  { cwd: ROOT, stdout: 'ignore', stderr: 'inherit' },
)

const testCode = await runner.exited
if (testCode !== 0) {
  process.stderr.write('coverage:gate: los tests fallaron; no se mide la cobertura\n')
  process.exit(testCode)
}

const coverage = parseLcov(readFileSync(LCOV, 'utf8'))
const measured = new Map<string, FileCoverage>()

for (const [path, data] of coverage) {
  const match = /^packages\/([^/]+)\//.exec(path)
  if (match?.[1] === undefined) continue

  const previous = measured.get(match[1]) ?? { lines: 0, hit: 0 }
  measured.set(match[1], { lines: previous.lines + data.lines, hit: previous.hit + data.hit })
}

let failed = false

process.stdout.write(`objetivo: ${(goal * 100).toFixed(0)} % de líneas por paquete\n\n`)

for (const name of MEASURED_PACKAGES) {
  const data = measured.get(name)
  if (data === undefined || data.lines === 0) {
    process.stdout.write(`  ${name.padEnd(16)} sin código que medir\n`)
    continue
  }

  const ratio = data.hit / data.lines
  const ok = ratio >= goal
  if (!ok) failed = true

  process.stdout.write(
    `  ${name.padEnd(16)} ${(ratio * 100).toFixed(2).padStart(6)} %  ${ok ? 'ok' : 'POR DEBAJO'}\n`,
  )
}

const seen = new Set([...coverage.keys()].map((path) => path.replace(/^\.\//, '')))
const unseen = sourceFiles().filter((path) => !seen.has(path))

process.stdout.write(`\narchivos de código que ningún test carga: ${unseen.length}\n`)
for (const path of unseen) process.stdout.write(`  ${path}\n`)

if (failed) {
  process.stderr.write('\ncoverage:gate: hay paquetes por debajo del objetivo\n')
  process.exit(1)
}

process.stdout.write('\ncoverage:gate: objetivo cumplido\n')
