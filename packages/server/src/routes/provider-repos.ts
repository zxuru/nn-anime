/**
 * Las rutas de los repositorios de proveedores.
 *
 * Cuatro: listar, instalar o actualizar, elegir qué se activa y quitar. La
 * decisión que las recorre todas es que **descargar y ejecutar son dos momentos
 * distintos**. Instalar baja el contenido y lo escanea —leer texto no ejecuta
 * nada—, y no habilita ni un archivo; habilitar es el `PATCH`, y es el único
 * momento en que un archivo del repositorio se importa. Por eso el `PATCH` sólo
 * acepta rutas que el escáner reconoció: lo que no está en el catálogo de
 * candidatos no se puede marcar, y lo que no se puede marcar no se ejecuta.
 *
 * Dos cosas que hace la ruta y conviene ver aquí:
 *
 * 1. **Actualizar no pierde la selección.** Al volver a descargar, los archivos
 *    marcados que sigan existiendo se quedan marcados y los que ya no están
 *    desaparecen de la lista. Es lo que el usuario espera de «actualizar», y lo
 *    contrario obligaría a recordar qué tenía marcado.
 * 2. **La copia vieja se borra después de guardar la nueva.** Primero se
 *    reemplaza la ficha —que apunta a la carpeta nueva— y sólo entonces se borra
 *    la carpeta anterior: si se borrara antes y la escritura fallara, el
 *    repositorio quedaría sin contenido y sin ficha que lo explique.
 */

import { rm } from 'node:fs/promises'
import {
  errorResponseSchema,
  githubRepoFromUrl,
  type ProviderRepoRecord,
  type ProviderRepoView,
  providerRepoQuerySchema,
  providerRepoRequestSchema,
  providerRepoResponseSchema,
  providerRepoSelectionSchema,
  providerReposResponseSchema,
} from '@nn-anime/core'
import type { FetchLike, Resolver } from '@nn-anime/media-proxy'
import type { Context, Hono } from 'hono'
import type { ServerContainer } from '../container'
import { downloadGithubRepo } from '../github'
import type { ProviderHub } from '../provider-hub'
import {
  candidatesOf,
  exists,
  incomingRepoDir,
  listRepoRecords,
  MAX_PROVIDER_REPOS,
  PROVIDER_REPOS_KEY,
  repoDirOf,
  repoHomeOf,
  saveRepoRecords,
} from '../repo-store'

export interface ProviderReposRouteOptions {
  readonly container: ServerContainer
  readonly hub: ProviderHub
  /** Raíz de la carpeta de datos: ahí se descargan los repositorios. */
  readonly dataDir: string
  /**
   * Modo restringido: sólo se registra el `GET`.
   *
   * La lista sigue siendo legible —es lo que hay instalado—, pero descargar,
   * marcar archivos o quitar un repositorio es ejecutar código de terceros y no
   * se ofrece desde un servidor.
   */
  readonly locked?: boolean | undefined
  /** `fetch` inyectable: las pruebas no salen a la red. */
  readonly fetchImpl?: FetchLike | undefined
  /** Resolutor inyectable: las pruebas no resuelven nombres de verdad. */
  readonly resolver?: Resolver | undefined
  /** Reloj inyectable: la marca de la descarga y `fetchedAt` salen de aquí. */
  readonly now?: (() => number) | undefined
}

/** La clave del ajuste, reexportada para que el arranque no la escriba a mano. */
export { PROVIDER_REPOS_KEY }

function error(message: string): { readonly error: string } {
  return errorResponseSchema.parse({ error: message })
}

/** El cuerpo como JSON, o `undefined` si no lo es. */
async function readJson(c: Context): Promise<unknown | undefined> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

