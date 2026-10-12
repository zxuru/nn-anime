/**
 * Qué proveedores ofrece un repositorio, **sin ejecutarlo**.
 *
 * La diferencia con `loader.ts` es toda la seguridad de este módulo: el loader
 * importa el archivo, y este escaneo lo lee. Se puede ofrecer la lista de un
 * repositorio recién descargado antes de que el usuario decida nada, y esa lista
 * es la que se marca casilla a casilla; hasta que no se marca una, no se importa
 * ni un archivo.
 *
 * Lo que se mira es el **texto**: las formas de exportar que el contrato admite
 * —`export default`, `export const providers`, `export { … as default }`,
 * `module.exports =`— y, como pista para la pantalla, el primer `id` y el primer
 * `name` escritos como literal. Una pista no es una promesa: el nombre de verdad
 * lo dice el plugin cuando se carga, y por eso el schema del contrato los lleva
 * opcionales.
 *
 * Tres decisiones sobre qué se deja fuera, y las tres son el mismo criterio
 * —ofrecer lo que el repositorio publica, no lo que usa para probarse—:
 *
 * 1. **Los directorios y archivos de trabajo y de pruebas.** `node_modules`,
 *    `dist`, `test`, `__fixtures__`, `*.test.ts`… Un repo con veinte proveedores
 *    tiene cincuenta archivos de prueba que exportan proveedores de mentira, y
 *    ofrecerlos como la oferta del repo sería mentir en la única pantalla donde
 *    el usuario decide qué ejecutar.
 * 2. **Lo oculto.** Un directorio o un archivo que empieza por punto no es de la
 *    oferta: `.git`, `.github`, `.env.example`.
 * 3. **Los enlaces simbólicos.** Sólo se leen archivos regulares. Un enlace puede
 *    apuntar fuera del repositorio, y lo que entra en la lista tiene que ser algo
 *    que el repositorio contiene.
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { MAX_REPO_CANDIDATES } from '@nn-anime/core'
import { PLUGIN_EXTENSIONS } from './loader'

/** Directorios que no forman parte de lo que el repositorio publica. */
export const SCAN_SKIPPED_DIRECTORIES: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test',
  'tests',
  '__tests__',
  '__fixtures__',
  'e2e',
]

/** Un archivo de pruebas no es un proveedor aunque exporte uno. */
const TEST_FILE_RE = /\.(test|spec|e2e)\.[^.]+$/

/** Hasta dónde se baja. Un repo de proveedores no anida doce carpetas. */
export const SCAN_MAX_DEPTH = 12

/** Lo que se lee de un archivo para mirarlo. Por encima, no se mira. */
export const SCAN_MAX_FILE_BYTES = 1024 * 1024

/** Cuántos archivos se inspeccionan antes de decir que no se siguió. */
export const SCAN_MAX_FILES = 400

/** Cuántos archivos que no declaran nada se enumeran. Es informativo. */
export const SCAN_MAX_IGNORED = 50

export interface ProviderCandidate {
  /** Ruta dentro de la raíz escaneada, siempre con `/` como separador. */
  readonly path: string
  /** El `id` del primer literal del texto. Pista, no contrato. */
  readonly id?: string
  /** El nombre del primer literal del texto. Pista, no contrato. */
  readonly name?: string
}

export interface ScanResult {
  readonly candidates: readonly ProviderCandidate[]
  /** Archivos de extensión de plugin que no declaran ninguno. */
  readonly ignored: readonly string[]
  /** Se dejó algo fuera por los topes, y quien llame tiene que poder decirlo. */
  readonly truncated: boolean
}

export interface ScanOptions {
  readonly maxFiles?: number
  readonly maxCandidates?: number
  readonly maxBytesPerFile?: number
  readonly maxIgnored?: number
  readonly maxDepth?: number
}

interface Limits {
  readonly maxFiles: number
  readonly maxCandidates: number
  readonly maxBytesPerFile: number
  readonly maxIgnored: number
  readonly maxDepth: number
}

/**
 * Las formas de exportar que el contrato admite, en texto.
 *
 * `export default` y `export const providers` son las dos del spec; las otras dos
 * son las maneras de escribir lo mismo que también funcionan al importarlas —una
 * cláusula `export { x as default }` y un `module.exports`—, y dejaras fuera
 * ofrecería una lista incompleta sin decirlo.
 */
const DECLARATIONS: readonly RegExp[] = [
  /(^|\n)\s*export\s+default\b/,
  /(^|\n)\s*export\s+(?:const|let|var|function|class)\s+providers\b/,
  /(^|\n)\s*module\.exports\s*=/,
]

/** Una cláusula `export { … }` con `providers` o con `as default` dentro. */
const NAMED_EXPORT_RE = /export\s*\{([^}]*)\}/g
const NAMED_PROVIDERS_RE = /(^|[\s,{])providers\s*(,|\}|$)/
const NAMED_DEFAULT_RE = /\bas\s+default\b/

