import { describe, expect, test } from 'bun:test'
import type { PresenceSnapshot } from './activity'
import type { DiscordIpc } from './ipc'
import {
  cambiaElEstado,
  createPresenceService,
  esperaDeEnvio,
  MAX_IN_WINDOW,
  WINDOW_MS,
} from './service'

const T0 = 1_700_000_000_000

function foto(cambios: Partial<PresenceSnapshot> = {}): PresenceSnapshot {
  return {
    mode: 'completo',
    title: 'Aurora Nocturna',
    episodeNumber: 3,
    positionS: 0,
    durationS: 1_440,
    paused: false,
    ...cambios,
  }
}

/**
 * El reloj y el temporizador de las pruebas.
 *
 * La ventana de Discord son veinte segundos y el reintento, un minuto: esperarlos
 * de verdad convertiría la suite en una espera. Se avanza el reloj y se ejecutan
 * los turnos que toquen, en orden, dejando correr los `await` de cada envío.
 */
function relojFalso(): {
  readonly now: () => number
  readonly programar: (fn: () => void, ms: number) => unknown
  readonly cancelar: (id: unknown) => void
  readonly avanzar: (ms: number) => Promise<void>
} {
  let t = T0
  let siguienteId = 1
  const turnos = new Map<number, { readonly at: number; readonly fn: () => void }>()

  const siguiente = (): { id: number; at: number; fn: () => void } | undefined => {
    let elegido: { id: number; at: number; fn: () => void } | undefined

    for (const [id, turno] of turnos) {
      if (elegido === undefined || turno.at < elegido.at) elegido = { id, ...turno }
    }

    return elegido
  }

  return {
    now: () => t,
    programar(fn, ms) {
      const id = siguienteId++
      turnos.set(id, { at: t + ms, fn })

      return id
    },
    cancelar(id) {
      turnos.delete(Number(id))
    },
    async avanzar(ms) {
      const destino = t + ms

      for (;;) {
        const turno = siguiente()
        if (turno === undefined || turno.at > destino) break

        t = Math.max(t, turno.at)
        turnos.delete(turno.id)
        turno.fn()
        // El envío es asíncrono: se le deja terminar antes del turno siguiente.
        await Bun.sleep(0)
      }

      t = destino
      await Bun.sleep(0)
    },
  }
}

/** Un Discord de mentira que apunta las actividades y puede negarse a conectar. */
function discordFalso(): DiscordIpc & {
  readonly actividades: unknown[]
  readonly intentos: number
  negar: (veces: number) => void
  cerrarAlConectar: Promise<void> | undefined
} {
  let conectado = false
  let negativas = 0
  let intentos = 0

  const falso = {
    actividades: [] as unknown[],
    intentos: 0,
    cerrarAlConectar: undefined as Promise<void> | undefined,
    get connected() {
      return conectado
    },
    async connect() {
      intentos += 1
      falso.intentos = intentos

      if (negativas > 0) {
        negativas -= 1
        throw new Error('Discord no está abierto')
      }

      conectado = true
    },
    setActivity(activity: unknown) {
      falso.actividades.push(activity)
    },
    clearActivity() {
      falso.actividades.push('CLEAR')
    },
    close() {
      conectado = false
    },
    negar(veces: number) {
      negativas = veces
    },
  }

  return falso
}

function montar(): {
  readonly servicio: ReturnType<typeof createPresenceService>
  readonly discord: ReturnType<typeof discordFalso>
  readonly reloj: ReturnType<typeof relojFalso>
} {
  const reloj = relojFalso()
  const discord = discordFalso()
  const servicio = createPresenceService({
    appId: 'x',
    now: reloj.now,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
    createIpc: () => discord,
  })

  return { servicio, discord, reloj }
}

/** Lo que Discord recibió, sin el ruido de los tipos. */
function publicado(discord: ReturnType<typeof discordFalso>, indice = -1): Record<string, unknown> {
  const actividad = discord.actividades.at(indice)
  if (typeof actividad !== 'object' || actividad === null) throw new Error('no hay actividad')

  return actividad as Record<string, unknown>
}

