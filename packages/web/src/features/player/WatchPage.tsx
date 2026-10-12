/**
 * Pantalla de reproducción.
 *
 * Resuelve el stream por la API —el cliente nunca ve la URL del upstream, sólo
 * el ticket— y monta el reproductor con la primera fuente. Si la resolución
 * falla, se dice qué pasó y se ofrece reintentar: una pantalla en negro sin
 * explicación es lo peor que puede hacer un reproductor.
 *
 * La elección de sub o dub, la pista de subtítulos y el guardado de la posición
 * son de T32; aquí está la reproducción.
 *
 * La lista de episodios se pide **sólo para saber quién va antes y quién
 * después**: sin ella no hay flechas, pero la reproducción no depende de esa
 * petición. Si falla, el episodio se ve igual y lo único que se pierde es el
 * salto al de al lado.
 *
 * La pantalla se compone en **dos columnas**: el reproductor y sus mandos a la
 * izquierda, la lista de episodios a la derecha. El encabezado, el video y el pie
 * comparten el mismo borde porque viven en la misma columna: antes el título
 * llegaba hasta el ancho de la página y el video se quedaba en la mitad, con un
 * hueco vacío al lado.
 */

import {
  animeResponseSchema,
  episodesResponseSchema,
  streamResolveResponseSchema,
} from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { describirFallo, FALLO_SIN_CAUSA, type Fallo, falloSinFuente } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import {
  composeTitle,
  episodeLabel,
  useDocumentTitle,
  watchTitleParts,
} from '../../lib/document-title'
import { buildPath, Link, usePath } from '../../router'
import { coverPath } from '../search/ResultCard'
import { AudioModeSwitch } from './AudioModeSwitch'
import { Player } from './Player'
import { type SubtitleCandidate, toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useMpvHandoff } from './useMpvHandoff'
import { useWatchEvents } from './useWatchEvents'
import {
  animeRefFromPath,
  animeRefOf,
  episodePosition,
  modeFromPath,
  neighbourEpisodes,
  startAtFromPath,
  type WatchPathOptions,
  watchPath,
} from './watch-route'

export interface WatchPageProps {
  readonly providerId: string
  readonly ref: string
}

type Estado = 'loading' | 'ready' | 'error'

/**
 * La flecha de episodio.
 *
 * Es un dibujo y no el glifo `←` de la tipografía. El glifo se apoya en la línea
 * de base, así que dentro de una caja de 56 px queda descentrado —y se ve
 * distinto en cada máquina, porque cada una resuelve la flecha con la fuente que
 * tenga—. Un bloque con contorno, como el resto de la interfaz, se centra solo y
 * se ve igual en todas partes.
 *
 * La de la izquierda es la misma, espejada: un solo dibujo, dos direcciones.
 */
function EpisodeArrow(props: { readonly towards: 'previous' | 'next' }): ReactNode {
  return (
    <svg
      className="watch__nav-arrow"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-towards={props.towards}
    >
      <path d="M2 9H13V4.5L21.5 12 13 19.5V15H2Z" />
    </svg>
  )
}

