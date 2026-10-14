import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { hostPlatform, hostTarget, installerName } from './package'
import { dottedVersion, EMBEDDED_DIRECTORIES, TARGETS } from './package/binary'
import { artifactsIn, hashOf, writeChecksums } from './package/checksums'
import { render, template } from './package/render'
import { listWorkspaces, ROOT } from './workspaces'

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
    const dir = await mkdtemp(join(ROOT, '.tmp', 'checksums-'))

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
    const dir = await mkdtemp(join(ROOT, '.tmp', 'checksums-'))

    try {
      await writeFile(join(dir, 'uno.bin'), 'contenido')
      await writeChecksums(await artifactsIn(dir), join(dir, 'SHA256SUMS.txt'))

      expect((await artifactsIn(dir)).map((ruta) => basename(ruta))).toEqual(['uno.bin'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('un archivo vacío se rechaza: su hash sería válido y el release estaría roto', async () => {
    const dir = await mkdtemp(join(ROOT, '.tmp', 'checksums-'))

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

  test('las plantillas del repositorio se pueden rellenar con lo que reciben', async () => {
    const nfpm = await template('linux/nfpm.yaml')

    expect(nfpm).toContain('__VERSION__')
    // Sin `rpm` en los overrides, el `.rpm` saldría sin dependencia de glibc.
    expect(nfpm).toContain('overrides:')
    expect(nfpm).toContain('rpm:')
  })
})
