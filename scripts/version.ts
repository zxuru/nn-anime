#!/usr/bin/env bun
/**
 * La versión, en un solo sitio.
 *
 * Hay diez `package.json` en este repositorio —la raíz y los nueve paquetes— y
 * hasta ahora los diez decían `0.1.0` por acuerdo, no por construcción. Una
 * release que sube uno y se olvida de otro publica un binario que dice una
 * versión y unos instaladores que dicen otra, y eso no se nota hasta que alguien
 * compara el `--version` con el nombre del archivo.
 *
 * La raíz manda. `sync` copia su versión a los paquetes, `check` falla si alguno
 * se desvió, `set` cambia la raíz y sincroniza, y `current` la imprime para que
 * un workflow la lea sin abrir el JSON a mano.
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
  const root = parseManifest(ROOT_MANIFEST, await Bun.file(ROOT_MANIFEST).text(), 'nn-anime (raíz)')

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

      io.out(`version ${root.version}: la raíz y los ${packages.length} paquetes coinciden`)

      return 0
    }

    case 'sync': {
      const cambios: string[] = []

      for (const manifest of packages) {
        const cambio = await writeVersion(manifest, root.version)
        if (cambio !== undefined) cambios.push(cambio)
      }

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
