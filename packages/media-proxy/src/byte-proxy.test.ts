import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ALLOWED_RESPONSE_HEADERS, parseRange, proxyBytes, upstreamFailure } from './byte-proxy'

// No se llama `URL`: eso taparía el constructor global y `new URL` deja de
// compilar. Lo cazó el compilador.
const ARCHIVO = 'https://fixture.invalid/aurora/1/sub.mp4'
const ROOT = fileURLToPath(new URL('.', import.meta.url))

/** Upstream de mentira: un cuerpo por trozos que se puede cancelar. */
function upstream(
  options: {
    status?: number
    headers?: Record<string, string>
    chunks?: number
    size?: number
    onCancel?: () => void
    onPull?: () => void
  } = {},
) {
  const trozos = options.chunks ?? 4
  const tamano = options.size ?? 16
  let enviados = 0

  return {
    fetchImpl: async (_url: string, _init?: RequestInit) => {
      const cuerpo = new ReadableStream<Uint8Array>({
        pull(controller) {
          options.onPull?.()
          if (enviados >= trozos) {
            controller.close()
            return
          }

          enviados += 1
          controller.enqueue(new Uint8Array(tamano).fill(65))
        },
        cancel() {
          options.onCancel?.()
        },
      })

      return new Response(cuerpo, {
        status: options.status ?? 200,
        headers: options.headers ?? { 'content-type': 'video/mp4' },
      })
    },
    get enviados() {
      return enviados
    },
  }
}

/**
 * El proxy, con un resolutor de mentira.
 *
 * La lista blanca de destinos resuelve el nombre antes de dejar salir, así que
 * sin esto cada prueba intentaría un DNS de verdad contra `fixture.invalid`.
 */
function proxy(options: Parameters<typeof proxyBytes>[0]): Promise<Response> {
  return proxyBytes({ resolver: async () => ['93.184.216.34'], ...options })
}

describe('validación del rango', () => {
  test('sin cabecera no hay rango', () => {
    expect(parseRange(undefined)).toEqual({ ok: true, range: undefined })
    expect(parseRange('   ')).toEqual({ ok: true, range: undefined })
  })

  test('acepta las tres formas del spec', () => {
    expect(parseRange('bytes=0-1023')).toEqual({ ok: true, range: 'bytes=0-1023' })
    expect(parseRange('bytes=1024-')).toEqual({ ok: true, range: 'bytes=1024-' })
    expect(parseRange('bytes=-500')).toEqual({ ok: true, range: 'bytes=-500' })
  })

  test('recorta los espacios de los extremos', () => {
    expect(parseRange('  bytes=0-10  ')).toEqual({ ok: true, range: 'bytes=0-10' })
  })

  test('rechaza varios rangos', () => {
    const salida = parseRange('bytes=0-1,5-6')

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.reason).toContain('varios')
  })

  test('rechaza un rango al revés', () => {
    const salida = parseRange('bytes=100-10')

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.reason).toContain('anterior')
  })

  test('rechaza un sufijo de cero bytes y una forma que no es la del spec', () => {
    expect(parseRange('bytes=-0').ok).toBe(false)
    expect(parseRange('items=0-10').ok).toBe(false)
    expect(parseRange('bytes=abc-def').ok).toBe(false)
    expect(parseRange('bytes=').ok).toBe(false)
    expect(parseRange('bytes=1-2-3').ok).toBe(false)
  })

  test('rechaza números que no caben en un entero seguro', () => {
    expect(parseRange('bytes=99999999999999999999-').ok).toBe(false)
  })
})

