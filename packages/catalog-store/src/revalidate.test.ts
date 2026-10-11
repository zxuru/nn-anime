import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnimeDetail, ProviderRef } from '@nn-anime/core'
import { openDb } from './db'
import { runMigrations } from './migrations/runner'
import { createAnimeRepository } from './repositories/anime'
import {
  clearRevalidateError,
  createRevalidator,
  listRevalidateErrors,
  markRevalidateError,
  refKey,
} from './revalidate'
import { createWriteQueue } from './write-queue'

const REF: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna' }

function detalle(title: string): AnimeDetail {
  return { ref: REF, title, genres: ['Acción'], studios: ['Estudio'] }
}

/** Espera a que el revalidador se quede vacío, sin cerrarlo. */
async function hastaTerminar(revalidator: { running(): number; queued(): readonly string[] }) {
  while (revalidator.running() > 0 || revalidator.queued().length > 0) await Bun.sleep(2)
}

async function withDb<T>(body: (db: Database) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-reval-'))

  try {
    const db = openDb(join(dir, 'nn-anime.db'))
    runMigrations(db)

    return await body(db)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('cola de escritura', () => {
  test('serializa: nunca hay dos trabajos a la vez', async () => {
    const cola = createWriteQueue()
    let dentro = 0
    let maximo = 0
    const orden: number[] = []

    const trabajos = Array.from({ length: 50 }, (_item, indice) =>
      cola.run(async () => {
        dentro += 1
        maximo = Math.max(maximo, dentro)
        await Bun.sleep(1)
        orden.push(indice)
        dentro -= 1
      }),
    )

    await Promise.all(trabajos)

    expect(maximo).toBe(1)
    expect(orden).toHaveLength(50)
    expect(orden).toEqual([...orden].sort((a, b) => a - b))
    expect(cola.pending()).toBe(0)
  })

  test('50 escrituras simultáneas sobre la misma base no dan SQLITE_BUSY', async () => {
    await withDb(async (db) => {
      const cola = createWriteQueue()

      await Promise.all(
        Array.from({ length: 50 }, (_item, indice) =>
          cola.run(() => {
            db.query('INSERT INTO setting (key, value_json) VALUES (?, ?)').run(
              `clave-${indice}`,
              JSON.stringify({ indice }),
            )
          }),
        ),
      )

      const filas = db.query('SELECT COUNT(*) AS total FROM setting').get() as { total: number }
      expect(filas.total).toBe(50)
    })
  })

  test('50 escrituras de la misma clave dejan una sola fila', async () => {
    await withDb(async (db) => {
      const cola = createWriteQueue()

      await Promise.all(
        Array.from({ length: 50 }, (_item, indice) =>
          cola.run(() => {
            db.query(
              `INSERT INTO setting (key, value_json) VALUES ('misma', ?)
               ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
            ).run(JSON.stringify({ indice }))
          }),
        ),
      )

      const filas = db.query('SELECT COUNT(*) AS total FROM setting').get() as { total: number }
      expect(filas.total).toBe(1)
    })
  })

  test('un trabajo que falla no rompe la cola', async () => {
    const cola = createWriteQueue()

    const fallo = cola.run(() => {
      throw new Error('este trabajo se cae')
    })
    const despues = cola.run(() => 'sigo vivo')

    await expect(fallo).rejects.toThrow('este trabajo se cae')
    expect(await despues).toBe('sigo vivo')
  })

  test('cerrada, no admite más trabajo y lo dice', async () => {
    const cola = createWriteQueue()
    cola.close()

    expect(cola.closed()).toBe(true)
    await expect(cola.run(() => 1)).rejects.toThrow(/cerrada/)
  })

  test('drain espera a lo que hay sin cerrarla', async () => {
    const cola = createWriteQueue()
    let hecho = false

    void cola.run(async () => {
      await Bun.sleep(5)
      hecho = true
    })

    await cola.drain()

    expect(hecho).toBe(true)
    expect(cola.closed()).toBe(false)
  })
})

describe('revalidación', () => {
  test('no corre más de dos a la vez, aunque se pidan cinco', async () => {
    const revalidator = createRevalidator()
    let dentro = 0
    let maximo = 0
    const vistas: string[] = []

    for (let indice = 0; indice < 5; indice++) {
      revalidator.schedule(`clave-${indice}`, async () => {
        dentro += 1
        maximo = Math.max(maximo, dentro)
        vistas.push(`clave-${indice}`)
        await Bun.sleep(5)
        dentro -= 1
      })
    }

    // Se espera a que terminen todas: cerrar en medio descartaría las que aún no
    // han empezado, y la prueba mediría otra cosa.
    while (vistas.length < 5) await Bun.sleep(2)
    await revalidator.close()

    expect(maximo).toBe(2)
    expect(vistas).toHaveLength(5)
  })

  test('la misma clave dos veces encola un solo trabajo', async () => {
    const revalidator = createRevalidator({ concurrency: 1 })
    let veces = 0
    let liberar = (): void => {}
    const bloqueado = new Promise<void>((resolve) => {
      liberar = resolve
    })

    const tarea = async (): Promise<void> => {
      veces += 1
      await bloqueado
    }

    revalidator.schedule('aurora', tarea)
    revalidator.schedule('aurora', tarea)
    revalidator.schedule('aurora', tarea)

    // Sin deduplicar, las dos repetidas estarían esperando: la primera corre y
    // no hay nada en cola.
    expect(revalidator.queued()).toEqual([])

    liberar()
    await hastaTerminar(revalidator)
    await revalidator.close()

    expect(veces).toBe(1)
  })

  test('claves distintas sí son trabajos distintos', async () => {
    const revalidator = createRevalidator({ concurrency: 2 })
    const vistas: string[] = []

    revalidator.schedule('uno', async () => {
      vistas.push('uno')
    })
    revalidator.schedule('dos', async () => {
      vistas.push('dos')
    })

    await revalidator.close()

    expect([...vistas].sort()).toEqual(['dos', 'uno'])
  })

  test('una vez terminada, la misma clave se puede volver a pedir', async () => {
    const revalidator = createRevalidator({ concurrency: 1 })
    let veces = 0

    const tarea = async (): Promise<void> => {
      veces += 1
    }

    revalidator.schedule('aurora', tarea)
    await Bun.sleep(5)
    revalidator.schedule('aurora', tarea)
    await revalidator.close()

    expect(veces).toBe(2)
  })

  test('un fallo se anota y no tumba la cola', async () => {
    const anotados: { key: string; message: string }[] = []
    const revalidator = createRevalidator({
      concurrency: 1,
      onError: (key, message) => {
        anotados.push({ key, message })
      },
    })

    revalidator.schedule('rota', async () => {
      throw new Error('el proveedor no responde')
    })
    revalidator.schedule('buena', async () => {})

    await revalidator.close()

    expect(anotados).toEqual([{ key: 'rota', message: 'el proveedor no responde' }])
  })

  test('abortar no se anota como fallo: es que se cerró', async () => {
    const anotados: string[] = []
    const revalidator = createRevalidator({
      onError: (key) => {
        anotados.push(key)
      },
    })

    revalidator.schedule('colgada', async (signal) => {
      await new Promise((_resolve, reject) => {
        // Un `fetch` cancelado rechaza con el motivo de la señal, no con un
        // error propio: la prueba imita eso.
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    await Bun.sleep(5)

    await revalidator.close()

    expect(anotados).toEqual([])
    expect(revalidator.running()).toBe(0)
  })

  test('cerrar descarta lo que esperaba y no se queda colgado', async () => {
    const revalidator = createRevalidator({ concurrency: 1 })
    const ejecutadas: string[] = []

    revalidator.schedule('primera', async (signal) => {
      ejecutadas.push('primera')
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    })
    revalidator.schedule('segunda', async () => {
      ejecutadas.push('segunda')
    })

    const cerrado = await Promise.race([
      revalidator.close().then(() => 'cerrado'),
      Bun.sleep(500).then(() => 'colgado'),
    ])

    expect(cerrado).toBe('cerrado')
    expect(ejecutadas).toEqual(['primera'])
    expect(revalidator.queued()).toEqual([])
    expect(revalidator.closed()).toBe(true)
  })

  test('después de cerrar no se acepta nada nuevo', async () => {
    const revalidator = createRevalidator()
    await revalidator.close()
    let corrio = false

    revalidator.schedule('tarde', async () => {
      corrio = true
    })
    await Bun.sleep(5)

    expect(corrio).toBe(false)
  })

  test('una concurrencia inválida se rechaza al construir', () => {
    expect(() => createRevalidator({ concurrency: 0 })).toThrow(/concurrencia/)
    expect(() => createRevalidator({ concurrency: 1.5 })).toThrow(/concurrencia/)
  })
})

describe('el dato viejo sobrevive al fallo', () => {
  test('la fila se conserva, el error se anota y luego se limpia', async () => {
    await withDb(async (db) => {
      const anime = createAnimeRepository(db)
      anime.write(REF, detalle('El dato viejo'))
      const clave = refKey(REF)

      const revalidator = createRevalidator({
        concurrency: 1,
        onError: (key, message) => {
          markRevalidateError(db, 'anime', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(db, 'anime', key)
        },
      })

      revalidator.schedule(clave, async () => {
        throw new Error('el proveedor devolvió 500')
      })
      await hastaTerminar(revalidator)

      // El dato viejo sigue ahí: un fallo de red no puede dejar sin nada.
      expect(anime.read(REF)?.value.title).toBe('El dato viejo')
      expect(listRevalidateErrors(db)).toEqual([
        {
          resource: 'anime',
          key: clave,
          message: 'el proveedor devolvió 500',
          at: expect.any(Date),
        },
      ])

      // La siguiente revalidación funciona y el aviso desaparece.
      revalidator.schedule(clave, async () => {
        anime.write(REF, detalle('El dato nuevo'))
      })
      await hastaTerminar(revalidator)
      await revalidator.close()

      expect(anime.read(REF)?.value.title).toBe('El dato nuevo')
      expect(listRevalidateErrors(db)).toEqual([])
    })
  })

  test('dos fallos seguidos de la misma clave dejan un solo aviso, el último', async () => {
    await withDb((db) => {
      markRevalidateError(db, 'search', 'fixture/aurora', 'timeout', 1_000)
      markRevalidateError(db, 'search', 'fixture/aurora', 'sin conexión', 2_000)

      expect(listRevalidateErrors(db)).toEqual([
        {
          resource: 'search',
          key: 'fixture/aurora',
          message: 'sin conexión',
          at: new Date(2_000),
        },
      ])
    })
  })

  test('cada recurso tiene su propio aviso, sin pisarse', async () => {
    await withDb((db) => {
      markRevalidateError(db, 'anime', 'fixture/aurora', 'falló el detalle', 1_000)
      markRevalidateError(db, 'episodes', 'fixture/aurora', 'falló la lista', 2_000)
      // Los dos recursos de T54: mismo proveedor, misma forma de clave, y aun así
      // dos filas. Si el recurso no discriminara, el aviso del feed borraría el de
      // las tendencias y la pantalla de ajustes diría que falla lo que no falla.
      markRevalidateError(db, 'feed', 'feed#fixture', 'falló el feed', 3_000)
      markRevalidateError(db, 'trending', 'trending#fixture', 'fallaron las tendencias', 4_000)

      expect(listRevalidateErrors(db)).toHaveLength(4)

      clearRevalidateError(db, 'anime', 'fixture/aurora')

      expect(listRevalidateErrors(db).map((error) => error.resource)).toEqual([
        'trending',
        'feed',
        'episodes',
      ])
    })
  })

  test('la clave de una referencia no se confunde entre proveedores', () => {
    expect(refKey({ providerId: 'uno', value: 'x/y' })).toBe('uno#x/y')
    expect(refKey({ providerId: 'uno', value: 'x/y' })).not.toBe(
      refKey({ providerId: 'uno/x', value: 'y' }),
    )
  })
})
