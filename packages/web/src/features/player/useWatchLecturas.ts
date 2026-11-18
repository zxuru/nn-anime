/**
 * Las dos lecturas de la pantalla de reproducción.
 *
 * La pantalla pide dos cosas al servidor y son de naturalezas distintas: el
 * **stream** del episodio —que sin él no hay nada que reproducir— y la **ficha**
 * del título —que sólo sirve para saber cómo se llama lo que se está viendo y
 * dibujar su portada—. Por eso son dos hooks y no uno: la diferencia está en qué
 * pasa cuando cada una falla.
 *
 * - Si el stream falla, la pantalla lo dice y ofrece reintentar: no hay episodio.
 * - Si la ficha falla, la reproducción no se entera: se pierde el nombre del
 *   título y la portada, y el episodio se ve igual.
 *
 * El modo de audio vive con el stream porque es lo que lo decide: el mismo
 * episodio se pide en doblado o en subtitulado, y volver a resolverlo con el
 * otro modo reanuda en la misma posición.
 */

import {
  animeResponseSchema,
  downloadsResponseSchema,
  streamResolveResponseSchema,
} from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { TitleKind } from '@rona/core/models'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { describirFallo, type Fallo, falloSinFuente } from '../../api/fallo'
import { t } from '../../i18n'
import { usePath } from '../../router'
import { coverPath } from '../search/ResultCard'
import { elegirFuente } from './quality'
import { almacenLocal, leerCalidad } from './storage'
import type { SubtitleCandidate } from './subtitle-tracks'
import type { WatchEstado } from './watch-neighbours'
import { modeFromPath, type PlayMode } from './watch-route'

/** La fuente que se está reproduciendo: la dirección del proxy y su formato. */
export interface WatchFuente {
  /** La dirección del proxy: el ticket, nunca la del upstream. */
  readonly url: string
  readonly kind: string
  readonly subtitles?: readonly SubtitleCandidate[] | undefined
}

/** Lo que hay que saber para pedir el stream de un episodio. */
export interface WatchFuenteOptions {
  readonly providerId: string
  readonly ref: string
}

/** El stream del episodio y el modo con el que se pide. */
export interface WatchFuenteHandle {
  /** La fuente resuelta, si la hay. */
  readonly fuente: WatchFuente | undefined
  /** En qué punto está la pantalla: cargando, con fuente o con fallo. */
  readonly estado: WatchEstado
  /** El fallo, si lo hubo. */
  readonly error: Fallo | undefined
  /** El modo de audio con el que se está viendo. */
  readonly modo: PlayMode
  readonly cambiarModo: (modo: PlayMode) => void
  /** Pedir el stream otra vez, desde el principio. */
  readonly recargar: () => void
  /**
   * Pide una fuente nueva saltándose la caché del servidor.
   *
   * Es la renovación transparente de una URL firmada o de un ticket caducado: la
   * firma del upstream y el ticket del proxy viven un tiempo acotado, y cuando
   * se agotan los segmentos empiezan a contestar 403/410. Volver a resolver con
   * `refresh` emite un ticket nuevo con una URL firmada nueva.
   *
   * **No se escribe en la fuente**: cambiar `source.url` volvería a montar el
   * medio y perdería justo la posición que la recuperación conserva. La URL nueva
   * la usa hls.js por dentro; si de verdad cambia el episodio o el modo, el
   * efecto de la fuente se encarga por su cuenta.
   */
  readonly renovarFuente: () => Promise<string | undefined>
}

/**
 * El stream del episodio, y el modo con el que se pide.
 *
 * El modo se elige aquí y volver a resolver el stream con el nuevo modo reanuda
 * en la misma posición: cambiar de subtitulado a doblado no debería devolver a
 * nadie al principio del episodio.
 *
 * El modo de arranque es el que la ficha puso en la dirección: quien eligió
 * doblado allí ya lo dijo, y volver a preguntarlo aquí sería hacerle repetir una
 * elección que acaba de hacer. Dentro de la pantalla manda este selector.
 */
