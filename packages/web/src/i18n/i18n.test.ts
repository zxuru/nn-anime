import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { messages as es } from './es'
import { CATALOGS, t } from './index'

/**
 * Rutas con `fileURLToPath`, nunca `URL.pathname`: `pathname` deja `%20` en una
 * ruta con espacios y la lectura de archivos falla. Ver el gemelo en
 * `packages/cli/src/i18n/i18n.test.ts`.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CATALOG = fileURLToPath(new URL('./es.ts', import.meta.url))
const INDEX = fileURLToPath(new URL('./index.ts', import.meta.url))

describe('catálogo de la interfaz', () => {
  test('todas las claves tienen un valor no vacío', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), `la clave ${key} está vacía`).not.toBe('')
    }
  })

  test('traduce una clave propia', () => {
    expect(t('es', 'nav.search')).toBe('Buscar')
  })

  test('traduce una clave de core, que llega mezclada', () => {
    expect(t('es', 'error.config.missingHome', { dirs: 'dataDir' })).toContain('dataDir')
  })

  test('las claves propias ganan sobre las de core', () => {
    expect(CATALOGS.es['app.name']).toBe('nn-anime')
  })

  test('interpola los parámetros', () => {
    expect(t('es', 'notFound.body', { path: '/raro' })).toContain('/raro')
  })

  test('una clave desconocida se devuelve a sí misma, sin lanzar', () => {
    expect(t('es', 'no.existe')).toBe('no.existe')
  })
})

describe('claves huérfanas', () => {
  async function productionSource(): Promise<string> {
    const glob = new Bun.Glob('**/*.{ts,tsx}')
    const parts: string[] = []

    for await (const relative of glob.scan({ cwd: ROOT })) {
      if (relative.includes('.test.')) continue

      const path = `${ROOT}${relative}`
      if (path === CATALOG || path === INDEX) continue
      parts.push(await Bun.file(path).text())
    }

    return parts.join('\n')
  }

  test('lee el código de producción: encuentra un componente', async () => {
    expect(await productionSource()).toContain('useRoute')
  })

  test('ninguna clave del catálogo está sin usar', async () => {
    const source = await productionSource()
    const unused = Object.keys(es).filter((key) => !source.includes(key))

    expect(unused).toEqual([])
  })
})
