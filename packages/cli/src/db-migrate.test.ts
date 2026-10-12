import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listMigrations, openDb, runMigrations } from '@nn-anime/catalog-store'
import { loadConfig } from '@nn-anime/core'
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

/** Las versiones que hay hoy, para no fijar un número que crece con cada migración. */
const VERSIONES = listMigrations().map((migration) => migration.version)
const ULTIMA = Math.max(...VERSIONES)

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
      expect(target.out.join('\n')).toContain(`Migraciones aplicadas: ${VERSIONES.join(', ')}`)
      expect(target.out.join('\n')).toContain(`Versión del esquema: ${ULTIMA}`)
    })
  })

  test('la base queda en el directorio de datos, no en el de trabajo', async () => {
    await withHome(async (home) => {
      await migrate(deps(home, salida()))

      // La ruta la dice `loadConfig` y no un literal: el layout por defecto
      // depende de la plataforma —en Windows es `%LOCALAPPDATA%`—, y lo que mide
      // la prueba es que la base cae en el directorio de datos y no en el de
      // trabajo.
      const { dataDir } = loadConfig({ env: { HOME: home } })
      const stats = await stat(join(dataDir, 'nn-anime.db'))

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
      expect(segunda.out.join('\n')).toContain(`Versión del esquema: ${ULTIMA}`)
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
