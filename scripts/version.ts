#!/usr/bin/env bun
/**
 * La versión, en un solo sitio.
 *
 * Hay diez `package.json` en este repositorio —la raíz y los nueve paquetes— y
 * hasta ahora los diez decían `0.1.0` por acuerdo, no por construcción. Una
 * release que sube uno y se olvida de otro publica un binario que dice una
 * versión y unos artefactos que dicen otra, y eso no se nota hasta que alguien
 * compara el `--version` con el nombre del archivo.
 *
 * La raíz manda. `sync` copia su versión a los paquetes, `check` falla si alguno
 * se desvió, `set` cambia la raíz y sincroniza, y `current` la imprime para que
 * un workflow la lea sin abrir el JSON a mano.
 *
 * El anfitrión de ventana (`desktop/src-tauri`) va con ellos: su `Cargo.toml` y
 * la entrada de `rona-desktop` en `Cargo.lock` también dicen la versión, y el
 * build compila con `--locked`. Un hotfix manual que sólo suba los `package.json`
 * deja el tag en rojo en `comprobar`, así que los tres comandos los cubren.
 *
 * `check` acepta además un tag (`check v1.2.3`) y comprueba que coincida: es lo
 * que impide que el tag `v1.2.4` publique un binario que dice `1.2.3`.
 *
 * Uso:
 *   bun run version:current
 *   bun run version:check [vX.Y.Z]
 *   bun run version:sync
 *   bun run version:set X.Y.Z
 */

import { join } from 'node:path'
import { listWorkspaces, ROOT } from './workspaces'

/**
 * Una versión de release, sin rangos ni comodines.
 *
 * Deliberadamente estricta. Acepta lo que semver permite publicar —`1.2.3`,
 * `1.2.3-rc.1`, `1.2.3+build.5`— y rechaza todo lo demás: `^1.2.3` no es una
 * versión, es un rango, y escribirla aquí sería publicar un rango.
 */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface Manifest {
  /** Nombre del paquete, para poder nombrarlo en el error. */
  readonly name: string
  /** Ruta absoluta del `package.json`. */
  readonly path: string
  readonly version: string | undefined
}

export interface VersionIO {
  readonly out: (line: string) => void
  readonly err: (line: string) => void
}

/** El `package.json` de la raíz, que es el que manda. */
const ROOT_MANIFEST = join(ROOT, 'package.json')

/**
 * El anfitrión de ventana declara la misma versión, y en dos archivos.
 *
 * `Cargo.toml` la lleva en `[package]` y `Cargo.lock` la repite en la entrada del paquete; el
 * `desktop:build` del CI compila con `--locked`, así que un lock atrasado no se corrige solo y
 * tumba los cuatro artefactos antes de compilar. `release-please` los sube con sus `extra-files`,
 * pero el hotfix manual de `version:set` se los dejaba atrás y el tag fallaba en `comprobar`.
 */
const CARGO_TOML = join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml')
const CARGO_LOCK = join(ROOT, 'desktop', 'src-tauri', 'Cargo.lock')

/**
 * La línea `version = "…"` de un TOML, partida en tres trozos.
 *
 * El tercero conserva el comentario de cola: `Cargo.lock` lleva
 * `# x-release-please-version` en esa línea y perderlo dejaría a release-please sin la anotación
 * que usa para actualizarla.
 */
const VERSION_EN_LINEA = /^(\s*version\s*=\s*")([^"]*)(".*)$/

/** Separa el texto en líneas sin cambiar su salto, para que reescribirlo no toque el resto. */
function lineasDe(texto: string): { lineas: string[]; eol: string } {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n'

  return { lineas: texto.split(eol), eol }
}

/**
 * El nombre del paquete de `[package]`.
 *
 * Es la clave con la que la entrada aparece en `Cargo.lock`, así que se lee del manifiesto y no se
 * escribe aquí: renombrar el anfitrión es un cambio de una línea, no de dos archivos de versión.
 */
export function cargoPackageName(toml: string): string | undefined {
  const { lineas } = lineasDe(toml)
  let enPaquete = false

  for (const linea of lineas) {
    const recortada = linea.trim()

    if (recortada.startsWith('[')) {
      enPaquete = recortada === '[package]'
      continue
    }

    if (!enPaquete) continue

    const nombre = /^\s*name\s*=\s*"([^"]+)"\s*(?:#.*)?$/.exec(linea)
    if (nombre?.[1] !== undefined) return nombre[1]
  }

  return undefined
}

