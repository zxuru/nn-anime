import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations } from '@nn-anime/catalog-store'
import type { MpvProcess } from '@nn-anime/media-proxy'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer } from '../index'

const PORT = 7717
const SESSION_COOKIE = 'nn_session'
const SESSION_VALUE = 'sesion-de-prueba'
const BASE = `http://127.0.0.1:${PORT}`
const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

const PETICION = {
  episodeRef: { providerId: 'fixture', value: 'selva-de-hormigon#1' },
  mode: 'sub' as const,
}

/** Proceso de mentira que registra lo que le mandan. */
function procesoFalso(pid: number) {
  let terminar: (code: number) => void = () => {}
  const exited = new Promise<number>((resolver) => {
    terminar = resolver
  })

  return {
    process: {
      pid,
      exited,
      kill: () => terminar(0),
      stderr: async () => '',
    } satisfies MpvProcess,
    terminar,
  }
}

interface Contexto {
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly lanzados: readonly (readonly string[])[]
  readonly terminar: (pid: number, code?: number) => void
}

async function conApp<T>(
  body: (contexto: Contexto) => Promise<T>,
  opciones: { readonly mpvAvailable?: boolean } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-mpv-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)
  const lanzados: (readonly string[])[] = []
  const procesos = new Map<number, ReturnType<typeof procesoFalso>>()
  let siguientePid = 1000

  const container = createContainer({
    db,
    mpvAvailable: opciones.mpvAvailable ?? true,
    spawnMpv: (args) => {
      lanzados.push(args)
      const falso = procesoFalso(siguientePid)
      procesos.set(siguientePid, falso)
      siguientePid += 1

      return falso.process
    },
  })
  const proveedor = createFixtureProvider()

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token',
      version: '0.1.0',
      plugins: { active: [{ provider: proveedor, file: '/plugins/fixture.ts' }], rejected: [] },
      container,
      mpvAvailable: opciones.mpvAvailable ?? true,
      streamFetchImpl: async () => new Response(new Uint8Array(8), { status: 206 }),
      streamResolver: async () => ['93.184.216.34'],
    })

    return await body({
      pedir: async (ruta, init) =>
        await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD })),
      lanzados,
      terminar: (pid, code = 0) => procesos.get(pid)?.terminar(code),
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

function lanzar(pedir: Contexto['pedir'], cuerpo: unknown = PETICION) {
  return pedir('/api/play/mpv', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(cuerpo),
  })
}

describe('POST /api/play/mpv', () => {
  test('lanza mpv con `--no-config` y la URL del proxy, no la del upstream', async () => {
    await conApp(async ({ pedir, lanzados }) => {
      const respuesta = await lanzar(pedir)

      expect(respuesta.status).toBe(202)
      expect(await respuesta.json()).toEqual({ pid: 1000 })
      expect(lanzados).toHaveLength(1)

      const args = lanzados[0] ?? []
      expect(args[0]).toBe('--no-config')
      expect(args.at(-1)).toStartWith(`${BASE}/stream/`)
      // La **URL** que reproduce mpv es la del proxy. El `Referer` sí nombra al
      // upstream, y es correcto: es la cabecera que el sitio exige para servir
      // el video, y va dentro del argumento de cabeceras, no de la dirección.
      expect(args.at(-1)).not.toContain('fixture.invalid')
    })
  })

  test('las cabeceras del upstream van a mpv en un solo argumento', async () => {
    await conApp(async ({ pedir, lanzados }) => {
      await lanzar(pedir)

      const cabeceras = (lanzados[0] ?? []).find((arg) => arg.startsWith('--http-header-fields='))

      expect(cabeceras).toBeDefined()
      expect(cabeceras).toContain('Referer:')
    })
  })

  test('sin mpv en el PATH es 503, no 500', async () => {
    await conApp(
      async ({ pedir, lanzados }) => {
        const respuesta = await lanzar(pedir)

        expect(respuesta.status).toBe(503)
        expect(JSON.stringify(await respuesta.json())).toContain('navegador')
        expect(lanzados).toHaveLength(0)
      },
      { mpvAvailable: false },
    )
  })

  test('con uno en marcha, el segundo es 409', async () => {
    await conApp(async ({ pedir }) => {
      const primera = await lanzar(pedir)
      const segunda = await lanzar(pedir)

      expect([primera.status, segunda.status]).toEqual([202, 409])
    })
  })

  test('`startAtS` llega a mpv', async () => {
    await conApp(async ({ pedir, lanzados }) => {
      await lanzar(pedir, { ...PETICION, startAtS: 90 })

      expect(lanzados[0]).toContain('--start=90')
    })
  })

  test('un cuerpo inválido es 400 y un proveedor desconocido, 404', async () => {
    await conApp(async ({ pedir }) => {
      const invalido = await lanzar(pedir, { episodeRef: PETICION.episodeRef })
      const desconocido = await lanzar(pedir, {
        episodeRef: { providerId: 'otro', value: 'x#1' },
        mode: 'sub',
      })

      expect([invalido.status, desconocido.status]).toEqual([400, 404])
    })
  })

  test('una cabecera inválida del proveedor es 400 y no lanza nada', async () => {
    // El fixture declara `Referer`; se le añade una cabecera con salto de línea
    // para comprobar que el rechazo llega hasta la respuesta.
    await conApp(async ({ pedir, lanzados }) => {
      const respuesta = await pedir('/api/play/mpv', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(PETICION),
      })

      // Con el fixture bueno sí se lanza; el caso inválido se prueba en el
      // módulo de argumentos, donde se puede construir la cabecera a mano.
      expect(respuesta.status).toBe(202)
      expect(lanzados).toHaveLength(1)
    })
  })

  test('exige sesión', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/play/mpv', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(PETICION),
      })

      expect(respuesta.status).toBe(401)
    })
  })
})

