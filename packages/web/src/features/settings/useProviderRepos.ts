/**
 * Los datos de la sección de repositorios.
 *
 * Se lee al montar y **no** desde `useSettings`: ese hook lo lee la raíz para el
 * tema y lo lee esta pantalla, así que colgar de él una lectura de repositorios
 * sería pedir la lista de repositorios en cada pantalla.
 *
 * Después de cada cambio se relee la lista y se avisa a quien corresponda:
 * activar o quitar carga o descarga proveedores, y la lista de proveedores de
 * arriba tiene que enterarse. Lo que se enseña es lo que el servidor dice que
 * quedó —un archivo del repositorio puede estar rechazado— y no lo que se pidió.
 *
 * El estado vive en un almacén que recibe su `fetch`, como el de los ajustes, y
 * por eso se puede probar sin DOM: las pruebas miran qué se pide, en qué orden y
 * qué queda cuando el servidor contesta o cuando no. El gancho sólo conecta ese
 * almacén a React.
 */

import type { ProviderRepoView } from '@rona/core/api'
import { providerReposResponseSchema } from '@rona/core/api'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiGet, type RequestDeps, send } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

export interface ProviderReposSnapshot {
  readonly state: 'loading' | 'ready' | 'error'
  readonly repos: readonly ProviderRepoView[]
  readonly error: Fallo | undefined
}

export interface ProviderReposData extends ProviderReposSnapshot {
  /** Descarga un repositorio o lo vuelve a descargar. Lanza si no se pudo. */
  readonly install: (url: string) => Promise<void>
  /** Guarda qué archivos del repositorio se activan. Lanza si no se pudo. */
  readonly select: (url: string, enabled: readonly string[]) => Promise<void>
  /** Quita el repositorio, su copia y sus proveedores. Lanza si no se pudo. */
  readonly remove: (url: string) => Promise<void>
}

export interface ProviderReposStore {
  /** El estado actual. La misma referencia mientras no cambie nada. */
  readonly snapshot: () => ProviderReposSnapshot
  readonly subscribe: (oyente: () => void) => () => void
  /** Lee la lista. Es la lectura inicial y la que sigue a cada cambio. */
  readonly load: () => Promise<void>
  readonly install: (url: string) => Promise<void>
  readonly select: (url: string, enabled: readonly string[]) => Promise<void>
  readonly remove: (url: string) => Promise<void>
}

const INICIAL: ProviderReposSnapshot = { state: 'loading', repos: [], error: undefined }

/**
 * El almacén de la sección, con su `fetch` inyectable.
 *
 * Es uno por montaje y no del módulo: la lista es de esta pantalla y nadie más
 * la lee, así que dos montajes no tienen por qué compartirla ni pisarse.
 */
export function createProviderReposStore(
  onChanged: () => void,
  deps?: RequestDeps,
): ProviderReposStore {
  let cache = INICIAL
  const oyentes = new Set<() => void>()

  function publicar(siguiente: ProviderReposSnapshot): void {
    if (siguiente === cache) return

    cache = siguiente

    for (const oyente of [...oyentes]) oyente()
  }

  /*
    Un fallo al releer no borra la lista que ya se tenía: lo que se enseña es de
    antes, pero es lo último que el servidor dijo. El error viaja aparte para que
    la pantalla pueda contarlo en vez de afirmar que no hay repositorios.
  */
  async function leer(): Promise<void> {
    try {
      const salida = await apiGet('/api/provider-repos', providerReposResponseSchema, {}, deps)

      publicar({ state: 'ready', repos: salida.repos, error: undefined })
    } catch (cause) {
      publicar({ state: 'error', repos: cache.repos, error: describirFallo(cause) })
    }
  }

  /*
    Después de una mutación se avisa y se relee. La relectura se espera antes de
    resolver: quien pulsó el botón tiene que recibir «guardado» con la lista que
    el servidor dejó, no con la que tenía mientras la petición iba en camino. Un
    fallo de la relectura no convierte en fallo una mutación que el servidor
    aceptó; queda contado en el estado.
  */
  async function despues(): Promise<void> {
    onChanged()
    await leer()
  }

  return {
    snapshot: () => cache,
    subscribe(oyente) {
      oyentes.add(oyente)

      return () => {
        oyentes.delete(oyente)
      }
    },
    load: leer,
    async install(url) {
      await send('/api/provider-repos', { method: 'POST', body: { url } }, deps)
      await despues()
    },
    async select(url, enabled) {
      await send('/api/provider-repos', { method: 'PATCH', body: { url, enabled } }, deps)
      await despues()
    },
    async remove(url) {
      await send(`/api/provider-repos?url=${encodeURIComponent(url)}`, { method: 'DELETE' }, deps)
      await despues()
    },
  }
}

export function useProviderRepos(onChanged: () => void, deps?: RequestDeps): ProviderReposData {
  // El almacén se crea una vez. El aviso de cambio va por referencia para que
  // una función nueva en cada render no lo recree ni tire la lista ya leída.
  const alCambiar = useRef(onChanged)
  useEffect(() => {
    alCambiar.current = onChanged
  }, [onChanged])

  const [store] = useState(() => createProviderReposStore(() => alCambiar.current(), deps))
  const { snapshot, subscribe, load, install, select, remove } = store

  const vista = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    void load()
  }, [load])

  return { ...vista, install, select, remove }
}
