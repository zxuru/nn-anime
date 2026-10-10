/**
 * Carga de plugins desde el directorio del usuario.
 *
 * Un plugin es código de terceros en el mismo proceso, así que aquí no hay
 * sandbox posible —está documentado en el spec—: lo único que se puede hacer es
 * que **un plugin roto no impida cargar los demás**. Cada archivo se importa por
 * separado, cada fallo se recoge con su motivo y el informe final dice qué entró
 * y qué no.
 *
 * Los archivos se importan con `import()` dinámico: sin build step, sin
 * recompilar el proyecto y sin reiniciar nada más que el proceso. Bun ejecuta
 * `.ts` directamente, que es lo que hace que un plugin en TypeScript funcione
 * igual que uno en JavaScript.
 *
 * El orden es alfabético y está fijado a propósito: dos plugins con el mismo `id`
 * se resuelven «gana el primero», y eso tiene que significar lo mismo en dos
 * arranques distintos. Dejarlo al orden del sistema de archivos haría que el
 * proveedor activo cambiara sin que nadie tocara nada.
 */

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type AppError, ProviderError } from '@nn-anime/core'
import { classifyThrow, namedByFile, providerFailure } from './errors'
import { createRegistry, type ProviderRegistry } from './registry'
import type { Provider } from './types'

/** Extensiones que se escanean, en el orden en que el spec las nombra. */
export const PLUGIN_EXTENSIONS: readonly string[] = ['.ts', '.js', '.mjs']

export interface LoadedProvider {
  readonly provider: Provider
  /** Archivo del que salió, para poder decir cuál es. */
  readonly file: string
}

export interface RejectedPlugin {
  readonly file: string
  readonly reason: ProviderError
}

export interface LoadReport {
  /** Los que entraron, en el orden en que se cargaron. */
  readonly active: readonly LoadedProvider[]
  /** Los que no, cada uno con su motivo. */
  readonly rejected: readonly RejectedPlugin[]
  /**
   * Fallo al leer el directorio, no de un plugin.
   *
   * Va aparte porque no es lo mismo «un plugin está mal» que «no se pudo mirar
   * la carpeta»: lo primero es normal y lo segundo hay que decirlo. Un
   * directorio que no existe **no** es un error: es el arranque de alguien que
   * todavía no ha instalado nada.
   */
  readonly directoryError?: AppError
}

export interface LoadOptions {
  readonly directory: string
  /** Inyectable: los tests comprueban un import que lanza sin tocar el disco. */
  readonly importModule?: (url: string) => Promise<unknown>
}

function isMissing(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false

  return cause.code === 'ENOENT'
}

function defaultImport(url: string): Promise<unknown> {
  return import(url)
}

/**
 * Los nombres que son plugins, en orden alfabético.
 *
 * Es una función propia y exportada por un motivo concreto: el orden del sistema
 * de archivos **no** es alfabético ni estable —medido, devuelve un orden de hash—
 * así que una prueba que solo mirara el directorio estaría comprobando el azar de
 * esa máquina. Aquí la regla se prueba con una lista escrita a mano.
 */
export function pluginNames(names: readonly string[]): readonly string[] {
  return names
    .filter((name) => PLUGIN_EXTENSIONS.some((extension) => name.endsWith(extension)))
    .sort()
}

/** Nombres de plugin del directorio, en orden alfabético. */
async function pluginFileNames(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })

  return pluginNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
}

function readExport(module: unknown, name: string): unknown {
  if (typeof module !== 'object' || module === null) return undefined

  return Reflect.get(module, name)
}

/**
 * Los candidatos que un archivo declara.
 *
 * El spec acepta `default` o `providers`, y **no los dos**: con ambos no hay
 * forma de saber cuál es el bueno, y elegir uno en silencio es peor que decirlo.
 */
function candidatesFrom(module: unknown, file: string): readonly unknown[] | ProviderError {
  const defaultExport = readExport(module, 'default')
  const namedExport = readExport(module, 'providers')

  if (defaultExport !== undefined && namedExport !== undefined) {
    return providerFailure({
      providerId: file,
      kind: 'invalid-shape',
      detail: 'exporta `default` y `providers` a la vez; tiene que exportar uno de los dos',
    })
  }

  if (namedExport !== undefined) {
    if (!Array.isArray(namedExport)) {
      return providerFailure({
        providerId: file,
        kind: 'invalid-shape',
        detail: 'exporta `providers` y no es una lista',
      })
    }

    return namedExport
  }

  if (defaultExport !== undefined) return [defaultExport]

  return providerFailure({
    providerId: file,
    kind: 'invalid-shape',
    detail: 'no exporta ni `default` ni `providers`',
  })
}

/** Los candidatos son una lista; el fallo, un error. */
function isFailure(value: readonly unknown[] | ProviderError): value is ProviderError {
  return !Array.isArray(value)
}

/**
 * Escanea el directorio y devuelve qué entró y qué no.
 *
 * No lanza por un plugin: los fallos van en el informe. Sí puede devolver
 * `directoryError` cuando el problema es el directorio.
 */
export async function loadProviders(options: LoadOptions): Promise<LoadReport> {
  const directory = resolve(options.directory)
  const imported = options.importModule ?? defaultImport

  let names: readonly string[]
  try {
    names = await pluginFileNames(directory)
  } catch (cause) {
    if (isMissing(cause)) return { active: [], rejected: [] }

    return {
      active: [],
      rejected: [],
      directoryError: providerFailure({
        providerId: directory,
        kind: 'invalid-shape',
        cause,
        detail: `el directorio de plugins no se puede leer: ${directory}`,
      }),
    }
  }

  const registry: ProviderRegistry = createRegistry()
  const active: LoadedProvider[] = []
  const rejected: RejectedPlugin[] = []

  for (const name of names) {
    const file = join(directory, name)

    let module: unknown
    try {
      module = await imported(pathToFileURL(file).href)
    } catch (cause) {
      // El mensaje se construye aquí y no con `providerFailure`: un archivo que
      // no se puede importar no incumple el contrato, no llegó a declararlo.
      rejected.push({
        file,
        reason: namedByFile(
          new ProviderError({
            message: `no se pudo importar: ${cause instanceof Error ? cause.message : 'sin causa'}`,
            scope: name,
            cause,
            context: { kind: classifyThrow(cause) },
          }),
          name,
        ),
      })
      continue
    }

    const candidates = candidatesFrom(module, name)
    if (isFailure(candidates)) {
      rejected.push({ file, reason: namedByFile(candidates, name) })
      continue
    }

    for (const candidate of candidates) {
      const added = registry.add(candidate)
      if (!added.ok) {
        rejected.push({ file, reason: namedByFile(added.error, name) })
        continue
      }

      active.push({ provider: added.value, file })
    }
  }

  return { active, rejected }
}