export function registerProviderReposRoutes(app: Hono, options: ProviderReposRouteOptions): void {
  const store = options.container.store
  const dataDir = options.dataDir
  const now = options.now ?? (() => Date.now())

  /** La vista de una ficha: lo guardado más lo que hay ahora en el disco. */
  async function viewOf(record: ProviderRepoRecord): Promise<ProviderRepoView> {
    return {
      ...record,
      candidates: [...(await candidatesOf(record, dataDir))],
      present: await exists(repoDirOf(dataDir, record)),
    }
  }

  /** Recarga el registro vivo. Un fallo se cuenta, no se traga. */
  async function reload(): Promise<string | undefined> {
    try {
      await options.hub.reload()

      return undefined
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }

  app.get('/api/provider-repos', async (c) => {
    const records = await listRepoRecords(store)
    const repos = await Promise.all(records.map((record) => viewOf(record)))

    // Lleva rutas del disco del usuario, como los ajustes: no se cachea.
    c.header('cache-control', 'no-store')

    return c.json(providerReposResponseSchema.parse({ repos }))
  })

  if (options.locked === true) return

  app.post('/api/provider-repos', async (c) => {
    const crudo = await readJson(c)
    if (crudo === undefined) return c.json(error('el cuerpo no es JSON válido'), 400)

    const parsed = providerRepoRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(error(`dirección inválida: ${parsed.error.message}`), 400)
    }

    const location = githubRepoFromUrl(parsed.data.url)
    if (location === undefined) {
      return c.json(error(`no es una dirección de repositorio de GitHub: ${parsed.data.url}`), 400)
    }

    const records = await listRepoRecords(store)
    const previous = records.find((record) => record.url === location.url)

    if (previous === undefined && records.length >= MAX_PROVIDER_REPOS) {
      return c.json(error(`ya hay ${MAX_PROVIDER_REPOS} repositorios instalados`), 400)
    }

    const fetchedAt = new Date(now()).toISOString()
    const destination = incomingRepoDir(dataDir, location.owner, location.repo, fetchedAt)
    const downloaded = await downloadGithubRepo({
      location,
      destination,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      signal: c.req.raw.signal,
    })

    if (!downloaded.ok) return c.json(error(downloaded.error.message), 502)

    const record: ProviderRepoRecord = {
      url: location.url,
      owner: location.owner,
      repo: location.repo,
      ref: downloaded.ref,
      ...(location.subdir === undefined ? {} : { subdir: location.subdir }),
      fetchedAt,
      // La selección que sigue teniendo sentido: lo marcado que aún existe.
      enabled: [],
      files: downloaded.files.length,
    }

    const candidates = await candidatesOf(record, dataDir)
    const available = new Set(candidates.map((candidate) => candidate.path))
    const kept = (previous?.enabled ?? []).filter((path) => available.has(path))
    const updated: ProviderRepoRecord = { ...record, enabled: kept }

    await saveRepoRecords(store, [
      ...records.filter((existing) => existing.url !== updated.url),
      updated,
    ])

    const failure = await reload()
    if (failure !== undefined) {
      return c.json(error(`el repositorio se instaló y no se pudo cargar: ${failure}`), 500)
    }

    // La copia anterior se borra cuando la nueva ya está en su sitio y guardada.
    if (previous !== undefined && previous.fetchedAt !== updated.fetchedAt) {
      await rm(repoDirOf(dataDir, previous), { recursive: true, force: true }).catch(() => {})
    }

    return c.json(
      providerRepoResponseSchema.parse({ repo: await viewOf(updated) }),
      previous === undefined ? 201 : 200,
    )
  })

  app.patch('/api/provider-repos', async (c) => {
    const crudo = await readJson(c)
    if (crudo === undefined) return c.json(error('el cuerpo no es JSON válido'), 400)

    const parsed = providerRepoSelectionSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(error(`selección inválida: ${parsed.error.message}`), 400)
    }

    const location = githubRepoFromUrl(parsed.data.url)
    if (location === undefined) {
      return c.json(error(`no es una dirección de repositorio de GitHub: ${parsed.data.url}`), 400)
    }

    const records = await listRepoRecords(store)
    const record = records.find((existing) => existing.url === location.url)
    if (record === undefined) {
      return c.json(error(`no hay ningún repositorio instalado en ${location.url}`), 404)
    }

    // Sólo se puede marcar lo que el escáner reconoció. Es la puerta que hace que
    // habilitar sea elegir de una lista y no escribir una ruta que se importa.
    const available = new Set((await candidatesOf(record, dataDir)).map((it) => it.path))
    const ajenas = parsed.data.enabled.filter((path) => !available.has(path))
    if (ajenas.length > 0) {
      return c.json(
        error(`estos archivos no son proveedores del repositorio: ${ajenas.join(', ')}`),
        400,
      )
    }

    const updated: ProviderRepoRecord = { ...record, enabled: [...new Set(parsed.data.enabled)] }
    await saveRepoRecords(
      store,
      records.map((existing) => (existing.url === updated.url ? updated : existing)),
    )

    const failure = await reload()
    if (failure !== undefined) {
      return c.json(error(`la selección se guardó y no se pudo cargar: ${failure}`), 500)
    }

    return c.json(providerRepoResponseSchema.parse({ repo: await viewOf(updated) }))
  })

  app.delete('/api/provider-repos', async (c) => {
    const parsed = providerRepoQuerySchema.safeParse({ url: c.req.query('url') })
    if (!parsed.success) {
      return c.json(error(`dirección inválida: ${parsed.error.message}`), 400)
    }

    const location = githubRepoFromUrl(parsed.data.url)
    if (location === undefined) {
      return c.json(error(`no es una dirección de repositorio de GitHub: ${parsed.data.url}`), 400)
    }

    const records = await listRepoRecords(store)
    const record = records.find((existing) => existing.url === location.url)
    if (record === undefined) {
      return c.json(error(`no hay ningún repositorio instalado en ${location.url}`), 404)
    }

    // Primero la ficha y después el contenido: si el borrado del disco fallara,
    // el repositorio ya no está instalado y no se carga nada suyo.
    await saveRepoRecords(
      store,
      records.filter((existing) => existing.url !== record.url),
    )
    await rm(repoHomeOf(dataDir, record), { recursive: true, force: true }).catch(() => {})

    const failure = await reload()
    if (failure !== undefined) {
      return c.json(error(`el repositorio se quitó y no se pudo recargar: ${failure}`), 500)
    }

    return c.body(null, 204)
  })
}
