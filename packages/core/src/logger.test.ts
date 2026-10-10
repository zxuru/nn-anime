import { describe, expect, test } from 'bun:test'
import {
  createLogger,
  type LogEntry,
  type Logger,
  type LoggerOptions,
  REDACTED,
  toJsonLine,
} from './logger'

const CLOCK = new Date('2026-10-10T12:00:00.000Z')

interface Capture {
  readonly entries: LogEntry[]
  readonly logger: Logger
}

function capture(options: Omit<LoggerOptions, 'sink'> = {}): Capture {
  const entries: LogEntry[] = []
  const logger = createLogger({ ...options, sink: (entry) => entries.push(entry) })
  return { entries, logger }
}

function entriesOf(target: Capture): readonly LogEntry[] {
  return target.entries
}

function first(target: Capture): LogEntry {
  const entry = target.entries[0]
  if (entry === undefined) throw new Error('no se emitió ninguna entrada')
  return entry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Busca un valor exacto en cualquier profundidad de una estructura. */
function containsValue(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value === needle
  if (Array.isArray(value)) return value.some((item) => containsValue(item, needle))
  if (isRecord(value)) return Object.values(value).some((item) => containsValue(item, needle))
  return false
}

describe('umbral de nivel', () => {
  test('por defecto el umbral es info y debug se descarta', () => {
    const target = capture()

    target.logger.debug('detalle')
    target.logger.info('normal')

    expect(entriesOf(target).map((entry) => entry.msg)).toEqual(['normal'])
  })

  test('descarta todo lo que queda por debajo del umbral', () => {
    const target = capture({ level: 'warn' })

    target.logger.debug('detalle')
    target.logger.info('normal')
    target.logger.warn('atención')
    target.logger.error('fallo')

    expect(entriesOf(target).map((entry) => entry.level)).toEqual(['warn', 'error'])
  })

  test('con level debug también salen las entradas de depuración', () => {
    const target = capture({ level: 'debug' })

    target.logger.debug('detalle')

    expect(entriesOf(target).map((entry) => entry.level)).toEqual(['debug'])
  })
})

describe('forma de la entrada', () => {
  test('incluye marca de tiempo ISO, nivel, mensaje y campos', () => {
    const target = capture({ now: () => CLOCK })

    target.logger.info('arrancó el server', { puerto: 7717 })

    const entry = first(target)
    expect(entry.ts).toBe(CLOCK.toISOString())
    expect(entry.level).toBe('info')
    expect(entry.msg).toBe('arrancó el server')
    expect(entry.fields).toEqual({ puerto: 7717 })
  })

  test('sin campos, la entrada lleva un objeto vacío', () => {
    const target = capture()

    target.logger.info('sin campos')

    expect(first(target).fields).toEqual({})
  })

  test('cada entrada usa el reloj en el momento de emitir, no al crear el logger', () => {
    let ticks = 0
    const target = capture({
      now: () => new Date(CLOCK.getTime() + ticks++ * 1000),
    })

    target.logger.info('primera')
    target.logger.info('segunda')

    expect(entriesOf(target).map((entry) => entry.ts)).toEqual([
      '2026-10-10T12:00:00.000Z',
      '2026-10-10T12:00:01.000Z',
    ])
  })
})

describe('redacción de datos sensibles', () => {
  test('redacta las cinco claves sensibles en el primer nivel', () => {
    const target = capture()

    target.logger.info('petición', {
      authorization: 'Bearer secreto',
      cookie: 'nn_session=abc',
      referer: 'https://sitio.example',
      token: 'deadbeef',
      headers: { referer: 'https://sitio.example' },
    })

    expect(first(target).fields).toEqual({
      authorization: REDACTED,
      cookie: REDACTED,
      referer: REDACTED,
      token: REDACTED,
      headers: REDACTED,
    })
  })

  test('redacta claves sensibles anidadas a cualquier profundidad', () => {
    const target = capture()

    target.logger.info('petición', {
      upstream: { respuesta: { headers: { cookie: 'nn_session=abc' } } },
    })

    const upstream = first(target).fields.upstream
    expect(containsValue(upstream, REDACTED)).toBe(true)
    expect(containsValue(upstream, 'nn_session=abc')).toBe(false)
  })

  test('redacta claves sensibles dentro de arrays', () => {
    const target = capture()

    target.logger.info('lote', { peticiones: [{ token: 'aaa' }, { token: 'bbb' }] })

    const peticiones = first(target).fields.peticiones
    expect(containsValue(peticiones, REDACTED)).toBe(true)
    expect(containsValue(peticiones, 'aaa')).toBe(false)
    expect(containsValue(peticiones, 'bbb')).toBe(false)
  })

  test('redacta también en nivel debug', () => {
    const target = capture({ level: 'debug' })

    target.logger.debug('detalle', { token: 'deadbeef' })

    expect(first(target).fields).toEqual({ token: REDACTED })
  })

  test('es insensible a mayúsculas', () => {
    const target = capture()

    target.logger.info('petición', { Authorization: 'Bearer secreto', COOKIE: 'x' })

    expect(first(target).fields).toEqual({ Authorization: REDACTED, COOKIE: REDACTED })
  })

  test('redacta cualquier clave cuyo nombre contenga token, cookie, secret o password', () => {
    const target = capture()

    target.logger.info('sesión', {
      bootToken: 'aaa',
      sessionToken: 'bbb',
      cookieCount: 2,
      apiSecret: 'ccc',
      userPassword: 'ddd',
    })

    expect(first(target).fields).toEqual({
      bootToken: REDACTED,
      sessionToken: REDACTED,
      cookieCount: REDACTED,
      apiSecret: REDACTED,
      userPassword: REDACTED,
    })
  })

  test('no redacta claves inocentes', () => {
    const target = capture()

    target.logger.info('arranque', { puerto: 7717, proveedor: 'fuente-ejemplo', intentos: 2 })

    expect(first(target).fields).toEqual({ puerto: 7717, proveedor: 'fuente-ejemplo', intentos: 2 })
  })

  test('no modifica el objeto de campos que recibe', () => {
    const target = capture()
    const fields = { token: 'deadbeef', puerto: 7717 }

    target.logger.info('petición', fields)

    expect(fields).toEqual({ token: 'deadbeef', puerto: 7717 })
  })
})

describe('robustez al serializar', () => {
  test('sobrevive a referencias circulares', () => {
    const target = capture()
    const circular: Record<string, unknown> = { nombre: 'raíz' }
    circular.self = circular

    target.logger.info('ciclo', { circular })

    expect(containsValue(first(target).fields, '[circular]')).toBe(true)
  })

  test('no marca como circular dos referencias al mismo objeto sin ciclo', () => {
    const target = capture()
    const compartido = { nombre: 'compartido' }

    target.logger.info('grafo', { rama: { primero: compartido, segundo: compartido } })

    expect(first(target).fields.rama).toEqual({
      primero: { nombre: 'compartido' },
      segundo: { nombre: 'compartido' },
    })
  })

  test('serializa Error como nombre y mensaje, sin la pila', () => {
    const target = capture()

    target.logger.error('falló', { cause: new TypeError('no es una función') })

    const cause = first(target).fields.cause
    expect(cause).toEqual({ name: 'TypeError', message: 'no es una función' })
  })

  test('convierte bigint a cadena en lugar de romper', () => {
    const target = capture()

    target.logger.info('bytes', { total: 10n })

    expect(first(target).fields).toEqual({ total: '10' })
  })

  test('trunca estructuras absurdamente profundas en lugar de recursar sin fin', () => {
    const target = capture()
    let deep: Record<string, unknown> = { fondo: true }
    for (let index = 0; index < 20; index++) deep = { nivel: deep }

    target.logger.info('profundo', { deep })

    expect(containsValue(first(target).fields, '[truncated]')).toBe(true)
  })

  test('convierte Date a ISO', () => {
    const target = capture()

    target.logger.info('fecha', { cuando: CLOCK })

    expect(first(target).fields).toEqual({ cuando: CLOCK.toISOString() })
  })
})

describe('child', () => {
  test('añade campos base a cada entrada', () => {
    const target = capture()
    const child = target.logger.child({ módulo: 'provider-sdk' })

    child.info('cargando plugin', { archivo: 'ejemplo.ts' })

    expect(first(target).fields).toEqual({ módulo: 'provider-sdk', archivo: 'ejemplo.ts' })
  })

  test('hereda el umbral y el destino del padre', () => {
    const target = capture({ level: 'warn' })

    target.logger.child({ módulo: 'a' }).info('descartada')
    target.logger.child({ módulo: 'a' }).warn('emitida')

    expect(entriesOf(target).map((entry) => entry.msg)).toEqual(['emitida'])
  })

  test('los campos de la llamada pisan a los del hijo', () => {
    const target = capture()
    const child = target.logger.child({ módulo: 'core' })

    child.info('mensaje', { módulo: 'server' })

    expect(first(target).fields).toEqual({ módulo: 'server' })
  })

  test('el hijo también redacta', () => {
    const target = capture()

    target.logger.child({ módulo: 'server' }).info('petición', { token: 'deadbeef' })

    expect(first(target).fields).toEqual({ módulo: 'server', token: REDACTED })
  })
})

describe('toJsonLine', () => {
  test('devuelve una sola línea JSON parseable, sin salto final', () => {
    const line = toJsonLine({ ts: CLOCK.toISOString(), level: 'info', msg: 'hola', fields: {} })

    expect(line).not.toContain('\n')
    expect(() => JSON.parse(line)).not.toThrow()
    expect(line).toContain('"level":"info"')
    expect(line).toContain('"msg":"hola"')
  })

  test('incluye los campos junto a los campos base', () => {
    const line = toJsonLine({
      ts: CLOCK.toISOString(),
      level: 'warn',
      msg: 'atención',
      fields: { puerto: 7717 },
    })

    expect(line).toContain('"puerto":7717')
  })

  test('un campo del llamador no puede pisar ts, level ni msg', () => {
    const line = toJsonLine({
      ts: CLOCK.toISOString(),
      level: 'info',
      msg: 'mensaje real',
      fields: { ts: '1970-01-01T00:00:00.000Z', level: 'error', msg: 'falso' },
    })

    expect(line).toContain('"level":"info"')
    expect(line).toContain('"msg":"mensaje real"')
    expect(line).toContain(CLOCK.toISOString())
    expect(line).not.toContain('"level":"error"')
  })
})