/** La versión de `[package]` en `Cargo.toml`, o `undefined` si no la declara. */
export function cargoTomlVersion(toml: string): string | undefined {
  const { lineas } = lineasDe(toml)
  let enPaquete = false

  for (const linea of lineas) {
    const recortada = linea.trim()

    if (recortada.startsWith('[')) {
      enPaquete = recortada === '[package]'
      continue
    }

    if (!enPaquete) continue

    const version = VERSION_EN_LINEA.exec(linea)
    if (version?.[2] !== undefined) return version[2]
  }

  return undefined
}

/**
 * El `Cargo.toml` con la versión de `[package]` cambiada, **y nada más**.
 *
 * La sustitución es sobre una línea, no sobre el texto entero: `[dependencies]` lleva su propio
 * `version = "1"` en cada dependencia, y una expresión regular global las habría convertido en la
 * versión de la aplicación.
 */
export function withCargoTomlVersion(toml: string, version: string): string {
  const { lineas, eol } = lineasDe(toml)
  let enPaquete = false

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i] ?? ''
    const recortada = linea.trim()

    if (recortada.startsWith('[')) {
      enPaquete = recortada === '[package]'
      continue
    }

    if (!enPaquete) continue

    const actual = VERSION_EN_LINEA.exec(linea)
    if (actual?.[2] === undefined) continue
    if (actual[2] === version) return toml

    lineas[i] = `${actual[1] ?? ''}${version}${actual[3] ?? ''}`

    return lineas.join(eol)
  }

  throw new Error('Cargo.toml: no hay una línea version en [package]')
}

/**
 * La línea de `[[package]]` con ese nombre, o `undefined`.
 *
 * `Cargo.lock` repite `name` y `version` por cada paquete del grafo: buscar la versión sin mirar
 * de qué bloque es devolvería la de una dependencia cualquiera.
 */
function inicioDePaquete(lock: string, paquete: string): number | undefined {
  const { lineas } = lineasDe(lock)
  let inicio = -1

  for (let i = 0; i < lineas.length; i++) {
    const recortada = (lineas[i] ?? '').trim()

    if (recortada === '[[package]]') {
      inicio = i
      continue
    }

    if (inicio === -1) continue

    const nombre = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(lineas[i] ?? '')
    if (nombre?.[1] === paquete) return inicio
  }

  return undefined
}

/** La versión de ese paquete en `Cargo.lock`, o `undefined` si no hay entrada. */
export function cargoLockVersion(lock: string, paquete: string): string | undefined {
  const inicio = inicioDePaquete(lock, paquete)
  if (inicio === undefined) return undefined

  const { lineas } = lineasDe(lock)

  for (let i = inicio; i < lineas.length; i++) {
    const linea = lineas[i] ?? ''
    if (i > inicio && linea.trim() === '[[package]]') break

    const version = VERSION_EN_LINEA.exec(linea)
    if (version?.[2] !== undefined) return version[2]
  }

  return undefined
}

/** El `Cargo.lock` con la versión de ese paquete cambiada, conservando su anotación. */
export function withCargoLockVersion(lock: string, paquete: string, version: string): string {
  const inicio = inicioDePaquete(lock, paquete)
  if (inicio === undefined) {
    throw new Error(`Cargo.lock: no hay una entrada para ${paquete}`)
  }

  const { lineas, eol } = lineasDe(lock)

  for (let i = inicio; i < lineas.length; i++) {
    const linea = lineas[i] ?? ''
    if (i > inicio && linea.trim() === '[[package]]') break

    const actual = VERSION_EN_LINEA.exec(linea)
    if (actual?.[2] === undefined) continue
    if (actual[2] === version) return lock

    lineas[i] = `${actual[1] ?? ''}${version}${actual[3] ?? ''}`

    return lineas.join(eol)
  }

  throw new Error(`Cargo.lock: la entrada de ${paquete} no declara version`)
}

