import { describe, expect, test } from 'bun:test'
import type { CliOptions } from './args'
import { type CliIO, run } from './run'

interface Harness {
  readonly out: string[]
  readonly err: string[]
  readonly started: CliOptions[]
  readonly deps: {
    readonly io: CliIO
    readonly start: (options: CliOptions) => Promise<number>
    readonly version: string
  }
}

/** `exitCode` es lo que devolvería el arranque real del servidor. */
function harness(exitCode = 0): Harness {
  const out: string[] = []
  const err: string[] = []
  const started: CliOptions[] = []

  return {
    out,
    err,
    started,
    deps: {
      io: { out: (line) => out.push(line), err: (line) => err.push(line) },
      start: async (options) => {
        started.push(options)
        return exitCode
      },
      version: '9.9.9',
    },
  }
}

describe('--help', () => {
  test('sale con 0 e imprime la ayuda', async () => {
    const target = harness()

    const code = await run(['--help'], target.deps)

    expect(code).toBe(0)
    expect(target.out).toHaveLength(1)
    expect(target.out[0]).toContain('nn-anime')
    expect(target.out[0]).toContain('--no-open')
  })

  test('no arranca el servidor', async () => {
    const target = harness()

    await run(['-h'], target.deps)

    expect(target.started).toEqual([])
  })

  test('no imprime la versión', async () => {
    const target = harness()

    await run(['--help'], target.deps)

    expect(target.out.join('\n')).not.toContain('9.9.9')
  })

  test('gana aunque haya una bandera inválida delante', async () => {
    const target = harness()

    const code = await run(['--port', 'abc', '--help'], target.deps)

    expect(code).toBe(0)
    expect(target.err).toEqual([])
  })
})

describe('--version', () => {
  test('sale con 0 e imprime la versión inyectada', async () => {
    const target = harness()

    const code = await run(['--version'], target.deps)

    expect(code).toBe(0)
    expect(target.out).toEqual(['nn-anime 9.9.9'])
  })

  test('no arranca el servidor', async () => {
    const target = harness()

    await run(['--version'], target.deps)

    expect(target.started).toEqual([])
  })
})

describe('errores de uso', () => {
  test('sale con 2 y escribe en la salida de error', async () => {
    const target = harness()

    const code = await run(['--port', 'abc'], target.deps)

    expect(code).toBe(2)
    expect(target.err).toHaveLength(1)
    expect(target.out).toEqual([])
  })

  test('nombra el valor inválido', async () => {
    const target = harness()

    await run(['--port', 'abc'], target.deps)

    expect(target.err[0]).toContain('abc')
  })

  test('nombra la bandera desconocida', async () => {
    const target = harness()

    await run(['--desconocida'], target.deps)

    expect(target.err[0]).toContain('--desconocida')
  })

  test('nombra la bandera sin valor', async () => {
    const target = harness()

    await run(['--data-dir'], target.deps)

    expect(target.err[0]).toContain('--data-dir')
  })

  test('no arranca el servidor', async () => {
    const target = harness()

    await run(['--desconocida'], target.deps)

    expect(target.started).toEqual([])
  })

  test('traduce el error aunque el idioma pedido no tenga catálogo', async () => {
    const target = harness()

    const code = await run(['--lang', 'en', '--port', 'abc'], target.deps)

    expect(code).toBe(2)
    expect(target.err[0]).toContain('abc')
  })
})

describe('arranque normal', () => {
  test('pasa las opciones analizadas al arranque', async () => {
    const target = harness()

    await run(['naruto', '--port', '8080', '--no-open'], target.deps)

    expect(target.started).toHaveLength(1)
    expect(target.started[0]?.query).toBe('naruto')
    expect(target.started[0]?.port).toBe(8080)
    expect(target.started[0]?.open).toBe(false)
  })

  test('devuelve el código de salida del arranque', async () => {
    const target = harness(3)

    expect(await run([], target.deps)).toBe(3)
  })

  test('sin consulta también arranca', async () => {
    const target = harness()

    expect(await run([], target.deps)).toBe(0)
    expect(target.started).toHaveLength(1)
  })
})
