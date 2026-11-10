/**
 * Estado del reproductor y carga de `hls.js`.
 *
 * `hls.js` se carga **con importación dinámica**: son unos 300 KB que sólo hacen
 * falta cuando alguien reproduce algo en HLS. Importarlo arriba engordaría la
 * búsqueda —la pantalla que todo el mundo usa— para servir a la que se usa de
 * vez en cuando.
 *
 * El estado que se publica es pequeño a propósito: si suena, por dónde va,
 * cuánto dura y qué falló. Todo lo demás lo sabe el elemento `<video>`, y
 * copiarlo aquí sería tener dos verdades.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  announcement,
  clampVolume,
  needsHls,
  type PlayerAction,
  SEEK_STEP_S,
  seekBy,
  VOLUME_STEP,
  volumeBy,
} from './controls'
import { crearRecuperadorDeHls, diagnosticarHls, type FalloDeReproduccion } from './player-errors'
import { type HlsSubtitleTrack, hlsSubtitleTracks } from './subtitle-menu'

/** Una pista que el reproductor puede pintar. */
export interface SafeTrack {
  readonly url: string
  readonly lang: string
  readonly label: string
}

export interface PlayerState {
  readonly playing: boolean
  readonly positionS: number
  readonly durationS: number
  readonly volume: number
  readonly muted: boolean
  readonly error: string | undefined
  /**
   * ¿Se puede ofrecer «Reintentar» con este fallo?
   *
   * Un error de red o de media se arregla pidiendo otra vez —o con otra fuente—
   * y el botón tiene sentido. Un navegador que no sabe reproducir HLS o una
   * fuente que no existe no se arreglan repitiendo, y un botón que no hace nada
   * es peor que no tenerlo.
   */
  readonly retryable: boolean
  /**
   * Todavía no hay ni un fotograma: ni metadatos ni imagen.
   *
   * Se apaga con `loadedmetadata`, no cuando se suelta la fuente: entre asignar
   * la dirección y tener imagen pasa lo que tarda el proxy en traer el primer
   * trozo, y dar la carga por terminada antes de eso deja al reproductor en
   * negro sin decir nada.
   */
  readonly loading: boolean
  /**
   * Ya reprodujo y se ha quedado sin datos: espera al siguiente segmento.
   *
   * Es otra espera, no la misma de `loading`. Se enciende con `waiting` y
   * `stalled` y se apaga cuando vuelve a haber imagen.
   */
  readonly buffering: boolean
  /**
   * Hasta dónde tiene datos el elemento, en segundos.
   *
   * Es la segunda capa de la barra de progreso: sin ella, una pausa para
   * almacenar en búfer y una pausa porque a alguien se le acabó el episodio se
   * ven igual. Sale de `video.buffered`, que es del elemento y no nuestra.
   */
  readonly bufferedS: number
  /**
   * Lo que se anuncia por `aria-live`, y **cuándo** se rehace.
   *
   * No se recalcula en cada vuelta: se rehace cuando pasa algo que se cuenta
   * —empezar, parar, buscar, terminar o fallar—, que son los eventos del
   * elemento que importan. Una región `aria-live` que cambia con el reloj
   * —cuatro veces por segundo— es inservible con un lector de pantalla: no deja
   * oír nada más.
   */
  readonly status: string
  /**
   * Ancho de la pista de video, en píxeles; cero si no hay ninguna.
   *
   * Es la única señal de que el navegador **está decodificando la imagen**: el
   * audio puede sonar con el video en negro —un decodificador que no arranca, una
   * GPU que falla— y ni el elemento ni hls.js lo dicen. Con esto, el reproductor
   * puede contarlo en vez de dejar una pantalla negra sin explicación.
   */
  readonly videoWidth: number
}

export interface PlayerHandle {
  readonly state: PlayerState
  readonly videoRef: (elemento: HTMLVideoElement | null) => void
  readonly act: (action: PlayerAction) => void
  readonly seekTo: (seconds: number) => void
  /** Volumen entre 0 y 1, que es lo que el elemento entiende. */
  readonly setVolume: (volume: number) => void
  readonly toggle: () => void
  /**
   * Las pistas de subtítulos que trae el manifiesto, si trae alguna.
   *
   * Son otro origen que las que declara el proveedor —viajan dentro de la lista
   * HLS y las sirve hls.js— y se ofrece porque hls.js no enciende ninguna sola.
   */
  readonly hlsTracks: readonly HlsSubtitleTrack[]
  /** Enciende la pista del manifiesto con ese índice, o las apaga con `-1`. */
  readonly pickHlsTrack: (id: number) => void
  /**
   * Vuelve a intentarlo desde el segundo en el que se quedó.
   *
   * Es el gesto del botón «Reintentar»: pide una fuente nueva y, si no la hay,
   * arranca otra vez con la misma, sin perder la posición.
   */
  readonly retry: () => void
}

