/**
 * Qué hacer con un error de `hls.js`.
 *
 * Hasta ahora un error **fatal** se contaba y se acababa ahí: el reproductor
 * pintaba el aviso y no volvía a pedir nada. En una fuente real eso deja la
 * reproducción parada para siempre por un fallo que casi siempre se arregla
 * pidiendo otra vez —un segmento que no llegó, una URL firmada que caducó, una
 * conexión que se cayó—.
 *
 * La decisión vive aquí, aparte del reproductor y de la biblioteca, por dos
 * razones: se puede probar sin navegador y sin red —con los `ErrorData` que
 * publica hls.js— y el orden de los intentos queda escrito en un solo sitio.
 *
 * Las reglas, y por qué:
 *
 * - **Lo no fatal no se toca.** hls.js reintenta por dentro; adelantarse sería
 *   duplicar sus reintentos y llenar el registro de ruido.
 * - **Un código de caducidad (401/403/410) no se reintenta igual.** La URL —o
 *   el ticket del proxy que la representa— ya no vale: insistir con la misma
 *   solo gasta tiempo. Toca pedir una fuente nueva y conservar la posición.
 * - **Un error de red sin código se reintenta con espera creciente** y, si no
 *   basta, también se renueva: una CDN que falla para un host puede servir otro.
 * - **Un error de media no se arregla pidiendo red.** `recoverMediaError()` es
 *   la herramienta de la biblioteca, y se usa un número acotado de veces: un
 *   códec que el navegador no decodifica no se arregla repitiendo.
 * - **Todo está acotado.** Sin tope, un upstream caído se convierte en un bucle
 *   de peticiones; el usuario tiene que ver el fallo y decidir.
 */

/** Lo que este módulo mira de un `ErrorData` de hls.js. */
export interface ErrorDeCargaHls {
  readonly type: string
  readonly details: string
  readonly fatal: boolean
  readonly response?: { readonly code?: number | undefined } | undefined
  readonly frag?:
    | { readonly url?: string | undefined; readonly sn?: number | string | undefined }
    | undefined
  readonly url?: string | undefined
}

/**
 * El error, reducido a lo que sirve para depurar.
 *
 * Se registra **sólo en desarrollo** y con la URL que pidió el reproductor —la
 * del proxy, nunca la del upstream, que no llega al cliente—. Es lo que hacía
 * falta para saber si el fallo era un 403 de la firma, un 410 del ticket o una
 * conexión caída sin código.
 */
export interface DiagnosticoHls {
  readonly type: string
  readonly details: string
  readonly fatal: boolean
  readonly http: number | undefined
  readonly url: string | undefined
  readonly sn: number | string | undefined
}

export function diagnosticarHls(datos: ErrorDeCargaHls): DiagnosticoHls {
  return {
    type: datos.type,
    details: datos.details,
    fatal: datos.fatal,
    http: datos.response?.code,
    url: datos.frag?.url ?? datos.url,
    sn: datos.frag?.sn,
  }
}

/**
 * Los códigos que dicen «esta dirección ya no vale».
 *
 * 401 y 403 son la firma caducada o el CDN que rechaza la petición; 410 es el
 * ticket del proxy vencido. En los tres casos la URL que se está usando no va a
 * funcionar por mucho que se repita: lo que hay que hacer es pedir otra.
 */
export function esCaducidad(codigo: number | undefined): boolean {
  return codigo === 401 || codigo === 403 || codigo === 410
}

/** ¿Merece la pena ofrecer «Reintentar» cuando ya se agotaron los intentos? */
export function esReintentable(datos: ErrorDeCargaHls): boolean {
  return datos.type === 'networkError' || datos.type === 'mediaError'
}

/** El texto del fallo, con su código HTTP cuando lo hay. */
export function mensajeDeFallo(datos: ErrorDeCargaHls): string {
  const codigo = datos.response?.code

  return codigo === undefined ? datos.details : `${datos.details} (HTTP ${codigo})`
}

/** Lo que toca hacer con el error, ya con los intentos contados. */
export type AccionDeRecuperacion =
  | { readonly tipo: 'ignorar' }
  | { readonly tipo: 'reintentar'; readonly esperaMs: number }
  | { readonly tipo: 'renovar' }
  | { readonly tipo: 'media' }
  | { readonly tipo: 'agotado' }

/** Cuántas recuperaciones se llevan hechas para la fuente actual. */
export interface IntentosDeRecuperacion {
  readonly red: number
  readonly media: number
  readonly renovaciones: number
}

export const SIN_INTENTOS: IntentosDeRecuperacion = { red: 0, media: 0, renovaciones: 0 }