describe('cuánto se espera antes de hablar con Discord', () => {
  const base = {
    ahora: T0,
    ultimoEnvio: T0,
    hayAnterior: true,
    cambiaElEstado: false,
    marcas: [] as number[],
    windowMs: WINDOW_MS,
    maxInWindow: MAX_IN_WINDOW,
    minGapMs: 2_000,
  }

  test('lo que sólo avanza espera el turno de dos segundos', () => {
    expect(esperaDeEnvio({ ...base, ahora: T0 + 500 })).toBe(1_500)
    expect(esperaDeEnvio({ ...base, ahora: T0 + 2_000 })).toBe(0)
  })

  /**
   * La prueba que mide el fallo: con el intervalo fijo de cinco segundos, una
   * pausa que llegaba justo después de una foto esperaba a publicarse, y Discord
   * seguía contando el reloj como si el episodio estuviera en marcha.
   */
  test('un cambio de estado no espera el turno', () => {
    expect(esperaDeEnvio({ ...base, ahora: T0 + 100, cambiaElEstado: true })).toBe(0)
  })

  test('la primera foto no espera nada', () => {
    expect(esperaDeEnvio({ ...base, ultimoEnvio: 0, hayAnterior: false, ahora: T0 + 100 })).toBe(0)
  })

  test('la ventana admite cinco y la sexta espera a que caduque la primera', () => {
    const marcas = [T0, T0 + 2_000, T0 + 4_000, T0 + 6_000, T0 + 8_000]

    // Con cinco dentro, la que llega a los diez segundos espera a los veinte.
    expect(esperaDeEnvio({ ...base, ahora: T0 + 10_000, ultimoEnvio: T0 + 8_000, marcas })).toBe(
      10_000,
    )

    // Y en el mismo instante en que caduca la primera, sale.
    expect(esperaDeEnvio({ ...base, ahora: T0 + 20_000, ultimoEnvio: T0 + 8_000, marcas })).toBe(0)
  })

  test('las marcas que ya caducaron no cuentan', () => {
    const marcas = [T0 - 20_001, T0 - 19_000]

    expect(esperaDeEnvio({ ...base, ahora: T0 + 10_000, ultimoEnvio: T0, marcas })).toBe(0)
  })
})

describe('qué cuenta como cambio de estado', () => {
  test('la pausa, el modo, el título, el episodio y la duración', () => {
    expect(cambiaElEstado(foto({ paused: true }), foto())).toBe(true)
    expect(cambiaElEstado(foto({ mode: 'discreto' }), foto())).toBe(true)
    expect(cambiaElEstado(foto({ title: null }), foto())).toBe(true)
    expect(cambiaElEstado(foto({ episodeNumber: 4 }), foto())).toBe(true)
    expect(cambiaElEstado(foto(), undefined)).toBe(true)
  })

  test('saber la duración es lo que hace aparecer la barra: no espera turno', () => {
    expect(cambiaElEstado(foto({ durationS: 1_440 }), foto({ durationS: 0 }))).toBe(true)
  })

  test('la posición no: ésa la lleva el reloj de Discord entre foto y foto', () => {
    expect(cambiaElEstado(foto({ positionS: 900 }), foto({ positionS: 100 }))).toBe(false)
  })
})

