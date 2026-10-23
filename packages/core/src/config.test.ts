import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { ensureDirs, loadConfig } from './config'
import { AppError } from './errors'

const HOME = '/home/prueba'

/**
 * Las dos convenciones de ruta se miden inyectando la plataforma, así que las
 * dos se comprueban desde cualquier máquina.
 *
 * Las expectativas se arman con `join` y no con literales. El código usa el
 * `join` de la máquina y no el de la plataforma inyectada, así que en Windows
 * `join('/home/prueba', '.config', 'nn-anime')` es `\home\prueba\.config\nn-anime`
 * y un literal con `/` no mediría lo que el código hace. Lo que se mide es la
 * convención —qué raíz y qué subdirectorio—, no el separador.
 */
const LINUX = 'linux'
const WINDOWS = 'win32'

/** El `0700` es una garantía POSIX: en Windows los permisos son ACLs. */
const POSIX = process.platform !== 'win32'

describe('loadConfig: precedencia', () => {
  test('sin nada configurado, usa los valores por defecto bajo HOME', () => {
    const config = loadConfig({ env: { HOME }, platform: LINUX })

    expect(config.dataDir).toBe(join(HOME, '.local', 'share', 'nn-anime'))
    expect(config.configDir).toBe(join(HOME, '.config', 'nn-anime'))
    expect(config.cacheDir).toBe(join(HOME, '.cache', 'nn-anime'))
  })

  test('en Windows usa LOCALAPPDATA y APPDATA, que es donde el sistema dice que van', () => {
    const config = loadConfig({
      env: {
        USERPROFILE: 'C:\\Users\\ana',
        LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local',
        APPDATA: 'C:\\Users\\ana\\AppData\\Roaming',
      },
      platform: WINDOWS,
    })

    expect(config.dataDir).toBe(join('C:\\Users\\ana\\AppData\\Local', 'nn-anime'))
    expect(config.configDir).toBe(join('C:\\Users\\ana\\AppData\\Roaming', 'nn-anime'))
    // La caché es desechable y local a la máquina: no viaja con el perfil.
    expect(config.cacheDir).toBe(join('C:\\Users\\ana\\AppData\\Local', 'nn-anime', 'cache'))
  })

  test('en Windows, sin %APPDATA% ni %LOCALAPPDATA%, cuelgan de USERPROFILE', () => {
    // Es el caso de un servicio sin perfil cargado, y el que deja a `USERPROFILE`
    // como única raíz. Sin esto la aplicación no arrancaba en Windows: Bun no
    // define `HOME` ahí y no quedaba ningún directorio que resolver.
    const config = loadConfig({ env: { USERPROFILE: 'C:\\Users\\ana' }, platform: WINDOWS })

    expect(config.dataDir).toBe(join('C:\\Users\\ana', 'AppData', 'Local', 'nn-anime'))
    expect(config.configDir).toBe(join('C:\\Users\\ana', 'AppData', 'Roaming', 'nn-anime'))
  })

  test('HOME gana a USERPROFILE cuando están las dos', () => {
    const config = loadConfig({ env: { HOME, USERPROFILE: 'C:\\Users\\ana' }, platform: LINUX })

    expect(config.dataDir).toBe(join(HOME, '.local', 'share', 'nn-anime'))
  })

  test('XDG_* gana a los valores por defecto', () => {
    const config = loadConfig({
      env: {
        HOME,
        XDG_DATA_HOME: '/xdg/datos',
        XDG_CONFIG_HOME: '/xdg/conf',
        XDG_CACHE_HOME: '/xdg/cache',
      },
      platform: LINUX,
    })

    expect(config.dataDir).toBe(join('/xdg/datos', 'nn-anime'))
    expect(config.configDir).toBe(join('/xdg/conf', 'nn-anime'))
    expect(config.cacheDir).toBe(join('/xdg/cache', 'nn-anime'))
  })

  test('XDG_* también gana en Windows, para quien las tenga puestas', () => {
    const config = loadConfig({
      env: { USERPROFILE: 'C:\\Users\\ana', XDG_DATA_HOME: '/xdg/datos' },
      platform: WINDOWS,
    })

    expect(config.dataDir).toBe(join('/xdg/datos', 'nn-anime'))
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
      platform: LINUX,
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
      platform: LINUX,
    })

    expect(config.dataDir).toBe('/override/datos')
    expect(config.configDir).toBe('/override/conf')
    expect(config.cacheDir).toBe(join(HOME, '.cache', 'nn-anime'))
  })
})