/**
 * Lo que el anfitrión dice de menos o de más respecto a la raíz.
 *
 * Es una función pura para poder medirla con un TOML y un lock de mentira: el caso que importa es
 * el que no coincide, y para reproducirlo no hace falta tocar los archivos del repositorio.
 */
export function cargoProblems(root: string, toml: string, lock: string): readonly string[] {
  const problemas: string[] = []
  const nombre = cargoPackageName(toml)
  const enToml = cargoTomlVersion(toml)

  if (enToml !== root) {
    problemas.push(
      `desktop/src-tauri/Cargo.toml dice ${enToml ?? '(sin versión)'} y la raíz ${root}`,
    )
  }

  if (nombre === undefined) {
    problemas.push('desktop/src-tauri/Cargo.toml no declara name en [package]')

    return problemas
  }

  const enLock = cargoLockVersion(lock, nombre)
  if (enLock !== root) {
    problemas.push(
      `desktop/src-tauri/Cargo.lock dice ${enLock ?? '(sin versión)'} y la raíz ${root}`,
    )
  }

  return problemas
}

export interface CargoPaths {
  readonly toml: string
  readonly lock: string
}

const CARGO_PATHS: CargoPaths = { toml: CARGO_TOML, lock: CARGO_LOCK }

/**
 * Aplica la versión al anfitrión y devuelve los cambios, con el archivo y el antes/después.
 *
 * Las rutas se pueden pasar para medirlo sobre un par de archivos temporales: escribir en los del
 * repositorio durante una prueba cambiaría justo lo que se está probando.
 */
export async function writeCargo(
  version: string,
  rutas: CargoPaths = CARGO_PATHS,
): Promise<readonly string[]> {
  const toml = await Bun.file(rutas.toml).text()
  const nombre = cargoPackageName(toml)

  if (nombre === undefined) {
    throw new Error(`${rutas.toml}: no declara name en [package]`)
  }

  const cambios: string[] = []
  const enToml = cargoTomlVersion(toml)

  if (enToml !== version) {
    await Bun.write(rutas.toml, withCargoTomlVersion(toml, version))
    cambios.push(`desktop/src-tauri/Cargo.toml: ${enToml ?? '(sin versión)'} → ${version}`)
  }

  const lock = await Bun.file(rutas.lock).text()
  const enLock = cargoLockVersion(lock, nombre)

  if (enLock !== version) {
    await Bun.write(rutas.lock, withCargoLockVersion(lock, nombre, version))
    cambios.push(`desktop/src-tauri/Cargo.lock: ${enLock ?? '(sin versión)'} → ${version}`)
  }

  return cambios
}

