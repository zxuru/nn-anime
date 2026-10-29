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
 * Los mandos van **encima del video**, en una banda con degradado, y se esconden
 * solos mientras reproduce: una fila de botones permanentes sobre la imagen es
 * ruido, y debajo del marco obligaba a desplazar la página para tocar cualquier
 * cosa.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { AudioModeSwitch } from './AudioModeSwitch'
import {
  CLICK_DELAY_MS,
  formatTime,
  isTypingTarget,
  keyAction,
  needsHls,
  spokenTime,
  volumeFromPercent,
  volumePercent,
} from './controls'
import {
  IconoAdelante,
  IconoAjustes,
  IconoAtras,
  IconoPantallaCompleta,
  IconoPausar,
  IconoReproducir,
  IconoSalirPantallaCompleta,
  IconoSilencio,
  IconoVolumen,
} from './icons'
import { type SubtitleChoice, subtitleAction, subtitleOptions } from './subtitle-menu'
import { isProxyPath } from './subtitle-tracks'
import { useCompatPaint } from './useCompatPaint'
import { type SafeTrack, usePlayer } from './usePlayer'
import type { PlayMode } from './watch-route'

/**
 * Lo que tarda la barra en esconderse sola mientras el video reproduce.
 *
 * Tres segundos: lo que se tarda en decidir que no se va a tocar nada. Menos
 * parpadea cada vez que alguien señala la pantalla, y más deja los mandos encima
 * de la imagen todo el rato, que es lo que había antes.
 */
const INACTIVIDAD_MS = 3000

/**
 * Los dos anchos a partir de los cuales la barra cambia de forma.
 *
 * En una ventana estrecha los mandos dejan de superponerse al video y se van
 * debajo, dentro del reproductor: con un video de 167 px de alto, una barra
 * encima se come la imagen. Y por debajo del segundo —un teléfono en vertical— no
 * caben los saltos de diez segundos, que en el táctil los hace el doble toque en
 * los bordes.
 *
 * Los mismos números viven en `tokens.css` como puntos de corte, porque el CSS no
 * puede leer un token dentro de un `@media`: la prueba de la hoja comprueba que
 * coincidan. Aquí deciden **qué mandos hay** —y dónde va el volumen, que en móvil
 * se muda al menú—; allí, cómo se colocan.
 */
const ANCHO_ESTRECHO = 600
const ANCHO_COMPACTO = 480

/** Zona de los bordes del video, en tanto por uno, donde el doble toque salta. */
const ZONA_SALTO = 0.3

/**
 * ¿La ventana cumple esta consulta de ancho?
 *
 * Se pregunta al montar y se escucha el cambio: girar el teléfono o encoger la
 * ventana tiene que mover el volumen al menú sin recargar la página. La primera
 * respuesta llega en un efecto y no en el render, así que en el servidor —donde no
 * hay `window`— vale «no»: la barra se pinta como la de escritorio y se corrige en
 * el primer efecto, que es antes de que el video tenga imagen.
 */
function useAnchoHasta(ancho: number): boolean {
  const [cumple, setCumple] = useState(false)

  useEffect(() => {
    const consulta = window.matchMedia(`(max-width: ${ancho}px)`)
    const alCambiar = (): void => setCumple(consulta.matches)

    alCambiar()
    consulta.addEventListener('change', alCambiar)

    return () => consulta.removeEventListener('change', alCambiar)
  }, [ancho])

  return cumple
}

