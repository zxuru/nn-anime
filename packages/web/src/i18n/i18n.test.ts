import { describe, expect, test } from 'bun:test'
import { messages as es } from './es'
import { t } from './index'

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
    expect(t('es', 'app.name')).toBe('nn-anime')
  })

  test('interpola los parámetros', () => {
    expect(t('es', 'notFound.body', { path: '/raro' })).toContain('/raro')
  })

  test('una clave desconocida se devuelve a sí misma, sin lanzar', () => {
    expect(t('es', 'no.existe')).toBe('no.existe')
  })
})

describe('claves huérfanas', () => {
  /** Ver `packages/cli/src/i18n/i18n.test.ts` para el porqué de esta comprobación. */
  async function productionSource(): Promise<string> {
    const root = new URL('..', import.meta.url).pathname
    const glob = new Bun.Glob('**/*.{ts,tsx}')
    const catalog = new URL('es.ts', import.meta.url).pathname
    const index = new URL('index.ts', import.meta.url).pathname
    const parts: string[] = []

    for await (const relative of glob.scan({ cwd: root })) {
      const path = root + relative
      if (path === catalog || path === index) continue
      parts.push(await Bun.file(path).text())
    }

    return parts.join('\n')
  }

  test('ninguna clave del catálogo está sin usar', async () => {
    const source = await productionSource()
    const unused = Object.keys(es).filter((key) => !source.includes(key))

    expect(unused).toEqual([])
  })
})