/**
 * Deja el volumen en el elemento, y quita el silencio si el gesto pide oír.
 *
 * Subir el volumen con el silencio puesto deja un mando que parece roto: se
 * arrastra la barra y no suena. Bajarlo a cero **no** vuelve a silenciar: para
 * eso está su botón, y el silencio tiene su propio estado que se anuncia.
 */
function aplicarVolumen(video: HTMLVideoElement, volume: number): void {
  video.volume = clampVolume(volume)

  if (video.volume > 0) video.muted = false
}

/**
 * Hasta dónde hay datos, en segundos.
 *
 * Se toma el final del último tramo y no el que contiene la posición actual: los
 * tramos se descartan por detrás al reproducir, así que el último es el que
 * termina más lejos. Un elemento sin datos —o sin `buffered`— devuelve cero, que
 * es lo que la barra pinta cuando no hay nada que enseñar.
 */
export function finDeBuffer(video: { readonly buffered: TimeRanges }): number {
  const tramos = video.buffered

  return tramos.length === 0 ? 0 : tramos.end(tramos.length - 1)
}

/**
 * El estado con su anuncio rehecho.
 *
 * Es el **único** sitio donde se rehace `status`, y por eso el anuncio cambia
 * cuando pasa algo que se cuenta —empezar, parar, buscar, terminar o fallar— y
 * no en cada `timeupdate`. Quien llama decide qué pasó; la frase sale del estado
 * que queda, así que nunca dice una posición que no es la del momento.
 */
function anunciar(previo: PlayerState, cambio: Partial<PlayerState>): PlayerState {
  const siguiente = { ...previo, ...cambio }

  return { ...siguiente, status: announcement(siguiente) }
}

/**
 * Lo que devuelve montar el medio: cómo soltarlo y cómo elegir subtítulos.
 *
 * La carga de `hls.js` es dinámica —son unos 300 KB que sólo hacen falta al
 * reproducir HLS—, así que montar el medio es una función aparte de este gancho y
 * con su propio contrato.
 */
export interface HlsHandle {
  readonly destroy: () => void
  /**
   * Enciende la pista del manifiesto con ese índice, o las apaga con `-1`.
   *
   * Es una pista que viaja **dentro de la lista** (`#EXT-X-MEDIA` con
   * `TYPE=SUBTITLES`), no un `<track>`: la sirve hls.js y se elige por índice.
   */
  readonly elegirSubtitulo: (id: number) => void
  /**
   * El reintento manual: pide fuente nueva y reanuda donde se quedó.
   *
   * Devuelve `false` si la instancia ya no está viva. Lo que salga mal después
   * vuelve por `alFallar`, así que quien llama no tiene que distinguir motivos.
   */
  readonly reintentar: () => Promise<boolean>
}