describe('reenvío de bytes', () => {
  test('un rango válido viaja al upstream y su 206 vuelve con Content-Range', async () => {
    const visto: string[] = []
    const fake = upstream({
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-15/1024' },
    })

    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      range: 'bytes=0-15',
      fetchImpl: async (input: string, init: RequestInit) => {
        visto.push(new Headers(init.headers).get('range') ?? '')
        return fake.fetchImpl(input, init)
      },
    })

    expect(visto).toEqual(['bytes=0-15'])
    expect(respuesta.status).toBe(206)
    expect(respuesta.headers.get('content-range')).toBe('bytes 0-15/1024')
    expect(respuesta.headers.get('content-type')).toBe('video/mp4')
  })

  test('si el upstream no da rango, se degrada a 200 sin inventarlo', async () => {
    const fake = upstream({ status: 200 })
    const respuesta = await proxy({ url: ARCHIVO, headers: {}, fetchImpl: fake.fetchImpl })

    expect(respuesta.status).toBe(200)
    expect(respuesta.headers.get('content-range')).toBeNull()
  })

  test('fuerza Accept-Encoding: identity y no la copia del cliente', async () => {
    const vistos: (string | null)[] = []
    const fake = upstream()

    await proxy({
      url: ARCHIVO,
      headers: { 'Accept-Encoding': 'gzip, br', Referer: 'https://sitio.example' },
      fetchImpl: async (input: string, init: RequestInit) => {
        vistos.push(new Headers(init.headers).get('accept-encoding'))
        return fake.fetchImpl(input, init)
      },
    })

    expect(vistos).toEqual(['identity'])
  })

  test('los headers del proveedor viajan al upstream', async () => {
    const enviadas: Record<string, string> = {}
    const fake = upstream()

    await proxy({
      url: ARCHIVO,
      headers: { Referer: 'https://sitio.example', 'User-Agent': 'nn-anime' },
      fetchImpl: async (input: string, init: RequestInit) => {
        const cabeceras = new Headers(init.headers)
        for (const nombre of ['referer', 'user-agent']) {
          enviadas[nombre] = cabeceras.get(nombre) ?? ''
        }
        return fake.fetchImpl(input, init)
      },
    })

    expect(enviadas).toEqual({ referer: 'https://sitio.example', 'user-agent': 'nn-anime' })
  })

  test('sólo pasan las cabeceras de la lista blanca', async () => {
    const fake = upstream({
      headers: {
        'content-type': 'video/mp4',
        'content-length': '64',
        'accept-ranges': 'bytes',
        etag: '"abc"',
        'set-cookie': 'sesion=robada; Path=/',
        'x-secreto': 'no debería salir',
        server: 'nginx',
      },
    })

    const respuesta = await proxy({ url: ARCHIVO, headers: {}, fetchImpl: fake.fetchImpl })
    const nombres = [...respuesta.headers.keys()].sort()

    // Todas las que llegan están en la lista blanca; las de fuera no aparecen.
    for (const nombre of nombres) {
      expect([...ALLOWED_RESPONSE_HEADERS, 'x-content-type-options'], nombre).toContain(nombre)
    }

    expect(nombres).toContain('content-type')
    expect(nombres).toContain('etag')
    expect(nombres).not.toContain('set-cookie')
    expect(nombres).not.toContain('x-secreto')
    expect(nombres).not.toContain('server')
    expect(respuesta.headers.get('set-cookie')).toBeNull()
    expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('un cuerpo que no se puede leer no rompe la respuesta', async () => {
    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
    })

    expect(respuesta.status).toBe(204)
  })

  test('el cuerpo llega entero, por trozos', async () => {
    const fake = upstream({ chunks: 5, size: 10 })
    const respuesta = await proxy({ url: ARCHIVO, headers: {}, fetchImpl: fake.fetchImpl })
    const bytes = new Uint8Array(await respuesta.arrayBuffer())

    expect(bytes.length).toBe(50)
  })
})

describe('rango inválido', () => {
  test('un rango imposible da 416 sin llegar al upstream', async () => {
    let llamadas = 0

    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      range: 'bytes=0-1,5-6',
      fetchImpl: async () => {
        llamadas += 1
        return new Response('no debería llegar aquí')
      },
    })

    expect(respuesta.status).toBe(416)
    expect(llamadas).toBe(0)
  })
})

describe('cancelación y memoria', () => {
  test('al cortar el cliente, el upstream se cancela', async () => {
    let cancelado = false
    const fake = upstream({
      chunks: 1000,
      size: 1024,
      onCancel: () => {
        cancelado = true
      },
    })
    const respuesta = await proxy({ url: ARCHIVO, headers: {}, fetchImpl: fake.fetchImpl })

    const lector = respuesta.body?.getReader()
    expect(lector).toBeDefined()
    await lector?.read()
    await lector?.cancel()

    for (let intento = 0; intento < 50 && !cancelado; intento++) await Bun.sleep(5)

    expect(cancelado).toBe(true)
  })

  test('un cuerpo enorme no se acumula en memoria', async () => {
    // 200 MB por trozos de 1 MB: si el proxy acumulara el cuerpo, la memoria
    // subiría más de lo que este umbral permite.
    const fake = upstream({ chunks: 200, size: 1024 * 1024 })
    const antes = process.memoryUsage().rss

    const respuesta = await proxy({ url: ARCHIVO, headers: {}, fetchImpl: fake.fetchImpl })
    const lector = respuesta.body?.getReader()
    let total = 0

    while (true) {
      const { done, value } = (await lector?.read()) ?? { done: true, value: undefined }
      if (done) break
      total += value?.length ?? 0
    }

    const crecimiento = process.memoryUsage().rss - antes

    expect(total).toBe(200 * 1024 * 1024)
    expect(crecimiento).toBeLessThan(64 * 1024 * 1024)
  })

  test('el código no acumula el cuerpo en ninguna parte', async () => {
    const fuente = await readFile(`${ROOT}byte-proxy.ts`, 'utf8')
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(codigo).not.toContain('arrayBuffer')
    expect(codigo).not.toContain('Buffer.concat')
    expect(codigo).toContain('pipeTo')
  })

  test('el error de upstream nombra el host y nada más', () => {
    const error = upstreamFailure('https://fixture.invalid/a/b.mp4', new Error('sin ruta'))

    expect(error.message).toContain('sin ruta')
    expect(error.context.host).toBe('fixture.invalid')
    expect(JSON.stringify(error.context)).not.toContain('/a/b.mp4')
  })
})
