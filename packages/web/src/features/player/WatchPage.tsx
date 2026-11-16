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
 * La pantalla se compone en **dos columnas**: el reproductor y sus mandos a la
 * izquierda, la lista de episodes a la derecha. El encabezado, el video y el pie
 * comparten el mismo borde porque viven en la misma columna: antes el título
 * llegaba hasta el ancho de la página y el video se quedaba en la mitad, con un
 * hueco vacío al lado.
 *
 * **Aquí no se guarda nada.** Todo el estado —la fuente, el modo, la posición,
 * los vecinos, el nombre del título y la sala— vive en `useWatchPage`, y las dos
 * lecturas de la pantalla en `useWatchLecturas`. Esta pieza sólo pinta: compone
 * el marcado y decide qué estado se ve. Es lo mismo que hacen `DetailPage` con
 * `useDetail` y `PartyPanel` con `useParty`, y por lo mismo: cuando el estado
 * está repartido por el componente, arreglar el reproductor significaba buscar
 * entre mil líneas dónde estaba cada cosa.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import { buildPath, Link } from '../../router'
import { DownloadButton } from '../downloads/DownloadButton'
import { ANCLAS } from '../guia/guia'
import { PartyBar } from '../party/PartyBar'
import { PartyPanel } from '../party/PartyPanel'
import { AudioModeSwitch } from './AudioModeSwitch'
import { Player } from './Player'
import { SourceFallback } from './SourceFallback'
import { toSafeTracks, tracksFromSource } from './subtitle-tracks'
import { useWatchPage } from './useWatchPage'
import { WatchEpisodes } from './WatchEpisodes'
import { type WatchPathOptions, watchPath } from './watch-route'

