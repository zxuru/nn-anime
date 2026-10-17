#!/usr/bin/env bun
/**
 * Empaqueta nn-anime.
 *
 * Un ejecutable autocontenido por plataforma y su instalador. Lo que salga de
 * aquí es lo que se sube a la release, y por eso los tres pasos que importan no
 * se pueden saltar sin decirlo:
 *
 * 1. **El build de la interfaz tiene que existir.** Sin él, el ejecutable sale
 *    igual y sale sin interfaz: arranca, contesta 404 en `/` y quien lo instaló
 *    cree que la aplicación está rota. Se comprueba antes de compilar.
 * 2. **El ejecutable se prueba de verdad** (`smoke.ts`) cuando es el de esta
 *    plataforma. Un binario de otra no se puede ejecutar aquí, y entonces se dice
 *    en lugar de fingir que se probó.
 * 3. **El instalador se arma con la herramienta de su sistema**, y si falta, el
 *    error dice cuál es y cómo se instala.
 *
 * Uso:
 *   bun run package                       # la plataforma en la que corre
 *   bun run package --target=darwin-arm64  # sólo el binario, para otra
 *   bun run package --skip-smoke           # sin probar el ejecutable
 *   bun run package --skip-installer       # sólo el ejecutable
 *   bun run package --only-installer       # el instalador, con el ejecutable ya hecho
 *   bun run package --skip-desktop         # sin la ventana (el acceso abre consola)
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type BinarySpec, buildBinary, missingAssets, TARGETS } from './package/binary'
import { stageDesktop } from './package/desktop'
import { linuxAppImage, linuxPackages } from './package/linux'
import { macDmg } from './package/macos'
import { smoke } from './package/smoke'
import { windowsInstaller } from './package/windows'
import { isRecord, ROOT } from './workspaces'

/** El ejecutable compilado, y el instalador, viven aquí. Lo ignorado es `build/`. */
export const BUILD_DIR = join(ROOT, 'build', 'package')
export const RELEASE_DIR = join(ROOT, 'release')

export interface PackageOptions {
  /** Clave de `TARGETS`. Por defecto, la plataforma en la que corre. */
  readonly target?: string
  readonly skipSmoke?: boolean
  readonly skipInstaller?: boolean
  /**
   * Arma el instalador con el ejecutable que ya está compilado.
   *
   * Existe por la firma de Windows: el `.exe` tiene que estar firmado **antes**
   * de que NSIS lo meta dentro del instalador, y entre esos dos pasos el
   * workflow firma. Sin esto habría que recompilar el binario para nada.
   */
  readonly onlyInstaller?: boolean
  /**
   * No prepara el anfitrión de ventana junto al servidor.
   *
   * Existe para poder compilar un instalador sin el árbol de Rust —que necesita
   * red y un compilador de Rust—, y **no** es el camino de la release: sin
   * anfitrión, el acceso del escritorio abre una consola, que es justo lo que este
   * trabajo viene a quitar. Se dice en voz alta al usarlo.
   */
  readonly skipDesktop?: boolean
}

/**
 * El nombre de la plataforma como aparece en el **nombre del artefacto**.
 *
 * Ojo, que hay dos nombres para lo mismo y no coinciden a propósito: las claves de
 * `TARGETS` y el objetivo de Bun dicen `darwin` —es el nombre del sistema en el
 * kernel y el que usa `bun-darwin-arm64`—, y los archivos que descarga un usuario
 * dicen `macos`, que es lo que la gente busca en una página de releases.
 *
 * Se separa de `hostTarget` porque son dos preguntas distintas: **ejecutar** un
 * binario necesita la misma máquina exacta —un `arm64` no corre en un `x64`—,
 * pero **armar** el instalador sólo necesita el mismo sistema. Un `macos-latest`
 * es arm64 y desde ahí se arman los dos `.dmg`, el de Apple Silicon y el de
 * Intel: son dos compilaciones cruzadas y un `hdiutil`, y separarlos en dos
 * runners sería pagar dos máquinas por lo que hace una.
 */
export function hostPlatform(
  platform: string = process.platform,
): BinarySpec['platform'] | undefined {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'

  // Un sistema sin instalador no devuelve el nombre de otro: devolver `linux`
  // por descarte haría que un FreeBSD intentara armar un `.deb`.
  return undefined
}

/** La clave de `TARGETS` que corresponde a esta máquina, si la hay. */
export function hostTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  // La clave usa `darwin` y no `macos`: es la que entiende Bun.
  const clave = `${platform === 'win32' ? 'windows' : platform}-${arch}`

  return TARGETS[clave] === undefined ? undefined : clave
}

