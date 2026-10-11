/**
 * El título destacado de la home.
 *
 * Es el primero del ranking, y para pintarlo hacen falta tres cosas que el
 * ranking no trae: la sinopsis, los estudios y **la referencia del primer
 * episodio**, que es la que permite que el botón reproduzca en vez de llevar a
 * otra pantalla. Se piden al detalle y a los episodios del título, que es lo que
 * hace la pantalla de detalle.
 *
 * Si algo de eso falla, el destacado se pinta con lo que haya: el título y la
 * portada bastan para que la home no se quede sin su primera fila.
 */

import { animeResponseSchema, episodesResponseSchema } from '@nn-anime/core/api'
import type { AnimeDetail, Episode } from '@nn-anime/core/models'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'

export interface Featured {
  readonly loading: boolean
  readonly detail: AnimeDetail | undefined
  readonly firstEpisode: Episode | undefined
}

const VACIO: Featured = { loading: true, detail: undefined, firstEpisode: undefined }

export function useFeatured(
  ref: { readonly providerId: string; readonly value: string } | undefined,
): Featured {
  const [estado, setEstado] = useState<Featured>(VACIO)
  const providerId = ref?.providerId
  const value = ref?.value

  useEffect(() => {
    if (providerId === undefined || value === undefined) {
      setEstado({ loading: false, detail: undefined, firstEpisode: undefined })

      return
    }

    let vivo = true
    const controller = new AbortController()
    const opciones = { signal: controller.signal }
    const ruta = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(value)}`

    void Promise.allSettled([
      apiGet(ruta, animeResponseSchema, opciones),
      apiGet(`${ruta}/episodes`, episodesResponseSchema, opciones),
    ]).then(([detalle, episodios]) => {
      if (!vivo) return

      setEstado({
        loading: false,
        detail: detalle.status === 'fulfilled' ? detalle.value : undefined,
        firstEpisode: episodios.status === 'fulfilled' ? episodios.value.episodes[0] : undefined,
      })
    })

    return () => {
      vivo = false
      controller.abort()
    }
  }, [providerId, value])

  return estado
}
