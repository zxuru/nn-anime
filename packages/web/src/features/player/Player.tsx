/**
 * Reproductor de la página.
 *
 * Usa el `<video>` del navegador y `hls.js` sólo cuando la fuente es HLS. Los
 * controles son propios porque los del navegador no se pueden atar a los atajos
 * del spec ni anunciarse por `aria-live`, pero **el elemento sigue siendo un
 * `<video>`**: sin `controls`, con controles nuestros, y con el teclado como
 * camino principal.
 *
 * La región `aria-live` es `polite` y no `assertive`: el estado del reproductor
 * cambia constantemente, y una región que interrumpe cada segundo hace que la
 * página sea inservible con un lector de pantalla.
 *
 * **Aquí no se guarda estado**: cada pieza con nombre tiene el suyo. El medio y
 * los avisos están en `usePlayer`; los gestos y la referencia del elemento en
 * `usePlayerGestos`; el menú, la ayuda y la pantalla completa en
 * `usePlayerAjustes`; el modo extendido en `usePlayerExtendido`; los mandos y el
 * ancho de la ventana en `usePlayerMandos`; el arrastre de la barra en
 * `usePlayerBarra`; los subtítulos en `usePlayerSubtitulos`; y el teclado en
 * `usePlayerTeclado`, con sus decisiones puras en `player-teclas` y `controls`.
 * Lo que se salta —el intervalo, el destino y el margen— lo decide la pantalla;
 * aquí sólo se ejecuta y se recuerda qué intervalos ya se saltaron, que es
 * memoria de la visita y no estado que se pinte. El marcado se reparte entre
 * `PlayerFrame` —el video y sus capas—, `PlayerSkip` —el botón de saltar—,
 * `PlayerSeekBar` —el carril con sus marcas— y `PlayerButtons` —la fila de
 * mandos—, y este archivo compone y elige qué se ve, igual que `WatchPage`.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { AudioModeSwitch } from './AudioModeSwitch'
import { etiquetaVelocidad, needsHls, volumeFromPercent, volumePercent } from './controls'
import { IconoAjustes, IconoReproducir, IconoSilencio, IconoVolumen } from './icons'
import { PlayerButtons } from './PlayerButtons'
import { PlayerErrorNotice } from './PlayerErrorNotice'
import { PlayerFrame } from './PlayerFrame'
import { PlayerSeekBar } from './PlayerSeekBar'
import { PlayerShortcuts } from './PlayerShortcuts'
import { PlayerSkipButton } from './PlayerSkip'
import type { PlayerProps } from './player-props'
import {
  almacenLocal,
  guardarVelocidad,
  leerVelocidad,
  VELOCIDADES,
  type Velocidad,
} from './storage'
import { useCompatPaint } from './useCompatPaint'
import { usePictureInPicture } from './usePictureInPicture'
import { usePlayer } from './usePlayer'
import { usePlayerAjustes } from './usePlayerAjustes'
import { usePlayerBarra } from './usePlayerBarra'
import { usePlayerExtendido } from './usePlayerExtendido'
import { usePlayerGestos } from './usePlayerGestos'
import { usePlayerMandos } from './usePlayerMandos'
import { usePlayerSubtitulos } from './usePlayerSubtitulos'
import { usePlayerTeclado } from './usePlayerTeclado'

export type { PlayerProps, PlayerSkip } from './player-props'

export function Player(props: PlayerProps): ReactNode {
  /**
   * El marco del reproductor.
   *
   * Es la caja que mide el video y la que contiene sus capas —el botón grande,
   * la espera y el botón de saltar—, así que es la que se pone a pantalla
   * completa: pedirla sobre el `<video>` dejaría el botón de saltar fuera de la
   * pantalla, y es justo donde hace más falta.
   */
  const marco = useRef<HTMLDivElement | null>(null)
  const objetivoPantalla = useCallback(() => marco.current, [])

  /**
   * La velocidad, en estado y en el almacén del navegador.
   *
   * El estado es lo que pinta qué opción está marcada; el almacén es lo que
   * hace que siga elegida al volver. El elemento lo toca `usePlayer`, que
   * vuelve a aplicarla al montar cada fuente.
   */
  const [velocidad, setVelocidad] = useState<Velocidad>(() => leerVelocidad(almacenLocal()))

  // Los avisos de reproducción, pausa y avance salen de los eventos del propio
  // elemento, no del render: llamarlos al pintar los dispararía en cada vuelta.
  const { state, videoRef, act, seekTo, setVolume, setRate, hlsTracks, pickHlsTrack, retry } =
    usePlayer({
      url: props.url,
      kind: props.kind,
      ...(props.onPlay === undefined ? {} : { onPlay: props.onPlay }),
      ...(props.onPause === undefined ? {} : { onPause: props.onPause }),
      ...(props.onProgress === undefined ? {} : { onProgress: props.onProgress }),
      ...(props.onDuration === undefined ? {} : { onDuration: props.onDuration }),
      ...(props.onEnded === undefined ? {} : { onEnded: props.onEnded }),
      ...(props.startAtS === undefined ? {} : { startAtS: props.startAtS }),
      ...(props.renovarFuente === undefined ? {} : { renovarFuente: props.renovarFuente }),
      rate: velocidad,
      fullscreenTarget: objetivoPantalla,
    })
  const pistas = props.tracks ?? []
  const intervalos = props.intervals ?? []

  // El elemento, sus gestos y el aviso a quien monta el reproductor —la sala—.
  const { elemento, refVideo, alClic, alDobleClic } = usePlayerGestos({
    videoRef,
    onVideoElement: props.onVideoElement,
    act,
  })
  // El modo compatible necesita el elemento en estado: el pintado arranca cuando
  // el `<canvas>` ya está montado, y eso pasa por un render.
  const { pintando, alternar, canvasRef } = useCompatPaint({
    video: elemento,
    url: props.url,
  })

  const {
    menu,
    alternarMenu,
    cerrarMenu,
    abrirAyuda,
    cerrarAyuda,
    ayudaAbierta,
    botonAjustes,
    cajaAjustes,
    dialogoAtajos,
    completa,
  } = usePlayerAjustes(marco)
  const extendido = usePlayerExtendido()
  const mandos = usePlayerMandos(state.playing, marco)
  const barra = usePlayerBarra({
    positionS: state.positionS,
    durationS: state.durationS,
    seekTo,
  })
  const subtitulos = usePlayerSubtitulos({
    declaradas: pistas,
    manifiesto: hlsTracks,
    pickHlsTrack,
    elemento,
    ninguna: t(DEFAULT_LOCALE, 'player.tracks.none'),
    sinNombre: t(DEFAULT_LOCALE, 'player.tracks.sinNombre'),
  })

  /**
   * El gesto de la velocidad: estado, almacén y elemento, en ese orden.
   *
   * Las tres cosas son la misma decisión. Guardar sólo la que se pinta dejaría
   * el video a 1× hasta la próxima visita; tocar sólo el elemento la perdería al
   * cambiar de episodio.
   */
  const cambiarVelocidad = useCallback(
    (valor: Velocidad) => {
      setVelocidad(valor)
      guardarVelocidad(almacenLocal(), valor)
      setRate(valor)
    },
    [setRate],
  )

  // El picture-in-picture sólo se ofrece donde el navegador lo tiene. El hook
  // escucha el elemento para saber si el video está dentro o fuera.
  const pip = usePictureInPicture(elemento)

  /**
   * Los intervalos que ya se saltaron en esta visita.
   *
   * La clave lleva el episodio y los dos extremos, así que volver a entrar en el
   * intervalo —con la barra o con la flecha— no dispara otro salto automático.
   * Se anota **cualquier** salto, no sólo el automático: si alguien saltó a mano,
   * el automático no tiene por qué volver a decidir por él.
   */
  const saltados = useRef(new Set<string>())

  /**
   * El salto, en una sola función.
   *
   * Es la que comparten el botón, la tecla `S` y el salto automático: el destino
   * lo decide la pantalla —que tiene el margen y los intervalos— y aquí sólo se
   * mueve el elemento y se avisa para que se apunte el progreso. Tener tres
   * caminos distintos sería tener tres formas de saltar que se separan.
   */
  const saltar = useCallback(() => {
    const salto = props.skip
    if (salto === undefined) return

    saltados.current.add(salto.key)
    seekTo(salto.destinoS)
    props.onSkip?.(salto.destinoS, salto.key)
  }, [props.skip, props.onSkip, seekTo])

  /**
   * El salto automático, una sola vez por intervalo y episodio.
   *
   * El conjunto vive en una referencia porque no se pinta: es memoria de lo ya
   * hecho. El botón sigue ofreciéndose al volver a entrar —eso permite saltar a
   * mano—, pero la reproducción no se mueve sola otra vez.
   */
  useEffect(() => {
    if (props.autoSkip !== true || props.skip === undefined) return
    if (saltados.current.has(props.skip.key)) return

    saltar()
  }, [props.autoSkip, props.skip, saltar])

  usePlayerTeclado({
    act,
    saltar,
    alternarExtendido: extendido.alternar,
    extendido: extendido.extendido,
    menu,
    ayudaAbierta,
    abrirAyuda,
    despertarMandos: mandos.despertar,
  })

  /**
   * Suena y no se ve.
   *
   * El audio puede reproducirse con la imagen en negro —un decodificador que no
   * arranca, una GPU que falla— y ni el elemento ni hls.js lo dicen. Se espera a
   * llevar dos segundos reproduciendo para no avisar durante la carga, que es
   * cuando `videoWidth` todavía es cero en cualquier reproducción.
   */
  const sinImagen = state.playing && state.videoWidth === 0 && state.positionS > 2

  /**
   * Lo que se está esperando, si se está esperando algo.
   *
   * Dos esperas distintas y una sola pregunta: al principio no hay ni
   * metadatos, y a mitad se acabaron los datos. Se cuenta encima del video, que
   * es donde está mirando quien la sufre; el texto suelto de antes quedaba
   * debajo de los controles y no se veía.
   */
  const espera = state.loading
    ? t(DEFAULT_LOCALE, 'player.loading')
    : state.buffering
      ? t(DEFAULT_LOCALE, 'player.buffering')
      : undefined

  // El botón grande de reproducir: en pausa y con el medio ya cargado. Durante la
  // carga manda el cartel de la espera, que dice qué se está esperando. Al
  // terminar, la tarjeta del siguiente ocupa ese sitio: un play sobre un video
  // que ya acabó no lleva a ninguna parte y tapaba la decisión.
  const enPausa = !state.playing && espera === undefined && props.nextCard === undefined

  /**
   * La lámina, sólo mientras no hay nada que ver.
   *
   * Se retira al primer play —y también si el medio ya trae un fotograma o si el
   * modo compatible está pintando— porque su sitio es el hueco, no la imagen.
   */
  const placa =
    props.plate !== undefined && !state.playing && state.positionS === 0 && !pintando
      ? props.plate
      : null

  const rotuloSilencio = state.muted
    ? t(DEFAULT_LOCALE, 'player.unmute')
    : t(DEFAULT_LOCALE, 'player.mute')

  /**
   * El menú de ajustes: el volumen cuando no cabe en la fila, el audio, el
   * reproductor externo, el modo compatible, los subtítulos, la reproducción
   * automática y la ayuda del teclado.
   *
   * Se queda en este archivo, y no en un componente propio, porque el menú
   * cerrado sigue en el documento —es lo que permite animar la salida— y su
   * `data-abierto`, su `inert` y su `aria-hidden` son el contrato con la hoja de
   * estilos: la prueba de la hoja los lee aquí.
   */
  const menuDeAjustes = (
    <div className="player__settings">
      <button
        type="button"
        ref={botonAjustes}
        className="button player__control"
        aria-label={t(DEFAULT_LOCALE, 'player.settings')}
        title={t(DEFAULT_LOCALE, 'player.settings')}
        aria-expanded={menu}
        aria-haspopup="true"
        onClick={alternarMenu}
      >
        <IconoAjustes />
      </button>

      <div
        className="player__menu"
        ref={cajaAjustes}
        data-abierto={menu}
        // Un diálogo no modal: se abre encima del video sin dejar de
        // verlo, y por eso no lleva `aria-modal` ni encierra el foco.
        // Cerrado sigue en el documento para poder animar la salida;
        // `inert` y `aria-hidden` lo sacan del foco y del árbol accesible.
        role="dialog"
        aria-label={t(DEFAULT_LOCALE, 'player.settings')}
        aria-hidden={!menu}
        inert={!menu}
      >
        {props.mode === undefined || props.onMode === undefined ? null : (
          <div className="player__menu-block">
            <p className="player__menu-title">{t(DEFAULT_LOCALE, 'player.audio')}</p>
            <AudioModeSwitch mode={props.mode} onMode={props.onMode} />
          </div>
        )}

        {/*
          La velocidad. Es una lista cerrada y con `aria-pressed`, como las
          pistas: se elige una y las demás quedan apagadas. El texto lleva la
          coma decimal de la casa —`1,25×`— y no el punto que devuelve `String`.
        */}
        <div className="player__menu-block">
          <p className="player__menu-title">{t(DEFAULT_LOCALE, 'player.speed')}</p>
          <ul className="player__menu-list">
            {VELOCIDADES.map((opcion) => (
              <li key={opcion}>
                <button
                  type="button"
                  className="button player__menu-choice"
                  aria-pressed={velocidad === opcion}
                  onClick={() => cambiarVelocidad(opcion)}
                >
                  {t(DEFAULT_LOCALE, 'player.speed.option', {
                    rate: etiquetaVelocidad(opcion),
                  })}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* La ventana flotante, sólo si el navegador la ofrece. El estado sale
            de los eventos del video y no de haber pulsado el botón: el
            navegador puede rechazar la petición y el mando no puede mentir. */}
        {pip.disponible ? (
          <button
            type="button"
            className="button player__menu-action"
            aria-pressed={pip.activo}
            onClick={() => void pip.alternar()}
          >
            {t(DEFAULT_LOCALE, pip.activo ? 'player.pip.exit' : 'player.pip')}
          </button>
        ) : null}

        {props.onMpv === undefined ? null : (
          <button type="button" className="button player__menu-action" onClick={props.onMpv}>
            {t(DEFAULT_LOCALE, 'player.mpv')}
          </button>
        )}

        {/* El volumen, cuando en la fila no cabe.
            Es el mismo grupo de la barra —botón y barra juntos, el
            mismo estado—, pero aquí dentro no hace falta esconder la
            barra tras el puntero: el menú ya es «donde se toca una vez».
            Sólo hay uno de los dos grupos en el documento: dos mandos con
            el mismo nombre accesible son un nombre ambiguo. */}
        {mandos.estrecho ? (
          <div className="player__menu-block">
            <p className="player__menu-title">{t(DEFAULT_LOCALE, 'player.volume')}</p>
            <div className="player__menu-volume">
              <button
                type="button"
                className="button player__control"
                aria-label={rotuloSilencio}
                title={rotuloSilencio}
                aria-keyshortcuts="M"
                onClick={() => act('mute')}
              >
                {state.muted ? <IconoSilencio /> : <IconoVolumen />}
              </button>
              <input
                className="player__range player__slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={volumePercent(state.volume)}
                aria-label={t(DEFAULT_LOCALE, 'player.volume')}
                onChange={(evento) => setVolume(volumeFromPercent(Number(evento.target.value)))}
              />
            </div>
          </div>
        ) : null}

        {/* El modo compatible, como interruptor. La sonda lo enciende
            sola cuando ve el fallo, pero una sonda que mira un
            fotograma puede no verlo: quien está mirando la pantalla en
            negro lo enciende aquí. `aria-pressed` dice si está
            encendido, y el texto no cambia con el estado para que se
            lea como un interruptor y no como una acción. */}
        <button
          type="button"
          className="button player__menu-action"
          aria-pressed={pintando}
          onClick={alternar}
        >
          {t(DEFAULT_LOCALE, 'player.compat')}
        </button>

        {subtitulos.opciones.length <= 1 ? null : (
          <div className="player__menu-block">
            <p className="player__menu-title">{t(DEFAULT_LOCALE, 'player.tracks.pick')}</p>
            <ul className="player__menu-list">
              {subtitulos.opciones.map((opcion) => (
                <li key={opcion.key}>
                  <button
                    type="button"
                    className="button player__menu-choice"
                    aria-pressed={opcion.pressed}
                    onClick={() => subtitulos.elegir(opcion.choice)}
                  >
                    {opcion.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {props.onAutoplay === undefined ? null : (
          <label className="player__menu-switch">
            {/* La casilla nativa sigue siendo la que guarda el estado y
                la que se anuncia; el dibujo de interruptor lo pone el
                tirador de al lado, que va `aria-hidden` para que el
                nombre del mando siga siendo sólo el texto. */}
            <span className="player__switch-box">
              <input
                type="checkbox"
                className="player__switch"
                checked={props.autoplay ?? true}
                onChange={(evento) => props.onAutoplay?.(evento.target.checked)}
              />
              <span className="player__switch-knob" aria-hidden="true" />
            </span>
            {t(DEFAULT_LOCALE, 'player.autoplay')}
          </label>
        )}

        <button
          type="button"
          className="button player__menu-action"
          onClick={() => {
            cerrarMenu()
            abrirAyuda()
          }}
        >
          {t(DEFAULT_LOCALE, 'player.keys.open')}
        </button>
      </div>
    </div>
  )

  return (
    <section className="player" data-tour={props.dataTour} data-extendido={extendido.extendido}>
      {/* El escenario: el video con sus capas dentro del marco, y los mandos.
          En una ventana estrecha los mandos van debajo, dentro del escenario, y
          por eso el botón grande, la espera y el lienzo se centran en **la
          imagen** y no en la caja entera. */}
      <div
        className="player__stage"
        onPointerMove={mandos.despertar}
        onPointerDown={mandos.despertar}
      >
        <PlayerFrame
          refVideo={refVideo}
          marco={marco}
          onClick={alClic}
          onDoubleClick={alDobleClic}
          poster={props.poster}
          etiqueta={props.title ?? t(DEFAULT_LOCALE, 'player.label')}
          pistas={pistas}
          pintando={pintando}
          canvasRef={canvasRef}
          espera={espera}
        >
          {/* La lámina va debajo de todo lo que se pulsa: si no hay póster, es
              lo que se ve en el hueco hasta que el video tiene imagen. */}
          {placa}

          {/* El botón de reproducir, grande y en el centro. Es decoración para el
            ojo —quien no ve la pantalla tiene el mando de la barra, que sí se
            anuncia— y por eso va `aria-hidden` y sin recibir el puntero: el clic
            es del video, que es toda la superficie. */}
          {enPausa ? (
            <div className="player__overlay" aria-hidden="true">
              <span className="player__play-icon">
                <IconoReproducir className="player__play-glyph" />
              </span>
            </div>
          ) : null}

          {/* El botón de saltar, dentro del marco: es la caja que se pone a
              pantalla completa, así que aquí también se ve ahí. Sin intervalo no
              se pinta nada y la pantalla queda como estaba. */}
          <PlayerSkipButton skip={props.skip} onSaltar={saltar} />

          {/* La tarjeta del siguiente también dentro del marco: al terminar el
              capítulo, la decisión está donde se mira y no en el pie de la
              página, que a 1366×768 ya no se ve. */}
          {props.nextCard}
        </PlayerFrame>

        {/* Los mandos: la barra de progreso y su fila de botones.
            En escritorio se superponen al borde inferior del video, con un
            degradado que los separa de la imagen sin taparla; en una ventana
            estrecha van **debajo** del video y dentro del escenario, porque una
            barra superpuesta sobre un video de 167 px de alto se come la imagen.
            `data-oculto` los esconde sin sacarlos del documento —`display: none`
            devolvería el foco al `body` en mitad de una reproducción— y sin recibir
            el puntero; en móvil no se esconden, porque no tapan nada. */}
        <div className="player__controls" data-oculto={state.playing && !mandos.visibles}>
          <PlayerSeekBar
            posicion={barra.posicion}
            duracion={barra.duracion}
            bufferedS={state.bufferedS}
            sobreBarra={barra.sobreBarra}
            intervalos={intervalos}
            onArrastrar={barra.arrastrar}
            onSoltar={barra.soltar}
            onMoverPuntero={barra.moverPuntero}
            onSalir={barra.salir}
          />

          <PlayerButtons
            playing={state.playing}
            muted={state.muted}
            volume={state.volume}
            posicion={barra.posicion}
            duracionS={state.durationS}
            estrecho={mandos.estrecho}
            compacto={mandos.compacto}
            completa={completa}
            extendida={extendido.extendido}
            act={act}
            onVolumen={setVolume}
            onAlternarExtendida={extendido.alternar}
          >
            {menuDeAjustes}
          </PlayerButtons>
        </div>
      </div>

      {sinImagen ? <p className="search__error">{t(DEFAULT_LOCALE, 'player.sinImagen')}</p> : null}

      {pintando ? <p className="player__note">{t(DEFAULT_LOCALE, 'player.compat.on')}</p> : null}

      {state.error === undefined ? null : (
        <PlayerErrorNotice error={state.error} retryable={state.retryable} onRetry={retry} />
      )}

      {/* El estado, para quien no ve la pantalla: el párrafo está fuera del flujo
          —`solo-lectores`, que es lo que en otros sitios se llama `sr-only`— y su
          texto **no** se rehace con el reloj: `usePlayer` sólo lo cambia cuando
          pasa algo que se cuenta —empezar, parar, buscar, terminar o fallar—.
          Una región `aria-live` que cambia cuatro veces por segundo no deja oír
          nada más. */}
      <p className="solo-lectores" aria-live="polite">
        {state.status}
      </p>

      {/* El aviso cuenta las dos clases de pista: para quien lee, «subtítulos
          disponibles» son las que puede elegir, vengan del proveedor o del
          manifiesto. */}
      {pistas.length + hlsTracks.length === 0 ? null : (
        <p className="player__note">
          {t(DEFAULT_LOCALE, 'player.tracks', { count: pistas.length + hlsTracks.length })}
        </p>
      )}

      {/* La atribución sólo aparece cuando se usa la biblioteca: hls.js es
          Apache 2.0 y su licencia pide conservar el aviso. Lleva clase propia
          porque el modo extendido la esconde: ahí la pantalla es para el
          contenido, y la nota, fuera del marco, le quitaba alto a la imagen. */}
      {needsHls(props.kind) ? (
        <p className="player__note player__attribution">
          {t(DEFAULT_LOCALE, 'player.attribution')}
        </p>
      ) : null}

      {/* La ayuda del teclado, en un diálogo y no siempre a la vista: el
          navegador se encarga del `Esc` y del encierro del foco. */}
      <PlayerShortcuts dialogRef={dialogoAtajos} onClose={cerrarAyuda} />
    </section>
  )
}
