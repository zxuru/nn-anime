import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { assertReleaseFiles, hostPlatform, hostTarget, installerName } from './package'
import { dottedVersion, EMBEDDED_DIRECTORIES, TARGETS } from './package/binary'
import { artifactsIn, hashOf, writeChecksums } from './package/checksums'
import { render, template } from './package/render'
import { listWorkspaces, ROOT } from './workspaces'

/**
 * Un directorio temporal, dentro del repositorio y con su padre asegurado.
 *
 * `mkdtemp` **no crea el directorio padre**, y `.tmp/` no existe en un checkout
 * limpio: en el CI esto fallaba con `ENOENT` sólo a veces, según qué otro archivo
 * de prueba hubiera creado `.tmp` antes. Una prueba que pasa o falla según el
 * orden en que corran las demás no mide nada.
 */
async function tempDir(prefijo: string): Promise<string> {
  const base = join(ROOT, '.tmp')
  await mkdir(base, { recursive: true })

  return await mkdtemp(join(base, prefijo))
}

/**
 * Lo que estas pruebas defienden.
 *
 * El empaquetado tiene dos contratos que **no fallan cuando se rompen**: si el
 * nombre con el que se incrusta la interfaz deja de ser el que el CLI busca, el
 * ejecutable sale igual y sirve 404 en `/`; y si la lista de manifiestos que
 * `release-please` sincroniza se queda corta, se publica una release con un
 * paquete diciendo otra versión. Ninguno de los dos da un error: dan un producto
 * roto. Por eso se comparan aquí, que es leer los dos lados del contrato.
 */

describe('el nombre de los recursos incrustados', () => {
  test('los directorios que se incrustan se llaman como el CLI los busca', async () => {
    // El otro lado del contrato está en el paquete del CLI, que no se puede
    // importar desde aquí: `index.ts` arranca el servidor al cargarse. Se lee su
    // fuente, que es lo que hace el resto del repositorio para comprobar
    // fronteras.
    const fuente = await Bun.file(join(ROOT, 'packages', 'cli', 'src', 'resources.ts')).text()

    const esperados = ['EMBEDDED_WEB_DIR', 'EMBEDDED_MIGRATIONS_DIR'].map((nombre) => {
      const match = new RegExp(`${nombre}\\s*=\\s*'([^']+)'`).exec(fuente)
      const valor = match?.[1]

      if (valor === undefined) throw new Error(`${nombre} no está en resources.ts`)

      return valor
    })

    // `--asset` no sabe renombrar: lo incrustado se llama como el directorio de
    // origen. Si alguien mueve `packages/web/dist` a `packages/web/build`, el
    // basename cambia y el ejecutable se queda sin interfaz.
    expect(EMBEDDED_DIRECTORIES.map((ruta) => basename(ruta))).toEqual(esperados)
  })

  test('los dos directorios que se incrustan existen en el repositorio', async () => {
    const migraciones = EMBEDDED_DIRECTORIES[1]

    // Sólo se comprueba el que está versionado: el build de la interfaz no lo
    // está, y exigirlo obligaría a construir antes de correr las pruebas.
    expect(migraciones).toBeDefined()
    expect(
      await Array.fromAsync(new Bun.Glob('*.sql').scan({ cwd: migraciones as string })),
    ).not.toBeEmpty()
  })
})

describe('la lista de manifiestos de release-please', () => {
  test('nombra exactamente los nueve paquetes, ni uno menos', async () => {
    const config = (await Bun.file(join(ROOT, 'release-please-config.json')).json()) as {
      packages?: Record<string, { 'extra-files'?: readonly { path: string }[] }>
    }

    const declarados = (config.packages?.['.']?.['extra-files'] ?? []).map(
      (entrada) => entrada.path,
    )
    const workspaces = (await listWorkspaces()).map(
      (workspace) => `packages/${basename(workspace.dir)}/package.json`,
    )

    // Un paquete que no esté aquí se queda en la versión vieja para siempre, y la
    // release sale con dos versiones distintas sin que nada avise.
    expect([...declarados].sort()).toEqual([...workspaces].sort())
  })

  test('el manifiesto de release-please arranca en la versión del repositorio', async () => {
    const manifest = (await Bun.file(join(ROOT, '.release-please-manifest.json')).json()) as Record<
      string,
      string
    >
    const root = (await Bun.file(join(ROOT, 'package.json')).json()) as { version: string }

    expect(manifest['.']).toBe(root.version)
  })
})

