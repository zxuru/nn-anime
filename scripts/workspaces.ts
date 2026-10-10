/**
 * Utilidades compartidas por los scripts de desarrollo.
 */

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

/** Lista los workspaces declarados en `packages/`, ordenados por nombre. */
export async function listWorkspaces(): Promise<readonly Workspace[]> {
  const glob = new Bun.Glob('packages/*/package.json')
  const found: Workspace[] = []

  for await (const relative of glob.scan({ cwd: ROOT })) {
    const dir = ROOT + relative.slice(0, relative.lastIndexOf('/'))
    const raw: unknown = JSON.parse(await Bun.file(ROOT + relative).text())
    if (!isRecord(raw)) continue

    const declared = raw.name
    const name = typeof declared === 'string' ? declared : dir.slice(dir.lastIndexOf('/') + 1)
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
