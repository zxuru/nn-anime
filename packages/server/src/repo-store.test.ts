/**
 * Dónde vive lo instalado y qué está habilitado.
 *
 * Las pruebas escriben árboles de verdad: lo que se mide es la correspondencia
 * entre una ficha guardada y un archivo del disco, y con un doble del sistema de
 * archivos se mediría el doble.
 */

import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import type { ProviderRepoRecord } from '@nn-anime/core'
import { createContainer, type ServerContainer } from './container'
import {
  candidatesOf,
  enabledProviderFiles,
  incomingRepoDir,
  listRepoRecords,
  repoDirOf,
  repoHomeOf,
  saveRepoRecords,
  stampOf,
} from './repo-store'

const FETCHED = '2026-10-13T10:00:00.000Z'

function record(overrides: Partial<ProviderRepoRecord> = {}): ProviderRepoRecord {
  return {
    url: 'https://github.com/zxuru/nn-anime-plugins',
    owner: 'zxuru',
    repo: 'nn-anime-plugins',
    ref: 'main',
    fetchedAt: FETCHED,
    enabled: [],
    files: 1,
    ...overrides,
  }
}

interface Contexto {
  readonly container: ServerContainer
  readonly dataDir: string
  readonly escribir: (path: string, content: string) => Promise<void>
}

async function conStore<T>(body: (contexto: Contexto) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(join(tmpdir(), 'nn-anime-repo-store-'))
  const db = openDb(join(dataDir, 'nn-anime.db'))
  runMigrations(db)
  const container = createContainer({ db })

  try {
    return await body({
      container,
      dataDir,
      escribir: async (path, content) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content)
      },
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dataDir, { recursive: true, force: true })
  }
}

describe('la carpeta de un repositorio', () => {
  test('la marca sale de `fetchedAt` y es un nombre de archivo en Windows', () => {
    expect(stampOf(FETCHED)).toBe('2026-10-13T10-00-00-000Z')
    expect(stampOf(FETCHED)).not.toContain(':')
  })

  test('cada descarga estrena carpeta: es lo que hace que el módulo se recargue', () => {
    const primera = repoDirOf('/datos', record())
    const segunda = repoDirOf('/datos', record({ fetchedAt: '2026-10-13T11:00:00.000Z' }))

    expect(primera).not.toBe(segunda)
    expect(primera.startsWith(repoHomeOf('/datos', record()))).toBe(true)
  })

  test('la carpeta de la próxima descarga se calcula antes de tener ficha', () => {
    expect(incomingRepoDir('/datos', 'zxuru', 'nn-anime-plugins', FETCHED)).toBe(
      repoDirOf('/datos', record()),
    )
  })
})

describe('la ficha guardada', () => {
  test('se guarda y se vuelve a leer entera', async () => {
    await conStore(async ({ container, dataDir }) => {
      const guardado = record({ enabled: ['jkanime.ts'], files: 7, subdir: 'src/providers' })
      await saveRepoRecords(container.store, [guardado])

      expect(await listRepoRecords(container.store)).toEqual([guardado])
      // La carpeta de esa ficha no existe: leer la lista no toca el disco.
      expect(repoDirOf(dataDir, guardado)).toContain('zxuru__nn-anime-plugins')
    })
  })

  test('sin nada guardado la lista es vacía, no un error', async () => {
    await conStore(async ({ container }) => {
      expect(await listRepoRecords(container.store)).toEqual([])
    })
  })
})

describe('los candidatos de un repositorio', () => {
  test('se leen del disco y las rutas son las del repositorio entero', async () => {
    await conStore(async ({ container, dataDir, escribir }) => {
      const ficha = record()
      const dir = repoDirOf(dataDir, ficha)
      await escribir(join(dir, 'jkanime.ts'), 'export default {}\n')
      await escribir(join(dir, 'notas.md'), 'no es un proveedor\n')
      await saveRepoRecords(container.store, [ficha])

      const candidatos = await candidatesOf(ficha, dataDir)

      expect(candidatos.map((c) => c.path)).toEqual(['jkanime.ts'])
    })
  })

  test('con subcarpeta, la oferta se limita a ella pero la ruta es la del repo', async () => {
    await conStore(async ({ dataDir, escribir }) => {
      const ficha = record({ subdir: 'src/providers' })
      await escribir(join(repoDirOf(dataDir, ficha), 'src/providers/a.ts'), 'export default {}\n')
      await escribir(join(repoDirOf(dataDir, ficha), 'otro.ts'), 'export default {}\n')

      const candidatos = await candidatesOf(ficha, dataDir)

      expect(candidatos.map((c) => c.path)).toEqual(['src/providers/a.ts'])
    })
  })

  test('sin contenido en el disco no hay oferta y no se lanza', async () => {
    await conStore(async ({ dataDir }) => {
      expect(await candidatesOf(record(), dataDir)).toEqual([])
    })
  })
})

describe('enabledProviderFiles: qué se carga', () => {
  test('sólo lo que existe, en orden y sin repetir', async () => {
    await conStore(async ({ container, dataDir, escribir }) => {
      const uno = record({ enabled: ['b.ts', 'a.ts', 'no-existe.ts'] })
      const dos = record({
        url: 'https://github.com/otro/repo',
        owner: 'otro',
        repo: 'repo',
        enabled: ['a.ts'],
      })

      await escribir(join(repoDirOf(dataDir, uno), 'a.ts'), 'export default {}\n')
      await escribir(join(repoDirOf(dataDir, uno), 'b.ts'), 'export default {}\n')
      await escribir(join(repoDirOf(dataDir, dos), 'a.ts'), 'export default {}\n')
      await saveRepoRecords(container.store, [uno, dos])

      const archivos = await enabledProviderFiles(container.store, dataDir)

      // El orden es el de las rutas enteras: `otro__repo` va antes que
      // `zxuru__nn-anime-plugins`, y lo que importa es que sea el mismo en dos
      // arranques distintos.
      expect(archivos).toEqual([
        join(repoDirOf(dataDir, dos), 'a.ts'),
        join(repoDirOf(dataDir, uno), 'a.ts'),
        join(repoDirOf(dataDir, uno), 'b.ts'),
      ])
    })
  })

  test('una ruta que se sale del repositorio no se carga aunque exista', async () => {
    await conStore(async ({ container, dataDir, escribir }) => {
      const ficha = record({ enabled: ['../fuera.ts'] })
      await escribir(join(repoDirOf(dataDir, ficha), '..', 'fuera.ts'), 'export default {}\n')
      await saveRepoRecords(container.store, [ficha])

      expect(await enabledProviderFiles(container.store, dataDir)).toEqual([])
    })
  })

  test('sin repositorios no hay archivos que cargar', async () => {
    await conStore(async ({ container, dataDir }) => {
      expect(await enabledProviderFiles(container.store, dataDir)).toEqual([])
    })
  })
})