function specOf(target: string): BinarySpec {
  const spec = TARGETS[target]

  if (spec === undefined) {
    throw new Error(
      `objetivo desconocido: ${target}. Los que hay: ${Object.keys(TARGETS).join(', ')}`,
    )
  }

  return spec
}

/** La versión de la raíz, sin depender de que el script de versiones acierte. */
export async function currentVersion(): Promise<string> {
  const manifiesto: unknown = await Bun.file(join(ROOT, 'package.json')).json()

  if (!isRecord(manifiesto) || typeof manifiesto.version !== 'string') {
    throw new Error('package.json de la raíz no declara versión')
  }

  return manifiesto.version
}

/**
 * Comprueba lo que hace falta **antes** de compilar.
 *
 * Un ejecutable de 90 MB que tarda un minuto en subirse y que resulta no servir
 * es peor que un error aquí.
 */
export async function checkAssets(): Promise<void> {
  const faltan = missingAssets()

  if (faltan.length > 0) {
    throw new Error(
      `faltan recursos que van dentro del ejecutable:\n  ${faltan.join('\n  ')}\n` +
        'el de la interfaz lo produce `bun run build`',
    )
  }
}

/** El nombre del instalador: `nn-anime-1.2.3-windows-x64-setup.exe`. */
export function installerName(version: string, spec: BinarySpec): string {
  const base = `nn-anime-${version}-${spec.platform}-${spec.arch}`
  return spec.platform === 'windows' ? `${base}-setup.exe` : `${base}.dmg`
}

/**
 * Comprueba que en el directorio de la release sólo hay archivos sueltos.
 *
 * `gh release upload release/*` no sabe subir un directorio. El `.app` de macOS se
 * armaba justo ahí, así que la release habría fallado **al final**, con los
 * instaladores de las tres plataformas ya compilados y el gasto hecho. El `.app`
 * se arma ahora en el directorio de trabajo —sólo viaja dentro del `.dmg`— y esto
 * es la red que lo sujetaría si alguien volviera a dejarlo caer.
 */
export async function assertReleaseFiles(directory: string): Promise<readonly string[]> {
  const nombres: string[] = []

  for (const entrada of await readdir(directory, { withFileTypes: true })) {
    if (!entrada.isFile()) {
      throw new Error(
        `${join(directory, entrada.name)} no es un archivo, y una release sólo admite archivos`,
      )
    }

    nombres.push(entrada.name)
  }

  return nombres
}

export interface Packaged {
  readonly target: string
  readonly binary: string
  readonly artifacts: readonly string[]
  /** `true` si el ejecutable se ejecutó y pasó las comprobaciones. */
  readonly smoked: boolean
}

export async function packageApp(options: PackageOptions = {}): Promise<Packaged> {
  const target = options.target ?? hostTarget()

  if (target === undefined) {
    throw new Error(
      `no hay objetivo para ${process.platform}-${process.arch}. Los que hay: ${Object.keys(TARGETS).join(', ')}`,
    )
  }

  const spec = specOf(target)
  const version = await currentVersion()

  await checkAssets()
  await mkdir(BUILD_DIR, { recursive: true })
  await mkdir(RELEASE_DIR, { recursive: true })

  const stage = join(BUILD_DIR, target)
  const binary = join(stage, `nn-anime${spec.extension}`)
  let smoked = false

  if (options.onlyInstaller === true) {
    if (!(await Bun.file(binary).exists())) {
      throw new Error(`no hay ejecutable que empaquetar en ${binary}: compílalo antes`)
    }
  } else {
    await rm(stage, { recursive: true, force: true })
    await mkdir(stage, { recursive: true })

    process.stdout.write(`compilando ${target} (${spec.target})…\n`)
    await buildBinary({ spec, version, outfile: binary })

    // Sólo se puede ejecutar lo que es de esta plataforma **y** de esta
    // arquitectura. Un binario cruzado no se prueba aquí, y decirlo es más útil
    // que un `smoke` que falla por no poder arrancar.
    const esDeAqui = target === hostTarget()

    if (options.skipSmoke !== true && esDeAqui) {
      process.stdout.write('probando el ejecutable…\n')
      const checks = await smoke({ binary, expectedVersion: version })

      for (const item of checks) {
        process.stdout.write(`  ${item.ok ? 'ok   ' : 'FALLO'} ${item.name}: ${item.detail}\n`)
      }

      smoked = checks.every((item) => item.ok)
      if (!smoked) throw new Error('el ejecutable no pasó sus comprobaciones')
    }
  }

  const artifacts: string[] = []
  const puedeArmarElInstalador = spec.platform === hostPlatform()

  if (options.skipInstaller !== true) {
    if (!puedeArmarElInstalador) {
      process.stdout.write(
        `el instalador de ${spec.platform} no se puede armar desde ${process.platform}: sólo el ejecutable\n`,
      )
    } else {
      process.stdout.write('armando el instalador…\n')

      // El anfitrión va **al lado** del servidor, en el mismo directorio: es lo
      // que hace que el acceso del escritorio abra una ventana y no una consola.
      // Si falta, se para: un instalador que abre una consola es exactamente lo
      // que este trabajo existe para no publicar.
      if (options.skipDesktop === true) {
        process.stdout.write(
          '  aviso: --skip-desktop, el instalador NO llevará la ventana y el acceso abrirá una consola\n',
        )
      } else {
        const anfitrion = await stageDesktop(dirname(binary), spec.platform, spec.arch)
        process.stdout.write(`  anfitrión:  ${anfitrion}\n`)
      }

      artifacts.push(...(await buildInstaller({ spec, version, binary, stage })))

      // Antes de dar el trabajo por bueno: lo que hay en `release/` tiene que poder
      // subirse tal cual.
      const enLaRelease = await assertReleaseFiles(RELEASE_DIR)
      process.stdout.write(`release/: ${enLaRelease.join(', ')}\n`)
    }
  }

  return { target, binary, artifacts, smoked }
}

