import { describe, expect, test } from 'bun:test'
import { join, sep } from 'node:path'
import { dirOfModule, isRecord, listWorkspaces, scriptOf } from './workspaces'

/**
 * Una URL `file://` de Windows lleva la unidad —`file:///C:/…`— y una de POSIX
 * no. `fileURLToPath` rechaza la de la otra plataforma con «File URL path must
 * be an absolute path», así que la prueba arma la suya con el prefijo de esta
 * máquina. Lo que mide —que los escapes se descodifican— es igual en las dos.
 */
const RAIZ_URL = process.platform === 'win32' ? 'file:///C:/' : 'file:///'
const RAIZ_FS = process.platform === 'win32' ? 'C:\\' : '/'

/** Lo que `dirOfModule` devuelve: el padre del directorio del módulo, con separador final. */
function esperado(...segmentos: readonly string[]): string {
  return join(RAIZ_FS, ...segmentos) + sep
}

describe('dirOfModule', () => {
  test('devuelve una ruta del sistema de archivos, sin codificar', () => {
    expect(dirOfModule(`${RAIZ_URL}home/prueba/nn-anime/scripts/dev.ts`)).toBe(
      esperado('home', 'prueba', 'nn-anime'),
    )
  })

  test('descodifica los espacios en lugar de dejar %20', () => {
    expect(dirOfModule(`${RAIZ_URL}home/ana/mis%20proyectos/nn-anime/scripts/dev.ts`)).toBe(
      esperado('home', 'ana', 'mis proyectos', 'nn-anime'),
    )
  })

  test('descodifica otros caracteres escapados', () => {
    expect(dirOfModule(`${RAIZ_URL}tmp/a%2Bb%20%26%20c/scripts/x.ts`)).toBe(
      esperado('tmp', 'a+b & c'),
    )
  })
})

describe('isRecord', () => {
  test('acepta objetos planos', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord({})).toBe(true)
  })

  test('rechaza null, arrays y primitivos', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('texto')).toBe(false)
    expect(isRecord(3)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })
})

describe('scriptOf', () => {
  const workspace = {
    name: '@nn-anime/demo',
    dir: '/tmp/demo',
    manifest: { scripts: { dev: 'bun --watch src/index.ts' } },
  }

  test('devuelve el comando declarado', () => {
    expect(scriptOf(workspace, 'dev')).toBe('bun --watch src/index.ts')
  })

  test('devuelve undefined cuando el script no está declarado', () => {
    expect(scriptOf(workspace, 'build')).toBeUndefined()
  })

  test('devuelve undefined cuando el manifiesto no tiene scripts', () => {
    expect(scriptOf({ ...workspace, manifest: {} }, 'dev')).toBeUndefined()
  })

  test('devuelve undefined cuando el valor no es una cadena', () => {
    expect(scriptOf({ ...workspace, manifest: { scripts: { dev: 7 } } }, 'dev')).toBeUndefined()
  })
})

describe('listWorkspaces', () => {
  test('encuentra los nueve paquetes del monorepo', async () => {
    const names = (await listWorkspaces()).map((workspace) => workspace.name).sort()

    expect(names).toEqual(
      [
        'catalog-store',
        'cli',
        'core',
        'media-proxy',
        'provider-sdk',
        'providers-fixture',
        'recsys',
        'server',
        'web',
      ].map((name) => `@nn-anime/${name}`),
    )
  })

  test('cada workspace apunta a un directorio con manifiesto legible', async () => {
    const workspaces = await listWorkspaces()

    for (const workspace of workspaces) {
      expect(await Bun.file(join(workspace.dir, 'package.json')).exists()).toBe(true)
    }
  })
})