describe('el servicio', () => {
  test('una pausa se publica en el acto aunque acabe de salir una foto', async () => {
    const { servicio, discord, reloj } = montar()

    servicio.update(foto({ positionS: 120 }))
    await reloj.avanzar(0)
    expect(discord.actividades).toHaveLength(1)

    // Medio segundo después el usuario pausa: no puede esperar el turno.
    servicio.update(foto({ positionS: 120, paused: true }))
    await reloj.avanzar(500)

    expect(discord.actividades).toHaveLength(2)
    expect(publicado(discord).state).toBe('En pausa')
    expect(publicado(discord).timestamps).toBeUndefined()
  })

  test('las fotos que sólo avanzan se agrupan y gana la última', async () => {
    const { servicio, discord, reloj } = montar()

    servicio.update(foto({ positionS: 10 }))
    await reloj.avanzar(0)

    servicio.update(foto({ positionS: 11 }))
    servicio.update(foto({ positionS: 12 }))
    servicio.update(foto({ positionS: 13 }))
    await reloj.avanzar(1_000)
    expect(discord.actividades).toHaveLength(1)

    await reloj.avanzar(1_000)
    expect(discord.actividades).toHaveLength(2)
    // La posición publicada es la última, no la que programó el turno.
    expect(publicado(discord).timestamps).toEqual({
      start: T0 + 2_000 - 13_000,
      end: T0 + 2_000 - 13_000 + 1_440_000,
    })
  })

  test('la misma foto no se repite', async () => {
    const { servicio, discord, reloj } = montar()

    // En pausa la actividad no lleva timestamps, así que dos fotos iguales dan
    // el mismo JSON: Discord ya lo tiene y repetirlo gastaría cuota.
    servicio.update(foto({ positionS: 10, paused: true }))
    await reloj.avanzar(0)
    servicio.update(foto({ positionS: 10, paused: true }))
    await reloj.avanzar(5_000)

    expect(discord.actividades).toHaveLength(1)
  })

  /**
   * La prueba que mide el fallo: la foto que caía dentro del minuto de reintento
   * se descartaba y no volvía nunca. Una pausa en ese minuto dejaba el perfil
   * diciendo que se seguía viendo.
   */
  test('si Discord no está, la foto espera al reintento en vez de perderse', async () => {
    const { servicio, discord, reloj } = montar()
    discord.negar(1)

    servicio.update(foto({ positionS: 30 }))
    await reloj.avanzar(0)
    expect(discord.actividades).toHaveLength(0)

    // Dentro del minuto de reintento el usuario pausa: la foto no se tira.
    servicio.update(foto({ positionS: 30, paused: true }))
    await reloj.avanzar(1_000)
    expect(discord.actividades).toHaveLength(0)

    await reloj.avanzar(60_000)
    expect(discord.actividades).toHaveLength(1)
    expect(publicado(discord).state).toBe('En pausa')
  })

  /**
   * El mismo fallo, sin una segunda foto que lo rescate: la que falló tiene que
   * volver sola al vencer el reintento. Es el caso de pausar y no tocar nada
   * más, que es justo lo que hace quien se levanta del ordenador.
   */
  test('la foto que falló se publica sola cuando vence el reintento', async () => {
    const { servicio, discord, reloj } = montar()
    discord.negar(1)

    servicio.update(foto({ positionS: 30, paused: true }))
    await reloj.avanzar(1_000)
    expect(discord.actividades).toHaveLength(0)

    await reloj.avanzar(60_000)
    expect(discord.actividades).toHaveLength(1)
    expect(publicado(discord).state).toBe('En pausa')
  })

  test('la cuota no deja pasar más de cinco por ventana', async () => {
    const { servicio, discord, reloj } = montar()

    for (let indice = 0; indice < 8; indice++) {
      servicio.update(foto({ positionS: indice * 30 }))
      await reloj.avanzar(2_000)
    }

    // Cinco publicadas y las demás esperando a que la ventana se abra.
    expect(discord.actividades).toHaveLength(MAX_IN_WINDOW)

    await reloj.avanzar(WINDOW_MS)
    expect(discord.actividades.length).toBeGreaterThan(MAX_IN_WINDOW)
  })

  test('apagar la presencia mientras se abre el pipe no la publica después', async () => {
    const { servicio, discord, reloj } = montar()

    servicio.update(foto({ positionS: 40 }))
    // `clear` llega con el handshake a medias: el `await` del envío no ha vuelto.
    servicio.clear()
    await reloj.avanzar(5_000)

    // Ni la actividad ni un `CLEAR`: no llegó a publicarse nada.
    expect(discord.actividades).toHaveLength(0)
  })

  test('apagar la presencia retira lo publicado', async () => {
    const { servicio, discord, reloj } = montar()

    servicio.update(foto({ positionS: 40 }))
    await reloj.avanzar(0)
    servicio.clear()

    expect(discord.actividades.at(-1)).toBe('CLEAR')
  })

  test('al cerrar no se publica nada más', async () => {
    const { servicio, discord, reloj } = montar()

    await servicio.close()
    servicio.update(foto({ positionS: 50 }))
    await reloj.avanzar(5_000)

    expect(discord.actividades).toHaveLength(0)
  })
})
