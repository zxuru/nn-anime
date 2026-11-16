import { describe, expect, test } from 'bun:test'
import {
  crearRecuperadorDeHls,
  diagnosticarHls,
  type ErrorDeCargaHls,
  esCaducidad,
  esReintentable,
  MAX_RECUPERACIONES_DE_MEDIA,
  MAX_REINTENTOS_DE_RED,
  MAX_RENOVACIONES,
  type MedioHls,
  mensajeDeFallo,
  planificarRecuperacion,
  SIN_INTENTOS,
  type VideoParaRecuperar,
} from './player-errors'

/**
 * El manejador de errores de hls.js, sin navegador.
 *
 * Los cuatro casos del encargo —403, 404, red caída y error de media— son
 * `ErrorData` con la forma que publica la biblioteca: `type`, `details`,
 * `fatal`, `response.code` y `frag`. Lo que se mide es la decisión y el efecto:
 * qué se llama, con qué posición y cuándo se le cuenta el fallo al usuario.
 */

function error(
  parcial: Partial<ErrorDeCargaHls> & Pick<ErrorDeCargaHls, 'type' | 'details'>,
): ErrorDeCargaHls {
  return { fatal: true, ...parcial }
}

const CADUCADA = error({
  type: 'networkError',
  details: 'fragLoadError',
  response: { code: 403 },
  frag: { url: '/stream/ticket/seg/12', sn: 12 },
})

const NO_ENCONTRADO = error({
  type: 'networkError',
  details: 'fragLoadError',
  response: { code: 404 },
  frag: { url: '/stream/ticket/seg/3', sn: 3 },
})

const RED_CAIDA = error({ type: 'networkError', details: 'fragLoadTimeOut' })

const MEDIA = error({ type: 'mediaError', details: 'bufferAppendError' })

describe('el diagnóstico', () => {
  test('extrae el código, la URL del proxy y el número de fragmento', () => {
    expect(diagnosticarHls(CADUCADA)).toEqual({
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      http: 403,
      url: '/stream/ticket/seg/12',
      sn: 12,
    })
  })

  test('sin respuesta ni fragmento deja los campos vacíos, no inventa', () => {
    expect(diagnosticarHls(RED_CAIDA)).toMatchObject({
      http: undefined,
      url: undefined,
      sn: undefined,
    })
  })

  test('un error de lista usa `url` cuando no hay fragmento', () => {
    const deLista = error({ type: 'networkError', details: 'manifestLoadError', url: '/stream/t' })

    expect(diagnosticarHls(deLista).url).toBe('/stream/t')
  })
})

describe('los códigos de caducidad', () => {
  test('401, 403 y 410 son caducidad; 404 y 500 no', () => {
    expect(esCaducidad(401)).toBe(true)
    expect(esCaducidad(403)).toBe(true)
    expect(esCaducidad(410)).toBe(true)
    expect(esCaducidad(404)).toBe(false)
    expect(esCaducidad(500)).toBe(false)
    expect(esCaducidad(undefined)).toBe(false)
  })

  test('el mensaje lleva el código cuando lo hay', () => {
    expect(mensajeDeFallo(CADUCADA)).toBe('fragLoadError (HTTP 403)')
    expect(mensajeDeFallo(RED_CAIDA)).toBe('fragLoadTimeOut')
  })

  test('sólo red y media se ofrecen para reintentar', () => {
    expect(esReintentable(CADUCADA)).toBe(true)
    expect(esReintentable(MEDIA)).toBe(true)
    expect(esReintentable(error({ type: 'keySystemError', details: 'keySystemNoKeys' }))).toBe(
      false,
    )
  })
})

