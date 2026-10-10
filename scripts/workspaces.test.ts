import { describe, expect, test } from 'bun:test'
import { isRecord, listWorkspaces, scriptOf } from './workspaces'

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
      expect(await Bun.file(`${workspace.dir}/package.json`).exists()).toBe(true)
    }
  })
})
