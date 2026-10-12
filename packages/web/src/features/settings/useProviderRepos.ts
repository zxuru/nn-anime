/**
 * Los datos de la sección de repositorios.
 *
 * Se lee al montar y **no** desde `useSettings`: ese hook lo usa el tema en toda
 * la aplicación, así que colgar de él una lectura de repositorios sería pedir la
 * lista de repositorios en cada pantalla.
 *
 * Después de cada cambio se relee la lista y se avisa a quien corresponda:
 * activar o quitar carga o descarga proveedores, y la lista de proveedores de
 * arriba tiene que enterarse. Lo que se enseña es lo que el servidor dice que
 * quedó —un archivo del repositorio puede estar rechazado— y no lo que se pidió.
 */

import type { ProviderRepoView } from '@nn-anime/core/api'
import { providerReposResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, send } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

export interface ProviderReposData {
  readonly state: 'loading' | 'ready' | 'error'
  readonly repos: readonly ProviderRepoView[]
  readonly error: Fallo | undefined
  /** Descarga un repositorio o lo vuelve a descargar. Lanza si no se pudo. */
  readonly install: (url: string) => Promise<void>
  /** Guarda qué archivos del repositorio se activan. Lanza si no se pudo. */
  readonly select: (url: string, enabled: readonly string[]) => Promise<void>
  /** Quita el repositorio, su copia y sus proveedores. Lanza si no se pudo. */
  readonly remove: (url: string) => Promise<void>
}

export function useProviderRepos(onChanged: () => void): ProviderReposData {
  const [repos, setRepos] = useState<readonly ProviderRepoView[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  const [lectura, setLectura] = useState(0)

  // El contador `lectura` es el disparador de la relectura y no un dato que el
  // efecto lea: por eso no aparece dentro, y por eso la supresión.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lectura` dispara la relectura
  useEffect(() => {
    let vivo = true

    void apiGet('/api/provider-repos', providerReposResponseSchema).then(
      (salida) => {
        if (!vivo) return

        setRepos(salida.repos)
        setState('ready')
      },
      (cause: unknown) => {
        if (!vivo) return

        setError(describirFallo(cause))
        setState('error')
      },
    )

    return () => {
      vivo = false
    }
  }, [lectura])

  const despues = useCallback(() => {
    setLectura((actual) => actual + 1)
    onChanged()
  }, [onChanged])

  const install = useCallback(
    async (url: string): Promise<void> => {
      await send('/api/provider-repos', { method: 'POST', body: { url } })
      despues()
    },
    [despues],
  )

  const select = useCallback(
    async (url: string, enabled: readonly string[]): Promise<void> => {
      await send('/api/provider-repos', { method: 'PATCH', body: { url, enabled } })
      despues()
    },
    [despues],
  )

  const remove = useCallback(
    async (url: string): Promise<void> => {
      await send(`/api/provider-repos?url=${encodeURIComponent(url)}`, { method: 'DELETE' })
      despues()
    },
    [despues],
  )

  return { state, repos, error, install, select, remove }
}