describe('el nombre de los objetivos', () => {
  test('cada sistema y arquitectura que se publica tiene su objetivo', () => {
    expect(hostTarget('win32', 'x64')).toBe('windows-x64')
    expect(hostTarget('darwin', 'arm64')).toBe('darwin-arm64')
    expect(hostTarget('darwin', 'x64')).toBe('darwin-x64')
    expect(hostTarget('linux', 'x64')).toBe('linux-x64')
  })

  test('una máquina sin objetivo no devuelve cualquiera', () => {
    expect(hostTarget('linux', 'arm64')).toBeUndefined()
    expect(hostTarget('freebsd', 'x64')).toBeUndefined()
  })

  test('armar el instalador sólo pide el mismo sistema, no la misma arquitectura', () => {
    // Es lo que permite que un `macos-latest` (arm64) arme también el `.dmg` de
    // Intel, y por qué `hostPlatform` está separado de `hostTarget`.
    //
    // Y son dos nombres distintos para el mismo sistema: la clave de `TARGETS`
    // dice `darwin` —como Bun— y el archivo que se descarga dice `macos` —como lo
    // busca quien lo descarga—. Confundirlos deja a macOS sin instalador, y sin
    // que nada avise: simplemente no se arma.
    expect(hostTarget('darwin', 'arm64')).toBe('darwin-arm64')
    expect(hostPlatform('darwin')).toBe('macos')
    expect(hostPlatform('win32')).toBe('windows')
    expect(hostPlatform('freebsd')).toBeUndefined()

    for (const clave of ['darwin-arm64', 'darwin-x64']) {
      expect(TARGETS[clave]?.platform).toBe(hostPlatform('darwin'))
    }

    expect(TARGETS['windows-x64']?.platform).toBe(hostPlatform('win32'))
    expect(TARGETS['linux-x64']?.platform).toBe(hostPlatform('linux'))
  })

  test('el nombre del instalador dice la versión, el sistema y la arquitectura', () => {
    expect(installerName('1.2.3', TARGETS['windows-x64'] as never)).toBe(
      'nn-anime-1.2.3-windows-x64-setup.exe',
    )
    expect(installerName('1.2.3', TARGETS['darwin-arm64'] as never)).toBe(
      'nn-anime-1.2.3-macos-arm64.dmg',
    )
  })
})

describe('la versión de cuatro números', () => {
  test('rellena con ceros hasta cuatro', () => {
    expect(dottedVersion('1.2.3')).toBe('1.2.3.0')
  })

  test('un preestreno se recorta en vez de inventarse el cuarto número', () => {
    expect(dottedVersion('1.2.3-rc.1')).toBe('1.2.3.0')
    expect(dottedVersion('2.0.0+build.5')).toBe('2.0.0.0')
  })
})

