/**
 * La lista de descargas y sus acciones.
 *
 * La página no habla con la API a mano: pide el estado y ejecuta acciones contra
 * este hook. Mientras hay algo en cola o bajando, se refresca cada dos segundos;
 * cuando todo está quieto, se para. Sin eso, una descarga completa dejaría una
 * petición cada dos segundos para siempre.
 */

import {
  type DownloadItem,
  type DownloadsSpace,
  downloadCleanupResponseSchema,
  downloadStartResponseSchema,
  downloadsResponseSchema,
  downloadsSpaceSchema,
} from '@nn-anime/core/api'
import type { ProviderRef } from '@nn-anime/core/models'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPostJson, send } from '../../api/client'

const POLL_MS = 2_000

export type Descarga = DownloadItem

export interface DownloadsState {
  readonly items: readonly Descarga[]
  readonly space: DownloadsSpace | undefined
  readonly loading: boolean
  readonly error: string | undefined
  readonly refresh: () => Promise<void>
  readonly add: (input: {
    providerId: string
    animeRef: ProviderRef
    episodeRef: ProviderRef
  }) => Promise<void>
  readonly pause: (id: number) => Promise<void>
  readonly resume: (id: number) => Promise<void>
  readonly remove: (id: number) => Promise<void>
  /** Borra de una vez todas las descargas completas. */
  readonly cleanup: () => Promise<number>
}

async function pedirLista(): Promise<readonly Descarga[]> {
  const respuesta = await apiGet('/api/downloads', downloadsResponseSchema)

  return respuesta.items
}

export function useDownloads(): DownloadsState {
  const [items, setItems] = useState<readonly Descarga[]>([])
  const [space, setSpace] = useState<DownloadsSpace | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const vivo = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const [lista, espacio] = await Promise.all([
        pedirLista(),
        apiGet('/api/downloads/space', downloadsSpaceSchema).catch(() => undefined),
      ])
      if (!vivo.current) return
      setItems(lista)
      setSpace(espacio)
      setError(undefined)
    } catch (cause) {
      if (!vivo.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (vivo.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    vivo.current = true
    void refresh()

    return () => {
      vivo.current = false
    }
  }, [refresh])

  const activas = items.some((item) => item.status === 'queued' || item.status === 'downloading')

  useEffect(() => {
    if (!activas) return undefined

    const temporizador = setInterval(() => {
      void refresh()
    }, POLL_MS)

    return () => {
      clearInterval(temporizador)
    }
  }, [activas, refresh])

  const accion = useCallback(
    async (ruta: string, method: 'POST' | 'DELETE') => {
      await send(ruta, { method })
      await refresh()
    },
    [refresh],
  )

  const add = useCallback(
    async (input: { providerId: string; animeRef: ProviderRef; episodeRef: ProviderRef }) => {
      await apiPostJson('/api/downloads', input, downloadStartResponseSchema)
      await refresh()
    },
    [refresh],
  )

  const cleanup = useCallback(async () => {
    const respuesta = await apiPostJson(
      '/api/downloads/cleanup',
      undefined,
      downloadCleanupResponseSchema,
    )
    await refresh()

    return respuesta.removed
  }, [refresh])

  return {
    items,
    space,
    loading,
    error,
    refresh,
    add,
    pause: (id) => accion(`/api/downloads/${id}/pause`, 'POST'),
    resume: (id) => accion(`/api/downloads/${id}/resume`, 'POST'),
    remove: (id) => accion(`/api/downloads/${id}`, 'DELETE'),
    cleanup,
  }
}