export function WatchPage(props: WatchPageProps): ReactNode {
  const [fuente, setFuente] = useState<
    { url: string; kind: string; subtitles?: readonly SubtitleCandidate[] } | undefined
  >(undefined)
  // El modo se elige aquí y volver a resolver el stream con el nuevo modo
  // reanuda en la misma posición: cambiar de subtitulado a doblado no debería
  // devolver a nadie al principio del episodio.
  //
  // El modo de arranque es el que la ficha puso en la dirección: quien eligió
  // doblado allí ya lo dijo, y volver a preguntarlo aquí sería hacerle repetir
  // una elección que acaba de hacer. Dentro de la pantalla manda este selector.
  const path = usePath()
  const [modo, setModo] = useState<'sub' | 'dub'>(() => modeFromPath(path) ?? 'sub')
  // El segundo donde se dejó, si la dirección lo trae: la tarjeta de «continuar
  // viendo» lo pone en su enlace. Arrancar aquí y no en el cero es lo que hace
  // que la fila sirva para seguir viendo y no para volver a empezar.
  const [posicion, setPosicion] = useState(() => startAtFromPath(path) ?? 0)

  // El registro del visionado: alta al reproducir de verdad, avance cada 15 s y
  // al pausar, y la posición final al desmontar o cerrar la pestaña.
  //
  // El título y el episodio son dos referencias distintas. La del episodio es la
  // de la dirección; la del título viene escrita en la consulta, puesta ahí por
  // quien construyó el enlace —la ficha, que la tiene en `Episode.animeRef`—.
  // Deducirla del episodio queda como último recurso para un enlace viejo o una
  // dirección escrita a mano, y con la convención equivocada escribía en la base
  // la ficha del episodio como si fuera un título.
  const animeValue = animeRefFromPath(path) ?? animeRefOf(props.ref)
  const animeRef = { providerId: props.providerId, value: animeValue }
  const episodeRef = { providerId: props.providerId, value: props.ref }
  const visionado = useWatchEvents({
    animeRef,
    episodeRef,
    mode: modo,
    startAtS: posicion,
  })
  // El reproductor externo: el botón y lo que contestó el servidor. Va aquí y no
  // dentro de `Player` porque es una forma de ver el episodio, no un control del
  // elemento de video.
  const mpv = useMpvHandoff({
    providerId: props.providerId,
    ref: props.ref,
    mode: modo,
    startAtS: posicion,
  })
  const [estado, setEstado] = useState<Estado>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  const [episodios, setEpisodios] = useState<readonly Episode[]>([])
  // El nombre del título. La dirección del reproductor sólo lleva la referencia
  // del episodio, así que sin esta petición la pantalla no sabe cómo se llama lo
  // que está reproduciendo y la pestaña sólo puede decir «Ep. 3».
  const [tituloAnime, setTituloAnime] = useState<string | undefined>(undefined)
  // La portada del título, si el proveedor dio una. No se pasa la dirección del
  // proveedor —que puede ser de fuera y la CSP no la admitiría—: se pide al
  // proxy, que es el único que habla con el upstream. Sin portada no se inventa
  // ninguna: el `<video>` se queda con su fondo, que es lo que había antes.
  const [portada, setPortada] = useState<string | undefined>(undefined)

  // Los episodios del título, para las flechas de al lado. La petición se
  // cancela al desmontar y su fallo no se pinta: una flecha que no aparece es
  // una molestia, un error encima del video que sí se ve es otra cosa.
  useEffect(() => {
    let vivo = true

    void apiGet(
      `/api/anime/${encodeURIComponent(props.providerId)}/${encodeURIComponent(animeRef.value)}/episodes`,
      episodesResponseSchema,
    ).then(
      (lista) => {
        if (vivo) setEpisodios(lista.episodes)
      },
      () => {
        if (vivo) setEpisodios([])
      },
    )

    return () => {
      vivo = false
    }
  }, [props.providerId, animeRef.value])

  // El nombre del título, que es lo que la pestaña necesita para distinguirse de
  // las demás. Si falla, la reproducción no se entera: se pierde el nombre, no el
  // episodio.
  useEffect(() => {
    let vivo = true

    void apiGet(
      `/api/anime/${encodeURIComponent(props.providerId)}/${encodeURIComponent(animeRef.value)}`,
      animeResponseSchema,
    ).then(
      (detalle) => {
        if (!vivo) return

        setTituloAnime(detalle.title)
        setPortada(
          detalle.coverUrl === undefined ? undefined : coverPath(props.providerId, animeRef.value),
        )
      },
      () => undefined,
    )

    return () => {
      vivo = false
    }
  }, [props.providerId, animeRef.value])

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

    void apiPostJson(
      '/api/stream/resolve',
      { episodeRef: { providerId: props.providerId, value: props.ref }, mode: modo },
      streamResolveResponseSchema,
      { signal: controlador.signal },
    ).then(
      (salida) => {
        if (controlador.signal.aborted) return

        const primera = salida.sources[0]
        if (primera === undefined) {
          // Un proveedor que contesta sin fuentes no es un fallo de red: es que
          // ese sitio no tiene el episodio, y se cuenta como tal.
          setError(falloSinFuente(t(DEFAULT_LOCALE, 'player.noSource')))
          setEstado('error')

          return
        }

        setFuente({
          url: primera.url,
          kind: primera.kind,
          ...(primera.subtitles === undefined
            ? {}
            : { subtitles: primera.subtitles as readonly SubtitleCandidate[] }),
        })
        setEstado('ready')
      },
      (cause: unknown) => {
        if (controlador.signal.aborted) return

        setError(describirFallo(cause))
        setEstado('error')
      },
    )

    return controlador
  }, [props.providerId, props.ref, modo])

  useEffect(() => {
    const controlador = resolver()

    return () => controlador.abort()
  }, [resolver])

  const recargar = useCallback(() => {
    setEstado('loading')
    setError(undefined)
    resolver()
  }, [resolver])

  const vecinos = neighbourEpisodes(episodios, props.providerId, props.ref)
  const posicionEpisodio = episodePosition(episodios, props.providerId, props.ref)
  const episodioActual = episodios.find((episodio) => episodio.ref.value === props.ref)
  const numeroEpisodio = posicionEpisodio?.number ?? episodioActual?.number

  /**
   * El título propio del episodio, si lo trae.
   *
   * Hay proveedores cuyo nombre de episodio es otra vez el número —«Episodio 3»—,
   * así que repetirlo daría un «Episodio 3 · 3 de 12 · Episodio 3». Cuando el
   * nombre ya dice lo mismo que la etiqueta, no se pinta.
   */
  const tituloEpisodio = episodioActual?.title?.trim() ?? ''
  const tituloUtil =
    tituloEpisodio === '' ||
    tituloEpisodio === t(DEFAULT_LOCALE, 'player.episode', { number: numeroEpisodio ?? 0 })
      ? undefined
      : tituloEpisodio

  /**
   * Cómo se llama el episodio que se está viendo.
   *
   * El número sale de la lista de episodios, que es la misma petición que dibuja
   * las flechas. Si esa petición falla, la pantalla sigue reproduciendo y la
   * etiqueta se queda con el nombre que el proveedor le haya dado: el episodio
   * es un adorno del título, no al revés.
   */
  const etiquetaEpisodio = episodeLabel(numeroEpisodio, tituloUtil)

  /**
   * La línea del episodio, con el número una sola vez.
   *
   * Antes eran dos textos —«Episodio 3» encima y «Episodio 3 de 12» en medio de
   * las flechas— y el número se leía dos veces. Ahora es una línea: el episodio,
   * el lugar que ocupa de cuántos y, si el proveedor lo dio, su título.
   */
  const lineaEpisodio =
    posicionEpisodio === undefined
      ? etiquetaEpisodio
      : composeTitle([
          t(DEFAULT_LOCALE, 'player.episodeAt', {
            number: posicionEpisodio.number,
            position: posicionEpisodio.position,
            total: posicionEpisodio.total,
          }),
          tituloUtil,
        ])

  // La pestaña y el encabezado dicen lo mismo: el nombre del título y por qué
  // episodio va. Es lo que distingue dos pestañas de la misma aplicación.
  useDocumentTitle(watchTitleParts(tituloAnime, etiquetaEpisodio))

  /**
   * El encabezado de la pantalla.
   *
   * Antes la pantalla de reproducción era el video y nada más: quien tenía dos
   * episodios abiertos no veía en ninguna parte qué estaba viendo. Va también en
   * los estados de carga y de error, que son justo en los que más falta hace
   * saber qué es lo que no se pudo abrir.
   *
   * El regreso a la ficha va aquí, con el encabezado, por la misma razón: es la
   * salida de la pantalla y tiene que estar en los tres estados. La cabecera de la
   * aplicación lleva a la home, no al título, así que sin este enlace la única
   * vuelta era el botón de atrás del navegador —que no se ve en una pantalla
   * pensada para verse a pantalla completa—. El título de la ficha es la
   * referencia que la dirección trae o la que se deduce del episodio: es la misma
   * que usa el registro del visionado, no una segunda conjetura.
   *
   * El nombre del título va en **una línea con puntos suspensivos**: es un
   * encabezado, no el contenido de la pantalla, y creciendo con el nombre más
   * largo empujaba el video fuera de la ventana.
   */
  const encabezado = (
    <header className="watch__head">
      <Link
        className="watch__back"
        to={buildPath('detail', { providerId: props.providerId, ref: animeRef.value })}
      >
        {t(DEFAULT_LOCALE, 'player.backToDetail')}
      </Link>
      <h1>{tituloAnime ?? t(DEFAULT_LOCALE, 'title.loading')}</h1>
      {lineaEpisodio === undefined ? null : <p className="watch__episode">{lineaEpisodio}</p>}
    </header>
  )

  /** El nombre del título y el episodio, para lo que no es texto de interfaz. */
  const nombreCompleto = composeTitle([tituloAnime, etiquetaEpisodio])

  /**
   * Las flechas de episodio.
   *
   * Van **debajo del video**, en la misma fila que el selector de audio: el salto
   * al episodio de al lado sigue estando a la vista al terminar uno, y el
   * encabezado se queda con lo que sólo se lee una vez.
   *
   * Cada una sólo es un enlace cuando existe ese episodio: en el primero no hay
   * flecha a la izquierda y en el último no la hay a la derecha. Cuando no existe,
   * el sitio no se queda con una flecha suelta: se pinta el mismo rótulo,
   * apagado, con `aria-disabled` y el `title` diciendo por qué no lleva a ninguna
   * parte. Una flecha diminuta sin texto no explica nada, y quien la ve por
   * primera vez cree que la aplicación está rota.
   *
   * El modo con el que se está viendo viaja en la dirección: si alguien cambió a
   * doblado, el episodio siguiente se abre doblado y no vuelve a preguntarlo.
   */
  const opcionesDePaso: WatchPathOptions = { mode: modo, anime: animeValue }

  const pasos = (
    <div className="watch__steps">
      {vecinos.previous === undefined ? (
        <span
          className="watch__nav-off"
          aria-disabled="true"
          title={t(DEFAULT_LOCALE, 'player.firstEpisode')}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previous')}
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          ariaLabel={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          title={t(DEFAULT_LOCALE, 'player.previousEpisode')}
          to={watchPath(props.providerId, vecinos.previous.value, opcionesDePaso)}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previous')}
        </Link>
      )}

      {vecinos.next === undefined ? (
        <span
          className="watch__nav-off"
          aria-disabled="true"
          title={t(DEFAULT_LOCALE, 'player.lastEpisode')}
        >
          {t(DEFAULT_LOCALE, 'player.next')}
          <EpisodeArrow towards="next" />
        </span>
      ) : (
        <Link
          className="watch__nav-link"
          ariaLabel={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          title={t(DEFAULT_LOCALE, 'player.nextEpisode')}
          to={watchPath(props.providerId, vecinos.next.value, opcionesDePaso)}
        >
          {t(DEFAULT_LOCALE, 'player.next')}
          <EpisodeArrow towards="next" />
        </Link>
      )}
    </div>
  )

  /**
   * La fila de mandos bajo el reproductor.
   *
   * A la izquierda el salto de episodio y a la derecha la elección de audio, que
   * es lo que se cambia a menudo y por eso no vive dentro del menú de ajustes.
   * En la carga y en el error sólo van las flechas: el modo no resuelve nada
   * cuando no hay fuente.
   */
  const filaDeMandos = (conAudio: boolean): ReactNode => (
    <nav className="watch__nav" aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
      {pasos}
      {conAudio ? <AudioModeSwitch mode={modo} onMode={setModo} /> : null}
    </nav>
  )

  if (estado === 'loading') {
    return (
      <section className="watch">
        <div className="watch__layout">
          <div className="watch__main">
            {encabezado}
            <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p>
          </div>
        </div>
      </section>
    )
  }

  if (estado === 'error' || fuente === undefined) {
    return (
      <section className="watch">
        <div className="watch__layout">
          <div className="watch__main">
            {encabezado}
            <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={recargar} />
            {filaDeMandos(false)}
          </div>
        </div>
      </section>
    )
  }

  const pistas = toSafeTracks(tracksFromSource(fuente))

  return (
    <section className="watch">
      <div className="watch__layout">
        <div className="watch__main">
          {encabezado}

          {mpv.estado.kind === 'abierto' ? (
            <p className="watch__episode">{t(DEFAULT_LOCALE, 'player.mpv.opened')}</p>
          ) : null}

          {mpv.estado.kind === 'error' ? (
            <p className="search__error">
              {t(DEFAULT_LOCALE, 'player.mpv.error', { message: mpv.estado.mensaje })}
            </p>
          ) : null}

          <Player
            url={fuente.url}
            kind={fuente.kind}
            // El nombre del título, y no la referencia del episodio: `title` es la
            // etiqueta que lee un lector de pantalla y `aurora-nocturna#3` no es
            // cómo se llama nada. Sin nombre, `Player` pone la suya.
            title={nombreCompleto === '' ? undefined : nombreCompleto}
            poster={portada}
            tracks={pistas}
            // El modo de audio y el reproductor externo son de la pantalla, no
            // del elemento de video: el menú de ajustes del reproductor los
            // recibe para no tener una segunda copia del estado.
            mode={modo}
            onMode={setModo}
            onMpv={mpv.abrir}
            startAtS={posicion}
            onPlay={visionado.onPlay}
            onPause={visionado.onPause}
            // La duración viaja al registro además de la posición: el servidor
            // calcula con ella la proporción vista, y sin duración todo visionado
            // valía cero y la fila de «continuar viendo» los descartaba a todos.
            onProgress={(positionS, durationS) => {
              setPosicion(positionS)
              visionado.onProgress(positionS, durationS)
            }}
          />

          {filaDeMandos(true)}
        </div>
      </div>
    </section>
  )
}
