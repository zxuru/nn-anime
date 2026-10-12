/**
 * Los repositorios instalados: dónde vive la copia y qué está habilitado.
 *
 * Dos cosas que parecen una y son dos: la **ficha** del repositorio —su
 * dirección, su referencia, cuándo se trajo y qué archivos marcó el usuario— vive
 * en la tabla de ajustes, y el **contenido** vive en la carpeta de datos. La ficha
 * es la que manda: si alguien borra la carpeta a mano, el repositorio sigue
 * instalado y la interfaz puede decir que le falta el contenido, que es más útil
 * que hacerlo desaparecer.
 *
 * **Cada descarga estrena carpeta.** El contenido de un repositorio se guarda en
 * `<dataDir>/repos/<owner>__<repo>/<marca>/`, donde la marca sale de `fetchedAt`.
 * No es decoración: Bun cachea los módulos por URL, así que actualizar un
 * repositorio sobre la misma ruta volvería a importar el **código viejo** y el
 * usuario vería que actualizó y no cambió nada. Con una carpeta nueva, cada
 * archivo es una URL nueva y el módulo se carga de verdad; los imports entre
 * archivos del repositorio quedan dentro de la carpeta nueva, así que también se
 * recargan. El precio es que la versión anterior sigue en memoria hasta que el
 * proceso muere, y se paga a gusto: una actualización por acción del usuario.
 */

import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CatalogStore } from '@nn-anime/catalog-store'
import { type ProviderRepoRecord, providerRepoRecordSchema } from '@nn-anime/core'
import { type ProviderCandidate, scanProviderSources } from '@nn-anime/provider-sdk'
import { z } from 'zod'
import { confine } from './github'

/** La clave de la tabla de ajustes donde vive la lista de repositorios. */
export const PROVIDER_REPOS_KEY = 'providerRepos'

/**
 * Cuántos repositorios puede tener instalados el usuario.
 *
 * Es un tope de la tabla de ajustes, que es texto libre: sin él, cada petición
 * haría crecer una fila. Con 32 repositorios de proveedores hay más fuentes de
 * las que nadie usa.
 */
export const MAX_PROVIDER_REPOS = 32

const recordsSchema = z.array(providerRepoRecordSchema).max(MAX_PROVIDER_REPOS)

/** La carpeta donde viven todos los repositorios descargados. */
export function reposRoot(dataDir: string): string {
  return join(resolve(dataDir), 'repos')
}

/**
 * La marca de una descarga, como nombre de carpeta.
 *
 * Los dos puntos de una fecha ISO no son un nombre de archivo en Windows, así que
 * se cambian por guiones. La marca tiene que ser **distinta en cada descarga**:
 * es lo que hace que el módulo se vuelva a importar.
 */
export function stampOf(fetchedAt: string): string {
  return fetchedAt.replace(/[:.]/g, '-')
}

/** La carpeta de un repositorio, sin la marca: para borrarlo entero. */
export function repoHomeOf(
  dataDir: string,
  record: Pick<ProviderRepoRecord, 'owner' | 'repo'>,
): string {
  return join(reposRoot(dataDir), `${record.owner}__${record.repo}`)
}

/** La carpeta de **esta** descarga del repositorio. */
export function repoDirOf(
  dataDir: string,
  record: Pick<ProviderRepoRecord, 'owner' | 'repo' | 'fetchedAt'>,
): string {
  return join(repoHomeOf(dataDir, record), stampOf(record.fetchedAt))
}

/** La ruta de la próxima descarga, que todavía no tiene ficha. */
export function incomingRepoDir(
  dataDir: string,
  owner: string,
  repo: string,
  fetchedAt: string,
): string {
  return repoDirOf(dataDir, { owner, repo, fetchedAt })
}

/** ¿Hay algo en esta ruta? Un `ENOENT` es un no; cualquier otra cosa, un sí. */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

/** La lista guardada. Una fila con otra forma devuelve la lista vacía. */
export async function listRepoRecords(store: CatalogStore): Promise<readonly ProviderRepoRecord[]> {
  return store.getSetting(PROVIDER_REPOS_KEY, recordsSchema, [])
}

export async function saveRepoRecords(
  store: CatalogStore,
  records: readonly ProviderRepoRecord[],
): Promise<void> {
  await store.setSetting(PROVIDER_REPOS_KEY, records)
}

/**
 * La oferta de un repositorio, leída del disco en el momento.
 *
 * Las rutas que devuelve son **relativas a la raíz del repositorio**, también
 * cuando la dirección apunta a una subcarpeta: es la forma en la que se guardan
 * habilitadas, y tener dos formas de nombrar el mismo archivo sería la manera de
 * que una habilitación apunte a un archivo y el catálogo a otro.
 */
export async function candidatesOf(
  record: ProviderRepoRecord,
  dataDir: string,
): Promise<readonly ProviderCandidate[]> {
  const dir = repoDirOf(dataDir, record)
  const root = record.subdir === undefined ? dir : join(dir, record.subdir)

  if (!(await exists(root))) return []

  const scan = await scanProviderSources(root)
  const prefix = record.subdir === undefined ? '' : `${record.subdir}/`

  return scan.candidates.map((candidate) => ({ ...candidate, path: `${prefix}${candidate.path}` }))
}

/**
 * Los archivos que hay que cargar: la única definición de «qué está habilitado».
 *
 * Se comprueban dos cosas por ruta, y las dos importan. Que el archivo exista,
 * porque una carpeta borrada a mano no puede impedir que la aplicación arranque.
 * Y que esté **dentro** del repositorio: `enabled` es una fila de la tabla de
 * ajustes, y una fila editada a mano no puede hacer que se importe lo que hay al
 * lado.
 */
export async function enabledProviderFiles(
  store: CatalogStore,
  dataDir: string,
): Promise<readonly string[]> {
  const records = await listRepoRecords(store)
  const files = new Set<string>()

  for (const record of records) {
    const dir = repoDirOf(dataDir, record)

    for (const path of record.enabled) {
      const full = confine(dir, path)
      if (full === undefined) continue
      if (!(await exists(full))) continue

      files.add(full)
    }
  }

  return [...files].sort()
}