export function useWatchFuente(options: WatchFuenteOptions): WatchFuenteHandle {
  const path = usePath()
  const [fuente, setFuente] = useState<WatchFuente | undefined>(undefined)
  const [modo, setModo] = useState<PlayMode>(() => modeFromPath(path) ?? 'sub')
  const [estado, setEstado] = useState<WatchEstado>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  /**
   * La calidad preferida, leída una vez al abrir la pantalla.
   *
   * Es una preferencia del navegador, como la velocidad: se aplica a la
   * siguiente resolución y no necesita volver a pedir el stream en caliente.
   */
  const [calidad] = useState(() => leerCalidad(almacenLocal()))

  /**
   * Resolver el stream del episodio y el modo actuales.
   *
   * Es una función y no el cuerpo del efecto porque «reintentar» tiene que hacer
   * exactamente lo mismo: pedirlo otra vez. Con un contador en las dependencias el
   * efecto se volvía a montar, pero el contador no se leía en ninguna parte, así
   * que el motivo de la repetición vivía fuera del código que la ejecuta.
   *
   * La petición anterior se aborta: reintentar dos veces seguidas dejaba viva la
   * primera, y su respuesta podía llegar después y pintar una fuente que ya no
   * corresponde al modo elegido.
   */
  const resolver = useCallback(() => {
    const controlador = new AbortController()

    const ejecutar = async (): Promise<void> => {
      try {
        /*
         * La copia local manda.
         *
         * Se busca sólo para el modo `sub` porque la fila de descarga todavía no
         * guarda el modo: servir un `sub` cuando se pidió `dub` sería peor que
         * volver a la red. El día que la fila lo guarde, esta condición se cae.
         */
        if (modo === 'sub') {
          const lista = await apiGet('/api/downloads', downloadsResponseSchema, {
            signal: controlador.signal,
          }).catch(() => undefined)

          if (controlador.signal.aborted) return

          const local = lista?.items.find(
            (item) =>
              item.status === 'complete' &&
              item.providerId === options.providerId &&
              item.episodeRef.value === options.ref,
          )

          if (local !== undefined) {
            setFuente({
              url: `/api/downloads/${local.id}/file`,
              kind: local.kind === 'segments' ? 'hls' : 'file',
            })
            setEstado('ready')

            return
          }
        }

        const salida = await apiPostJson(
          '/api/stream/resolve',
          {
            episodeRef: { providerId: options.providerId, value: options.ref },
            mode: modo,
            // El campo está en el contrato y el catálogo lo usa al elegir la
            // fila que cachea. Si la fuente no ofrece esa calidad, la respuesta
            // trae las demás y `elegirFuente` se queda con la primera.
            ...(calidad === undefined ? {} : { preferredQuality: calidad }),
          },
          streamResolveResponseSchema,
          { signal: controlador.signal },
        )

        if (controlador.signal.aborted) return

        const elegida = elegirFuente(salida.sources, calidad)
        if (elegida === undefined) {
          // Un proveedor que contesta sin fuentes no es un fallo de red: es que
          // ese sitio no tiene el episodio, y se cuenta como tal.
          setError(falloSinFuente(t(DEFAULT_LOCALE, 'player.noSource')))
          setEstado('error')

          return
        }

        setFuente({
          url: elegida.url,
          kind: elegida.kind,
          ...(elegida.subtitles === undefined
            ? {}
            : { subtitles: elegida.subtitles as readonly SubtitleCandidate[] }),
        })
        setEstado('ready')
      } catch (cause) {
        if (controlador.signal.aborted) return

        setError(describirFallo(cause))
        setEstado('error')
      }
    }

    void ejecutar()

    return controlador
  }, [options.providerId, options.ref, modo, calidad])

  useEffect(() => {
    const controlador = resolver()

    return () => controlador.abort()
  }, [resolver])

  const recargar = useCallback(() => {
    setEstado('loading')
    setError(undefined)
    resolver()
  }, [resolver])

  const renovarFuente = useCallback(async (): Promise<string | undefined> => {
    try {
      const salida = await apiPostJson(
        '/api/stream/resolve',
        {
          episodeRef: { providerId: options.providerId, value: options.ref },
          mode: modo,
          refresh: true,
          ...(calidad === undefined ? {} : { preferredQuality: calidad }),
        },
        streamResolveResponseSchema,
      )

      return elegirFuente(salida.sources, calidad)?.url
    } catch {
      // Un fallo al renovar no se cuenta aquí: el reproductor está en medio de
      // una recuperación y su manejador decide si se agota o se reintenta.
      return undefined
    }
  }, [options.providerId, options.ref, modo, calidad])

  return {
    fuente,
    estado,
    error,
    modo,
    cambiarModo: setModo,
    recargar,
    renovarFuente,
  }
}