export interface AttachHlsOptions {
  readonly video: HTMLVideoElement
  readonly url: string
  /**
   * Un error **fatal** que ya no se puede recuperar.
   *
   * Hace falta un oído: hls.js no lanza, avisa, y el elemento no dispara `error`
   * cuando lo que falla es el Media Source. Pero no se avisa del primer fallo:
   * antes se reintenta y se pide fuente nueva, y sólo cuando no queda nada que
   * probar se cuenta. `reintentable` dice si el botón «Reintentar» tiene algo
   * que hacer.
   */
  readonly alFallar?: ((fallo: FalloDeReproduccion) => void) | undefined
  /**
   * La reproducción se recuperó sola.
   *
   * Sirve para quitar el aviso que dejó un fallo anterior cuando el reintento
   * —automático o del usuario— sale bien.
   */
  readonly alRecuperar?: (() => void) | undefined
  /**
   * Pide una fuente nueva para el mismo episodio y devuelve su URL.
   *
   * Es lo que convierte una URL firmada caducada o un ticket vencido en una
   * pausa invisible en vez de un error: el servidor vuelve a resolver el stream
   * saltándose su caché y devuelve un ticket nuevo. Sin esto no hay renovación
   * posible y el fallo se agota en el acto.
   */
  readonly renovarFuente?: (() => Promise<string | undefined>) | undefined
  /**
   * ¿Sigue vivo el efecto que pidió el montaje?
   *
   * Se comprueba **después** de la importación y antes de tocar el elemento. La
   * importación es asíncrona y el efecto puede haberse desmontado mientras
   * llegaba: React en modo estricto monta, desmonta y vuelve a montar, así que la
   * primera vuelta llega tarde y su `destroy()` —el que la segunda vuelta pide
   * para lo que ya no sirve— arrancaría el medio que la segunda acababa de
   * montar. Se veía como una lista cargada —200— y **ni una sola petición de
   * segmento**: el video se quedaba sin fuente y en negro, con el audio a veces
   * sonando de milagro según el orden de los microtasks. Sólo pasa en desarrollo,
   * que es donde React duplica los efectos.
   */
  readonly sigueVivo?: (() => boolean) | undefined
  /**
   * Las pistas de subtítulos que trae el manifiesto, cada vez que la lista cambia.
   *
   * hls.js las publica al parsear la lista maestra y **no enciende ninguna**: sin
   * esto, una fuente con subtítulos incrustados —el audio original con su pista
   * en inglés, que es lo que sirven estos sitios— llegaba al reproductor con sus
   * subtítulos dentro y sin forma de verlos.
   */
  readonly alDescubrirPistas?: ((pistas: readonly HlsSubtitleTrack[]) => void) | undefined
}

