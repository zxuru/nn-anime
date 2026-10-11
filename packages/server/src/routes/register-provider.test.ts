import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providersResponseSchema } from '@nn-anime/core'
import { type LoadReport, providerFailure } from '@nn-anime/provider-sdk'
import { type AppOptions, createApp } from '../app'
import { SESSION_COOKIE, type Session } from '../session'

/**
 * El alta, probada contra el disco de verdad.
 *
 * No hay cargador falso en el camino feliz: el plugin se escribe, el loader real
 * lo importa y la lista de proveedores cambia. Es la única forma de comprobar lo
 * que promete la ruta —«se guarda y queda activo sin reiniciar»— porque lo que
 * puede fallar es justo la parte que un doble sustituiría.
 */

const PORT = 7717
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const JSON_HEADERS = {
  cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
  origin: BASE,
  'content-type': 'application/json',
}

function fakeSession(): Session {
  return {
    cookieName: SESSION_COOKIE,
    value: SESSION_VALUE,
    matches: (candidate) => candidate === SESSION_VALUE,
  }
}

const DRAFT = {
  id: 'mio',
  name: 'Mío',
  baseUrl: 'https://e.example',
  capabilities: { search: true, sub: true, dub: false, trending: false },
  endpoints: {
    search: '/buscar?q={query}',
    anime: '/anime/{ref}',
    episodes: '/anime/{ref}/episodios',
    stream: '/ver/{ref}',
  },
}

interface Contexto {
  readonly dir: string
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly altas: (body: unknown) => Promise<Response>
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  overrides: Partial<AppOptions> = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-alta-'))

  try {
    const app = createApp({
      port: PORT,
      session: fakeSession(),
      bootToken: 'token',
      version: '0.1.0',
      providersDir: dir,
      ...overrides,
    })

    return await body({
      dir,
      pedir: async (ruta, init) =>
        await Promise.resolve(app.request(`${BASE}${ruta}`, init ?? { headers: JSON_HEADERS })),
      altas: async (payload) =>
        await Promise.resolve(
          app.request(`${BASE}/api/providers`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify(payload),
          }),
        ),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('alta de un proveedor', () => {
  test('escribe el plugin, lo carga y lo deja activo sin reiniciar', async () => {
    await conApp(async ({ dir, altas, pedir }) => {
      const respuesta = await altas(DRAFT)

      expect(respuesta.status).toBe(201)
      expect(await respuesta.json()).toEqual({
        provider: {
          id: 'mio',
          name: 'Mío',
          capabilities: { search: true, sub: true, dub: false, trending: false, feed: false },
          status: 'active',
        },
      })

      // El archivo está donde tiene que estar.
      expect(await readdir(dir)).toEqual(['mio.ts'])

      // Y la misma aplicación, sin reiniciar, ya lo sirve.
      const lista = providersResponseSchema.parse(await (await pedir('/api/providers')).json())
      expect(lista.providers.map((p) => p.id)).toEqual(['mio'])
      expect(lista.providers[0]?.status).toBe('active')
    })
  })

  test('el plugin escrito es el generado, no lo que mandó el cliente', async () => {
    await conApp(async ({ altas, dir }) => {
      await altas({ ...DRAFT, name: 'Mío' })

      const fuente = await readFile(join(dir, 'mio.ts'), 'utf8')

      expect(fuente).toContain('const ID = "mio"')
      expect(fuente).toContain('const BASE_URL = "https://e.example"')
      expect(fuente).toContain('export default provider')
    })
  })

  test('un identificador ya ocupado es un 409 y no toca el archivo', async () => {
    await conApp(async ({ altas, dir }) => {
      await writeFile(join(dir, 'mio.ts'), '// el original')

      const respuesta = await altas(DRAFT)

      expect(respuesta.status).toBe(409)
      expect(await readFile(join(dir, 'mio.ts'), 'utf8')).toBe('// el original')
    })
  })

  test('un identificador con ruta no llega a escribir nada', async () => {
    await conApp(async ({ altas, dir }) => {
      const respuesta = await altas({ ...DRAFT, id: '../fuera' })

      expect(respuesta.status).toBe(400)
      expect(await readdir(dir)).toEqual([])
    })
  })

  test('una ruta sin su marcador se rechaza antes de escribir', async () => {
    await conApp(async ({ altas, dir }) => {
      const respuesta = await altas({
        ...DRAFT,
        endpoints: { ...DRAFT.endpoints, search: '/buscar' },
      })

      expect(respuesta.status).toBe(400)
      expect(await respuesta.text()).toContain('{query}')
      expect(await readdir(dir)).toEqual([])
    })
  })

  test('una ruta absoluta dentro de la plantilla se rechaza', async () => {
    await conApp(async ({ altas }) => {
      const respuesta = await altas({
        ...DRAFT,
        endpoints: { ...DRAFT.endpoints, anime: 'https://otro.example/anime/{ref}' },
      })

      expect(respuesta.status).toBe(400)
    })
  })

  test('un cuerpo que no es JSON es un 400 explicable', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/providers', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: 'no soy json',
      })

      expect(respuesta.status).toBe(400)
      expect(await respuesta.text()).toContain('JSON')
    })
  })

  test('si el plugin no carga, se retira y se dice por qué', async () => {
    // El cargador se sustituye aquí a propósito: provocar un rechazo de verdad
    // exigiría escribir un plugin roto a mano, y lo que se está probando es la
    // retirada, no el loader.
    await conApp(
      async ({ altas, dir, pedir }) => {
        const respuesta = await altas(DRAFT)

        expect(respuesta.status).toBe(400)
        expect(await respuesta.text()).toContain('no conforma')

        // Ni queda el archivo, ni queda el proveedor activo: el alta no dejó
        // basura. El rechazo sí se ve en la lista, que es donde tiene que verse.
        expect(await readdir(dir)).toEqual([])
        const lista = providersResponseSchema.parse(await (await pedir('/api/providers')).json())
        expect(lista.providers.filter((p) => p.status === 'active')).toEqual([])
      },
      {
        loadPlugins: async (directory): Promise<LoadReport> => ({
          active: [],
          rejected: [
            {
              file: join(directory, 'mio.ts'),
              reason: providerFailure({
                providerId: 'mio',
                kind: 'invalid-shape',
                detail: 'no conforma',
              }),
            },
          ],
        }),
      },
    )
  })

  test('sin directorio de plugins la ruta no existe', async () => {
    const app = createApp({
      port: PORT,
      session: fakeSession(),
      bootToken: 'token',
      version: '0.1.0',
    })

    const respuesta = await app.request(`${BASE}/api/providers`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(DRAFT),
    })

    expect(respuesta.status).toBe(404)
  })
})