describe('loadConfig: rutas derivadas', () => {
  test('deriva el directorio de plugins, la base y el archivo de ajustes', () => {
    const config = loadConfig({
      env: { HOME },
      overrides: { dataDir: '/datos', configDir: '/conf' },
      platform: LINUX,
    })

    expect(config.providersDir).toBe(join('/conf', 'providers'))
    expect(config.dbPath).toBe(join('/datos', 'nn-anime.db'))
    expect(config.configFile).toBe(join('/conf', 'config.json'))
  })

  test('resuelve las rutas relativas contra el directorio de trabajo', () => {
    const config = loadConfig({
      env: { HOME },
      overrides: { dataDir: 'datos-relativos' },
      platform: LINUX,
    })

    expect(config.dataDir).toBe(resolve('datos-relativos'))
  })

  test('quita las barras finales sobrantes', () => {
    const config = loadConfig({
      env: { HOME },
      overrides: { dataDir: '/datos/', configDir: '/conf//' },
      platform: LINUX,
    })

    expect(config.dataDir).toBe('/datos')
    expect(config.configDir).toBe('/conf')
  })

  test('en Windows quita la barra invertida final y respeta la raíz de la unidad', () => {
    // `C:\datos\` sólo es una ruta absoluta en Windows: en POSIX `isAbsolute`
    // dice que no y se resolvería contra el directorio de trabajo, así que esta
    // parte se limita a donde significa algo. La raíz no se toca porque quitarle
    // el separador a `C:\` deja `C:`, que es «la unidad actual», no su raíz.
    if (POSIX) return

    const config = loadConfig({
      env: { HOME },
      overrides: { dataDir: 'C:\\datos\\', configDir: 'C:\\', cacheDir: 'D:\\cache\\\\' },
      platform: WINDOWS,
    })

    expect(config.dataDir).toBe('C:\\datos')
    expect(config.configDir).toBe('C:\\')
    expect(config.cacheDir).toBe('D:\\cache')
  })

  test('ignora variables de entorno vacías o con sólo espacios', () => {
    const config = loadConfig({
      env: { HOME, XDG_DATA_HOME: '   ', NN_ANIME_CONFIG_DIR: '' },
      platform: LINUX,
    })

    expect(config.dataDir).toBe(join(HOME, '.local', 'share', 'nn-anime'))
    expect(config.configDir).toBe(join(HOME, '.config', 'nn-anime'))
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
      platform: LINUX,
    })

    expect(config.dataDir).toBe('/datos')
    expect(config.cacheDir).toBe('/cache')
  })
})

describe('ensureDirs', () => {
  test('crea los directorios y devuelve las rutas, en orden', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base }, platform: LINUX })
      const created = await ensureDirs(config)

      expect(created).toEqual([
        config.dataDir,
        config.configDir,
        config.cacheDir,
        config.providersDir,
      ])

      for (const dir of created) {
        expect((await stat(dir)).isDirectory()).toBe(true)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('si un directorio no se puede preparar, el error dice cuál y por qué', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      // Un archivo donde tiene que ir el directorio de datos: `mkdir` falla con
      // `EEXIST` y el mensaje tiene que nombrar esa ruta absoluta. Sin ella,
      // `unable to open database file` no dice qué se intentó crear. Se rompen
      // **dos** destinos para comprobar que se acumulan en vez de parar en el
      // primero: si parara, habría que arreglar, reintentar y descubrir el otro.
      const config = loadConfig({ env: { HOME: base }, platform: LINUX })
      await mkdir(dirname(config.dataDir), { recursive: true })
      await writeFile(config.dataDir, 'estorbo')
      await mkdir(dirname(config.configDir), { recursive: true })
      await writeFile(config.configDir, 'estorbo')

      const error = await ensureDirs(config).then(
        () => undefined,
        (fracaso: unknown) => fracaso as Error,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toContain(config.dataDir)
      expect(error?.message).toContain('EEXIST')
      expect(error?.message).toContain(config.configDir)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('deja los directorios sin permisos de más', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base }, platform: LINUX })
      await ensureDirs(config)

      if (POSIX) {
        // `0700`: sólo el dueño entra.
        expect((await stat(config.dataDir)).mode & 0o777).toBe(0o700)
      } else {
        // En Windows los permisos son ACLs y `chmod` sólo puede tocar el bit de
        // sólo lectura —`stat` devuelve `0666`, nunca `0700`—, así que lo que se
        // mide es que el directorio quedó escribible para su dueño. Quién más
        // puede entrar lo decide la ACL que hereda de `%LOCALAPPDATA%`.
        expect((await stat(config.dataDir)).mode & 0o200).toBe(0o200)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('es idempotente: llamarla dos veces no falla', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base }, platform: LINUX })

      await ensureDirs(config)
      await ensureDirs(config)

      expect((await stat(config.dataDir)).isDirectory()).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('endurece un directorio que ya existía con permisos más laxos', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))

    try {
      const config = loadConfig({ env: { HOME: base }, platform: LINUX })

      if (POSIX) {
        await mkdir(config.dataDir, { recursive: true, mode: 0o755 })
        expect((await stat(config.dataDir)).mode & 0o777).toBe(0o755)

        await ensureDirs(config)

        expect((await stat(config.dataDir)).mode & 0o777).toBe(0o700)
      } else {
        // En Windows lo más abierto que puede estar un directorio es tener el
        // bit de sólo lectura quitado, así que el caso se monta al revés: se
        // deja de sólo lectura y `ensureDirs` tiene que devolverlo a escribible.
        await mkdir(config.dataDir, { recursive: true })
        await chmod(config.dataDir, 0o500)
        expect((await stat(config.dataDir)).mode & 0o200).toBe(0)

        await ensureDirs(config)

        expect((await stat(config.dataDir)).mode & 0o200).toBe(0o200)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('no crea nada fuera de la raíz indicada', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nn-anime-config-'))
    const other = await mkdtemp(join(tmpdir(), 'nn-anime-otro-'))

    try {
      const config = loadConfig({ env: { HOME: base }, platform: LINUX })
      await ensureDirs(config)

      const entries = await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: other }))
      expect(entries).toEqual([])
    } finally {
      await rm(base, { recursive: true, force: true })
      await rm(other, { recursive: true, force: true })
    }
  })
})