describe('el plan de recuperación', () => {
  test('un error no fatal no se toca', () => {
    expect(planificarRecuperacion({ ...CADUCADA, fatal: false }, SIN_INTENTOS).accion).toEqual({
      tipo: 'ignorar',
    })
  })

  test('un 403 pide fuente nueva en vez de reintentar la misma URL', () => {
    const plan = planificarRecuperacion(CADUCADA, SIN_INTENTOS)

    expect(plan.accion).toEqual({ tipo: 'renovar' })
    expect(plan.intentos.renovaciones).toBe(1)
    expect(plan.intentos.red).toBe(0)
  })

  test('un 410 (ticket vencido) también renueva', () => {
    const vencido = error({
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 410 },
    })

    expect(planificarRecuperacion(vencido, SIN_INTENTOS).accion).toEqual({ tipo: 'renovar' })
  })

  test('un 404 se reintenta, con la espera del primer intento', () => {
    const plan = planificarRecuperacion(NO_ENCONTRADO, SIN_INTENTOS)

    expect(plan.accion).toEqual({ tipo: 'reintentar', esperaMs: 400 })
    expect(plan.intentos.red).toBe(1)
  })

  test('los reintentos de red se gastan y luego se renueva', () => {
    let intentos = SIN_INTENTOS
    const acciones: string[] = []

    for (let vuelta = 0; vuelta <= MAX_REINTENTOS_DE_RED; vuelta++) {
      const plan = planificarRecuperacion(NO_ENCONTRADO, intentos)
      acciones.push(plan.accion.tipo)
      intentos = plan.intentos
    }

    expect(acciones).toEqual(['reintentar', 'reintentar', 'renovar'])
  })

  test('la espera entre reintentos crece', () => {
    const primero = planificarRecuperacion(NO_ENCONTRADO, SIN_INTENTOS)
    const segundo = planificarRecuperacion(NO_ENCONTRADO, primero.intentos)

    expect(primero.accion).toEqual({ tipo: 'reintentar', esperaMs: 400 })
    expect(segundo.accion).toEqual({ tipo: 'reintentar', esperaMs: 1200 })
  })

  test('sin código HTTP, la red caída se reintenta y luego se renueva', () => {
    let intentos = SIN_INTENTOS
    const acciones: string[] = []

    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const plan = planificarRecuperacion(RED_CAIDA, intentos)
      acciones.push(plan.accion.tipo)
      intentos = plan.intentos
    }

    expect(acciones).toEqual(['reintentar', 'reintentar', 'renovar'])
  })

  test('el error de media usa la recuperación de la biblioteca, no la red', () => {
    const plan = planificarRecuperacion(MEDIA, SIN_INTENTOS)

    expect(plan.accion).toEqual({ tipo: 'media' })
    expect(plan.intentos.media).toBe(1)
    expect(plan.intentos.red).toBe(0)
  })

  test('la recuperación de media también está acotada', () => {
    let intentos = SIN_INTENTOS
    const acciones: string[] = []

    for (let vuelta = 0; vuelta <= MAX_RECUPERACIONES_DE_MEDIA; vuelta++) {
      const plan = planificarRecuperacion(MEDIA, intentos)
      acciones.push(plan.accion.tipo)
      intentos = plan.intentos
    }

    expect(acciones).toEqual(['media', 'media', 'agotado'])
  })

  test('las renovaciones están acotadas', () => {
    let intentos = SIN_INTENTOS
    const acciones: string[] = []

    for (let vuelta = 0; vuelta <= MAX_RENOVACIONES; vuelta++) {
      const plan = planificarRecuperacion(CADUCADA, intentos)
      acciones.push(plan.accion.tipo)
      intentos = plan.intentos
    }

    expect(acciones).toEqual(['renovar', 'renovar', 'agotado'])
  })

  test('un error que no se sabe arreglar se agota en el acto', () => {
    const llave = error({ type: 'keySystemError', details: 'keySystemNoKeys' })

    expect(planificarRecuperacion(llave, SIN_INTENTOS).accion).toEqual({ tipo: 'agotado' })
  })
})

/* ------------------------------------------------------- el recuperador con dobles */

interface MedioFalso {
  readonly medio: MedioHls
  readonly llamadas: {
    loadSource: string[]
    startLoad: number[]
    recoverMediaError: number
    swapAudioCodec: number
  }
  readonly dispararListo: () => void
}