/**
 * El primer literal de un `id` o un `name`.
 *
 * El `const ID = '…'` es el respaldo: es la forma que usa el generador de Ajustes
 * —una constante y luego `id: ID`—, y sin él los plugins escritos desde la propia
 * aplicación saldrían en la lista sin nombre.
 */
const ID_HINT_RE = /\bid\s*:\s*['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/
const ID_CONST_RE = /\b(?:const|let|var)\s+ID\s*=\s*['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/
const NAME_HINT_RE = /\bname\s*:\s*['"]([^'"\n]{1,120})['"]/
const NAME_CONST_RE = /\b(?:const|let|var)\s+NAME\s*=\s*['"]([^'"\n]{1,120})['"]/

function firstGroup(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1]
}

/** ¿Este texto declara un proveedor? Se mira, no se ejecuta. */
export function declaresProvider(text: string): boolean {
  if (DECLARATIONS.some((pattern) => pattern.test(text))) return true

  for (const match of text.matchAll(NAMED_EXPORT_RE)) {
    const clause = match[1] ?? ''
    if (NAMED_PROVIDERS_RE.test(clause) || NAMED_DEFAULT_RE.test(clause)) return true
  }

  return false
}

/** Las pistas de identidad que el texto deja ver. */
export function candidateHints(text: string): { id?: string; name?: string } {
  const id = firstGroup(text, ID_HINT_RE) ?? firstGroup(text, ID_CONST_RE)
  const name = firstGroup(text, NAME_HINT_RE) ?? firstGroup(text, NAME_CONST_RE)

  return { ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }) }
}

function isPluginFile(name: string): boolean {
  return PLUGIN_EXTENSIONS.some((extension) => name.endsWith(extension))
}

/** La ruta relativa con `/`, también en Windows, que es donde esto se rompe. */
function posixPath(root: string, file: string): string {
  return relative(root, file).split('\\').join('/')
}

/**
 * Los archivos de extensión de plugin del árbol, en orden de ruta.
 *
 * El orden lo fija el `sort` final y no el sistema de archivos: el mismo repo
 * tiene que ofrecer la misma lista en dos ejecuciones distintas, y el orden de
 * `readdir` no es alfabético ni estable.
 */
async function pluginFilesIn(
  root: string,
  limits: Limits,
): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  const files: string[] = []
  let truncated = false

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > limits.maxDepth) {
      truncated = true
      return
    }

    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      // Un directorio ilegible no rompe el escaneo: se sigue con lo demás, que
      // es lo mismo que hace el loader con un plugin que no se puede importar.
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const full = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (SCAN_SKIPPED_DIRECTORIES.includes(entry.name)) continue

        await walk(full, depth + 1)
        continue
      }

      // Sólo archivos regulares: un enlace puede apuntar fuera del repositorio.
      if (!entry.isFile()) continue
      if (!isPluginFile(entry.name)) continue
      if (TEST_FILE_RE.test(entry.name)) continue

      if (files.length >= limits.maxFiles) {
        truncated = true
        return
      }

      files.push(full)
    }
  }

  await walk(resolve(root), 0)

  return { files: [...files].sort(), truncated }
}

/**
 * Escanea un árbol y devuelve lo que ofrece.
 *
 * No lanza por un archivo: lo que no se puede leer se cuenta en `ignored`, que es
 * la lista de «mirado y descartado». Un directorio que no existe devuelve un
 * resultado vacío, igual que el loader: no hay nada que ofrecer.
 */
export async function scanProviderSources(
  root: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const limits: Limits = {
    maxFiles: options.maxFiles ?? SCAN_MAX_FILES,
    maxCandidates: options.maxCandidates ?? MAX_REPO_CANDIDATES,
    maxBytesPerFile: options.maxBytesPerFile ?? SCAN_MAX_FILE_BYTES,
    maxIgnored: options.maxIgnored ?? SCAN_MAX_IGNORED,
    maxDepth: options.maxDepth ?? SCAN_MAX_DEPTH,
  }

  const base = resolve(root)
  const { files, truncated: walkTruncated } = await pluginFilesIn(base, limits)
  const candidates: ProviderCandidate[] = []
  const ignored: string[] = []
  let truncated = walkTruncated

  for (const file of files) {
    const path = posixPath(base, file)
    const info = await stat(file).catch(() => undefined)

    if (info === undefined || info.size > limits.maxBytesPerFile) {
      if (ignored.length < limits.maxIgnored) ignored.push(path)
      continue
    }

    const text = await readFile(file, 'utf8').catch(() => undefined)
    if (text === undefined || !declaresProvider(text)) {
      if (ignored.length < limits.maxIgnored) ignored.push(path)
      continue
    }

    if (candidates.length >= limits.maxCandidates) {
      truncated = true
      break
    }

    candidates.push({ path, ...candidateHints(text) })
  }

  return { candidates, ignored, truncated }
}