export interface PlayerProps {
  /** URL del proxy: el ticket, nunca la del upstream. */
  readonly url: string
  readonly kind: string
  readonly title?: string | undefined
  /** Pistas que el navegador puede pintar, ya filtradas. */
  readonly tracks?: readonly SafeTrack[] | undefined
  /**
   * La imagen que se ve antes del primer fotograma.
   *
   * Es la portada del título servida por el proxy —`/api/cover/...`—, y sólo se
   * pasa cuando el proveedor dio una: sin portada, el `<video>` se queda con su
   * fondo, que es lo que había antes de esto. Inventar una dirección aquí sería
   * pedirle una imagen a un sitio que no dijo tenerla.
   */
  readonly poster?: string | undefined
  /**
   * El modo de audio con el que se está viendo, si quien monta el reproductor lo
   * sabe.
   *
   * Va aquí y no dentro del reproductor porque el estado es de la pantalla: el
   * mismo valor decide qué stream se pide al servidor («doblado», «subtitulado»)
   * y la fila de mandos de debajo del video lo pinta. El menú de ajustes lo
   * repite porque es donde se busca cuando no se ve, y las dos copias escriben en
   * el mismo sitio.
   */
  readonly mode?: PlayMode | undefined
  readonly onMode?: ((mode: PlayMode) => void) | undefined
  /** Abrir el episodio en el reproductor externo. Sin esto no se ofrece. */
  readonly onMpv?: (() => void) | undefined
  /**
   * Si el episodio siguiente empieza solo, y cómo cambiarlo.
   *
   * La preferencia la guarda la pantalla —es suya, porque es ella la que sabe
   * cuál es el episodio siguiente— y aquí sólo se pinta el interruptor, que vive
   * con los demás ajustes.
   */
  readonly autoplay?: boolean | undefined
  readonly onAutoplay?: ((valor: boolean) => void) | undefined
  /** Se llama al empezar a reproducir de verdad, no al cargar la página. */
  readonly onPlay?: (() => void) | undefined
  readonly onPause?: (() => void) | undefined
  readonly onProgress?: ((positionS: number, durationS: number) => void) | undefined
  /**
   * El episodio llegó al final.
   *
   * Sale del evento del elemento y no de la posición: una pausa en el último
   * segundo y el final se parecen, y de aquí sale la tarjeta del siguiente.
   */
  readonly onEnded?: (() => void) | undefined
  /** Segundo en el que empezar, al reanudar o al cambiar de modo. */
  readonly startAtS?: number | undefined
  /** El ancla de la guía: el reproductor es una parada del recorrido. */
  readonly dataTour?: string | undefined
}

/**
 * Los atajos que el reproductor escucha, con su tecla y lo que hace.
 *
 * Es la ayuda que se pinta debajo de los controles, y por eso está en dos
 * piezas: la tecla —que se dibuja como una tecla— y su frase. Antes era una
 * sola línea de texto corrido y no se leía como lo que es: teclas que se pueden
 * pulsar.
 *
 * El orden es el que se aprende, no el del `switch` de `keyAction`: primero lo
 * que hace todo el mundo, y al final lo que se busca una vez.
 */
const ATAJOS: readonly { readonly teclas: readonly string[]; readonly hace: string }[] = [
  { teclas: ['player.key.space', 'player.key.enter', 'player.key.k'], hace: 'player.key.toggle' },
  { teclas: ['player.key.left', 'player.key.right'], hace: 'player.key.seek' },
  { teclas: ['player.key.up', 'player.key.down'], hace: 'player.key.volume' },
  { teclas: ['player.key.m'], hace: 'player.key.mute' },
  { teclas: ['player.key.f'], hace: 'player.key.fullscreen' },
]

/** Lo que ocupa una parte del total, en por ciento, sin salirse de la barra. */
function porcentaje(valor: number, total: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(total) || total <= 0) return 0

  return Math.min(Math.max((valor / total) * 100, 0), 100)
}

/**
 * ¿El dispositivo tiene puntero fino?
 *
 * El doble clic para la pantalla completa sólo tiene sentido con ratón: en una
 * pantalla táctil, el doble toque es hacer zum, y el navegador lo resuelve él.
 * Se pregunta en el momento del gesto y no al montar: el mismo navegador cambia
 * de respuesta cuando se le enchufa un ratón.
 */
function punteroFino(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true
}

