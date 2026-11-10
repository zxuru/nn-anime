/**
 * Un `hls.js` falso, y **sólo para el e2e**.
 *
 * Por qué existe: el Chromium que descarga Playwright no decodifica H.264 ni AAC
 * —no trae los códecs propietarios—, así que un HLS de verdad no se puede
 * reproducir en este navegador por mucho que se sirva una lista válida. Y un
 * vídeo inventado tampoco vale: el códec es del navegador, y lo que hay que
 * ejercitar aquí es *nuestro* código de recuperación, no el decodificador.
 *
 * Por eso se separa el transporte del medio. El medio es el WAV real que genera
 * `scripts/e2e-server.ts`: el tiempo avanza de verdad y el `<video>` reproduce. El
 * transporte es este módulo, que imita la parte de la API pública de hls.js que
 * usa `attachHls` y simula los fragmentos con peticiones HTTP. Cuando el E2E
 * intercepta un fragmento y le devuelve un 403, el módulo emite el `ErrorData`
 * que emitiría hls.js de verdad —`networkError`, `fragLoadError`, fatal— y el
 * código de la aplicación corre sin enterarse de que el transporte es de mentira.
 *
 * Se activa con el alias de `vite.config.ts` cuando `NN_ANIME_E2E_HLS === 'falso'`.
 * El paquete de producción no lo incluye: fuera del e2e, `hls.js` es el de npm.
 *
 * Lo que **no** imita: el manifiesto, los segmentos, las pistas de subtítulos ni
 * el MSE. Nada de eso hace falta para medir que, tras un fallo de fragmento, se
 * renueva la fuente y se reanuda donde iba.
 */

/**
 * El estado del fallo que la prueba programa.
 *
 * Vive en el módulo y no en la instancia porque el gancho de la prueba se instala
 * antes de que exista ninguna instancia, y porque el reproductor monta y desmonta
 * el medio: `destroy()` se lleva los temporizadores de una instancia, pero no lo
 * que la prueba acaba de programar.
 */
let falloProgramado: number | undefined

/** Cuántos fragmentos se han pedido desde que se cargó el módulo. */
let fragmentosPedidos = 0

/** Lo que el E2E programa y consulta desde la página. */
export interface GanchoE2E {
  /** El siguiente fragmento falla con ese código HTTP. */
  readonly fallarFragmento: (codigo: number) => void
  /** Cuántos fragmentos se han pedido ya. */
  readonly fragmentos: number
}

declare global {
  interface Window {
    /**
     * Sólo existe en el paquete del e2e: es la puerta que tiene Playwright para
     * programar el fallo, porque un evento de red no se puede provocar desde el
     * `<video>`.
     */
    __nnAnimeE2E?: GanchoE2E
  }
}

interface VentanaConGancho {
  __nnAnimeE2E?: GanchoE2E
}

if (typeof window !== 'undefined') {
  const ventana: VentanaConGancho = window

  ventana.__nnAnimeE2E ??= {
    fallarFragmento: (codigo: number): void => {
      falloProgramado = codigo
    },
    get fragmentos(): number {
      return fragmentosPedidos
    },
  }
}

/** Lo que recibe un oyente de un evento. */
type Oyente = (evento: string, datos: unknown) => void

/** El `ErrorData` de hls.js, en la parte que mira la aplicación. */
export interface DatosDeError {
  readonly type: string
  readonly details: string
  readonly fatal: boolean
  readonly response: { readonly code: number; readonly text: string }
  readonly frag: { readonly url: string; readonly sn: number }
}

/** Cada cuánto se simula un fragmento, en milisegundos. */
const INTERVALO_FRAGMENTO_MS = 1000

/**
 * La clase que sustituye a `Hls` cuando el bundle es el del e2e.
 *
 * La forma es la de hls.js y no la de un mock mínimo: `attachHls` llama a
 * `isSupported`, se suscribe a `Events.ERROR` y a `SUBTITLE_TRACKS_UPDATED`, y
 * arranca con `loadSource` + `attachMedia`. La recuperación, además, usa
 * `loadSource` otra vez, `startLoad` y `once`. Todo eso tiene que existir y tener
 * el mismo efecto observable.
 */
export default class HlsFalso {
  /** Los eventos que usa la aplicación. Los valores importan poco: se comparan
   * siempre a través de esta tabla, como con hls.js. */
  static readonly Events: {
    readonly ERROR: string
    readonly SUBTITLE_TRACKS_UPDATED: string
    readonly MANIFEST_PARSED: string
  } = {
    ERROR: 'hlsError',
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    MANIFEST_PARSED: 'hlsManifestParsed',
  }

