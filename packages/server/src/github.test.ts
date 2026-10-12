/**
 * El cliente de GitHub, contra un GitHub de mentira.
 *
 * Ninguna prueba sale a la red: el `fetch` y el resolutor se inyectan, y el
 * resolutor devuelve una dirección pública para que la comprobación de destinos
 * —que sí se ejecuta, y es la que se está midiendo— deje pasar el nombre sin
 * resolverlo de verdad.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { githubRepoFromUrl } from '@nn-anime/core'
import type { FetchLike, Resolver } from '@nn-anime/media-proxy'
import {
  confine,
  downloadGithubRepo,
  GITHUB_API_HOST,
  GITHUB_RAW_HOST,
  isGithubUrl,
  isSafeRepoPath,
  isSkippedRepoPath,
} from './github'

/** Una dirección pública: GitHub es público, y lo que se comprueba es el resto. */
const RESOLVER: Resolver = async () => ['140.82.121.3']

const LOCATION = githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins')

if (LOCATION === undefined) throw new Error('la dirección de la prueba no analiza')

interface TreeEntry {
  readonly path: string
  readonly type?: string
  readonly size?: number
}

interface GithubFixture {
  readonly branch?: string
  readonly tree?: readonly TreeEntry[]
  readonly truncated?: boolean
  readonly blobs?: Readonly<Record<string, string>>
  /** Estado exacto por URL, para los casos de error. */
  readonly status?: Readonly<Record<string, number>>
  /** Redirección exacta por URL. */
  readonly redirect?: Readonly<Record<string, string>>
}

interface Fake {
  readonly impl: FetchLike
  /** Las URLs que de verdad se pidieron, en orden. */
  readonly calls: readonly string[]
}

function fakeGithub(fixture: GithubFixture = {}): Fake {
  const calls: string[] = []

  const impl: FetchLike = async (input) => {
    calls.push(input)

    const status = fixture.status?.[input]
    if (status !== undefined) return new Response('no', { status })

    const redirect = fixture.redirect?.[input]
    if (redirect !== undefined) {
      return new Response(null, { status: 302, headers: { location: redirect } })
    }

    const url = new URL(input)

    if (url.host === GITHUB_API_HOST && url.pathname.includes('/git/trees/')) {
      return Response.json({
        truncated: fixture.truncated ?? false,
        tree: (fixture.tree ?? []).map((entry) => ({
          path: entry.path,
          type: entry.type ?? 'blob',
          ...(entry.size === undefined ? {} : { size: entry.size }),
        })),
      })
    }

    if (url.host === GITHUB_API_HOST && /^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      return Response.json({ default_branch: fixture.branch ?? 'main' })
    }

    if (url.host === GITHUB_RAW_HOST) {
      // `/usuario/repo/referencia/ruta…`: los cuatro primeros segmentos son el
      // sobre, y lo que queda es la ruta dentro del repositorio.
      const path = url.pathname
        .split('/')
        .slice(4)
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      const text = fixture.blobs?.[path]

      return text === undefined ? new Response('no', { status: 404 }) : new Response(text)
    }

    return new Response('no', { status: 404 })
  }

  return { impl, calls }
}

