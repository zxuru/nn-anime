/**
 * El título destacado de la home.
 *
 * Es el primero del ranking, y para pintarlo hacen falta tres cosas que el
 * ranking no trae: la sinopsis, los estudios y **la referencia del primer
 * episodio**, que es la que permite que el botón reproduzca en vez de llevar a
 * otra pantalla. Se piden al detalle y a los episodios del título, que es lo que
 * hace la pantalla de detalle.
 *
 * La cuarta —el **banner** de AniList, para el campo de la marquesina— va por su
 * cuenta y no retrasa nada: es adorno de la vitrina, viaja en el enriquecimiento y
 * una obra sin emparejar no lo tiene. Si se pidiera con las otras dos, un tercero
 * lento dejaría la ficha —y con ella la sinopsis y el botón— esperando por una
 * imagen.
 *
 * Si algo de eso falla, el destacado se pinta con lo que haya: el título y la
 * portada bastan para que la home no se quede sin su primera fila.
 */

import {
  animeResponseSchema,
  enrichmentResponseSchema,
  episodesResponseSchema,
} from '@nn-anime/core/api'
import type { AnimeDetail, Episode } from '@nn-anime/core/models'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'

export interface Featured {
  readonly loading: boolean
  readonly detail: AnimeDetail | undefined
  readonly firstEpisode: Episode | undefined
  /** El banner de AniList de la obra, si está emparejada. `undefined` es «no hay». */
  readonly banner: string | undefined
}

const VACIO: Featured = {
  loading: true,
  detail: undefined,
  firstEpisode: undefined,
  banner: undefined,
}

export function useFeatured(
  ref: { readonly providerId: string; readonly value: string } | undefined,
): Featured {
  const [estado, setEstado] = useState<Featured>(VACIO)
  const providerId = ref?.providerId
  const value = ref?.value

  useEffect(() => {
    if (providerId === undefined || value === undefined) {
      setEstado({ loading: false, detail: undefined, firstEpisode: undefined, banner: undefined })

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

      // Actualización sobre lo que ya hay: el banner puede haber llegado antes y
      // este `setEstado` no tiene por qué llevárselo por delante.
      setEstado((previo) => ({
        ...previo,
        loading: false,
        detail: detalle.status === 'fulfilled' ? detalle.value : undefined,
        firstEpisode: episodios.status === 'fulfilled' ? episodios.value.episodes[0] : undefined,
      }))
    })

    /*
      El banner, aparte. Un fallo aquí no se cuenta —ni se dice—: es un adorno de
      la vitrina y la marquesina ya tiene su degradado. Y sin emparejamiento, el
      enriquecimiento llega a `null` en vez de fallar, que es el caso normal de una
      obra que AniList no conoce.
    */
    void apiGet(`${ruta}/enrichment`, enrichmentResponseSchema, opciones).then(
      (enriquecido) => {
        if (vivo) setEstado((previo) => ({ ...previo, banner: enriquecido.enrichment?.banner }))
      },
      () => {
        // Sin banner: la marquesina se queda con el campo de siempre.
      },
    )

    return () => {
      vivo = false
      controller.abort()
    }
  }, [providerId, value])

  return estado
}
