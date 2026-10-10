import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureDirs, loadConfig } from './config'
import { AppError } from './errors'

const HOME = '/home/prueba'

describe('loadConfig: precedencia', () => {
  test('sin nada configurado, usa los valores por defecto bajo HOME', () => {
    const config = loadConfig({ env: { HOME } })

    expect(config.dataDir).toBe('/home/prueba/.local/share/nn-anime')
    expect(config.configDir).toBe('/home/prueba/.config/nn-anime')
    expect(config.cacheDir).toBe('/home/prueba/.cache/nn-anime')
  })

  test('XDG_* gana a los valores por defecto', () => {
    const config = loadConfig({
      env: {
        HOME,
        XDG_DATA_HOME: '/xdg/datos',
        XDG_CONFIG_HOME: '/xdg/conf',
        XDG_CACHE_HOME: '/xdg/cache',
      },
    })

    expect(config.dataDir).toBe('/xdg/datos/nn-anime')
    expect(config.configDir).toBe('/xdg/conf/nn-anime')
    expect(config.cacheDir).toBe('/xdg/cache/nn-anime')
  })

  test('NN_ANIME_* gana a XDG_*', () => {
    const config = loadConfig({
      env: {
        HOME,
        XDG_DATA_HOME: '/xdg/datos',
        NN_ANIME_DATA_DIR: '/propio/datos',
        NN_ANIME_CONFIG_DIR: '/propio/conf',
        NN_ANIME_CACHE_DIR: '/propio/cache',
      },
    })

    expect(config.dataDir).toBe('/propio/datos')
    expect(config.configDir).toBe('/propio/conf')
    expect(config.cacheDir).toBe('/propio/cache')
  })

  test('los overrides ganan a todo lo demás', () => {
    const config = loadConfig({
      env: {
        HOME,
        XDG_DATA_HOME: '/xdg/datos',
        NN_ANIME_DATA_DIR: '/propio/datos',
      },
      overrides: { dataDir: '/override/datos', configDir: '/override/conf' },
    })

    expect(config.dataDir).toBe('/override/datos')
    expect(config.configDir).toBe('/override/conf')
    expect(config.cacheDir).toBe('/home/prueba/.cache/nn-anime')
  })
})

describe('loadConfig: rutas derivadas', () => {
  test('deriva el directorio de plugins, la base y el archivo de ajustes', () => {
    const config = loadConfig({
      env: { HOME },
      overrides: { dataDir: '/datos', configDir: '/conf' },
    })

    expect(config.providersDir).toBe('/conf/providers')
    expect(config.dbPath).toBe('/datos/nn-anime.db')
    expect(config.configFile).toBe('/conf/config.json')
  })

  test('resuelve las rutas relativas contra el directorio de trabajo', () => {
    const config = loadConfig({ env: { HOME }, overrides: { dataDir: 'datos-relativos' } })

    expect(config.dataDir).toBe(resolve('datos-relativos'))
  })

  test('quita las barras finales sobrantes', () => {
    const config = loadConfig({
      env: { HOME },
      overrides: { dataDir: '/datos/', configDir: '/conf//' },
    })

    expect(config.dataDir).toBe('/datos')
    expect(config.configDir).toBe('/conf')
  })

  test('ignora variables de entorno vacías o con sólo espacios', () => {
    const config = loadConfig({ env: { HOME, XDG_DATA_HOME: '   ', NN_ANIME_CONFIG_DIR: '' } })

    expect(config.dataDir).toBe('/home/prueba/.local/share/nn-anime')
    expect(config.configDir).toBe('/home/prueba/.config/nn-anime')
  })
})

describe('loadConfig: HOME ausente', () => {
  test('lanza un AppError de configuración cuando no hay HOME ni overrides', () => {
    expect(() => loadConfig({ env: {} })).toThrow(AppError)

    try {
      loadConfig({ env: {} })
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) expect(error.code).toBe('config')
    }
  })

  test('funciona sin HOME si los tres directorios vienen en overrides', () => {
    const config = loadConfig({
      env: {},
      overrides: { dataDir: '/datos', configDir: '/conf', cacheDir: '/cache' },
    })

    expect(config.dataDir).toBe('/datos')
    expect(config.cacheDir).toBe('/cache')
  })
})

describe('ensureDirs', () => {
  test('crea los directorios con modo 0700 y devuelve las rutas', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base } })
      const created = await ensureDirs(config)

      expect(created).toEqual([
        config.dataDir,
        config.configDir,
        config.cacheDir,
        config.providersDir,
      ])

      for (const dir of created) {
        const stats = await stat(dir)
        expect(stats.isDirectory()).toBe(true)
        expect(stats.mode & 0o777).toBe(0o700)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('es idempotente: llamarla dos veces no falla', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base } })

      await ensureDirs(config)
      await ensureDirs(config)

      expect((await stat(config.dataDir)).isDirectory()).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('endurece a 0700 un directorio que ya existía con permisos más laxos', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base } })
      await mkdir(config.dataDir, { recursive: true, mode: 0o755 })
      expect((await stat(config.dataDir)).mode & 0o777).toBe(0o755)

      await ensureDirs(config)

      expect((await stat(config.dataDir)).mode & 0o777).toBe(0o700)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('no crea nada fuera de la raíz indicada', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))
    const other = await mkdtemp(join(tmpdir(), 'nn-anime-otro-'))

    try {
      const config = loadConfig({ env: { HOME: base } })
      await ensureDirs(config)

      const entries = await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: other }))
      expect(entries).toEqual([])
    } finally {
      await rm(base, { recursive: true, force: true })
      await rm(other, { recursive: true, force: true })
    }
  })
})
