/**
 * Los intervalos saltables del episodio que se está viendo.
 *
 * Son dos lecturas encadenadas y ninguna es obligatoria:
 *
 * 1. `GET /api/anime/:providerId/:ref/enrichment` da el `anilistId`. Esa ruta
 *    lee de la base local, así que sólo contesta cuando la ficha del título ya
 *    está cacheada; la cachea la lectura del detalle que la pantalla hace para
 *    su encabezado. Por eso el hook **no pide el enriquecimiento al montar**:
 *    espera a que el detalle haya respondido (`fichaLista`) y lo pide una sola
 *    vez. Un `null` quiere decir «esta obra no tiene ficha en AniList» y no se
 *    reintenta.
 * 2. `GET /api/skip-times/:anilistId/:episode?length=<s>` da los intervalos. Se
 *    pide cuando se conoce la duración —en `loadedmetadata`—, porque el servidor
 *    la usa para descartar intervalos que no caben, y **sin bloquear la
 *    reproducción**: el video sigue cargando y sonando mientras llega.
 *
 * Las dos lecturas se piden una sola vez por episodio y duración. Una lista
 * vacía es una respuesta, no un fallo: no se vuelve a preguntar. Cualquier error
 * —red, forma de la respuesta, ruta que aún no existe— se traga y deja la
 * pantalla como estaba: sin datos no hay botón, y no hay nada que contarle a
 * quien está mirando.
 */

import { enrichmentResponseSchema, skipTimesResponseSchema } from '@nn-anime/core/api'
import type { SkipInterval } from '@nn-anime/core/schema'
import { useEffect, useRef, useState } from 'react'
import { apiGet, type RequestDeps } from '../../api/client'

/** La ruta del enriquecimiento de un título. */
export function rutaDeEnriquecimiento(providerId: string, animeRef: string): string {
  return `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(animeRef)}/enrichment`
}

/** La ruta de los saltos de un episodio, con la duración que el servidor espera. */
export function rutaDeSaltos(anilistId: number, episodio: number, duracionS: number): string {
  return `/api/skip-times/${anilistId}/${episodio}?length=${Math.round(duracionS)}`
}

/**
 * El `anilistId` del título, o nada.
 *
 * Nunca lanza: un fallo aquí es «no se sabe», que es exactamente lo mismo que un
 * `enrichment: null` para lo que la pantalla hace con el dato.
 */
export async function anilistIdDelTitulo(
  providerId: string,
  animeRef: string,
  signal?: AbortSignal,
  deps?: RequestDeps,
): Promise<number | undefined> {
  try {
    const respuesta = await apiGet(
      rutaDeEnriquecimiento(providerId, animeRef),
      enrichmentResponseSchema,
      signal === undefined ? {} : { signal },
      deps,
    )

    return respuesta.enrichment?.anilistId
  } catch {
    return undefined
  }
}

/**
 * Los intervalos del episodio, o una lista vacía.
 *
 * Nunca lanza. La duración que se manda es la redondeada y sólo si es positiva:
 * una petición con `length=0` no describe nada.
 */
export async function intervalosDelEpisodio(
  anilistId: number,
  episodio: number,
  duracionS: number,
  signal?: AbortSignal,
  deps?: RequestDeps,
): Promise<readonly SkipInterval[]> {
  const largo = Math.round(duracionS)
  if (!Number.isInteger(largo) || largo <= 0) return []

  try {
    return await apiGet(
      rutaDeSaltos(anilistId, episodio, largo),
      skipTimesResponseSchema,
      signal === undefined ? {} : { signal },
      deps,
    )
  } catch {
    return []
  }
}

export interface UseSkipTimesOptions {
  readonly providerId: string
  /** La referencia del **título**, que es con la que se pide el enriquecimiento. */
  readonly animeRef: string
  /** La referencia del episodio, que identifica el intervalo de cada capítulo. */
  readonly episodeRef: string
  /** El número de episodio, si se conoce. Sin él no se piden saltos. */
  readonly episodio: number | undefined
  /** La ficha del título ya se pidió y respondió: es la que cachea el enriquecimiento. */
  readonly fichaLista: boolean
  /** La duración del episodio, en segundos; cero mientras no se sepa. */
  readonly durationS: number
}