function medioFalso(): MedioFalso {
  const llamadas = {
    loadSource: [] as string[],
    startLoad: [] as number[],
    recoverMediaError: 0,
    swapAudioCodec: 0,
  }
  const listos: (() => void)[] = []

  return {
    llamadas,
    medio: {
      loadSource: (url) => {
        llamadas.loadSource.push(url)
      },
      startLoad: (posicion) => {
        llamadas.startLoad.push(posicion)
      },
      recoverMediaError: () => {
        llamadas.recoverMediaError += 1
      },
      swapAudioCodec: () => {
        llamadas.swapAudioCodec += 1
      },
      unaVezListo: (escucha) => {
        listos.push(escucha)
      },
    },
    dispararListo: () => {
      const ultimo = listos.at(-1)
      if (ultimo !== undefined) ultimo()
    },
  }
}

/**
 * El elemento de mentira.
 *
 * Clase y no objeto literal para poder medir el salto: `currentTime` es una
 * propiedad con setter, y un objeto plano no diría cuándo se escribió.
 */
class VideoDePrueba implements VideoParaRecuperar {
  #posicion: number
  #saltos: number[] = []
  #reproducciones = 0
  paused: boolean

  constructor(posicion: number, pausado = false) {
    this.#posicion = posicion
    this.paused = pausado
  }

  get currentTime(): number {
    return this.#posicion
  }

  set currentTime(valor: number) {
    this.#posicion = valor
    this.#saltos.push(valor)
  }

  get saltos(): readonly number[] {
    return this.#saltos
  }

  get reproducciones(): number {
    return this.#reproducciones
  }

  async play(): Promise<void> {
    this.#reproducciones += 1
  }
}

interface Montaje {
  readonly recuperador: ReturnType<typeof crearRecuperadorDeHls>
  readonly medio: MedioFalso
  readonly video: VideoDePrueba
  readonly fallos: { mensaje: string; reintentable: boolean }[]
  readonly programadas: { accion: () => void; esperaMs: number }[]
  readonly recuperados: () => number
}

function montar(
  posicion: number,
  renovar: (() => Promise<string | undefined>) | undefined,
  pausado = false,
): Montaje {
  const medio = medioFalso()
  const video = new VideoDePrueba(posicion, pausado)
  const fallos: { mensaje: string; reintentable: boolean }[] = []
  const programadas: { accion: () => void; esperaMs: number }[] = []
  let recuperados = 0

  const recuperador = crearRecuperadorDeHls({
    medio: medio.medio,
    video,
    ...(renovar === undefined ? {} : { renovarFuente: renovar }),
    alFallar: (fallo) => fallos.push(fallo),
    alRecuperar: () => {
      recuperados += 1
    },
    programar: (accion, esperaMs) => {
      programadas.push({ accion, esperaMs })
    },
  })

  return { recuperador, medio, video, fallos, programadas, recuperados: () => recuperados }
}

