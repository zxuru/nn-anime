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
 * cuenta: **después** del detalle y sin que nadie la espere. El orden es del
 * servidor, no de la prisa: su ruta lee la fila local del anime para emparejar con
 * AniList, y esa fila la escribe el detalle. Pedirla a la vez la dejaba vacía en
 * la primera carga de la home, así que el banner no aparecía hasta recargar. Como
 * tampoco se espera, un tercero lento no retrasa la sinopsis ni el botón.
 *
 * Si algo de eso falla, el destacado se pinta con lo que haya: el título y la
 * portada bastan para que la home no se quede sin su primera fila.
 *
 * **Lo que se enseña va atado a la referencia de la que salió.** El estado vivía
 * suelto y el héroe cambiaba de título con la sinopsis, el episodio y el banner
 * del anterior: el botón de reproducir enlazaba al capítulo de otra obra. Guardar
 * la clave junto a los datos hace que el cambio de referencia sea, por
 * construcción, un vacío del que se pinta el esqueleto.
 */

import {
  animeResponseSchema,
  enrichmentResponseSchema,
  episodesResponseSchema,
} from '@rona/core/api'
import type { AnimeDetail, Episode } from '@rona/core/models'
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

const SIN_DESTACADO: Featured = {
  loading: false,
  detail: undefined,
  firstEpisode: undefined,
  banner: undefined,
}

/** Lo que se sabe del destacado, con la referencia a la que pertenece. */
export interface FeaturedStore {
  readonly clave: string | undefined
  readonly datos: Featured
}

/**
 * La clave de la referencia del destacado.
 *
 * Separa proveedor y valor con un carácter que no puede aparecer en un id ni en
 * una referencia, para que dos parejas distintas no compartan clave.
 */
export function claveDeFeatured(
  ref: { readonly providerId: string; readonly value: string } | undefined,
): string | undefined {
  return ref === undefined ? undefined : `${ref.providerId}\u0000${ref.value}`
}

/**
 * Lo que se puede enseñar de esta referencia.
 *
 * Si lo guardado es de otra, no se hereda nada: la nueva empieza en el esqueleto
 * y espera su respuesta. Es la transición A→B, y es una función pura para poder
 * medirla sin un DOM.
 */
export function featuredVisible(guardado: FeaturedStore, clave: string | undefined): Featured {
  if (guardado.clave === clave) return guardado.datos

  return clave === undefined ? SIN_DESTACADO : VACIO
}

export function useFeatured(
  ref: { readonly providerId: string; readonly value: string } | undefined,
): Featured {
  const [guardado, setGuardado] = useState<FeaturedStore>({ clave: undefined, datos: VACIO })
  const providerId = ref?.providerId
  const value = ref?.value
  const clave = claveDeFeatured(ref)

  useEffect(() => {
    if (providerId === undefined || value === undefined) {
      setGuardado({ clave, datos: SIN_DESTACADO })

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

      // La base es lo de esta referencia, y sólo si ya estaba; si lo guardado es
      // de A, se empieza por el vacío y no se hereda ni su sinopsis ni su banner.
      // El banner puede haber llegado antes que esta respuesta —el orden normal
      // es el contrario— y, si es de la misma clave, se conserva.
      setGuardado((previo) => ({
        clave,
        datos: {
          ...(previo.clave === clave ? previo.datos : VACIO),
          loading: false,
          detail: detalle.status === 'fulfilled' ? detalle.value : undefined,
          firstEpisode: episodios.status === 'fulfilled' ? episodios.value.episodes[0] : undefined,
        },
      }))

      /*
        El banner, **después del detalle**. Su ruta lee la fila local del anime
        para emparejar con AniList, y esa fila la escribe el detalle: pedirlo a la
        vez —como se hacía— lo dejaba vacío en la primera carga de la home, y la
        marquesina se quedaba con su degradado hasta recargar. Un fallo aquí no se
        cuenta —ni se dice—: es un adorno de la vitrina y la marquesina ya tiene su
        degradado. Sin emparejamiento, el enriquecimiento llega a `null` en vez de
        fallar, que es el caso normal de una obra que AniList no conoce.
      */
      if (detalle.status !== 'fulfilled') return

      void apiGet(`${ruta}/enrichment`, enrichmentResponseSchema, opciones).then(
        (enriquecido) => {
          if (!vivo) return

          setGuardado((previo) =>
            previo.clave === clave
              ? {
                  clave,
                  datos: { ...previo.datos, banner: enriquecido.enrichment?.banner },
                }
              : previo,
          )
        },
        () => {
          // Sin banner: la marquesina se queda con el campo de siempre.
        },
      )
    })

    return () => {
      vivo = false
      controller.abort()
    }
  }, [providerId, value, clave])

  return featuredVisible(guardado, clave)
}
