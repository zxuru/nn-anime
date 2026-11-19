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

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Skeleton } from '../../components/Skeleton'
import { t } from '../../i18n'
import { episodeLabel } from '../../lib/document-title'
import { buildPath, Link } from '../../router'
import { DownloadButton } from '../downloads/DownloadButton'
import { ANCLAS } from '../guia/guia'
import { PartyBar } from '../party/PartyBar'
import { PartyPanel } from '../party/PartyPanel'
import { muestraBotonSala, usePartyAvailable } from '../party/usePartyAvailable'
import { AudioModeSwitch } from './AudioModeSwitch'
import { formatTime } from './controls'
import { Player } from './Player'
import { PlayerPlate } from './PlayerPlate'
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
  /*
    La sala se comprueba aparte de la página: es un extra del servidor y no un
    dato del episodio. Sin `RONA_PARTY=1` el mando no se pinta, que es lo único
    que impide ofrecer un panel que sólo puede responder «esa sala no existe».
  */
  const sala = usePartyAvailable()
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
    saltoAuto,
    setDuracion,
    saltoVisible,
    intervalosSaltables,
    alSaltar,
    mpv,
    recargar,
    renovarFuente,
    anotarProgreso,
    alTerminar,
    cuenta,
    finDeEpisodio,
    cancelarCuenta,
    rutaSiguiente,
    esPelicula,
    lineaEpisodio,
    etiquetaEpisodio,
    elementoVideo,
    nombreCompleto,
    estadoFicha,
  } = pagina

  /**
   * La reanudación, contada.
   *
   * El video arranca en el segundo guardado y no lo decía; la promesa del
   * producto es que al volver está donde lo dejaste, y eso se cuenta o no
   * existe. Se captura la posición de arranque una vez —la página se remonta
   * por episodio— y se deja de enseñar en cuanto la reproducción se mueve o se
   * empieza de cero.
   */
  const [reanudaEn] = useState(() => (posicion > 0 ? posicion : undefined))
  const mostrarReanudar = reanudaEn !== undefined && Math.abs(posicion - reanudaEn) < 0.05

  const empezarDeCero = (): void => {
    setPosicion(0)
    if (elementoVideo !== null) elementoVideo.currentTime = 0
  }

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
      {/* El nombre y su episodio en una columna que cede: el titular se corta
          con puntos suspensivos antes de llegar a los mandos. Antes los mandos
          iban anclados en absoluto sobre un encabezado que no reservaba su
          hueco, y el titular largo se metía debajo. */}
      <div className="watch__head-text">
        <Link
          className="watch__back"
          to={buildPath('detail', { providerId: props.providerId, ref: animeRef.value })}
          state={estadoFicha}
        >
          {t(DEFAULT_LOCALE, 'player.backToDetail')}
        </Link>
        <h1>{tituloAnime ?? t(DEFAULT_LOCALE, 'title.loading')}</h1>
        {lineaEpisodio === undefined ? null : (
          <p className="watch__episode">
            {lineaEpisodio}
            {mostrarReanudar ? (
              <span className="watch__resume">
                {' · '}
                {t(DEFAULT_LOCALE, 'player.resume', { time: formatTime(reanudaEn ?? 0) })}{' '}
                <button type="button" className="watch__restart" onClick={empezarDeCero}>
                  {t(DEFAULT_LOCALE, 'player.resume.restart')}
                </button>
              </span>
            ) : null}
          </p>
        )}
      </div>
      {/* «Ver juntos» y la descarga, en la misma fila del encabezado: la sala se
          mide contra la ventana y un bloque más debajo empujaba la página. El
          botón abre el panel de la sala; la descarga es la misma de siempre y
          hereda el modo que se está viendo, para no descargar el contrario de lo
          que suena. El botón de la sala sólo existe si el servidor la tiene
          montada: sin `party` en el health, un panel aquí sólo puede fallar. */}
      <div className="watch__actions">
        {muestraBotonSala(sala) ? (
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
        ) : null}
        <DownloadButton
          providerId={props.providerId}
          animeRef={animeRef}
          episodeRef={episodeRef}
          mode={modo}
        />
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
    <nav className="watch__steps" aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
      {vecinos?.previous === undefined ? (
        <span
          className="watch__nav-off"
          aria-disabled="true"
          title={t(DEFAULT_LOCALE, 'player.firstEpisode')}
        >
          <EpisodeArrow towards="previous" />
          {t(DEFAULT_LOCALE, 'player.previous')}
          <span className="solo-lectores">{t(DEFAULT_LOCALE, 'player.firstEpisode')}</span>
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
          <span className="solo-lectores">{t(DEFAULT_LOCALE, 'player.lastEpisode')}</span>
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
    </nav>
  )

  /**
   * La fila de mandos bajo el reproductor.
   *
   * A la izquierda el salto de episodio y a la derecha la elección de audio, que
   * es lo que se cambia a menudo y por eso no vive dentro del menú de ajustes.
   * En la carga y en el error sólo van las flechas: el modo no resuelve nada
   * cuando no hay fuente.
   *
   * El contenedor es un `div` y no un `nav`: el `nav` con nombre es el de las
   * flechas, y el audio tiene su propio grupo con nombre. Antes el mismo `nav`
   * se llamaba «Episodios» y contenía el conmutador de audio.
   */
  const filaDeMandos = (conAudio: boolean): ReactNode => (
    <div className="watch__nav" data-tour={ANCLAS.reproductorMandos}>
      {pasos}
      {conAudio ? <AudioModeSwitch mode={modo} onMode={cambiarModo} /> : null}
    </div>
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

  /**
   * La tarjeta del episodio siguiente.
   *
   * Se monta **dentro del marco**, y por eso viaja al reproductor como nodo y no
   * como bloque de la columna: antes iba detrás de la fila de mandos y a
   * 1366×768 el «Reproducir ahora» quedaba por debajo del borde de la ventana.
   * La cuenta atrás decide sola en ocho segundos, así que esconder el mando no
   * era un detalle de composición: era dejar que la página cambiara sin que se
   * viera la salida.
   *
   * Con la reproducción automática apagada —o después de cancelar— la tarjeta
   * sigue: el capítulo terminó y su salida natural sigue siendo el siguiente.
   * Sólo desaparece el «Cancelar», que ya no tiene nada que parar.
   *
   * El nombre del episodio va en su propio renglón y con el mismo criterio que
   * la lista: número y título, sin repetir el número cuando el proveedor vuelve
   * a llamar al capítulo «Episodio 4».
   */
  const siguiente = vecinos?.next
  const nombreSiguiente =
    siguiente === undefined ? undefined : episodeLabel(siguiente.number, siguiente.title)

  const tarjetaSiguiente =
    finDeEpisodio && rutaSiguiente !== undefined && siguiente !== undefined ? (
      <div className="watch__next">
        <div className="watch__next-info">
          <p className="watch__next-text">
            {cuenta === undefined
              ? t(DEFAULT_LOCALE, 'player.next.ended')
              : t(DEFAULT_LOCALE, 'player.next.in', { seconds: cuenta })}
          </p>
          {nombreSiguiente === undefined ? null : (
            <p className="watch__next-name">{nombreSiguiente}</p>
          )}
        </div>
        <Link className="button button--primary" to={rutaSiguiente}>
          {t(DEFAULT_LOCALE, 'player.next.now')}
        </Link>
        {cuenta === undefined ? null : (
          <button type="button" className="button" onClick={cancelarCuenta}>
            {t(DEFAULT_LOCALE, 'player.next.cancel')}
          </button>
        )}
        {/* Un solo anuncio al aparecer. La cuenta atrás cambia cada segundo y no
            puede ser la región viva: un lector de pantalla no dejaría oír nada
            más. Lo que se anuncia es el hecho y la salida, no el reloj. */}
        <p className="solo-lectores" role="status">
          {t(DEFAULT_LOCALE, 'player.next.ready', {
            episode: nombreSiguiente ?? t(DEFAULT_LOCALE, 'player.next.unknown'),
          })}
        </p>
      </div>
    ) : undefined

  if (estado === 'loading') {
    return (
      <section className="watch">
        <div className="watch__layout">
          <div className="watch__main">
            {encabezado}
            {party.phase === 'idle' ? null : <PartyBar party={party} />}
            {/* El marco se reserva con su forma y su ancho: sin esto el video y
                la lista aparecían de golpe al resolver la fuente y la pantalla
                saltaba. El bloque es decoración; la frase sigue debajo para
                quien no lo ve. */}
            <Skeleton h="auto" r={0} className="watch__loading-frame" />
            <p className="empty" role="status">
              {t(DEFAULT_LOCALE, 'player.loading')}
            </p>
            {panelDeSala}
          </div>
          {esPelicula ? null : (
            <aside className="watch__aside" aria-hidden="true">
              <div className="watch__list-skeleton">
                {[0, 1, 2, 3, 4, 5].map((fila) => (
                  <Skeleton key={fila} h="2rem" />
                ))}
              </div>
            </aside>
          )}
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
            plate={<PlayerPlate poster={portada} title={tituloAnime} episode={etiquetaEpisodio} />}
            tracks={pistas}
            // El reproductor externo es de la pantalla, no del elemento de
            // video: el menú de ajustes del reproductor lo recibe para no tener
            // una segunda copia del estado.
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
            // La duración, en cuanto `loadedmetadata` la conoce: con ella se
            // piden los intervalos saltables. No bloquea nada de lo de arriba.
            onDuration={setDuracion}
            // El salto que se ofrece ahora y lo que hay que hacer al pulsarlo.
            // Sin intervalo no hay botón; con el ajuste apagado —que es el de
            // fábrica— tampoco salta solo.
            skip={saltoVisible}
            autoSkip={saltoAuto}
            onSkip={alSaltar}
            // Los intervalos, para marcarlos en la barra de progreso. Sin datos
            // la lista está vacía y la barra queda como estaba.
            intervals={intervalosSaltables}
            nextCard={tarjetaSiguiente}
          />

          {filaDeMandos(true)}

          {panelDeSala}
        </div>

        {listaDeEpisodios}
      </div>
    </section>
  )
}
