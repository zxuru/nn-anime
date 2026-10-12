/**
 * Utilidades compartidas por los scripts de desarrollo.
 */

import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Convierte la URL de un módulo en el directorio que lo contiene.
 *
 * No se puede usar `new URL(...).pathname` a secas: devuelve la ruta
 * percent-encoded, así que un directorio con un espacio se convierte en `%20` y
 * la ruta deja de existir. `fileURLToPath` es lo que descodifica.
 */
export function dirOfModule(moduleUrl: string): string {
  return fileURLToPath(new URL('..', moduleUrl))
}

export const ROOT = dirOfModule(import.meta.url)

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface Workspace {
  /** Nombre completo del paquete, por ejemplo `@nn-anime/core`. */
  readonly name: string
  /** Ruta absoluta al directorio del paquete, sin barra final. */
  readonly dir: string
  readonly manifest: Record<string, unknown>
}

/**
 * Lista los workspaces declarados en `packages/`, ordenados por nombre.
 *
 * Las rutas se arman con `node:path` y no cortando la cadena por `/`. `Bun.Glob`
 * devuelve el separador de la plataforma —en Windows, `packages\web\package.json`—
 * así que `lastIndexOf('/')` no encontraba nada y el `dir` salía del tamaño
 * entero del archivo menos uno. No se notaba al listar, porque el nombre se lee
 * del manifiesto; sí al usar `dir` como `cwd`, que es lo que hace `bun run
 * build`: `Bun.spawn` fallaba con `ENOENT` y el mensaje hablaba del proceso, no
 * de la ruta inventada.
 */
export async function listWorkspaces(): Promise<readonly Workspace[]> {
  const glob = new Bun.Glob('packages/*/package.json')
  const found: Workspace[] = []

  for await (const relative of glob.scan({ cwd: ROOT })) {
    const manifestPath = join(ROOT, relative)
    const dir = dirname(manifestPath)
    const raw: unknown = JSON.parse(await Bun.file(manifestPath).text())
    if (!isRecord(raw)) continue

    const declared = raw.name
    const name = typeof declared === 'string' ? declared : basename(dir)
    found.push({ name, dir, manifest: raw })
  }

  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/** Devuelve el comando del script indicado, o `undefined` si el paquete no lo declara. */
export function scriptOf(workspace: Workspace, script: string): string | undefined {
  const scripts = workspace.manifest.scripts
  if (!isRecord(scripts)) return undefined

  const command = scripts[script]
  return typeof command === 'string' ? command : undefined
}