function parseManifest(path: string, raw: string, fallbackName: string): Manifest {
  const parsed: unknown = JSON.parse(raw)

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${path} no contiene un objeto JSON`)
  }

  const record = parsed as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : fallbackName

  return { name, path, version: typeof record.version === 'string' ? record.version : undefined }
}

/** La raíz primero, y después los paquetes por nombre. */
export async function readManifests(): Promise<readonly Manifest[]> {
  const root = parseManifest(ROOT_MANIFEST, await Bun.file(ROOT_MANIFEST).text(), 'rona (raíz)')

  const workspaces = await listWorkspaces()
  const packages: Manifest[] = []

  for (const workspace of workspaces) {
    const path = join(workspace.dir, 'package.json')
    packages.push(parseManifest(path, await Bun.file(path).text(), workspace.name))
  }

  return [root, ...packages]
}

/** Los manifiestos que no dicen lo que dice la raíz. */
export function divergences(root: Manifest, packages: readonly Manifest[]): readonly Manifest[] {
  return packages.filter((manifest) => manifest.version !== root.version)
}

/** Motivo por el que un tag no vale, o `undefined` si vale. */
export function tagProblem(version: string, tag: string): string | undefined {
  if (!tag.startsWith('v')) {
    return `el tag ${tag} no empieza por "v": se espera v${version}`
  }

  const declared = tag.slice(1)
  if (declared !== version) {
    return `el tag dice ${declared} y el package.json dice ${version}`
  }

  return undefined
}

/**
 * El manifiesto con su versión cambiada, **y nada más**.
 *
 * Se parsea y se vuelve a serializar en lugar de sustituir texto: una expresión
 * regular sobre `"version"` acierta hoy y falla el día que alguien añada una
 * dependencia con esa clave. El precio es que el archivo se reescribe entero, así
 * que `sync` compara el resultado con el original y se niega a escribir si el
 * cambio no es sólo la versión: reformatear un manifiesto es un diff enorme que
 * nadie revisa y que esconde el cambio de verdad.
 */
export function withVersion(raw: string, version: string): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>

  return `${JSON.stringify({ ...parsed, version }, null, 2)}\n`
}

/**
 * Escribe la versión en un manifiesto, si hace falta.
 *
 * Devuelve `undefined` si ya estaba, y lanza si reescribirlo cambiaría algo más
 * que la versión.
 */
export async function writeVersion(
  manifest: Manifest,
  version: string,
): Promise<string | undefined> {
  if (manifest.version === version) return undefined

  const raw = await Bun.file(manifest.path).text()
  const next = withVersion(raw, version)

  const soloLaVersion = withVersion(next, manifest.version ?? version)
  if (manifest.version !== undefined && soloLaVersion !== raw) {
    throw new Error(
      `${manifest.path}: reescribirlo cambiaría más que la versión; se deja como está`,
    )
  }

  await Bun.write(manifest.path, next)

  return `${manifest.name}: ${manifest.version ?? '(sin versión)'} → ${version}`
}

function requireVersion(value: string | undefined): string {
  if (value === undefined || !SEMVER.test(value)) {
    throw new Error(`"${value ?? ''}" no es una versión semver (se espera, por ejemplo, 1.2.3)`)
  }

  return value
}

export async function main(argv: readonly string[], io: VersionIO): Promise<number> {
  const [comando, argumento] = argv
  const manifests = await readManifests()
  const [root, ...packages] = manifests

  if (root === undefined || root.version === undefined) {
    io.err('la raíz del repositorio no declara versión en package.json')

    return 1
  }

  switch (comando) {
    case 'current': {
      io.out(root.version)

      return 0
    }

    case 'check': {
      let fallo = false

      for (const manifest of divergences(root, packages)) {
        io.err(
          `${manifest.name} dice ${manifest.version ?? '(sin versión)'} y la raíz ${root.version}`,
        )
        fallo = true
      }

      for (const problema of cargoProblems(
        root.version,
        await Bun.file(CARGO_TOML).text(),
        await Bun.file(CARGO_LOCK).text(),
      )) {
        io.err(problema)
        fallo = true
      }

      if (argumento !== undefined) {
        const problema = tagProblem(root.version, argumento)
        if (problema !== undefined) {
          io.err(problema)
          fallo = true
        }
      }

      if (fallo) {
        io.err('bun run version:sync para ponerlos de acuerdo')
        return 1
      }

      io.out(
        `version ${root.version}: la raíz, los ${packages.length} paquetes y el anfitrión coinciden`,
      )

      return 0
    }

    case 'sync': {
      const cambios: string[] = []

      for (const manifest of packages) {
        const cambio = await writeVersion(manifest, root.version)
        if (cambio !== undefined) cambios.push(cambio)
      }

      cambios.push(...(await writeCargo(root.version)))

      io.out(
        cambios.length === 0
          ? `version ${root.version}: ya estaba sincronizada`
          : `version ${root.version}:\n${cambios.join('\n')}`,
      )

      return 0
    }

    case 'set': {
      const version = requireVersion(argumento)
      const cambio = await writeVersion(root, version)
      const cambios: string[] = cambio === undefined ? [] : [cambio]

      for (const manifest of packages) {
        const aplicado = await writeVersion(manifest, version)
        if (aplicado !== undefined) cambios.push(aplicado)
      }

      cambios.push(...(await writeCargo(version)))

      io.out(`version ${version}:\n${cambios.join('\n')}`)

      return 0
    }

    default:
      io.err('uso: version.ts <current|check [tag]|sync|set X.Y.Z>')

      return 2
  }
}

if (import.meta.main) {
  const io: VersionIO = {
    out: (line) => {
      process.stdout.write(`${line}\n`)
    },
    err: (line) => {
      process.stderr.write(`${line}\n`)
    },
  }

  process.exitCode = await main(Bun.argv.slice(2), io).catch((error: unknown) => {
    io.err(error instanceof Error ? error.message : String(error))

    return 1
  })
}