export async function attachHls(options: AttachHlsOptions): Promise<HlsHandle | { error: string }> {
  const sigueVivo = options.sigueVivo ?? (() => true)
  const sinMedio: HlsHandle = {
    destroy: () => {},
    elegirSubtitulo: () => {},
    reintentar: async () => false,
  }

  try {
    const { default: Hls } = await import('hls.js')

    if (!sigueVivo()) return sinMedio

    if (!Hls.isSupported()) {
      // Safari reproduce HLS sin ayuda; si tampoco puede, se dice.
      if (options.video.canPlayType('application/vnd.apple.mpegurl') === '') {
        return { error: 'este navegador no puede reproducir HLS' }
      }

      // Aquí el HLS lo lleva el navegador: la lista la lee él y sus pistas de
      // subtítulos no las publica en ninguna parte, así que no hay nada que
      // ofrecer. La pista vacía se devuelve igual para que quien llama no tenga
      // que distinguir dos formas de lo mismo.
      options.video.src = options.url

      return { ...sinMedio, destroy: () => options.video.removeAttribute('src') }
    }

    /*
     * Reintentos más generosos que los de fábrica, y acotados.
     *
     * Un segmento que tarda o una conexión que se corta un instante son lo
     * normal en estos sitios: los valores por defecto de hls.js se rinden antes
     * de que el proxy termine de traer el trozo. Se suben los tiempos de espera
     * y el número de reintentos, pero se dejan **finitos**: un upstream caído no
     * puede convertirse en un bucle infinito de peticiones.
     */
    const hls = new Hls({
      enableWorker: true,
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 20_000,
          maxLoadTimeMs: 120_000,
          timeoutRetry: {
            maxNumRetry: 4,
            retryDelayMs: 500,
            maxRetryDelayMs: 8_000,
            backoff: 'linear',
          },
          errorRetry: {
            maxNumRetry: 6,
            retryDelayMs: 1_000,
            maxRetryDelayMs: 10_000,
            backoff: 'linear',
          },
        },
      },
      manifestLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 20_000,
          maxLoadTimeMs: 120_000,
          timeoutRetry: {
            maxNumRetry: 4,
            retryDelayMs: 500,
            maxRetryDelayMs: 8_000,
            backoff: 'linear',
          },
          errorRetry: {
            maxNumRetry: 4,
            retryDelayMs: 1_000,
            maxRetryDelayMs: 10_000,
            backoff: 'linear',
          },
        },
      },
    })

    const publicarPistas = (): void => {
      options.alDescubrirPistas?.(hlsSubtitleTracks(hls.subtitleTracks))
    }

    // Se escucha antes de cargar la lista: el evento llega al parsearla, y
    // suscribirse después es no enterarse de la primera —y única— vez que se
    // publican las pistas de una lista bajo demanda.
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, publicarPistas)

    /*
     * El oído de los errores.
     *
     * El diagnóstico —detalle, si es fatal, código HTTP, URL del proxy y número
     * de fragmento— se registra **sólo en desarrollo**: es lo que hace falta para
     * saber si un `fragLoadError` a los tres minutos es un 403 de la firma, un
     * 410 del ticket o una red caída. En producción no se escribe nada.
     *
     * La decisión de qué hacer la lleva el recuperador: reintentos acotados,
     * `recoverMediaError()` para la media y renovación de la fuente cuando la URL
     * ya no vale. El aviso al usuario sólo llega cuando se agota.
     */
    const recuperador = crearRecuperadorDeHls({
      medio: {
        loadSource: (url) => hls.loadSource(url),
        startLoad: (posicion) => hls.startLoad(posicion),
        recoverMediaError: () => hls.recoverMediaError(),
        swapAudioCodec: () => hls.swapAudioCodec(),
        unaVezListo: (escucha) => hls.once(Hls.Events.MANIFEST_PARSED, escucha),
      },
      video: options.video,
      ...(options.renovarFuente === undefined ? {} : { renovarFuente: options.renovarFuente }),
      alFallar: (fallo) => options.alFallar?.(fallo),
      alRecuperar: () => options.alRecuperar?.(),
    })

    hls.on(Hls.Events.ERROR, (_evento, datos) => {
      if (import.meta.env.DEV) {
        // Temporal: el diagnóstico que pidió el informe del fallo. Con `DEV`
        // fuera del bundle de producción.
        console.warn('[hls] error', diagnosticarHls(datos))
      }

      recuperador.alError(datos)
    })

    hls.loadSource(options.url)
    hls.attachMedia(options.video)

    return {
      destroy: () => {
        recuperador.destruir()
        hls.destroy()
      },
      elegirSubtitulo: (id) => (hls.subtitleTrack = id),
      reintentar: () => recuperador.reintentar(),
    }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export interface UsePlayerOptions {
  readonly url: string
  readonly kind: string
  /** Se llama al empezar a reproducir de verdad. */
  readonly onPlay?: (() => void) | undefined
  readonly onPause?: (() => void) | undefined
  readonly onProgress?: ((positionS: number, durationS: number) => void) | undefined
  /** Segundo en el que empezar. Sirve para reanudar y para cambiar de modo. */
  readonly startAtS?: number | undefined
  /**
   * Pide una fuente nueva para el mismo episodio y devuelve su URL.
   *
   * Es la renovación transparente: cuando el upstream contesta 403/410 —la
   * firma o el ticket caducaron— se pide otra fuente sin tocar la posición y la
   * reproducción sigue donde iba.
   */
  readonly renovarFuente?: (() => Promise<string | undefined>) | undefined
  /**
   * El episodio llegó al final.
   *
   * Es del elemento y no de la pantalla: `ended` no se puede deducir de la
   * posición —una pausa en el último segundo y el final se parecen—, y de aquí
   * sale la tarjeta del episodio siguiente.
   */
  readonly onEnded?: (() => void) | undefined
}

