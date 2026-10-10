/**
 * Utilidades compartidas por los scripts de desarrollo.
 *
 * Sólo usa APIs de Bun para no depender de tipos de Node: el proyecto
 * declara `types: ["bun"]` y no instala `@types/node`.
 */

export const ROOT = new URL('..', import.meta.url).pathname

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