describe('los checksums', () => {
  test('cada línea lleva el hash y el nombre, comprobable con sha256sum -c', async () => {
    const dir = await tempDir('checksums-')

    try {
      await writeFile(join(dir, 'uno.bin'), 'contenido uno')
      await writeFile(join(dir, 'dos.bin'), 'contenido dos')

      const archivos = await artifactsIn(dir)
      expect(archivos).toHaveLength(2)

      const puestos = await writeChecksums(archivos, join(dir, 'SHA256SUMS.txt'))
      expect(puestos).toBe(2)

      const lineas = (await Bun.file(join(dir, 'SHA256SUMS.txt')).text())
        .split('\n')
        .filter((linea) => linea !== '' && !linea.startsWith('#'))

      expect(lineas).toHaveLength(2)
      // Dos espacios entre el hash y el nombre: es lo que espera `sha256sum -c`, y
      // con uno solo no reconoce el formato.
      for (const linea of lineas) {
        const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(linea)
        expect(match, linea).not.toBeNull()

        expect(match?.[1]).toBe(await hashOf(join(dir, match?.[2] ?? '')))
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('el resumen no se resume a sí mismo', async () => {
    const dir = await tempDir('checksums-')

    try {
      await writeFile(join(dir, 'uno.bin'), 'contenido')
      await writeChecksums(await artifactsIn(dir), join(dir, 'SHA256SUMS.txt'))

      expect((await artifactsIn(dir)).map((ruta) => basename(ruta))).toEqual(['uno.bin'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('un archivo vacío se rechaza: su hash sería válido y el release estaría roto', async () => {
    const dir = await tempDir('checksums-')

    try {
      await writeFile(join(dir, 'vacio.exe'), '')

      await expect(
        writeChecksums([join(dir, 'vacio.exe')], join(dir, 'SHA256SUMS.txt')),
      ).rejects.toThrow(/vacío/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('las plantillas de los instaladores', () => {
  test('sustituye los marcadores', () => {
    expect(render('nn-anime __VERSION__ (__ARCH__)', { VERSION: '1.2.3', ARCH: 'amd64' })).toBe(
      'nn-anime 1.2.3 (amd64)',
    )
  })

  test('un marcador sin valor es un error y no un texto absurdo dentro del instalador', () => {
    expect(() => render('nn-anime __VERSION__ __ARCH__', { VERSION: '1.2.3' })).toThrow(/__ARCH__/)
  })

  test('el nfpm.yaml del repositorio se rellena y queda con las dependencias medidas', async () => {
    // `render` falla si queda un marcador sin valor, así que llegar hasta aquí ya
    // comprueba que la plantilla y quien la rellena dicen lo mismo.
    const texto = render(await template('linux/nfpm.yaml'), {
      ARCH: 'amd64',
      VERSION: '1.2.3',
      BINARY: '/tmp/nn-anime',
      DESKTOP: '/tmp/nn-anime.desktop',
      ICON: '/tmp/icon.png',
    })

    const yaml = Bun.YAML.parse(texto) as {
      name: string
      arch: string
      version: string
      contents: readonly { dst: string; type?: string }[]
      overrides: Record<string, { depends?: readonly string[] }>
    }

    expect(yaml.name).toBe('nn-anime')
    expect(yaml.arch).toBe('amd64')
    expect(yaml.version).toBe('1.2.3')

    // Los nombres de la dependencia cambian entre los dos formatos, y la versión
    // es la que el binario pide de verdad —`GLIBC_2.17`, leída de sus símbolos
    // versionados—. Sin `overrides`, el `.rpm` saldría sin declarar glibc.
    expect(yaml.overrides.deb?.depends).toEqual(['libc6 (>= 2.17)'])
    expect(yaml.overrides.rpm?.depends).toEqual(['glibc >= 2.17'])

    // El binario a `/usr/lib`, el enlace en `/usr/bin`, y el acceso y el icono
    // donde los busca el escritorio.
    expect(yaml.contents.map((entrada) => entrada.dst)).toEqual([
      '/usr/lib/nn-anime/nn-anime',
      '/usr/bin/nn-anime',
      '/usr/share/applications/nn-anime.desktop',
      '/usr/share/icons/hicolor/512x512/apps/nn-anime.png',
    ])
    expect(yaml.contents[1]?.type).toBe('symlink')
  })

  test('el Info.plist del repositorio se rellena y no declara la aplicación como agente', async () => {
    const texto = render(await template('macos/Info.plist'), {
      VERSION: '1.2.3',
      BUNDLE_VERSION: '1.2.3.0',
    })

    expect(texto).toContain('<string>io.github.zxuru.nn-anime</string>')
    expect(texto).toContain('<string>nn-anime</string>')
    expect(texto).toContain('<string>1.2.3.0</string>')
    // `LSUIElement` convertiría la aplicación en un agente sin icono en el Dock,
    // y el Dock es lo único desde donde se puede cerrar: no es una aplicación de
    // Cocoa y no tiene menú ni «Salir». Se busca la **clave** y no la palabra: la
    // plantilla la nombra en un comentario para contar justo esto.
    expect(texto).not.toContain('<key>LSUIElement</key>')
  })
})

describe('lo que se publica', () => {
  test('un directorio en el directorio de la release se rechaza', async () => {
    const dir = await tempDir('release-')

    try {
      await writeFile(join(dir, 'nn-anime-1.2.3-windows-x64-setup.exe'), 'instalador')
      await mkdir(join(dir, 'nn-anime.app'), { recursive: true })

      // `gh release upload release/*` no sabe subir un directorio, y el `.app` de
      // macOS se armaba justo ahí: la release habría fallado al final, con los
      // instaladores de las tres plataformas ya compilados.
      await expect(assertReleaseFiles(dir)).rejects.toThrow(/no es un archivo/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('sólo archivos sueltos pasa, y los devuelve', async () => {
    const dir = await tempDir('release-')

    try {
      await writeFile(join(dir, 'nn-anime-1.2.3-macos-arm64.dmg'), 'disco')
      await writeFile(join(dir, 'SHA256SUMS.txt'), 'hashes')

      // Ordenado en la prueba y no en la función: `readdir` no promete orden, y
      // exigirlo ahí sería pedirle a una lectura del disco algo que no da.
      expect([...(await assertReleaseFiles(dir))].sort()).toEqual([
        'SHA256SUMS.txt',
        'nn-anime-1.2.3-macos-arm64.dmg',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('el icono del instalador de Windows', () => {
  /** Los anchos que declara el directorio de un `.ico`. Un cero significa 256. */
  async function anchos(nombre: string): Promise<readonly number[]> {
    const bytes = new Uint8Array(
      await Bun.file(join(ROOT, 'packaging', 'icons', nombre)).arrayBuffer(),
    )
    const entradas = bytes[4] ?? 0

    return Array.from({ length: entradas }, (_, i) => bytes[6 + i * 16] ?? 0)
  }

  test('el del asistente no lleva el de 256, que NSIS escribe como un cero y rechaza', async () => {
    const tamanos = await anchos('icon-setup.ico')

    // Medido: con la entrada de 256 dentro, `makensis` aborta al cargar el
    // `MUI_ICON` con «invalid icon file size» —el tamaño de 256 no cabe en el byte
    // del directorio y se escribe como un cero—. El instalador que falló en la
    // primera ejecución del CI fue justo este.
    expect(tamanos.length).toBeGreaterThan(0)
    expect(tamanos).not.toContain(0)
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(64)
  })

  test('el que se instala sí lleva el de 256, que es el que enseña el explorador', async () => {
    const tamanos = await anchos('icon.ico')

    expect(tamanos).toContain(0)
  })
})

describe('la acción compuesta de las herramientas', () => {
  const ACCION = join(ROOT, '.github', 'actions', 'herramientas', 'action.yml')

  /**
   * `actionlint` es un linter de **workflows** y no mira los metadatos de una
   * acción compuesta, así que estas dos cosas se comprueban aquí. Las dos son
   * fallos que no se ven hasta que el trabajo falla en GitHub, y con un mensaje
   * que no dice cuál es el archivo.
   */
  test('todos los pasos con `run` declaran `shell`, que GitHub exige', async () => {
    const accion = Bun.YAML.parse(await Bun.file(ACCION).text()) as {
      runs?: { using?: string; steps?: readonly { run?: string; shell?: string }[] }
    }

    expect(accion.runs?.using).toBe('composite')

    const pasos = accion.runs?.steps ?? []
    expect(pasos.length).toBeGreaterThan(0)

    for (const paso of pasos) {
      if (paso.run !== undefined) expect(paso.shell, 'un paso con run y sin shell').toBeDefined()
    }
  })

  test('nada se descarga sin comprobar su SHA256', async () => {
    const texto = await Bun.file(ACCION).text()

    const descargas = [...texto.matchAll(/curl\s+-fsSL\s+-o\s+(\S+)/g)].map((m) => m[1])
    // Sin las comillas: el hash va dentro de un `echo "…"` para poder pasarlo por
    // la tubería a `sha256sum -c -`, y `\S+` se llevaría la de cierre.
    const hashes = [...texto.matchAll(/([0-9a-f]{64})\s{2}([^\s"]+)/g)]

    // Un `curl` sin su `sha256sum -c` es un binario de internet ejecutándose en el
    // runner sin nada que lo ate a una versión: la versión en la URL sola no basta,
    // porque un archivo publicado se puede reemplazar.
    expect(descargas.length).toBeGreaterThan(0)
    expect(hashes).toHaveLength(descargas.length)

    for (const descarga of descargas) {
      expect(hashes.map((m) => m[2])).toContain(descarga)
    }
  })
})