  /** Los tipos de error de hls.js, con sus valores reales. */
  static readonly ErrorTypes: {
    readonly NETWORK_ERROR: string
    readonly MEDIA_ERROR: string
    readonly OTHER_ERROR: string
  } = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
    OTHER_ERROR: 'otherError',
  }

  static isSupported(): boolean {
    // El navegador del e2e puede con el medio del arnés: el WAV lo decodifica.
    return true
  }

  private readonly oyentes = new Map<string, Set<Oyente>>()

  private video: HTMLVideoElement | undefined

  private urlActual: string | undefined

  private temporizador: ReturnType<typeof setInterval> | undefined

  private numeroDeFragmento = 0

  /** Corta los oyentes del `<video>` al destruir, para no dejar el medio vivo. */
  private readonly controlador = new AbortController()

  /** Se suscribe a un evento. */
  on(evento: string, oyente: Oyente): void {
    const conjunto = this.oyentes.get(evento) ?? new Set<Oyente>()

    conjunto.add(oyente)
    this.oyentes.set(evento, conjunto)
  }

  /** Se da de baja de un evento. */
  off(evento: string, oyente: Oyente): void {
    this.oyentes.get(evento)?.delete(oyente)
  }

  /**
   * Se suscribe a un evento **una sola vez**.
   *
   * Lo usa la recuperación: `MANIFEST_PARSED` llega al terminar de cargar la
   * fuente nueva, y ahí, una sola vez, se salta al segundo donde iba. Si el
   * oyente quedara puesto, saltaría también en cada recarga posterior.
   */
  once(evento: string, oyente: Oyente): void {
    const envoltorio: Oyente = (nombre, datos) => {
      this.off(evento, envoltorio)
      oyente(nombre, datos)
    }

    this.on(evento, envoltorio)
  }

  /** Guarda la dirección de la lista y, si ya hay medio, la carga. */
  loadSource(url: string): void {
    const cambia = url !== this.urlActual
    this.urlActual = url

    const video = this.video
    if (video === undefined) return

    if (cambia) this.cargarMedio(video, url)
    else this.avisarManifiesto(video)
  }

  /**
   * Toma el `<video>` de la página.
   *
   * Como `attachMedia` en hls.js: aquí es donde el medio empieza a reproducirse.
   * La fuente se pone **después** de tener el elemento, porque `loadSource` puede
   * haber llegado antes —es lo que hace `attachHls`—.
   */
  attachMedia(video: HTMLVideoElement): void {
    this.video = video

    const url = this.urlActual
    if (url !== undefined) this.cargarMedio(video, url)
  }

  /**
   * Empieza a cargar fragmentos desde una posición.
   *
   * La recuperación llama aquí con el segundo donde iba: asignar la fuente nueva
   * devuelve el elemento al principio, y este salto es lo que hace que el episodio
   * siga donde estaba. `-1` significa «no saltes»: es lo que manda `startLoad` de
   * hls.js y lo que la aplicación usa cuando estaba en el segundo cero.
   */
  startLoad(posicion?: number): void {
    const video = this.video
    if (video === undefined) return

    if (posicion !== undefined && posicion > 0) {
      this.cuandoHayaMetadatos(video, () => {
        // El límite no puede salir de una duración que no es número: con
        // `duration` en `NaN` —un elemento sin metadatos— el `Math.min` daría
        // `NaN`, y asignar eso a `currentTime` lanza. Sin duración conocida se
        // salta a la posición que se pidió y el elemento la acota él.
        const limite =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : posicion

        video.currentTime = Math.min(posicion, limite)
      })
    }

    // Se reanuda siempre: `startLoad` sólo se llama al recuperar un medio que se
    // estaba viendo. El `catch` es del navegador, no nuestro: `play()` puede
    // rechazar si el elemento todavía no tiene datos y lo reintenta el propio
    // elemento al tenerlos.
    void video.play().catch(() => {})
  }

  /** Deja de pedir fragmentos. El elemento sigue donde esté. */
  stopLoad(): void {
    this.detenerFragmentos()
  }

  /**
   * `recoverMediaError` de hls.js.
   *
   * Aquí no hay Media Source que recuperar: el medio lo lleva el propio elemento.
   * Se reanuda por si el fallo lo había dejado parado, que es lo que espera quien
   * llama a esta puerta.
   */
  recoverMediaError(): void {
    void this.video?.play().catch(() => {})
  }

  /** `swapAudioCodec` de hls.js: no hay codecs que cambiar en el arnés. */
  swapAudioCodec(): void {}

  /** Las pistas de subtítulos que trae el manifiesto: el arnés no trae ninguna. */
  get subtitleTracks(): readonly never[] {
    return []
  }

  /** La pista encendida. El arnés no puede encender ninguna. */
  get subtitleTrack(): number {
    return -1
  }

  set subtitleTrack(_indice: number) {
    // Sin manifiesto no hay pista que encender; el gesto no hace nada, igual que
    // en hls.js con un índice que no existe.
  }

  /** Suelta el medio y los temporizadores. */
  destroy(): void {
    this.detenerFragmentos()
    this.controlador.abort()
    this.oyentes.clear()
    this.video = undefined
    this.urlActual = undefined
  }

  /** Emite un evento a sus oyentes. */
  private emitir(evento: string, datos: unknown): void {
    const oyentes = this.oyentes.get(evento)
    if (oyentes === undefined) return

    // Sobre una copia: un oyente puede darse de baja al ejecutarse, y recorrer el
    // `Set` original mientras se modifica se salta al siguiente.
    for (const oyente of [...oyentes]) oyente(evento, datos)
  }

  /**
   * Pone la fuente en el elemento.
   *
   * Es lo único que hace de hls.js aquí: el medio no viaja por el Media Source,
   * viaja por el proxy como un archivo progresivo. El tiempo avanza de verdad.
   */
  private cargarMedio(video: HTMLVideoElement, url: string): void {
    video.src = url
    this.reiniciarFragmentos()

    // `loadedmetadata` se emite en una tarea aparte, nunca dentro de esta
    // llamada, así que escucharlo después de asignar la fuente no pierde el
    // evento. Es la señal de que el manifiesto nuevo ya «está», que es lo que la
    // recuperación espera para saltar de segundo.
    video.addEventListener('loadedmetadata', () => this.emitirManifiesto(url), {
      once: true,
      signal: this.controlador.signal,
    })
  }

  /** Avisa de que hay manifiesto cuando el elemento ya tiene metadatos. */
  private avisarManifiesto(video: HTMLVideoElement): void {
    const url = this.urlActual
    if (url === undefined) return

    this.cuandoHayaMetadatos(video, () => this.emitirManifiesto(url))
  }

  private emitirManifiesto(url: string): void {
    this.emitir(HlsFalso.Events.MANIFEST_PARSED, { url })

    // Sin pistas: el arnés no sirve subtítulos dentro de la lista. El aviso sale
    // igual porque `attachHls` se suscribe a él y una lista sin pistas es un caso
    // que la aplicación tiene que saber tratar.
    this.emitir(HlsFalso.Events.SUBTITLE_TRACKS_UPDATED, { subtitleTracks: [] })
  }

  /** Ejecuta la acción cuando el elemento ya conoce los metadatos. */
  private cuandoHayaMetadatos(video: HTMLVideoElement, accion: () => void): void {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      setTimeout(accion, 0)

      return
    }

    video.addEventListener('loadedmetadata', accion, {
      once: true,
      signal: this.controlador.signal,
    })
  }

  /**
   * Empieza a pedir fragmentos.
   *
   * En hls.js los pide el cargador de la biblioteca; aquí se simulan con `fetch`
   * a la misma URL del proxy y un número de secuencia. Sólo sirven para que el
   * E2E pueda interceptar uno y responder 403, que es el fallo que se quiere
   * reproducir; el medio que se ve no depende de ellos.
   */
  private reiniciarFragmentos(): void {
    this.detenerFragmentos()

    this.temporizador = setInterval(() => {
      const url = this.urlActual
      if (url === undefined) return

      this.numeroDeFragmento += 1
      fragmentosPedidos += 1

      const sn = this.numeroDeFragmento
      const direccion = `${url}?frag=${sn}`
      const programado = falloProgramado

      void fetch(direccion, { cache: 'no-store' })
        .then((respuesta) => {
          if (!respuesta.ok) {
            falloProgramado = undefined
            this.fallar(respuesta.status, respuesta.statusText || 'Forbidden', direccion, sn)

            return
          }

          // La prueba también puede programar el fallo sin interceptar la red: el
          // gancho manda y se emite el error igual. Así el E2E mide la
          // recuperación aunque la intercepción del fragmento no llegue.
          if (programado !== undefined) {
            falloProgramado = undefined
            this.fallar(programado, 'Forbidden', direccion, sn)
          }
        })
        .catch(() => {
          if (programado === undefined) return

          falloProgramado = undefined
          this.fallar(programado, 'Forbidden', direccion, sn)
        })
    }, INTERVALO_FRAGMENTO_MS)
  }

  private detenerFragmentos(): void {
    if (this.temporizador === undefined) return

    clearInterval(this.temporizador)
    this.temporizador = undefined
  }

  /**
   * Emite el fallo fatal de un fragmento.
   *
   * Se para el bucle porque hls.js también para tras un error fatal: seguir
   * pidiendo fragmentos de una fuente caducada es lo que hay que arreglar, no
   * repetir. La recuperación reanuda el bucle con la fuente nueva.
   */
  private fallar(codigo: number, texto: string, url: string, sn: number): void {
    this.detenerFragmentos()

    const datos: DatosDeError = {
      type: HlsFalso.ErrorTypes.NETWORK_ERROR,
      details: 'fragLoadError',
      fatal: true,
      response: { code: codigo, text: texto },
      frag: { url, sn },
    }

    this.emitir(HlsFalso.Events.ERROR, datos)
  }
}