export function usePlayer(source: UsePlayerOptions): PlayerHandle {
  const [state, setState] = useState<PlayerState>({
    playing: false,
    positionS: 0,
    durationS: 0,
    volume: 1,
    muted: false,
    error: undefined,
    retryable: false,
    loading: true,
    buffering: false,
    bufferedS: 0,
    videoWidth: 0,
    // Arranca con la frase del estado inicial: la región existe desde el primer
    // render y lo que se anuncia al entrar es que está en pausa.
    status: announcement({ playing: false, positionS: 0, durationS: 0 }),
  })

  const elemento = useRef<HTMLVideoElement | null>(null)
  const hls = useRef<HlsHandle | undefined>(undefined)
  /**
   * Las pistas de subtítulos que publicó el manifiesto.
   *
   * En estado y no en una referencia: son parte de lo que se pinta —el menú
   * crece cuando llegan—, y el evento que las trae llega una sola vez por fuente.
   */
  const [hlsTracks, setHlsTracks] = useState<readonly HlsSubtitleTrack[]>([])
  /**
   * Los avisos, en referencias y no en las dependencias del efecto.
   *
   * Quien llama pasa funciones nuevas en cada render —`onProgress={(p) => ...}`
   * es lo natural—, y con ellas en las dependencias el efecto se volvía a
   * ejecutar en **cada** actualización de estado: volvía a asignar `video.src`,
   * el navegador recargaba el medio y la reproducción se quedaba en el segundo
   * cero. Lo encontró el e2e del reproductor, que veía `paused: true` y
   * `played.length: 0` después de darle a reproducir.
   */
  const avisos = useRef({
    onPlay: source.onPlay,
    onPause: source.onPause,
    onProgress: source.onProgress,
    onEnded: source.onEnded,
  })
  avisos.current = {
    onPlay: source.onPlay,
    onPause: source.onPause,
    onProgress: source.onProgress,
    onEnded: source.onEnded,
  }

  /**
   * El segundo en el que reanudar, en una referencia por el mismo motivo.
   *
   * Es la **posición viva** en el momento en que cambia la fuente —cambiar de
   * subtitulado a doblado tiene que seguir donde iba—, así que quien la pasa la
   * mueve en cada avance. Con ella en las dependencias, cada `timeupdate` volvía
   * a montar el medio y el navegador recargaba el video: se quedaba en el
   * segundo cero, en pausa y con la duración ya conocida. Es exactamente el
   * síntoma de «carga, dice cuánto dura y no reproduce».
   */
  const reanudarEn = useRef(source.startAtS)
  reanudarEn.current = source.startAtS

  /**
   * La renovación de la fuente, en una referencia por el mismo motivo que los
   * avisos: la función que pasa quien monta el reproductor puede cambiar de
   * identidad en cada render, y con ella en las dependencias del efecto el medio
   * se volvería a montar.
   */
  const renovar = useRef(source.renovarFuente)
  renovar.current = source.renovarFuente

  const videoRef = useCallback((nuevo: HTMLVideoElement | null) => {
    elemento.current = nuevo
  }, [])

  useEffect(() => {
    const video = elemento.current
    if (video === null) return

    let vivo = true

    // Cada fuente empieza de cero. Sin esto, cambiar de subtitulado a doblado
    // —o reintentar— dejaba el estado de la fuente anterior y la espera de la
    // nueva no se pintaba: la pantalla se quedaba con el último fotograma del
    // modo viejo y parecía que el botón no había hecho nada.
    setState((previo) =>
      anunciar(previo, {
        loading: true,
        buffering: false,
        bufferedS: 0,
        error: undefined,
        retryable: false,
      }),
    )
    // Y las pistas del manifiesto también son de la fuente: las de la anterior no
    // existen en ésta, y ofrecerlas sería un menú que no enciende nada.
    setHlsTracks([])

    if (needsHls(source.kind)) {
      void attachHls({
        video,
        url: source.url,
        alFallar: (fallo) => {
          if (!vivo) return

          setState((previo) =>
            anunciar(previo, {
              error: `hls.js se detuvo: ${fallo.mensaje}`,
              retryable: fallo.reintentable,
              loading: false,
              buffering: false,
            }),
          )
        },
        alRecuperar: () => {
          if (!vivo) return

          // Se recuperó sola: el aviso de un fallo anterior —o el del reintento
          // que acaba de salir bien— sobra, y lo que toca es la espera de datos.
          setState((previo) =>
            anunciar(previo, { error: undefined, retryable: false, buffering: true }),
          )
        },
        renovarFuente: async () => {
          const pedir = renovar.current
          if (pedir === undefined) return undefined

          return await pedir()
        },
        sigueVivo: () => vivo,
        alDescubrirPistas: (pistas) => {
          if (!vivo) return

          setHlsTracks(pistas)
        },
      }).then((resultado) => {
        if (!vivo) {
          if ('destroy' in resultado) resultado.destroy()

          return
        }

        if ('error' in resultado) {
          // El anuncio también aquí: un fallo que sólo se ve en la pantalla no
          // existe para quien no la ve.
          setState((previo) => anunciar(previo, { error: resultado.error, loading: false }))

          return
        }

        // Aquí **no** se apaga `loading`: la lista ya cargó, pero la imagen
        // todavía no. Lo apaga `loadedmetadata`, que es cuando el elemento sabe
        // algo del medio.
        hls.current = resultado
      })
    } else {
      video.src = source.url
    }

    // La reanudación se decide **una vez por fuente**, cuando el efecto arranca:
    // si se leyera en cada `durationchange`, un cambio de duración a mitad de
    // reproducción volvería a saltar a la posición de reanudación y daría un
    // tirón hacia adelante.
    const destino = reanudarEn.current ?? 0
    let reanudado = false

    const alTiempo = (): void => {
      /*
       * Antes de reanudar, el elemento puede avisar de un `timeupdate` en el
       * segundo cero —justo después de `loadedmetadata` y antes del salto—.
       * Informar de esa posición escribiría 0 encima del sitio donde se dejó y
       * la reanudación se perdería en el mismo arranque. Se ignora hasta que el
       * salto se haya hecho.
       */
      if (!reanudado && destino > 0 && video.currentTime + 1 < destino) return

      setState((previo) => ({
        ...previo,
        positionS: video.currentTime,
        bufferedS: finDeBuffer(video),
        videoWidth: video.videoWidth,
      }))
      avisos.current.onProgress?.(video.currentTime, video.duration)
    }
    /**
     * El búfer, que no llega con `timeupdate`.
     *
     * El elemento avisa de que tiene más datos con `progress`, y sin escucharlo
     * la segunda capa de la barra sólo se movería cuando el reloj avanza: con el
     * video en pausa, la barra se quedaría mintiendo.
     */
    const alBuffer = (): void =>
      setState((previo) => ({ ...previo, bufferedS: finDeBuffer(video) }))
    const alDuracion = (): void => {
      setState((previo) =>
        anunciar(previo, {
          durationS: video.duration,
          videoWidth: video.videoWidth,
          // Aquí sí: el elemento ya trajo los metadatos. Es la primera señal de
          // que hay algo al otro lado, y la que apaga la espera inicial.
          loading: false,
          buffering: false,
        }),
      )

      // Reanudar: al saber la duración, se salta a donde se dejó. Se hace aquí y
      // no al montar porque el elemento todavía no admite un `currentTime` que no
      // conoce.
      if (!reanudado && destino > 0 && video.currentTime < destino) {
        video.currentTime = destino
        reanudado = true
      }
    }
    const alReproducir = (): void => {
      setState((previo) => anunciar(previo, { playing: true, buffering: false }))
      avisos.current.onPlay?.()
    }
    const alPausar = (): void => {
      // La espera se apaga al pausar: quien pausa a mitad de un tirón quiere ver
      // el fotograma, no un cartel encima.
      setState((previo) => anunciar(previo, { playing: false, buffering: false }))
      avisos.current.onPause?.()
    }
    const alError = (): void =>
      setState((previo) =>
        anunciar(previo, {
          error: 'no se pudo cargar el video',
          retryable: false,
          loading: false,
          buffering: false,
        }),
      )
    /**
     * La espera que no es la del principio.
     *
     * `waiting` y `stalled` son el elemento diciendo que se quedó sin datos;
     * `canplay` y `playing`, que ya los tiene. Sin esto, la única señal de que
     * el video se había parado a mitad era que el reloj no avanzaba.
     */
    const alEsperar = (): void => setState((previo) => ({ ...previo, buffering: true }))
    const alVolver = (): void => setState((previo) => ({ ...previo, buffering: false }))
    /**
     * Al soltar la búsqueda, se cuenta dónde quedó.
     *
     * Es una de las cuatro cosas que se anuncian —empezar, parar, buscar y
     * terminar—, y la única que necesita la posición en ese momento: la del
     * estado es la del último `timeupdate`, que mientras se arrastra no es
     * ninguna. También se avisa al registro del visionado: el salto tiene que
     * quedar guardado aunque se cierre justo después, y un `timeupdate` puede
     * tardar hasta un cuarto de segundo en llegar.
     */
    const alBuscar = (): void => {
      setState((previo) => anunciar(previo, { buffering: false, positionS: video.currentTime }))
      avisos.current.onProgress?.(video.currentTime, video.duration)
    }
    /** El final del episodio: deja de sonar, se cuenta y se avisa a la pantalla. */
    const alTerminar = (): void => {
      setState((previo) => anunciar(previo, { playing: false, buffering: false }))
      avisos.current.onEnded?.()
    }

    video.addEventListener('timeupdate', alTiempo)
    video.addEventListener('progress', alBuffer)
    video.addEventListener('loadedmetadata', alDuracion)
    video.addEventListener('durationchange', alDuracion)
    video.addEventListener('play', alReproducir)
    video.addEventListener('pause', alPausar)
    video.addEventListener('error', alError)
    video.addEventListener('waiting', alEsperar)
    video.addEventListener('stalled', alEsperar)
    video.addEventListener('canplay', alVolver)
    video.addEventListener('playing', alVolver)
    video.addEventListener('seeked', alBuscar)
    video.addEventListener('ended', alTerminar)

    return () => {
      vivo = false
      video.removeEventListener('timeupdate', alTiempo)
      video.removeEventListener('progress', alBuffer)
      video.removeEventListener('loadedmetadata', alDuracion)
      video.removeEventListener('durationchange', alDuracion)
      video.removeEventListener('play', alReproducir)
      video.removeEventListener('pause', alPausar)
      video.removeEventListener('error', alError)
      video.removeEventListener('waiting', alEsperar)
      video.removeEventListener('stalled', alEsperar)
      video.removeEventListener('canplay', alVolver)
      video.removeEventListener('playing', alVolver)
      video.removeEventListener('seeked', alBuscar)
      video.removeEventListener('ended', alTerminar)

      hls.current?.destroy()
      hls.current = undefined
    }
    // Sólo la fuente: los avisos y la posición de reanudación van en referencias
    // y no vuelven a montar el medio. Ver la nota de `avisos` y la de
    // `reanudarEn`.
  }, [source.kind, source.url])

  const act = useCallback((action: PlayerAction) => {
    const video = elemento.current
    if (video === null) return

    switch (action) {
      case 'toggle':
        if (video.paused) void video.play()
        else video.pause()

        return
      case 'forward':
        video.currentTime = seekBy(video.currentTime, SEEK_STEP_S, video.duration)

        return
      case 'back':
        video.currentTime = seekBy(video.currentTime, -SEEK_STEP_S, video.duration)

        return
      case 'volume-up':
        aplicarVolumen(video, volumeBy(video.volume, VOLUME_STEP))
        setState((previo) => ({ ...previo, volume: video.volume, muted: video.muted }))

        return
      case 'volume-down':
        aplicarVolumen(video, volumeBy(video.volume, -VOLUME_STEP))
        setState((previo) => ({ ...previo, volume: video.volume, muted: video.muted }))

        return
      case 'mute':
        video.muted = !video.muted
        setState((previo) => ({ ...previo, muted: video.muted }))

        return
      case 'fullscreen':
        // El mismo gesto entra y sale: sin la vuelta, el doble clic dentro de la
        // pantalla completa no la quitaría, y el botón tampoco. `requestFullscreen`
        // sobre un elemento que ya está a pantalla completa no hace nada, así que
        // sin esto el mando se quedaba muerto justo donde más se usa.
        if (document.fullscreenElement === null) void video.requestFullscreen?.()
        else void document.exitFullscreen?.()

        return
      case 'extended':
        // El modo extendido lo resuelve la pantalla con un atributo y CSS: no
        // toca el elemento ni el medio, así que aquí no hay nada que hacer. El
        // caso se deja explícito para que el `switch` cubra todas las acciones.
        return
    }
  }, [])

  const setVolume = useCallback((volume: number) => {
    const video = elemento.current
    if (video === null) return

    aplicarVolumen(video, volume)
    setState((previo) => ({ ...previo, volume: video.volume, muted: video.muted }))
  }, [])

  const seekTo = useCallback((seconds: number) => {
    const video = elemento.current
    if (video === null) return

    video.currentTime = seekBy(seconds, 0, video.duration)
  }, [])

  const toggle = useCallback(() => act('toggle'), [act])

  /**
   * Enciende una pista del manifiesto, o las apaga.
   *
   * Si no hay instancia —un mp4, o un HLS que el navegador lleva por su cuenta—
   * no hay nada que encender y el gesto no hace nada: inventar aquí un estado
   * pondría el menú a decir que hay una pista puesta cuando no la hay.
   */
  const pickHlsTrack = useCallback((id: number) => {
    hls.current?.elegirSubtitulo(id)
  }, [])

  /**
   * El botón «Reintentar».
   *
   * No re-monta el medio —eso perdería la posición—: la misma instancia de
   * hls.js vuelve a pedir fuente y arranca en el segundo donde se quedó. El
   * aviso se quita al momento para que el gesto se note; si vuelve a fallar,
   * `alFallar` lo devuelve con su motivo.
   */
  const retry = useCallback(() => {
    const medio = hls.current
    if (medio === undefined) return

    setState((previo) =>
      anunciar(previo, { error: undefined, retryable: false, loading: true, buffering: true }),
    )
    void medio.reintentar()
  }, [])

  return { state, videoRef, act, seekTo, setVolume, toggle, hlsTracks, pickHlsTrack, retry }
}
