import { describe, expect, test } from 'bun:test'
import { createDedupe } from './dedupe'

describe('deduplicación', () => {
  test('dos llamadas a la vez con la misma clave hacen un solo trabajo', async () => {
    const dedupe = createDedupe<string>()
    let veces = 0
    const trabajo = async (): Promise<string> => {
      veces += 1
      await Bun.sleep(5)
      return 'listo'
    }

    const [uno, dos] = await Promise.all([
      dedupe.run('/api/search?q=a', trabajo),
      dedupe.run('/api/search?q=a', trabajo),
    ])

    expect(veces).toBe(1)
    expect(uno).toBe('listo')
    expect(dos).toBe('listo')
  })

  test('claves distintas no se comparten', async () => {
    const dedupe = createDedupe<string>()
    let veces = 0
    const trabajo = async (): Promise<string> => {
      veces += 1
      return 'listo'
    }

    await Promise.all([dedupe.run('a', trabajo), dedupe.run('b', trabajo)])

    expect(veces).toBe(2)
  })

  test('pasado el trabajo, la siguiente llamada vuelve a empezar', async () => {
    const dedupe = createDedupe<string>()
    let veces = 0
    const trabajo = async (): Promise<string> => {
      veces += 1
      return 'listo'
    }

    await dedupe.run('a', trabajo)
    await dedupe.run('a', trabajo)

    expect(veces).toBe(2)
    expect(dedupe.size()).toBe(0)
  })

  test('un fallo libera la clave y se puede reintentar', async () => {
    const dedupe = createDedupe<string>()
    let intentos = 0

    await expect(
      dedupe.run('a', async () => {
        intentos += 1
        throw new Error('se cayó')
      }),
    ).rejects.toThrow('se cayó')

    const segundo = await dedupe.run('a', async () => {
      intentos += 1
      return 'ahora sí'
    })

    expect(segundo).toBe('ahora sí')
    expect(intentos).toBe(2)
  })

  test('los dos que comparten un fallo ven el mismo error', async () => {
    const dedupe = createDedupe<string>()
    const boom = new Error('se cayó')

    const uno = dedupe.run('a', async () => {
      await Bun.sleep(2)
      throw boom
    })
    const dos = dedupe.run('a', async () => {
      throw new Error('no debería ejecutarse')
    })

    await expect(uno).rejects.toBe(boom)
    await expect(dos).rejects.toBe(boom)
  })

  test('mientras hay trabajo en vuelo, la clave cuenta', async () => {
    const dedupe = createDedupe<string>()

    const pendiente = dedupe.run('a', async () => {
      await Bun.sleep(5)
      return 'listo'
    })

    expect(dedupe.size()).toBe(1)
    await pendiente
    expect(dedupe.size()).toBe(0)
  })
})
