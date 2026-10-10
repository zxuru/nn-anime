import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, pruneOrphans, runMigrations } from '@nn-anime/catalog-store'
import { prune } from './db-prune'
import type { CliIO } from './run'

interface Salida {
  readonly out: string[]
  readonly err: string[]
  readonly io: CliIO
}

function salida(): Salida {
  const out: string[] = []
  const err: string[] = []

  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } }
}

async function withHome<T>(body: (home: string) => Promise<T> | T): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'nn-anime-prune-'))

  try {
    return await body(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function deps(home: string, target: Salida) {
  return {
    io: target.io,
    env: { HOME: home },
    locale: 'es' as const,
    open: openDb,
    prune: (db: ReturnType<typeof openDb>, now?: Date) => pruneOrphans(db, now),
  }
}

/**
 * La base en la ruta que usa el comando.
 *
 * Se migra antes de limpiar: la limpieza necesita las tablas, y una base vacía
 * recién creada no las tiene.
 */
async function baseMigrada(home: string): Promise<void> {
  // La carpeta la crea el comando con `ensureDirs`; aquí se crea a mano porque
  // se migra antes de invocarlo.
  const carpeta = join(home, '.local', 'share', 'nn-anime')
  await mkdir(carpeta, { recursive: true })
  const db = openDb(join(carpeta, 'nn-anime.db'))
  runMigrations(db)
  db.close()
}

describe('bun run db:prune', () => {
  test('sin nada que limpiar informa de ceros y sale con 0', async () => {
    await withHome(async (home) => {
      const target = salida()
      await baseMigrada(home)

      const code = await prune(deps(home, target))

      expect(code).toBe(0)
      expect(target.err).toEqual([])
      expect(target.out[0]).toContain('0 filas')
    })
  })

  test('informa por tabla', async () => {
    await withHome(async (home) => {
      const target = salida()
      await baseMigrada(home)
      await prune(deps(home, target))

      const detalle = target.out.slice(1).join('\n')

      expect(detalle).toContain('stream_cache: 0')
      expect(detalle).toContain('anime: 0')
    })
  })

  test('un fallo de configuración sale con 1 y no lanza', async () => {
    const target = salida()

    const code = await prune({ ...deps('/no/existe', target), env: {} })

    expect(code).toBe(1)
    expect(target.err.join('\n')).toContain('No se pudo limpiar')
  })

  test('un fallo de la limpieza se cuenta y sale con 1', async () => {
    await withHome(async (home) => {
      const target = salida()

      const code = await prune({
        ...deps(home, target),
        prune: () => {
          throw new Error('la tabla no existe')
        },
      })

      expect(code).toBe(1)
      expect(target.err.join('\n')).toContain('la tabla no existe')
    })
  })
})
