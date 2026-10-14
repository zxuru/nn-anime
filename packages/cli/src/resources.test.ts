import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EMBEDDED_MIGRATIONS_DIR,
  EMBEDDED_WEB_DIR,
  MIGRATIONS_DIR_ENV,
  resolveResources,
  WEB_ROOT_ENV,
} from './resources'

/**
 * Lo que estas pruebas defienden.
 *
 * La resolución de recursos tiene un fallo que no se ve: dentro de un binario
 * compilado, el runner de migraciones mira un directorio sin `.sql`, no aplica
 * ninguna y **arranca como si hubiera migrado**. Medido antes de escribir esto:
 * el síntoma era un `no such table: anime` al servir, lejos de la causa.
 *
 * Por eso lo que se comprueba aquí es el **orden de precedencia**, que es lo
 * único que decide cuál de los tres candidatos gana. El disco se sustituye por
 * una lista de rutas existentes: con directorios de verdad, cada prueba tendría
 * que crear un árbol paralelo y el orden —que es lo que importa— quedaría
 * escondido detrás del montaje.
 */

function onlyExisting(...rutas: readonly string[]): (path: string) => boolean {
  const existentes = new Set(rutas)

  return (path) => existentes.has(path)
}

const SOURCE_DIR = join('repo', 'packages', 'cli', 'src')
const SOURCE_WEB = join(SOURCE_DIR, '..', '..', 'web', 'dist')
const SOURCE_MIGRATIONS = join(SOURCE_DIR, '..', '..', 'catalog-store', 'src', 'migrations')

/** La raíz del sistema de archivos virtual de un ejecutable, tal como se midió. */
const EMBEDDED_ROOT = join('B:', '~BUN', 'root')
const EMBEDDED_WEB = join(EMBEDDED_ROOT, EMBEDDED_WEB_DIR)
const EMBEDDED_MIGRATIONS = join(EMBEDDED_ROOT, EMBEDDED_MIGRATIONS_DIR)

describe('la resolución de recursos', () => {
  test('en el árbol de fuentes encuentra la interfaz y las migraciones', () => {
    const resources = resolveResources({
      env: {},
      embeddedRoot: undefined,
      sourceDir: SOURCE_DIR,
      exists: onlyExisting(SOURCE_WEB, SOURCE_MIGRATIONS),
    })

    expect(resources.webRoot).toBe(SOURCE_WEB)
    expect(resources.migrationsDir).toBe(SOURCE_MIGRATIONS)
  })

  test('dentro del binario encuentra los recursos incrustados', () => {
    const resources = resolveResources({
      env: {},
      embeddedRoot: EMBEDDED_ROOT,
      // Dentro del binario todos los módulos resuelven a la misma raíz: el árbol
      // de fuentes no sobrevive a la compilación, y esa es la trampa.
      sourceDir: EMBEDDED_ROOT,
      exists: onlyExisting(EMBEDDED_WEB, EMBEDDED_MIGRATIONS),
    })

    expect(resources.webRoot).toBe(EMBEDDED_WEB)
    expect(resources.migrationsDir).toBe(EMBEDDED_MIGRATIONS)
  })

  test('lo incrustado gana al árbol de fuentes, aunque los dos existan', () => {
    const resources = resolveResources({
      env: {},
      embeddedRoot: EMBEDDED_ROOT,
      sourceDir: SOURCE_DIR,
      exists: onlyExisting(EMBEDDED_WEB, EMBEDDED_MIGRATIONS, SOURCE_WEB, SOURCE_MIGRATIONS),
    })

    expect(resources.webRoot).toBe(EMBEDDED_WEB)
    expect(resources.migrationsDir).toBe(EMBEDDED_MIGRATIONS)
  })

  test('la variable de entorno gana a lo incrustado y al árbol de fuentes', () => {
    const resources = resolveResources({
      env: { [WEB_ROOT_ENV]: '/otra/interfaz', [MIGRATIONS_DIR_ENV]: '/otras/migraciones' },
      embeddedRoot: EMBEDDED_ROOT,
      sourceDir: SOURCE_DIR,
      exists: onlyExisting(
        '/otra/interfaz',
        '/otras/migraciones',
        EMBEDDED_WEB,
        EMBEDDED_MIGRATIONS,
        SOURCE_WEB,
        SOURCE_MIGRATIONS,
      ),
    })

    expect(resources.webRoot).toBe('/otra/interfaz')
    expect(resources.migrationsDir).toBe('/otras/migraciones')
  })

  test('una variable de entorno que apunta a algo que no existe se ignora', () => {
    const resources = resolveResources({
      env: { [WEB_ROOT_ENV]: '/no/existe', [MIGRATIONS_DIR_ENV]: '/tampoco' },
      embeddedRoot: EMBEDDED_ROOT,
      sourceDir: SOURCE_DIR,
      exists: onlyExisting(EMBEDDED_WEB, EMBEDDED_MIGRATIONS),
    })

    expect(resources.webRoot).toBe(EMBEDDED_WEB)
    expect(resources.migrationsDir).toBe(EMBEDDED_MIGRATIONS)
  })

  test('sin build de la interfaz, el servidor se queda sin webRoot', () => {
    const resources = resolveResources({
      env: {},
      embeddedRoot: undefined,
      sourceDir: SOURCE_DIR,
      exists: onlyExisting(SOURCE_MIGRATIONS),
    })

    expect(resources.webRoot).toBeUndefined()
  })

  test('sin migraciones el directorio queda indefinido y manda el runner', () => {
    const resources = resolveResources({
      env: {},
      embeddedRoot: undefined,
      sourceDir: SOURCE_DIR,
      exists: onlyExisting(SOURCE_WEB),
    })

    expect(resources.migrationsDir).toBeUndefined()
  })

  /**
   * Las anteriores usan un disco de mentira, y un disco de mentira no se
   * equivoca al contar `..`: si el resolutor contara uno de menos, todas
   * seguirían verdes. Esta mira el árbol de verdad, y por eso sólo afirma lo
   * que está en el repositorio —las migraciones lo están; el build de la
   * interfaz no, y por eso no se nombra—.
   */
  test('las migraciones del árbol de fuentes están donde dice el resolutor', () => {
    const resources = resolveResources({
      env: {},
      embeddedRoot: undefined,
      sourceDir: import.meta.dir,
      exists: existsSync,
    })

    expect(resources.migrationsDir).toBe(
      fileURLToPath(new URL('../../catalog-store/src/migrations', import.meta.url)),
    )
  })
})