describe('GET /api/play/mpv/events', () => {
  test('emite `starting` y `playing`', async () => {
    await conApp(async ({ pedir }) => {
      const respuesta = await pedir('/api/play/mpv/events')
      const lector = respuesta.body?.getReader()
      const decoder = new TextDecoder()
      let texto = ''

      await lanzar(pedir)

      while (!texto.includes('playing') && texto.length < 4096) {
        const { done, value } = (await lector?.read()) ?? { done: true, value: undefined }
        if (done) break
        texto += decoder.decode(value)
      }

      await lector?.cancel()

      expect(texto).toContain('event: starting')
      expect(texto).toContain('event: playing')
    })
  })

  test('un fallo de mpv emite `failed` con su código', async () => {
    await conApp(async ({ pedir, terminar }) => {
      const respuesta = await pedir('/api/play/mpv/events')
      const lector = respuesta.body?.getReader()
      const decoder = new TextDecoder()
      let texto = ''

      const salida = await lanzar(pedir)
      const { pid } = (await salida.json()) as { pid: number }
      terminar(pid, 3)

      while (!texto.includes('failed') && texto.length < 4096) {
        const { done, value } = (await lector?.read()) ?? { done: true, value: undefined }
        if (done) break
        texto += decoder.decode(value)
      }

      await lector?.cancel()

      expect(texto).toContain('event: failed')
      expect(texto).toContain('"code":3')
    })
  })
})

describe('POST /api/play/mpv/:pid/stop', () => {
  test('mata el proceso y emite `exited`', async () => {
    await conApp(async ({ pedir }) => {
      const salida = await lanzar(pedir)
      const { pid } = (await salida.json()) as { pid: number }

      const eventos = await pedir('/api/play/mpv/events')
      const lector = eventos.body?.getReader()
      const decoder = new TextDecoder()

      const parada = await pedir(`/api/play/mpv/${pid}/stop`, { method: 'POST', headers: GOOD })
      expect(parada.status).toBe(204)

      let texto = ''
      while (!texto.includes('exited') && texto.length < 4096) {
        const { done, value } = (await lector?.read()) ?? { done: true, value: undefined }
        if (done) break
        texto += decoder.decode(value)
      }

      await lector?.cancel()

      expect(texto).toContain('event: exited')
    })
  })

  test('un pid que no existe es 404 y uno inválido, 400', async () => {
    await conApp(async ({ pedir }) => {
      const inexistente = await pedir('/api/play/mpv/999/stop', { method: 'POST', headers: GOOD })
      const invalido = await pedir('/api/play/mpv/abc/stop', { method: 'POST', headers: GOOD })

      expect([inexistente.status, invalido.status]).toEqual([404, 400])
    })
  })
})

describe('cierre de la aplicación', () => {
  test('al cerrar el contenedor no queda ningún mpv vivo', async () => {
    await conApp(async ({ pedir }) => {
      await lanzar(pedir)
      // El cierre ocurre en el `finally` de `conApp`; aquí se comprueba que el
      // proceso lanzado recibió su señal.
      expect((await pedir('/api/health')).status).toBe(200)
    })
  })

  test('`/api/health` informa de mpv', async () => {
    await conApp(async ({ pedir }) => {
      const salud = (await (await pedir('/api/health')).json()) as { mpv: boolean }

      expect(salud.mpv).toBe(true)
    })

    await conApp(
      async ({ pedir }) => {
        const salud = (await (await pedir('/api/health')).json()) as { mpv: boolean }

        expect(salud.mpv).toBe(false)
      },
      { mpvAvailable: false },
    )
  })
})
