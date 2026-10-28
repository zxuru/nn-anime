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
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ProviderRef } from '@nn-anime/core/models'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPatch, apiPostJson, send } from '../../api/client'
import { t } from '../../i18n'

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
  /** Cambia la carpeta de destino. Lanza si el servidor la rechaza. */
  readonly setDir: (path: string) => Promise<void>
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

  /**
   * El aviso de «ya está», sin abrir otra superficie.
   *
   * Se usa la notificación del navegador —el webview del escritorio la soporta—
   * y sólo si el permiso ya se concedió. Pedirlo aquí, sin un gesto, lo dejaría
   * denegado para siempre; lo pide el botón de descargar, que sí es un gesto.
   */
  const anteriores = useRef(new Map<number, string>())
  useEffect(() => {
    const vistas = anteriores.current
    for (const item of items) {
      const antes = vistas.get(item.id)
      if (antes !== undefined && antes !== 'complete' && item.status === 'complete') {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(t(DEFAULT_LOCALE, 'downloads.notifyTitle'), {
            body: t(DEFAULT_LOCALE, 'downloads.notifyBody', { title: item.title }),
          })
        }
      }
      vistas.set(item.id, item.status)
    }
  }, [items])

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

  const setDir = useCallback(
    async (path: string) => {
      await apiPatch('/api/downloads/dir', { path })
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
    setDir,
    cleanup,
  }
}
