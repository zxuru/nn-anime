import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { messages as es } from './es'

/**
 * Vigila que no queden textos huérfanos.
 *
 * Una clave que ya nadie usa no da error en ningún sitio: se queda en el
 * catálogo, alguien la traduce, y nadie se entera de que sobra. Es lo que pasó
 * con `cli.notImplemented` al cerrar T7.
 *
 * Las rutas se obtienen con `fileURLToPath` y no con `URL.pathname`. `pathname`
 * devuelve la ruta percent-codificada: en un directorio con un espacio se
 * convierte en `%20`, `Bun.file` no encuentra nada y el test falla diciendo
 * «claves sin usar», que apunta al catálogo cuando el problema está en la
 * lectura. Es el mismo defecto que se corrigió en `scripts/workspaces.ts`.
 *
 * La comprobación es textual y por eso conservadora: una clave que sólo
 * aparezca en un comentario contará como usada. Prefiere no dar falsos
 * positivos a no dar ninguno.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CATALOG = fileURLToPath(new URL('./es.ts', import.meta.url))
const INDEX = fileURLToPath(new URL('./index.ts', import.meta.url))

/** Código de producción del paquete: sin catálogo, sin punto de entrada y sin tests. */
async function productionSource(): Promise<string> {
  const glob = new Bun.Glob('**/*.ts')
  const parts: string[] = []

  for await (const relative of glob.scan({ cwd: ROOT })) {
    if (relative.includes('.test.')) continue

    const path = `${ROOT}${relative}`
    if (path === CATALOG || path === INDEX) continue
    parts.push(await Bun.file(path).text())
  }

  return parts.join('\n')
}

describe('catálogo del CLI', () => {
  test('el directorio del paquete se resuelve aunque la ruta tenga espacios', () => {
    expect(HERE).not.toContain('%20')
    expect(HERE).toBe(`${ROOT}i18n/`)
  })

  test('todas las claves tienen valor no vacío', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), `la clave ${key} está vacía`).not.toBe('')
    }
  })

  test('lee el código de producción: encuentra el punto de entrada', async () => {
    // Si la lectura de archivos fallara, el test de claves huérfanas daría un
    // falso positivo. Éste falla primero y con el motivo correcto.
    expect(await productionSource()).toContain('parseArgs')
  })

  test('ninguna clave del catálogo está sin usar', async () => {
    const source = await productionSource()
    const unused = Object.keys(es).filter((key) => !source.includes(key))

    expect(unused).toEqual([])
  })
})