/** Lo que hay que saber para leer la ficha del título que se está viendo. */
export interface WatchTituloOptions {
  readonly providerId: string
  /** La referencia del título: la de la dirección, o la deducida del episodio. */
  readonly animeValue: string
}

/** Lo que la ficha del título le dice a la pantalla. */
export interface WatchTituloHandle {
  /** El nombre del título, si ya llegó. */
  readonly tituloAnime: string | undefined
  /**
   * El formato del título, que es lo que decide si esto es una película.
   *
   * La ficha lo sabe y la pantalla de reproducción no lo recibía: una película se
   * anunciaba como «Episodio 1 de 1» y conservaba los mandos de una serie. Se lee
   * del detalle que la pantalla ya pide para el nombre, sin una segunda petición.
   */
  readonly tipo: TitleKind | undefined
  /**
   * La portada del título, si el proveedor dio una.
   *
   * No se pasa la dirección del proveedor —que puede ser de fuera y la CSP no la
   * admitiría—: se pide al proxy, que es el único que habla con el upstream. Sin
   * portada no se inventa ninguna: el `<video>` se queda con su fondo, que es lo
   * que había antes.
   */
  readonly portada: string | undefined
  /**
   * La ficha del título ya respondió —bien o mal—.
   *
   * No es un dato para pintar: es el permiso para pedir el enriquecimiento. Esa
   * ruta lee de la base local y sólo contesta cuando la ficha está cacheada, y la
   * cachea esta misma lectura del detalle. Pedirla en paralelo devolvía `null` y
   * el episodio se quedaba sin saltos por una carrera, no porque no los tuviera.
   */
  readonly fichaLista: boolean
}

/**
 * El nombre del título, que es lo que la pestaña necesita para distinguirse de
 * las demás. Si falla, la reproducción no se entera: se pierde el nombre, no el
 * episodio.
 */
export function useWatchTitulo(options: WatchTituloOptions): WatchTituloHandle {
  const [tituloAnime, setTituloAnime] = useState<string | undefined>(undefined)
  const [tipo, setTipo] = useState<TitleKind | undefined>(undefined)
  const [portada, setPortada] = useState<string | undefined>(undefined)

  /**
   * Si la ficha ya contestó, bien o mal.
   *
   * La respuesta se pide una vez por título y esta marca no se vuelve a bajar: es
   * el permiso para preguntar por el enriquecimiento, que lee de la caché que
   * llena esta misma lectura. Da igual cómo conteste; lo que importa es el orden.
   */
  const [fichaLista, setFichaLista] = useState(false)

  useEffect(() => {
    let vivo = true

    void apiGet(
      `/api/anime/${encodeURIComponent(options.providerId)}/${encodeURIComponent(options.animeValue)}`,
      animeResponseSchema,
    ).then(
      (detalle) => {
        if (!vivo) return

        setTituloAnime(detalle.title)
        setTipo(detalle.kind)
        setPortada(
          detalle.coverUrl === undefined
            ? undefined
            : coverPath(options.providerId, options.animeValue),
        )
        setFichaLista(true)
      },
      () => {
        if (!vivo) return

        // Aunque la ficha falle, el permiso se da: preguntar por el
        // enriquecimiento una vez es barato y no hay bucle —si contesta que no,
        // el hook no vuelve a preguntar.
        setFichaLista(true)
      },
    )

    return () => {
      vivo = false
    }
  }, [options.providerId, options.animeValue])

  return { tituloAnime, tipo, portada, fichaLista }
}