/** Reintentos de red antes de pedir una fuente nueva. */
export const MAX_REINTENTOS_DE_RED = 2

/** Recuperaciones de media antes de darse por vencido. */
export const MAX_RECUPERACIONES_DE_MEDIA = 2

/** Fuentes nuevas que se piden como mucho para un mismo fallo. */
export const MAX_RENOVACIONES = 2

/**
 * Espera entre reintentos de red.
 *
 * Creciente y corta: el primer reintento tapa un corte de un instante —lo
 * normal— y el segundo da tiempo a que la CDN se recupere sin que la espera se
 * note como un parón.
 */
export const ESPERAS_DE_RED_MS: readonly number[] = [400, 1200]

export interface PlanDeRecuperacion {
  readonly accion: AccionDeRecuperacion
  readonly intentos: IntentosDeRecuperacion
}

/**
 * El plan para este error, con los intentos que quedan.
 *
 * Devuelve también los intentos actualizados: el planificador es una función
 * pura y no guarda estado, que es lo que permite probarlo con la tabla entera
 * de casos sin montar un reproductor.
 */
export function planificarRecuperacion(
  datos: ErrorDeCargaHls,
  intentos: IntentosDeRecuperacion,
): PlanDeRecuperacion {
  if (!datos.fatal) return { accion: { tipo: 'ignorar' }, intentos }

  if (datos.type === 'mediaError') {
    if (intentos.media >= MAX_RECUPERACIONES_DE_MEDIA) {
      return { accion: { tipo: 'agotado' }, intentos }
    }

    return { accion: { tipo: 'media' }, intentos: { ...intentos, media: intentos.media + 1 } }
  }

  if (datos.type === 'networkError') {
    // La URL no vale: reintentarla es gastar el tiempo del usuario.
    if (esCaducidad(datos.response?.code)) {
      if (intentos.renovaciones >= MAX_RENOVACIONES) {
        return { accion: { tipo: 'agotado' }, intentos }
      }

      return {
        accion: { tipo: 'renovar' },
        intentos: { ...intentos, renovaciones: intentos.renovaciones + 1 },
      }
    }

    if (intentos.red < MAX_REINTENTOS_DE_RED) {
      const esperaMs = ESPERAS_DE_RED_MS[intentos.red] ?? 1200

      return {
        accion: { tipo: 'reintentar', esperaMs },
        intentos: { ...intentos, red: intentos.red + 1 },
      }
    }

    // Sin código y con los reintentos gastados: puede que otra fuente —otro
    // host, otro ticket— sí responda.
    if (intentos.renovaciones < MAX_RENOVACIONES) {
      return {
        accion: { tipo: 'renovar' },
        intentos: { ...intentos, renovaciones: intentos.renovaciones + 1 },
      }
    }
  }

  return { accion: { tipo: 'agotado' }, intentos }
}

/** El fallo que se le cuenta al usuario, cuando ya no queda nada que probar. */
export interface FalloDeReproduccion {
  readonly mensaje: string
  readonly reintentable: boolean
}

/** Lo mínimo que el recuperador necesita de hls.js. */
export interface MedioHls {
  loadSource(url: string): void
  startLoad(startPosition: number): void
  recoverMediaError(): void
  swapAudioCodec(): void
  /** Ejecuta el aviso cuando la lista nueva ya está parseada. */
  unaVezListo(escucha: () => void): void
}

/** Lo mínimo que el recuperador necesita del `<video>`. */
export interface VideoParaRecuperar {
  currentTime: number
  readonly paused: boolean
  play(): Promise<void>
}

export interface RecuperadorOptions {
  readonly medio: MedioHls
  readonly video: VideoParaRecuperar
  /**
   * Pide una fuente nueva para el mismo episodio y devuelve su URL.
   *
   * Sin esto —un HLS que el navegador lleva por su cuenta, o una prueba— no hay
   * renovación posible y el fallo se agota en el acto.
   */
  readonly renovarFuente?: (() => Promise<string | undefined>) | undefined
  readonly alFallar: (fallo: FalloDeReproduccion) => void
  readonly alRecuperar?: (() => void) | undefined
  /** Se inyecta en las pruebas para no esperar de verdad entre reintentos. */
  readonly programar?: ((accion: () => void, esperaMs: number) => void) | undefined
}

export interface RecuperadorDeHls {
  readonly alError: (datos: ErrorDeCargaHls) => void
  /** El gesto del usuario: otra vuelta completa, con la posición de ahora. */
  readonly reintentar: () => Promise<boolean>
  readonly destruir: () => void
}