/**
 * Los intervalos saltables del episodio, o una lista vacía.
 *
 * El estado se reinicia al cambiar de episodio y al cambiar de título, y las
 * peticiones en vuelo se abortan: el episodio siguiente no hereda los saltos del
 * anterior. El `AbortController` de una petición que ya no sirve no se cancela al
 * desmontar —el gancho se monta una vez por fuente y una respuesta tardía de un
 * componente que ya no está es inofensiva—, pero sí cuando llega otra petición
 * del mismo tipo.
 */
export function useSkipTimes(options: UseSkipTimesOptions): readonly SkipInterval[] {
  const { providerId, animeRef, episodeRef, episodio, fichaLista, durationS } = options
  const [anilistId, setAnilistId] = useState<number | undefined>(undefined)
  const [intervalos, setIntervalos] = useState<readonly SkipInterval[]>([])

  /** La última petición de cada lectura, para no repetirla y para poder abortarla. */
  const enriquecimiento = useRef<
    { readonly clave: string; readonly controlador: AbortController } | undefined
  >(undefined)
  const saltos = useRef<
    { readonly clave: string; readonly controlador: AbortController } | undefined
  >(undefined)

  const claveTitulo = `${providerId}\u0000${animeRef}`
  const claveEpisodio = `${providerId}\u0000${animeRef}\u0000${episodeRef}`
  const tituloAnterior = useRef(claveTitulo)
  const episodioAnterior = useRef(claveEpisodio)

  // Cambiar de título deja sin enriquecimiento: el de la obra anterior no vale
  // para ésta. Va antes que las lecturas para que éstas vean el estado limpio.
  useEffect(() => {
    if (tituloAnterior.current === claveTitulo) return

    tituloAnterior.current = claveTitulo
    enriquecimiento.current?.controlador.abort()
    enriquecimiento.current = undefined
    saltos.current?.controlador.abort()
    saltos.current = undefined
    setAnilistId(undefined)
    setIntervalos([])
  }, [claveTitulo])

  // Y cambiar de episodio deja sin intervalos: los de 5-20 s del capítulo 1 no
  // son los del 2, y ofrecer un botón con la etiqueta del otro sería peor que no
  // ofrecer nada.
  useEffect(() => {
    if (episodioAnterior.current === claveEpisodio) return

    episodioAnterior.current = claveEpisodio
    saltos.current?.controlador.abort()
    saltos.current = undefined
    setIntervalos([])
  }, [claveEpisodio])

  // El enriquecimiento, una sola vez y sólo cuando la ficha ya respondió. La
  // respuesta puede ser `null` y eso también es definitivo: no se reintenta.
  useEffect(() => {
    if (!fichaLista) return

    const clave = `${providerId}\u0000${animeRef}`
    if (enriquecimiento.current?.clave === clave) return

    enriquecimiento.current?.controlador.abort()
    const controlador = new AbortController()
    enriquecimiento.current = { clave, controlador }

    void anilistIdDelTitulo(providerId, animeRef, controlador.signal).then((id) => {
      if (!controlador.signal.aborted) setAnilistId(id)
    })
  }, [fichaLista, providerId, animeRef])

  // Los intervalos, cuando se conocen el identificador y la duración. La clave
  // lleva la duración porque es lo que se manda al servidor: dos duraciones son
  // dos peticiones, y la misma dos veces es una.
  const duracion = Number.isFinite(durationS) && durationS > 0 ? Math.round(durationS) : 0

  useEffect(() => {
    if (anilistId === undefined || episodio === undefined || duracion <= 0) return

    const clave = `${anilistId}\u0000${episodio}\u0000${duracion}`
    if (saltos.current?.clave === clave) return

    saltos.current?.controlador.abort()
    const controlador = new AbortController()
    saltos.current = { clave, controlador }

    void intervalosDelEpisodio(anilistId, episodio, duracion, controlador.signal).then((lista) => {
      if (!controlador.signal.aborted) setIntervalos(lista)
    })
  }, [anilistId, episodio, duracion])

  return intervalos
}