describe('el recuperador', () => {
  /** Deja correr las promesas de la renovación, que encadena dos `await`. */
  const dejarCorrer = async (): Promise<void> => {
    await new Promise((resolver) => setTimeout(resolver, 0))
  }

  test('un 403 pide fuente nueva y reanuda en el mismo segundo', async () => {
    const prueba = montar(42, async () => '/stream/ticket-nuevo')

    prueba.recuperador.alError(CADUCADA)
    await dejarCorrer()

    expect(prueba.medio.llamadas.loadSource).toEqual(['/stream/ticket-nuevo'])

    // La posición se devuelve cuando la lista nueva está lista, no antes: con la
    // lista sin parsear el elemento no admite un `currentTime` que no conoce.
    expect(prueba.video.saltos).toEqual([])
    prueba.medio.dispararListo()

    expect(prueba.video.saltos).toEqual([42])
    expect(prueba.medio.llamadas.startLoad).toEqual([42])
    expect(prueba.recuperados()).toBe(1)
  })

  test('si estaba en pausa no se reanuda sola', async () => {
    const prueba = montar(10, async () => '/stream/otro', true)

    prueba.recuperador.alError(CADUCADA)
    await dejarCorrer()
    prueba.medio.dispararListo()

    expect(prueba.video.reproducciones).toBe(0)
  })

  test('un 404 se reintenta con `startLoad` en la posición, sin pedir fuente', () => {
    const prueba = montar(15, async () => '/stream/nueva')

    prueba.recuperador.alError(NO_ENCONTRADO)

    expect(prueba.medio.llamadas.loadSource).toEqual([])
    expect(prueba.programadas).toHaveLength(1)
    expect(prueba.programadas[0]?.esperaMs).toBe(400)

    prueba.programadas[0]?.accion()

    expect(prueba.medio.llamadas.startLoad).toEqual([15])
  })

  test('la red caída reintenta y, agotada, renueva', async () => {
    let renovaciones = 0
    const prueba = montar(5, async () => {
      renovaciones += 1

      return '/stream/nueva'
    })

    for (let vuelta = 0; vuelta < MAX_REINTENTOS_DE_RED; vuelta++) {
      prueba.recuperador.alError(RED_CAIDA)
      prueba.programadas[vuelta]?.accion()
    }

    expect(renovaciones).toBe(0)

    prueba.recuperador.alError(RED_CAIDA)
    await dejarCorrer()

    expect(renovaciones).toBe(1)
    expect(prueba.medio.llamadas.loadSource).toEqual(['/stream/nueva'])
  })

  test('el error de media llama a `recoverMediaError` y a la segunda cambia el códec', () => {
    const prueba = montar(20, undefined)

    prueba.recuperador.alError(MEDIA)
    expect(prueba.medio.llamadas.recoverMediaError).toBe(1)
    expect(prueba.medio.llamadas.swapAudioCodec).toBe(0)

    prueba.recuperador.alError(MEDIA)
    expect(prueba.medio.llamadas.recoverMediaError).toBe(2)
    expect(prueba.medio.llamadas.swapAudioCodec).toBe(1)
  })

  test('agotados los intentos, el fallo se cuenta con su código y es reintentable', () => {
    const prueba = montar(20, async () => '/stream/nueva')

    for (let vuelta = 0; vuelta <= MAX_RENOVACIONES; vuelta++) prueba.recuperador.alError(CADUCADA)

    expect(prueba.fallos).toHaveLength(1)
    expect(prueba.fallos[0]).toEqual({ mensaje: 'fragLoadError (HTTP 403)', reintentable: true })
  })

  test('sin renovación posible, un 403 se agota sin inventarse una URL', () => {
    const prueba = montar(20, undefined)

    prueba.recuperador.alError(CADUCADA)

    expect(prueba.medio.llamadas.loadSource).toEqual([])
    expect(prueba.fallos).toHaveLength(1)
    expect(prueba.fallos[0]?.reintentable).toBe(true)
  })

  test('si la renovación falla, se agota y se cuenta', async () => {
    const prueba = montar(20, async () => undefined)

    prueba.recuperador.alError(CADUCADA)
    await dejarCorrer()

    expect(prueba.medio.llamadas.loadSource).toEqual([])
    expect(prueba.fallos).toHaveLength(1)
  })

  test('el reintento manual pide fuente nueva y reanuda en la posición de ahora', async () => {
    let renovaciones = 0
    const prueba = montar(30, async () => {
      renovaciones += 1

      return `/stream/nueva-${renovaciones}`
    })
    prueba.video.currentTime = 33

    const recuperado = await prueba.recuperador.reintentar()

    expect(recuperado).toBe(true)
    expect(prueba.medio.llamadas.loadSource).toEqual(['/stream/nueva-1'])
    prueba.medio.dispararListo()
    // El salto de preparación de la prueba y el de la recuperación: el que
    // importa es el último, que es el que devuelve al usuario donde estaba.
    expect(prueba.video.saltos.at(-1)).toBe(33)
    expect(prueba.recuperados()).toBe(1)
  })

  test('el reintento manual sin fuente nueva vuelve a arrancar con la misma', async () => {
    const prueba = montar(30, async () => undefined)
    prueba.video.currentTime = 31

    expect(await prueba.recuperador.reintentar()).toBe(true)
    expect(prueba.medio.llamadas.startLoad).toEqual([31])
  })

  test('destruido, un reintento programado no toca el medio', () => {
    const prueba = montar(20, async () => '/stream/nueva')

    prueba.recuperador.alError(NO_ENCONTRADO)
    prueba.recuperador.destruir()
    prueba.programadas[0]?.accion()

    expect(prueba.medio.llamadas.startLoad).toEqual([])
  })
})