export function Player(props: PlayerProps): ReactNode {
  // Los avisos de reproducción, pausa y avance salen de los eventos del propio
  // elemento, no del render: llamarlos al pintar los dispararía en cada vuelta.
  const { state, videoRef, act, seekTo, setVolume, hlsTracks, pickHlsTrack } = usePlayer({
    url: props.url,
    kind: props.kind,
    ...(props.onPlay === undefined ? {} : { onPlay: props.onPlay }),
    ...(props.onPause === undefined ? {} : { onPause: props.onPause }),
    ...(props.onProgress === undefined ? {} : { onProgress: props.onProgress }),
    ...(props.onEnded === undefined ? {} : { onEnded: props.onEnded }),
    ...(props.startAtS === undefined ? {} : { startAtS: props.startAtS }),
  })
  const pistas = props.tracks ?? []

  /**
   * El mismo elemento, para el modo compatible.
   *
   * `usePlayer` lo guarda en una referencia porque sólo tiene que tocarlo; el
   * modo compatible necesita además **mirarlo** —el fotograma— y pintarlo, así
   * que aquí vive en estado: el pintado arranca cuando el `<canvas>` ya está
   * montado, y eso pasa por un render.
   */
  const [elemento, setElemento] = useState<HTMLVideoElement | null>(null)
  const { pintando, alternar, canvasRef } = useCompatPaint({ video: elemento, url: props.url })
  const refVideo = useCallback(
    (nodo: HTMLVideoElement | null) => {
      videoRef(nodo)
      setElemento(nodo)
    },
    [videoRef],
  )

  /**
   * La posición mientras se arrastra la barra, si se está arrastrando.
   *
   * Sin esto, la barra es un campo controlado por el estado del reproductor y el
   * pulgar vuelve a su sitio entre dos avisos del elemento —el `timeupdate` llega
   * cuatro veces por segundo—: se ve temblar y cuesta soltarlo donde se quiere.
   * Mientras dura el arrastre manda el dedo; al soltar, manda el video.
   */
  const [arrastre, setArrastre] = useState<number | undefined>(undefined)

  /**
   * El menú de ajustes y el diálogo de atajos.
   *
   * El menú es un popover y no un diálogo: se abre sobre el video sin taparlo
   * —lo que se ajusta se ajusta mientras se ve— y se cierra con `Esc`, con un
   * clic fuera o volviendo a pulsar su botón, que es donde queda el foco. Los
   * atajos sí son un `<dialog>`: ahí no hay nada que mirar detrás y el navegador
   * trae el `Esc` y el encierro del foco hechos.
   */
  const [menu, setMenu] = useState(false)
  const [atajos, setAtajos] = useState(false)
  const botonAjustes = useRef<HTMLButtonElement | null>(null)
  const cajaAjustes = useRef<HTMLDivElement | null>(null)
  const dialogoAtajos = useRef<HTMLDialogElement | null>(null)

  /**
   * Los subtítulos que están puestos: una pista del proveedor, una del manifiesto
   * o ninguno.
   *
   * El elemento trae una pista por subtítulo declarado y las pinta él: lo único
   * que hay que hacer es decirle cuál. La primera —la que el proveedor prefiere—
   * viene marcada por defecto, y aquí se puede cambiar o apagar sin salir de la
   * pantalla, que es lo que faltaba: un episodio con subtítulos forzados en otro
   * idioma no tenía arreglo.
   *
   * Las del manifiesto —las que trae la propia lista HLS— son el otro origen, y
   * van en la misma decisión: encender una apaga la otra. Ver `subtitle-menu`.
   */
  const [elegida, setElegida] = useState<SubtitleChoice>(
    pistas.length === 0 ? { origen: 'ninguna' } : { origen: 'declarada', indice: 0 },
  )

  /** Aplica una elección: al elemento por un lado y a hls.js por el otro. */
  const elegirSubtitulos = useCallback(
    (choice: SubtitleChoice) => {
      setElegida(choice)
      pickHlsTrack(subtitleAction(choice).manifiesto)
    },
    [pickHlsTrack],
  )

  /**
   * Las entradas del menú: los dos orígenes en una sola lista.
   *
   * Se calcula al pintar y no se guarda: las pistas del manifiesto llegan cuando
   * hls.js lo parsea, así que una copia guardada se quedaría vieja justo en la
   * vuelta en que aparece la primera pista.
   */
  const opcionesSubtitulos = subtitleOptions({
    declaradas: pistas,
    manifiesto: hlsTracks,
    elegida,
    ninguna: t(DEFAULT_LOCALE, 'player.tracks.none'),
    sinNombre: t(DEFAULT_LOCALE, 'player.tracks.sinNombre'),
  })

  useEffect(() => {
    const video = elemento
    if (video === null) return

    const lista = video.textTracks
    const encendida = subtitleAction(elegida).declarada

    // Se recorre el número de pistas del componente y no el del elemento: al
    // cambiar de fuente —de subtitulado a doblado— el `<video>` es el mismo y sus
    // `textTracks` se rehacen, así que el efecto tiene que volver a correr cuando
    // la lista cambia aunque el elemento no. Y las que hls.js añade por su cuenta
    // —una pista del manifiesto— van **detrás** de las nuestras, así que este
    // recorrido no las toca.
    for (let indice = 0; indice < pistas.length; indice++) {
      const actual = lista[indice]
      if (actual === undefined) continue

      actual.mode = encendida === indice ? 'showing' : 'disabled'
    }
  }, [elemento, elegida, pistas.length])

  // El diálogo se abre con la API del elemento y no con un atributo: `showModal`
  // es lo que trae el `Esc`, el encierro del foco y el fondo inerte.
  useEffect(() => {
    const dialogo = dialogoAtajos.current
    if (dialogo === null) return

    if (atajos && !dialogo.open) dialogo.showModal()
    if (!atajos && dialogo.open) dialogo.close()
  }, [atajos])

  // Fuera del menú, y con `Esc`, se cierra. El manejador sólo existe mientras
  // está abierto: uno permanente escucharía clics de toda la aplicación.
  useEffect(() => {
    if (!menu) return

    const alPulsar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return

      setMenu(false)
      botonAjustes.current?.focus()
    }
    const alPulsarFuera = (evento: PointerEvent): void => {
      if (!(evento.target instanceof Node)) return
      if (cajaAjustes.current?.contains(evento.target) === true) return
      if (botonAjustes.current?.contains(evento.target) === true) return

      setMenu(false)
    }

    document.addEventListener('keydown', alPulsar)
    document.addEventListener('pointerdown', alPulsarFuera)

    return () => {
      document.removeEventListener('keydown', alPulsar)
      document.removeEventListener('pointerdown', alPulsarFuera)
    }
  }, [menu])

  /**
   * El segundo sobre el que está el puntero, si está sobre la barra.
   *
   * Es el globo que dice el tiempo antes de soltar: sin él hay que arrastrar a
   * ciegas hasta el punto que se busca. Es estado y no CSS porque el texto cambia
   * con la posición, y se apaga al salir de la barra para no tapar el video.
   */
  const [sobreBarra, setSobreBarra] = useState<number | undefined>(undefined)

  /**
   * Si se está a pantalla completa, que es lo que decide el dibujo del mando.
   *
   * El botón tiene que decir a dónde lleva, y el mismo gesto entra y sale: sin
   * escuchar el cambio del navegador —que también ocurre al salir con `Esc`—, el
   * dibujo se quedaría diciendo «entrar» dentro de la pantalla completa.
   */
  const [completa, setCompleta] = useState(false)

  useEffect(() => {
    const alCambiar = (): void => setCompleta(document.fullscreenElement !== null)

    document.addEventListener('fullscreenchange', alCambiar)

    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  /**
   * Los mandos a la vista, y cuándo se esconden.
   *
   * Sólo se esconden mientras reproduce: en pausa no hay nada que quitar de
   * encima del fotograma y los mandos son lo único que se puede hacer. El
   * temporizador se reinicia con cualquier gesto sobre el marco y con el foco del
   * teclado —eso lo resuelve el CSS con `:focus-within`—, así que la barra vuelve
   * antes de que nadie la eche de menos.
   */
  const [mandos, setMandos] = useState(true)
  const reloj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reiniciarMandos = useCallback(() => {
    setMandos(true)
    if (reloj.current !== undefined) clearTimeout(reloj.current)

    reloj.current = setTimeout(() => setMandos(false), INACTIVIDAD_MS)
  }, [])

  useEffect(() => {
    if (reloj.current !== undefined) clearTimeout(reloj.current)

    if (!state.playing) {
      setMandos(true)

      return
    }

    reiniciarMandos()

    return () => {
      if (reloj.current !== undefined) clearTimeout(reloj.current)
    }
  }, [state.playing, reiniciarMandos])

  const duracion = Number.isFinite(state.durationS) && state.durationS > 0 ? state.durationS : 0
  const posicion = Math.min(arrastre ?? state.positionS, duracion)

  // La forma de la barra, según la ventana. Ver `useAnchoHasta`.
  const estrecho = useAnchoHasta(ANCHO_ESTRECHO)
  const compacto = useAnchoHasta(ANCHO_COMPACTO)

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

  /**
   * El clic sencillo, que espera a ver si es el principio de un doble clic.
   *
   * El navegador no dice «esto era un clic» hasta que pasa la ventana del doble
   * clic: manda `click`, `click` y luego `dblclick`. Sin la espera, el clic
   * sencillo y el doble son el mismo gesto para nosotros, y el que lleva las de
   * perder es el que más se usa —pausar—, que se sentiría tarde.
   */
  const clicPendiente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelarClic = useCallback(() => {
    if (clicPendiente.current === undefined) return

    clearTimeout(clicPendiente.current)
    clicPendiente.current = undefined
  }, [])
  // Un temporizador vivo después del desmontaje pausaría un video que ya no está.
  useEffect(() => cancelarClic, [cancelarClic])

  const alClic = useCallback(() => {
    cancelarClic()
    clicPendiente.current = setTimeout(() => {
      clicPendiente.current = undefined
      act('toggle')
    }, CLICK_DELAY_MS)
  }, [act, cancelarClic])

  /**
   * El doble gesto: saltar en los bordes, pantalla completa en el centro.
   *
   * Es la convención de todos los reproductores y aquí es además lo que deja
   * quitar los botones de ±10 s en un teléfono: el borde izquierdo retrocede, el
   * derecho adelanta. La pantalla completa se queda en el centro y sólo con ratón:
   * en táctil, el doble toque en medio es hacer zum y lo resuelve el navegador.
   */
  const alDobleClic = useCallback(
    (evento: ReactPointerEvent<HTMLVideoElement>) => {
      cancelarClic()

      const caja = evento.currentTarget.getBoundingClientRect()
      const relativo = caja.width <= 0 ? 0.5 : (evento.clientX - caja.left) / caja.width

      if (relativo <= ZONA_SALTO) {
        act('back')

        return
      }

      if (relativo >= 1 - ZONA_SALTO) {
        act('forward')

        return
      }

      if (!punteroFino()) return

      act('fullscreen')
    },
    [act, cancelarClic],
  )

  // El teclado se escucha en la ventana: el foco puede estar en el propio video
  // o en la página, y obligar a enfocar el reproductor para usar las flechas es
  // una molestia que no hace falta. `keyAction` decide cuándo no hacer nada.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent): void => {
      const objetivo = {
        key: evento.key,
        tagName: (evento.target as HTMLElement | null)?.tagName,
        isContentEditable: (evento.target as HTMLElement | null)?.isContentEditable,
        ctrlKey: evento.ctrlKey,
        metaKey: evento.metaKey,
        altKey: evento.altKey,
      }

      // `?` abre la ayuda de los atajos. Va antes que los mandos y no dentro de
      // `keyAction` porque no es una acción del reproductor: es una pregunta, y
      // el que la contesta es la pantalla.
      if (evento.key === '?' && !isTypingTarget(objetivo)) {
        evento.preventDefault()
        setAtajos(true)

        return
      }

      // Con la ayuda abierta, las teclas son del diálogo: la barra espaciadora
      // no puede pausar el video que hay detrás del velo.
      if (dialogoAtajos.current?.open === true) return

      const accion = keyAction(objetivo)

      if (accion === undefined) return

      // Cualquier tecla que el reproductor entiende enseña los mandos: se está
      // usándolo, y esconderlos mientras alguien busca el mando con el teclado
      // sería esconderle lo que hace.
      reiniciarMandos()
      evento.preventDefault()
      act(accion)
    }

    window.addEventListener('keydown', alPulsar)

    return () => window.removeEventListener('keydown', alPulsar)
  }, [act, reiniciarMandos])

  /** El tiempo que está debajo del puntero, si está sobre la barra. */
  const alMoverPuntero = useCallback(
    (evento: ReactPointerEvent<HTMLDivElement>) => {
      if (duracion <= 0) return

      const caja = evento.currentTarget.getBoundingClientRect()
      if (caja.width <= 0) return

      const proporcion = Math.min(Math.max((evento.clientX - caja.left) / caja.width, 0), 1)
      setSobreBarra(proporcion * duracion)
    },
    [duracion],
  )

  // El botón grande de reproducir: en pausa y con el medio ya cargado. Durante la
  // carga manda el cartel de la espera, que dice qué se está esperando.
  const enPausa = !state.playing && espera === undefined

  const rotuloPausa = state.playing
    ? t(DEFAULT_LOCALE, 'player.pause')
    : t(DEFAULT_LOCALE, 'player.play')
  const rotuloSilencio = state.muted
    ? t(DEFAULT_LOCALE, 'player.unmute')
    : t(DEFAULT_LOCALE, 'player.mute')
  const rotuloPantalla = completa
    ? t(DEFAULT_LOCALE, 'player.fullscreen.exit')
    : t(DEFAULT_LOCALE, 'player.fullscreen')

  return (
    <section className="player" data-tour={props.dataTour}>
      {/* El escenario: el video con sus capas dentro del marco, y los mandos.
          El marco es lo que mide el video, y por eso el botón grande, la espera y
          el lienzo del modo compatible se centran en **la imagen** y no en la caja
          entera: en una ventana estrecha los mandos van debajo, dentro del
          escenario, y centrar sobre el escenario dejaría el botón fuera del
          video. */}
      <div
        className="player__stage"
        onPointerMove={reiniciarMandos}
        onPointerDown={reiniciarMandos}
      >
        <div className="player__frame">
          <video
            ref={refVideo}
            className="player__video"
            controls={false}
            playsInline
            preload="metadata"
            poster={props.poster}
            aria-label={props.title ?? t(DEFAULT_LOCALE, 'player.label')}
            // El clic sobre la imagen pausa y el doble clic salta en los bordes o
            // pone pantalla completa en el centro: la superficie que se mira es la
            // que se toca, y quien mira el video no tiene por qué bajar la vista a
            // los mandos. Ver `alDobleClic`.
            //
            // El botón grande de encima es un dibujo sin eventos —`pointer-events:
            // none`—: el gesto es del video entero, y un cartel que se comiera el
            // clic obligaría a apuntarle a un cuadrado del centro.
            //
            // Los dos gestos se separan con una espera corta —ver `CLICK_DELAY_MS`—
            // y no dejando correr los dos `click` que el navegador manda antes del
            // `dblclick`: se anulaban entre sí y parecía funcionar, pero al salir de
            // la pantalla completa el navegador entrega uno solo de los dos, así que
            // el doble clic pausaba el video.
            onClick={alClic}
            onDoubleClick={alDobleClic}
          >
            {/* Una pista por subtítulo disponible. El navegador pinta la que esté
              marcada como `default`; el `<track>` no admite `default` dinámico, así
              que la primera —la que el proveedor prefiere— se marca desde el
              estado inicial del elemento. */}
            {pistas.map((pista, indice) => (
              <track
                key={pista.url}
                kind="subtitles"
                // La comprobación va **en el atributo**, no sólo al construir la
                // lista: si mañana alguien pasa pistas sin filtrar, aquí no entra una
                // dirección de fuera igualmente.
                src={isProxyPath(pista.url) ? pista.url : ''}
                srcLang={pista.lang}
                label={pista.label}
                default={indice === 0}
              />
            ))}
          </video>

          {/* El modo compatible: encima del video y en su misma caja. El elemento
            sigue ahí —es quien reproduce, quien lleva los subtítulos y quien
            habla con hls.js—, pero lo que se ve es este canvas, que el
            compositor pinta como una textura corriente. Va sin nombre accesible
            y sin `aria-hidden` a propósito: un canvas sin contenido de reserva
            no tiene rol ni nombre, así que no se anuncia, y lo que sí se anuncia
            es el `<video>` de debajo. */}
          {pintando ? <canvas className="player__canvas" ref={canvasRef} /> : null}

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

          {espera === undefined ? null : (
            <div className="player__wait">
              {/* El cartel va en su caja y no suelto sobre el velo: el velo oscurece
                el video, y texto oscuro sobre un velo sobre fondo claro se queda
                por debajo del contraste que exige el spec. La caja trae su propio
                fondo, que es el par que la prueba de contraste mide. */}
              <p className="player__wait-box" role="status">
                <span className="player__bar" aria-hidden="true" />
                {espera}
              </p>
            </div>
          )}
        </div>

        {/* Los mandos: la barra de progreso y su fila de botones.
            En escritorio se superponen al borde inferior del video, con un
            degradado que los separa de la imagen sin taparla; en una ventana
            estrecha van **debajo** del video y dentro del escenario, porque una
            barra superpuesta sobre un video de 167 px de alto se come la imagen.
            `data-oculto` los esconde sin sacarlos del documento —`display: none`
            devolvería el foco al `body` en mitad de una reproducción— y sin recibir
            el puntero; en móvil no se esconden, porque no tapan nada. */}
        <div className="player__controls" data-oculto={state.playing && !mandos}>
          <div
            className="player__seek"
            onPointerMove={alMoverPuntero}
            onPointerLeave={() => setSobreBarra(undefined)}
          >
            {/* El carril, por capas: lo que hay en búfer debajo, lo ya reproducido
                encima y el `input` arriba del todo. El `input` es transparente y
                está por encima de las capas para no perder ni el arrastre ni el
                teclado; pintarlo él mismo obligaría a un degradado calculado. */}
            <span className="player__track" aria-hidden="true">
              <span
                className="player__buffer"
                style={{ width: `${porcentaje(state.bufferedS, duracion)}%` }}
              />
              <span
                className="player__played"
                style={{ width: `${porcentaje(posicion, duracion)}%` }}
              />
            </span>

            {/* Una barra de progreso de verdad, y un `<input type="range">`: se
                arrastra, se toca y se recorre con el teclado sin escribir nada. El
                `aria-valuetext` dice el tiempo **en palabras**, porque un número de
                segundos no es lo que nadie quiere oír. */}
            <input
              className="player__range"
              type="range"
              min={0}
              max={duracion}
              step={0.1}
              value={posicion}
              disabled={duracion === 0}
              aria-label={t(DEFAULT_LOCALE, 'player.seek')}
              aria-valuetext={`${spokenTime(posicion)} de ${spokenTime(duracion)}`}
              onChange={(evento) => {
                const segundo = Number(evento.target.value)
                setArrastre(segundo)
                seekTo(segundo)
              }}
              onPointerUp={() => setArrastre(undefined)}
              onPointerCancel={() => setArrastre(undefined)}
              onBlur={() => setArrastre(undefined)}
              onKeyUp={() => setArrastre(undefined)}
            />

            {sobreBarra === undefined ? null : (
              <span
                className="player__tooltip"
                style={{ left: `${porcentaje(sobreBarra, duracion)}%` }}
                aria-hidden="true"
              >
                {formatTime(sobreBarra)}
              </span>
            )}
          </div>

          {/* Una sola fila. Los mandos llevan el dibujo y el nombre accesible: el
              texto en un botón de 44 px no cabe, y el nombre es lo que lee quien
              no ve la pantalla. El `title` repite el nombre para el ratón. */}
          <div className="player__buttons">
            <button
              type="button"
              className="button button--primary player__control"
              aria-label={rotuloPausa}
              title={rotuloPausa}
              aria-keyshortcuts="Space Enter K"
              onClick={() => act('toggle')}
            >
              {state.playing ? <IconoPausar /> : <IconoReproducir />}
            </button>

            {/* Los saltos de diez segundos no caben en un teléfono en vertical, y
                ahí no hacen falta: el doble toque en los bordes del video los
                hace. Ver `alDobleClic`. */}
            {compacto ? null : (
              <button
                type="button"
                className="button player__control"
                aria-label={t(DEFAULT_LOCALE, 'player.back')}
                title={t(DEFAULT_LOCALE, 'player.back')}
                aria-keyshortcuts="ArrowLeft"
                onClick={() => act('back')}
              >
                <IconoAtras />
                <span className="player__control-step">
                  {t(DEFAULT_LOCALE, 'player.seek.step')}
                </span>
              </button>
            )}

            {compacto ? null : (
              <button
                type="button"
                className="button player__control"
                aria-label={t(DEFAULT_LOCALE, 'player.forward')}
                title={t(DEFAULT_LOCALE, 'player.forward')}
                aria-keyshortcuts="ArrowRight"
                onClick={() => act('forward')}
              >
                <IconoAdelante />
                <span className="player__control-step">
                  {t(DEFAULT_LOCALE, 'player.seek.step')}
                </span>
              </button>
            )}

            {/* El silencio y su barra van juntos y en un solo grupo: son el mismo
                mando en dos pasos —uno dice si suena, la otra cuánto— y la barra
                aparece al pasar por encima o al enfocar, que es cuando se va a
                usar. En una pantalla táctil no hay «encima» y se queda a la
                vista. En una ventana estrecha el grupo entero se muda al menú de
                ajustes: ocupa el ancho de tres botones y ahí no cabe. */}
            {estrecho ? null : (
              <div className="player__volume">
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
                {/* Va de 0 a 100 porque es lo que entiende quien oye el valor:
                    «50», no «0,5». */}
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
            )}

            {/* El hueco que separa lo que se toca a menudo de lo que se toca una
                vez: el reloj y los mandos de la derecha. */}
            <span className="player__spacer" aria-hidden="true" />

            {/* El contador, con cifras de ancho fijo: sin `tabular-nums` el reloj
                baila en cada segundo y arrastra lo que tenga al lado. */}
            <span className="player__time">
              {formatTime(posicion)} / {formatTime(state.durationS)}
            </span>

            {/* Los ajustes: lo que se toca una vez y no tiene por qué ocupar un
                sitio en la fila —el audio, el reproductor externo, el modo
                compatible y la ayuda del teclado—. El popover se abre hacia
                arriba, que es donde hay sitio: el mando está pegado al borde
                inferior del video. */}
            <div className="player__settings">
              <button
                type="button"
                ref={botonAjustes}
                className="button player__control"
                aria-label={t(DEFAULT_LOCALE, 'player.settings')}
                title={t(DEFAULT_LOCALE, 'player.settings')}
                aria-expanded={menu}
                aria-haspopup="true"
                onClick={() => setMenu((abierto) => !abierto)}
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

                {props.onMpv === undefined ? null : (
                  <button
                    type="button"
                    className="button player__menu-action"
                    onClick={props.onMpv}
                  >
                    {t(DEFAULT_LOCALE, 'player.mpv')}
                  </button>
                )}

                {/* El volumen, cuando en la fila no cabe.
                    Es el mismo grupo de la barra —botón y barra juntos, el
                    mismo estado—, pero aquí dentro no hace falta esconder la
                    barra tras el puntero: el menú ya es «donde se toca una vez».
                    Sólo hay uno de los dos grupos en el documento: dos mandos con
                    el mismo nombre accesible son un nombre ambiguo. */}
                {estrecho ? (
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
                        onChange={(evento) =>
                          setVolume(volumeFromPercent(Number(evento.target.value)))
                        }
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

                {opcionesSubtitulos.length === 0 ? null : (
                  <div className="player__menu-block">
                    <p className="player__menu-title">{t(DEFAULT_LOCALE, 'player.tracks.pick')}</p>
                    <ul className="player__menu-list">
                      {opcionesSubtitulos.map((opcion) => (
                        <li key={opcion.key}>
                          <button
                            type="button"
                            className="button player__menu-choice"
                            aria-pressed={opcion.pressed}
                            onClick={() => elegirSubtitulos(opcion.choice)}
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
                    setMenu(false)
                    setAtajos(true)
                  }}
                >
                  {t(DEFAULT_LOCALE, 'player.keys.open')}
                </button>
              </div>
            </div>

            <button
              type="button"
              className="button player__control"
              aria-label={rotuloPantalla}
              title={rotuloPantalla}
              aria-keyshortcuts="F"
              onClick={() => act('fullscreen')}
            >
              {completa ? <IconoSalirPantallaCompleta /> : <IconoPantallaCompleta />}
            </button>
          </div>
        </div>
      </div>

      {sinImagen ? <p className="search__error">{t(DEFAULT_LOCALE, 'player.sinImagen')}</p> : null}

      {pintando ? <p className="player__note">{t(DEFAULT_LOCALE, 'player.compat.on')}</p> : null}

      {state.error === undefined ? null : (
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'player.error', { message: state.error })}
        </p>
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
          Apache 2.0 y su licencia pide conservar el aviso. */}
      {needsHls(props.kind) ? (
        <p className="player__note">{t(DEFAULT_LOCALE, 'player.attribution')}</p>
      ) : null}

      {/* La ayuda del teclado, en un diálogo y no siempre a la vista.
          Eran tres filas de teclas debajo del reproductor para algo que se mira
          una vez: ahora se abre desde los ajustes o con `?`, el navegador se
          encarga del `Esc` y del encierro del foco, y el contenido sigue siendo
          el mismo —cada tecla dibujada como una tecla y su frase al lado—. */}
      <dialog
        className="player__dialog"
        ref={dialogoAtajos}
        aria-label={t(DEFAULT_LOCALE, 'player.keys')}
        onClose={() => setAtajos(false)}
      >
        <div className="player__keys">
          <p className="player__keys-title">{t(DEFAULT_LOCALE, 'player.keys')}</p>
          <ul className="player__keys-list">
            {ATAJOS.map((atajo) => (
              <li className="player__key" key={atajo.hace}>
                <span className="player__key-caps">
                  {atajo.teclas.map((tecla) => (
                    <kbd className="player__key-cap" key={tecla}>
                      {t(DEFAULT_LOCALE, tecla)}
                    </kbd>
                  ))}
                </span>
                <span className="player__key-does">{t(DEFAULT_LOCALE, atajo.hace)}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="button player__dialog-close"
          onClick={() => setAtajos(false)}
        >
          {t(DEFAULT_LOCALE, 'player.keys.close')}
        </button>
      </dialog>
    </section>
  )
}