/** Un directorio temporal, que hace de carpeta de datos. */
async function withTemp<T>(body: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'nn-anime-github-'))

  try {
    return await body(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('isGithubUrl: los hosts que se piden', () => {
  test('acepta los tres de GitHub y rechaza lo demás', () => {
    expect(isGithubUrl(`https://${GITHUB_API_HOST}/repos/o/r`)).toBe(true)
    expect(isGithubUrl(`https://${GITHUB_RAW_HOST}/o/r/main/a.ts`)).toBe(true)
    expect(isGithubUrl('https://github.com/o/r')).toBe(true)
    expect(isGithubUrl('https://evil.example/o/r')).toBe(false)
    // El host se compara entero: `api.github.com.evil.example` no es GitHub.
    expect(isGithubUrl('https://api.github.com.evil.example/x')).toBe(false)
    expect(isGithubUrl('file:///etc/passwd')).toBe(false)
    expect(isGithubUrl('no es una dirección')).toBe(false)
  })
})

describe('las rutas del árbol', () => {
  test('un segmento que no es un nombre se rechaza', () => {
    expect(isSafeRepoPath('src/providers/jkanime.ts')).toBe(true)
    expect(isSafeRepoPath('../fuera.ts')).toBe(false)
    expect(isSafeRepoPath('src/../../fuera.ts')).toBe(false)
    expect(isSafeRepoPath('/etc/passwd')).toBe(false)
    expect(isSafeRepoPath('C:\\Windows\\x.ts')).toBe(false)
    expect(isSafeRepoPath('src\\jkanime.ts')).toBe(false)
    expect(isSafeRepoPath('a\0b.ts')).toBe(false)
    expect(isSafeRepoPath('')).toBe(false)
    expect(isSafeRepoPath('src//jkanime.ts')).toBe(false)
  })

  test('confina: una ruta que se sale del destino no tiene archivo', () => {
    const base = join(tmpdir(), 'nn-anime-destino')

    expect(confine(base, 'src/a.ts')).toBe(join(base, 'src', 'a.ts'))
    expect(confine(base, '../fuera.ts')).toBeUndefined()
    expect(confine(base, '/otro/lado.ts')).toBeUndefined()
  })

  test('se saltan los directorios de trabajo, lo oculto y los binarios', () => {
    expect(isSkippedRepoPath('node_modules/x/index.ts')).toBe(true)
    expect(isSkippedRepoPath('dist/index.js')).toBe(true)
    expect(isSkippedRepoPath('.github/workflows/ci.yml')).toBe(true)
    expect(isSkippedRepoPath('portada.png')).toBe(true)
    expect(isSkippedRepoPath('src/jkanime.ts')).toBe(false)
    expect(isSkippedRepoPath('src/datos.json')).toBe(false)
  })
})

describe('downloadGithubRepo', () => {
  test('sin referencia pregunta la rama por defecto y escribe los archivos', async () => {
    await withTemp(async (data) => {
      const destination = join(data, 'repos', 'zxuru__nn-anime-plugins')
      const github = fakeGithub({
        branch: 'principal',
        tree: [
          { path: 'jkanime.ts', size: 20 },
          { path: 'src/otro.ts', size: 10 },
        ],
        blobs: { 'jkanime.ts': 'export default uno', 'src/otro.ts': 'export default dos' },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return

      expect(outcome.ref).toBe('principal')
      expect(outcome.files).toEqual(['jkanime.ts', 'src/otro.ts'])
      expect(outcome.bytes).toBe('export default uno'.length + 'export default dos'.length)
      expect(await readFile(join(destination, 'jkanime.ts'), 'utf8')).toBe('export default uno')
      expect(await readFile(join(destination, 'src', 'otro.ts'), 'utf8')).toBe('export default dos')
      expect(github.calls.some((url) => url.endsWith('/repos/zxuru/nn-anime-plugins'))).toBe(true)
    })
  })

  test('con referencia no se pregunta la rama por defecto', async () => {
    await withTemp(async (data) => {
      const location = githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins/tree/dev')
      const github = fakeGithub({ tree: [{ path: 'a.ts' }], blobs: { 'a.ts': 'export default a' } })

      if (location === undefined) throw new Error('la dirección de la prueba no analiza')

      const outcome = await downloadGithubRepo({
        location,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.ref).toBe('dev')
      expect(
        github.calls.some(
          (url) => url === `https://${GITHUB_API_HOST}/repos/zxuru/nn-anime-plugins`,
        ),
      ).toBe(false)
      expect(github.calls.some((url) => url.includes('/git/trees/dev'))).toBe(true)
    })
  })

  test('una subcarpeta limita lo que se descarga, con rutas del repo entero', async () => {
    await withTemp(async (data) => {
      const location = githubRepoFromUrl(
        'https://github.com/zxuru/nn-anime-plugins/tree/main/src/providers',
      )
      const github = fakeGithub({
        tree: [{ path: 'src/providers/a.ts' }, { path: 'src/otro.ts' }, { path: 'raiz.ts' }],
        blobs: { 'src/providers/a.ts': 'export default a' },
      })

      if (location === undefined) throw new Error('la dirección de la prueba no analiza')

      const destination = join(data, 'repo')
      const outcome = await downloadGithubRepo({
        location,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.files).toEqual(['src/providers/a.ts'])
      expect(await exists(join(destination, 'src', 'otro.ts'))).toBe(false)
    })
  })

  test('el nombre con espacios viaja codificado y se escribe con su nombre', async () => {
    await withTemp(async (data) => {
      const destination = join(data, 'repo')
      const github = fakeGithub({
        tree: [{ path: 'mi plugin.ts' }],
        blobs: { 'mi plugin.ts': 'export default a' },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(true)
      expect(github.calls.some((url) => url.includes('mi%20plugin.ts'))).toBe(true)
      expect(await exists(join(destination, 'mi plugin.ts'))).toBe(true)
    })
  })

  test('una redirección fuera de GitHub se corta y no se pide el host ajeno', async () => {
    await withTemp(async (data) => {
      const treeUrl = `https://${GITHUB_API_HOST}/repos/zxuru/nn-anime-plugins/git/trees/main?recursive=1`
      const github = fakeGithub({ redirect: { [treeUrl]: 'https://evil.example/x' } })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.error.message).toContain('no es de GitHub')
      expect(github.calls.some((url) => url.includes('evil.example'))).toBe(false)
      expect(await exists(join(data, 'repo'))).toBe(false)
    })
  })

  test('un 404 explica lo que puede estar pasando', async () => {
    await withTemp(async (data) => {
      const infoUrl = `https://${GITHUB_API_HOST}/repos/zxuru/nn-anime-plugins`
      const github = fakeGithub({ status: { [infoUrl]: 404 } })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.error.message).toContain('no existen')
        expect(outcome.error.message).toContain('privado')
      }
    })
  })

  test('un 403 nombra el límite de peticiones, que es lo que de verdad pasa', async () => {
    await withTemp(async (data) => {
      const infoUrl = `https://${GITHUB_API_HOST}/repos/zxuru/nn-anime-plugins`
      const github = fakeGithub({ status: { [infoUrl]: 403 } })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.error.message).toContain('límite de peticiones')
    })
  })

  test('un árbol truncado por GitHub es un error, no una instalación a medias', async () => {
    await withTemp(async (data) => {
      const github = fakeGithub({ truncated: true, tree: [{ path: 'a.ts' }] })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.error.message).toContain('truncó')
    })
  })

  test('una ruta hostil del árbol no escribe fuera del destino', async () => {
    await withTemp(async (data) => {
      const destination = join(data, 'repos', 'zxuru__nn-anime-plugins')
      const github = fakeGithub({
        tree: [{ path: '../fuera.ts' }, { path: 'C:\\Windows\\x.ts' }, { path: 'a.ts' }],
        blobs: {
          '../fuera.ts': 'export default malo',
          'C:\\Windows\\x.ts': 'export default malo',
          'a.ts': 'export default bueno',
        },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.files).toEqual(['a.ts'])
      expect(await exists(join(data, 'repos', 'fuera.ts'))).toBe(false)
      expect(await exists(join(data, 'fuera.ts'))).toBe(false)
    })
  })

  test('los topes: más archivos de los permitidos es un error que se explica', async () => {
    await withTemp(async (data) => {
      const github = fakeGithub({
        tree: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
        blobs: { 'a.ts': 'x', 'b.ts': 'x', 'c.ts': 'x' },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
        limits: { maxFiles: 2 },
      })

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.error.message).toContain('3 archivos')
        expect(outcome.error.message).toContain('tope son 2')
      }
    })
  })

  test('el tope de un archivo lo salta en vez de romper la instalación', async () => {
    await withTemp(async (data) => {
      const destination = join(data, 'repo')
      const github = fakeGithub({
        tree: [
          { path: 'grande.ts', size: 5000 },
          { path: 'pequeno.ts', size: 10 },
        ],
        blobs: { 'grande.ts': 'x'.repeat(5000), 'pequeno.ts': 'export default a' },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
        limits: { maxFileBytes: 100 },
      })

      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.files).toEqual(['pequeno.ts'])
      expect(await exists(join(destination, 'grande.ts'))).toBe(false)
    })
  })

  test('un archivo sin tamaño declarado también se mide antes de escribirlo', async () => {
    await withTemp(async (data) => {
      const github = fakeGithub({
        tree: [{ path: 'grande.ts' }],
        blobs: { 'grande.ts': 'x'.repeat(500) },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
        limits: { maxFileBytes: 100 },
      })

      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.files).toEqual([])
    })
  })

  test('el total es un error: un repo que no cabe no se instala a medias', async () => {
    await withTemp(async (data) => {
      const github = fakeGithub({
        tree: [{ path: 'a.ts' }, { path: 'b.ts' }],
        blobs: { 'a.ts': 'x'.repeat(10), 'b.ts': 'x'.repeat(10) },
      })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination: join(data, 'repo'),
        fetchImpl: github.impl,
        resolver: RESOLVER,
        limits: { maxTotalBytes: 15 },
      })

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.error.message).toContain('no se descarga entero')
    })
  })

  test('un fallo a mitad no toca lo que ya había en el destino', async () => {
    await withTemp(async (data) => {
      const destination = join(data, 'repo')
      const github = fakeGithub({
        tree: [{ path: 'a.ts' }, { path: 'b.ts' }],
        blobs: { 'a.ts': 'export default a', 'b.ts': 'export default b' },
      })

      // Primero se instala bien, y después se actualiza con una descarga que falla.
      const primera = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })
      expect(primera.ok).toBe(true)

      const roto = fakeGithub({
        tree: [{ path: 'a.ts' }, { path: 'b.ts' }],
        blobs: { 'a.ts': 'export default nuevo' },
      })
      const segunda = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: roto.impl,
        resolver: RESOLVER,
      })

      expect(segunda.ok).toBe(false)
      // Lo de antes sigue entero y no queda el directorio de descarga por ahí.
      expect(await readFile(join(destination, 'a.ts'), 'utf8')).toBe('export default a')
      expect(await exists(`${destination}.descarga`)).toBe(false)
    })
  })

  test('un destino que no existe se crea', async () => {
    await withTemp(async (data) => {
      const destination = join(data, 'no', 'existe', 'todavía')
      const github = fakeGithub({ tree: [{ path: 'a.ts' }], blobs: { 'a.ts': 'export default a' } })

      const outcome = await downloadGithubRepo({
        location: LOCATION,
        destination,
        fetchImpl: github.impl,
        resolver: RESOLVER,
      })

      expect(outcome.ok).toBe(true)
      expect(await exists(join(destination, 'a.ts'))).toBe(true)
    })
  })
})