/**
 * El manejador de errores de una instancia de hls.js, con su estado.
 *
 * La posición se guarda **antes** de tocar nada: `recoverMediaError()` y
 * `loadSource()` recrean el MediaSource, y con él el elemento vuelve al segundo
 * cero. Esa es justo la posición que hay que devolver al usuario cuando la
 * reproducción se recupera.
 */
export function crearRecuperadorDeHls(options: RecuperadorOptions): RecuperadorDeHls {
  let intentos = SIN_INTENTOS
  let posicion = 0
  let seguiaReproduciendo = false
  let ultimo: ErrorDeCargaHls | undefined
  let vivo = true
  let pendiente: ReturnType<typeof setTimeout> | undefined

  const programar =
    options.programar ??
    ((accion: () => void, esperaMs: number): void => {
      pendiente = setTimeout(accion, esperaMs)
    })

  const guardarPosicion = (): void => {
    posicion = options.video.currentTime
    seguiaReproduciendo = !options.video.paused
  }

  const agotar = (): void => {
    if (ultimo === undefined) return

    options.alFallar({ mensaje: mensajeDeFallo(ultimo), reintentable: esReintentable(ultimo) })
  }

  /**
   * Carga una URL y devuelve el elemento a la posición guardada.
   *
   * El salto se hace cuando la lista nueva ya está parseada: antes no hay
   * duración y `currentTime` no admite un valor que el elemento no conoce. El
   * `startLoad` va después del salto para que la biblioteca pida los segmentos
   * de esa posición y no los del principio.
   */
  const cargarEn = (url: string, desdeS: number, seguir: boolean): void => {
    options.medio.loadSource(url)
    options.medio.unaVezListo(() => {
      if (!vivo) return

      if (desdeS > 0) options.video.currentTime = desdeS
      options.medio.startLoad(desdeS > 0 ? desdeS : -1)

      if (seguir) void options.video.play().catch(() => {})
    })
  }

  const renovar = async (): Promise<boolean> => {
    if (options.renovarFuente === undefined) {
      agotar()

      return false
    }

    let url: string | undefined
    try {
      url = await options.renovarFuente()
    } catch {
      // Un fallo al renovar es un fallo del fallo: se cuenta como agotado y el
      // usuario decide. No se propaga: aquí ya no hay nadie a quien contarlo.
      url = undefined
    }

    if (!vivo) return false

    if (url === undefined) {
      agotar()

      return false
    }

    cargarEn(url, posicion, seguiaReproduciendo)

    return true
  }

  const alError = (datos: ErrorDeCargaHls): void => {
    if (!datos.fatal) return

    guardarPosicion()
    ultimo = datos

    const plan = planificarRecuperacion(datos, intentos)
    intentos = plan.intentos

    switch (plan.accion.tipo) {
      case 'ignorar':
        return
      case 'media':
        // A la segunda vuelta se prueba además el otro códec de audio: el mismo
        // archivo con otro perfil a veces sí lo decodifica el navegador.
        if (plan.intentos.media > 1) options.medio.swapAudioCodec()
        options.medio.recoverMediaError()

        return
      case 'reintentar':
        programar(() => {
          if (!vivo) return

          options.medio.startLoad(posicion > 0 ? posicion : -1)
        }, plan.accion.esperaMs)

        return
      case 'renovar':
        void renovar().then((recuperado) => {
          if (recuperado) options.alRecuperar?.()
        })

        return
      case 'agotado':
        agotar()

        return
    }
  }

  /**
   * El reintento manual, en el mismo segundo.
   *
   * Primero se pide una fuente nueva —es la causa más probable de que un fallo
   * agote los intentos— y, si no la hay, se vuelve a arrancar con la misma: un
   * corte de red también se pasa solo. Los intentos se reinician porque esto es
   * una decisión del usuario, no un reintento automático más.
   */
  const reintentar = async (): Promise<boolean> => {
    if (!vivo) return false

    intentos = SIN_INTENTOS
    guardarPosicion()

    let url: string | undefined
    if (options.renovarFuente !== undefined) {
      try {
        url = await options.renovarFuente()
      } catch {
        url = undefined
      }
    }

    if (!vivo) return false

    if (url === undefined) options.medio.startLoad(posicion > 0 ? posicion : -1)
    else cargarEn(url, posicion, seguiaReproduciendo)

    options.alRecuperar?.()

    return true
  }

  const destruir = (): void => {
    vivo = false
    if (pendiente !== undefined) {
      clearTimeout(pendiente)
      pendiente = undefined
    }
  }

  return { alError, reintentar, destruir }
}
