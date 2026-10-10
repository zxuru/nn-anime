import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import { type MigrationTarget, migrate } from './db-migrate'
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
  const home = await mkdtemp(join(tmpdir(), 'nn-anime-migrate-'))

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
    migrate: (db: MigrationTarget) => runMigrations(db),
  }
}

describe('db:migrate', () => {
  test('aplica las migraciones pendientes y lo dice', async () => {
    await withHome(async (home) => {
      const target = salida()

      const code = await migrate(deps(home, target))

      expect(code).toBe(0)
      expect(target.err).toEqual([])
      expect(target.out.join('\n')).toContain('Migraciones aplicadas: 1')
      expect(target.out.join('\n')).toContain('Versión del esquema: 1')
    })
  })

  test('la base queda en el directorio de datos, no en el de trabajo', async () => {
    await withHome(async (home) => {
      await migrate(deps(home, salida()))

      const stats = await stat(join(home, '.local', 'share', 'nn-anime', 'nn-anime.db'))

      expect(stats.isFile()).toBe(true)
    })
  })

  test('correrlo dos veces no aplica nada la segunda', async () => {
    await withHome(async (home) => {
      await migrate(deps(home, salida()))
      const segunda = salida()

      const code = await migrate(deps(home, segunda))

      expect(code).toBe(0)
      expect(segunda.out.join('\n')).toContain('No hay migraciones pendientes')
      expect(segunda.out.join('\n')).toContain('Versión del esquema: 1')
    })
  })

  test('un fallo del runner sale con 1 y dice el motivo', async () => {
    await withHome(async (home) => {
      const target = salida()

      const code = await migrate({
        ...deps(home, target),
        migrate: () => {
          throw new Error('la migración 0002-rota.sql falló')
        },
      })

      expect(code).toBe(1)
      expect(target.err.join('\n')).toContain('0002-rota.sql')
    })
  })

  test('sin entorno de datos, un error de configuración sale con 1 y no lanza', async () => {
    const target = salida()

    const code = await migrate({ ...deps('/no/existe', target), env: {} })

    expect(code).toBe(1)
    expect(target.err.join('\n')).toContain('No se pudo preparar la base de datos')
  })
})
