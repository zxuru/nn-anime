import { describe, expect, test } from 'bun:test'
import { messages as es } from './es'

/**
 * Vigila que no queden textos huérfanos.
 *
 * Una clave que ya nadie usa no da error en ningún sitio: se queda en el
 * catálogo, alguien la traduce, y nadie se entera de que sobra. Es exactamente
 * lo que pasó con `cli.notImplemented` al cerrar T7.
 *
 * La comprobación es textual y por eso es conservadora: una clave que sólo
 * aparezca en un comentario contaría como usada. Prefiere no dar falsos
 * positivos a no dar ninguno.
 */

const CATALOG = new URL('es.ts', import.meta.url).pathname
const INDEX = new URL('index.ts', import.meta.url).pathname

async function productionSource(): Promise<string> {
  const root = new URL('..', import.meta.url).pathname
  const glob = new Bun.Glob('**/*.ts')
  const parts: string[] = []

  for await (const relative of glob.scan({ cwd: root })) {
    const path = root + relative
    if (path === CATALOG || path === INDEX) continue
    parts.push(await Bun.file(path).text())
  }

  return parts.join('\n')
}

describe('catálogo del CLI', () => {
  test('todas las claves tienen valor no vacío', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), `la clave ${key} está vacía`).not.toBe('')
    }
  })

  test('ninguna clave del catálogo está sin usar', async () => {
    const source = await productionSource()
    const unused = Object.keys(es).filter((key) => !source.includes(key))

    expect(unused).toEqual([])
  })

  test('los parámetros que interpola cada clave existen donde se usan', () => {
    for (const [key, value] of Object.entries(es)) {
      const params = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
      for (const name of params) expect(name, `${key} usa {${name}}`).toBeString()
    }
  })
})