export interface WatchPageProps {
  readonly providerId: string
  readonly ref: string
}

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
  const pagina = useWatchPage({ providerId: props.providerId, ref: props.ref })
  const {
    estado,
    error,
    fuente,
    modo,
    cambiarModo,
    posicion,
    setPosicion,
    posicionActual,
    autoplay,
    cambiarAutoplay,
    vecinos,
    posicionEpisodio,
    tituloAnime,
    portada,
    animeValue,
    animeRef,
    episodeRef,
    numero,
    temporada,
    setElementoVideo,
    panelSala,
    setPanelSala,
    botonSala,
    cerrarPanelSala,
    party,
    mediaDeLaSala,
    visionado,
    mpv,
    recargar,
    renovarFuente,
    anotarProgreso,
    alTerminar,
    cuenta,
    cancelarCuenta,
    rutaSiguiente,
    esPelicula,
    lineaEpisodio,
    nombreCompleto,
    estadoFicha,
  } = pagina

  const panelDeSala = panelSala ? (
    <PartyPanel party={party} canHost={mediaDeLaSala !== undefined} onClose={cerrarPanelSala} />
  ) : null

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
        state={estadoFicha}
      >
        {t(DEFAULT_LOCALE, 'player.backToDetail')}
      </Link>
      <h1>{tituloAnime ?? t(DEFAULT_LOCALE, 'title.loading')}</h1>
      {lineaEpisodio === undefined ? null : <p className="watch__episode">{lineaEpisodio}</p>}
      {/* «Ver juntos» y la descarga van anclados al encabezado, en una fila:
          la sala se mide contra la ventana y un bloque más debajo empujaba la
          página. El botón abre el panel de la sala; la descarga es la misma de
          siempre. */}
      <div className="watch__actions">
        <button
          type="button"
          ref={botonSala}
          className="button watch__party"
          aria-haspopup="dialog"
          aria-expanded={panelSala}
          onClick={() => setPanelSala(true)}
        >
          {t(DEFAULT_LOCALE, 'party.open')}
        </button>
        <div className="watch__download">
          <DownloadButton
            providerId={props.providerId}
            animeRef={animeRef}
            episodeRef={episodeRef}
          />
        </div>
      </div>
    </header>
  )

  /**
   * Las flechas de episodio.
   *
   * Van **debajo del video**, en la misma fila que el selector de audio: el salto
   * al episodio de al lado sigue estando a la vista al terminar uno, y el
   * encabezado se queda con lo que sólo se lee una vez.
   *
   * Cada una sólo es un enlace cuando existe ese episodio: en el primero no hay
   * flecha a la izquierda y en el último no la hay a la derecha. Cuando no existe,
   * el sitio no se queda con una flecha suelta: se pinta el mismo rótulo, apagado,
   * con `aria-disabled` y el `title` diciendo por qué no lleva a ninguna parte.
   *
   * El modo con el que se está viendo viaja en la dirección: si alguien cambió a
   * doblado, el episodio siguiente se abre doblado y no vuelve a preguntarlo. Y el
   * número viaja también, para que la pantalla que se abra no tenga que pedir la
   * lista entera para saber cuáles son **sus** vecinos.
   */
  const opcionesDePaso: WatchPathOptions = { mode: modo, anime: animeValue }

  const pasos = esPelicula ? null : (
    <div className="watch__steps">
      {vecinos?.previous === undefined ? (
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
          to={watchPath(props.providerId, vecinos.previous.ref.value, {
            ...opcionesDePaso,
            n: vecinos.previous.number,
            ...(vecinos.previous.season === undefined ? {} : { s: vecinos.previous.season }),
          })}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previous')}
        </Link>
      )}

      {vecinos?.next === undefined ? (
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
          to={watchPath(props.providerId, vecinos.next.ref.value, {
            ...opcionesDePaso,
            n: vecinos.next.number,
            ...(vecinos.next.season === undefined ? {} : { s: vecinos.next.season }),
          })}
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
    <nav
      className="watch__nav"
      aria-label={t(DEFAULT_LOCALE, esPelicula ? 'player.audio' : 'player.episodes')}
      data-tour={ANCLAS.reproductorMandos}
    >
      {pasos}
      {conAudio ? <AudioModeSwitch mode={modo} onMode={cambiarModo} /> : null}
    </nav>
  )

  /**
   * La lista de episodios, en su columna.
   *
   * Va en los dos estados en los que hay algo que elegir: en el error es justo
   * cuando más falta hace —el episodio que no abre tiene al lado los que sí— y en
   * la reproducción es la forma de cambiar sin volver a la ficha. Pide sus páginas
   * ella misma, de cien en cien: esta pantalla no descarga la lista entera para
   * pintarla, que es lo que T92 vino a quitar.
   */
  const listaDeEpisodios = esPelicula ? null : (
    <aside className="watch__aside" data-tour={ANCLAS.reproductorEpisodios}>
      <WatchEpisodes
        providerId={props.providerId}
        titleRef={animeValue}
        currentRef={props.ref}
        mode={modo}
        actual={posicionEpisodio}
        // La temporada de la dirección, para que la fila del episodio suelto y
        // sus enlaces no pierdan la temporada que se está viendo.
        season={temporada}
        // El nombre del título, que es el respaldo del renglón cuando el
        // proveedor no nombra sus episodios: esta columna no tiene al lado el
        // encabezado de la pantalla, así que un renglón con sólo el número no
        // dice de qué serie es.
        animeTitle={tituloAnime}
      />
    </aside>
  )

  if (estado === 'loading') {
    return (
      <section className="watch">
        <div className="watch__layout">
          <div className="watch__main">
            {encabezado}
            {party.phase === 'idle' ? null : <PartyBar party={party} />}
            <p className="empty">{t(DEFAULT_LOCALE, 'player.loading')}</p>
            {panelDeSala}
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
            {party.phase === 'idle' ? null : <PartyBar party={party} />}
            <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={recargar} />
            <SourceFallback
              providerId={props.providerId}
              titleRef={animeRef.value}
              number={numero}
              mode={modo}
              positionS={posicion ?? 0}
            />
            {filaDeMandos(false)}
            {panelDeSala}
          </div>
          {listaDeEpisodios}
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

          {party.phase === 'idle' ? null : <PartyBar party={party} />}

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
            dataTour={ANCLAS.reproductorVideo}
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
            onMode={cambiarModo}
            onMpv={mpv.abrir}
            autoplay={autoplay}
            onAutoplay={cambiarAutoplay}
            startAtS={posicion}
            onPlay={visionado.onPlay}
            // Pausar es el otro momento en el que el dato importa —quien pausa
            // suele estar a punto de irse—, así que aquí se apunta sin esperar al
            // turno del guardado periódico.
            onPause={() => {
              const ahora = posicionActual()
              anotarProgreso(ahora.positionS, ahora.durationS, true)
              visionado.onPause()
            }}
            onEnded={alTerminar}
            // La duración viaja al registro además de la posición: el servidor
            // calcula con ella la proporción vista, y sin duración todo visionado
            // valía cero y la fila de «continuar viendo» los descartaba a todos.
            onProgress={(positionS, durationS) => {
              setPosicion(positionS)
              visionado.onProgress(positionS, durationS)
              anotarProgreso(positionS, durationS, false)
            }}
            onVideoElement={setElementoVideo}
            renovarFuente={renovarFuente}
          />

          {filaDeMandos(true)}

          {cuenta === undefined || rutaSiguiente === undefined ? null : (
            <div className="watch__next">
              <p className="watch__next-text">
                {t(DEFAULT_LOCALE, 'player.next.in', { seconds: cuenta })}
              </p>
              <Link className="button button--primary" to={rutaSiguiente}>
                {t(DEFAULT_LOCALE, 'player.next.now')}
              </Link>
              <button type="button" className="button" onClick={cancelarCuenta}>
                {t(DEFAULT_LOCALE, 'player.next.cancel')}
              </button>
            </div>
          )}

          {panelDeSala}
        </div>

        {listaDeEpisodios}
      </div>
    </section>
  )
}