interface InstallerBuild {
  readonly spec: BinarySpec
  readonly version: string
  readonly binary: string
  /** Directorio de trabajo, fuera de `release/`: lo de ahí no se publica. */
  readonly stage: string
}

/**
 * El instalador de esta plataforma.
 *
 * Devuelve **una lista** porque Linux produce tres —AppImage, `.deb` y `.rpm`— y
 * el resto uno. Devolver una cadena con saltos de línea para que cupieran todos
 * habría dejado el caso de Linux como el raro y el de Windows como el normal, que
 * es justo al revés de lo que pasa.
 */
async function buildInstaller(build: InstallerBuild): Promise<readonly string[]> {
  const { spec, version, binary, stage } = build

  switch (spec.platform) {
    case 'windows':
      return [
        await windowsInstaller({
          version,
          sourceDir: dirname(binary),
          outfile: join(RELEASE_DIR, installerName(version, spec)),
        }),
      ]

    case 'macos':
      return [
        (
          await macDmg({
            version,
            binary,
            releaseDir: RELEASE_DIR,
            workDir: stage,
            dmgName: installerName(version, spec),
          })
        ).dmg,
      ]

    case 'linux': {
      // Las herramientas las descarga el workflow con su SHA256 comprobado. Sin
      // ellas no hay paquete, y el error dice de cuál se trata.
      const nfpm = process.env.NFPM_PATH
      const appimagetool = process.env.APPIMAGETOOL_PATH

      if (nfpm === undefined || nfpm === '') {
        throw new Error('falta NFPM_PATH: el workflow lo descarga y lo comprueba con su SHA256')
      }
      if (appimagetool === undefined || appimagetool === '') {
        throw new Error(
          'falta APPIMAGETOOL_PATH: el workflow lo descarga y lo comprueba con su SHA256',
        )
      }

      const paquetes = await linuxPackages(
        { version, binary, releaseDir: RELEASE_DIR, workDir: stage, arch: spec.arch },
        nfpm,
      )
      const appimage = await linuxAppImage(
        { version, binary, releaseDir: RELEASE_DIR, workDir: stage, arch: spec.arch },
        appimagetool,
      )

      return [...paquetes, appimage]
    }
  }
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2)
  const flag = (name: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

  try {
    const resultado = await packageApp({
      ...(flag('target') === undefined ? {} : { target: flag('target') }),
      skipSmoke: argv.includes('--skip-smoke'),
      skipInstaller: argv.includes('--skip-installer'),
      onlyInstaller: argv.includes('--only-installer'),
      skipDesktop: argv.includes('--skip-desktop'),
    })

    process.stdout.write(`\nobjetivo ${resultado.target}\n`)
    process.stdout.write(`  ejecutable: ${resultado.binary}\n`)
    process.stdout.write(`  probado:    ${resultado.smoked ? 'sí, entero' : 'no'}\n`)

    for (const artefacto of resultado.artifacts) {
      process.stdout.write(`  artefacto:  ${artefacto}\n`)
    }

    // Los checksums de la release **no** se escriben aquí: los calcula el trabajo
    // que junta los artefactos de las tres plataformas, sobre todos a la vez. Si
    // cada plataforma escribiera el suyo, subirían tres archivos con el mismo
    // nombre y el que sobreviviera hablaría sólo de una.
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
