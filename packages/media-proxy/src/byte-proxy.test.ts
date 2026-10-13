import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseRange, proxyBytes, upstreamFailure } from './byte-proxy'
import { ALLOWED_RESPONSE_HEADERS } from './response-headers'

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

  test('se declara del mismo origen, que es lo que abre los segmentos', async () => {
    const vistos: (string | null)[] = []
    const fake = upstream()

    // Un CDN con protección de hotlinking contesta 403 a `cross-site` y a la
    // ausencia de la cabecera: lo comprobado contra el de verdad es que sólo
    // `same-origin` devuelve el segmento.
    await proxy({
      url: ARCHIVO,
      headers: { 'Sec-Fetch-Site': 'cross-site', Referer: 'https://sitio.example' },
      fetchImpl: async (input: string, init: RequestInit) => {
        vistos.push(new Headers(init.headers).get('sec-fetch-site'))
        return fake.fetchImpl(input, init)
      },
    })

    expect(vistos).toEqual(['same-origin'])
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

describe('cuando el upstream no contesta', () => {
  test('si el cliente se va primero, 499 y ninguna excepción', async () => {
    const control = new AbortController()

    // Es lo que hace Bun: la petición al upstream se rechaza con el motivo del
    // `signal`, que cuando cierra el cliente es un `AbortError`. Sin la rama,
    // esto salía del proxy como un error del servidor con su pila.
    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      signal: control.signal,
      fetchImpl: async () => {
        control.abort()

        throw control.signal.reason
      },
    })

    expect(respuesta.status).toBe(499)
  })

  test('un fallo de verdad es 502 con el motivo y sin la URL', async () => {
    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      fetchImpl: async () => {
        throw new Error('ENOTFOUND')
      },
    })

    expect(respuesta.status).toBe(502)

    const cuerpo = (await respuesta.json()) as { error: string }
    expect(cuerpo.error).toContain('ENOTFOUND')
    expect(cuerpo.error).not.toContain('/aurora/1/sub.mp4')
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

describe('vigilante de inactividad', () => {
  /** Un upstream que manda un trozo y después se calla para siempre. */
  function dormido(init: RequestInit): Promise<Response> {
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4).fill(65))

        // El vigilante aborta la señal; el cuerpo del upstream hace lo que haría
        // un `fetch` de verdad al que le abortan la respuesta: termina en error.
        init.signal?.addEventListener(
          'abort',
          () => {
            controller.error(new Error('el upstream dejó de responder'))
          },
          { once: true },
        )
      },
      pull() {
        // Silencio. No se cierra: el upstream sigue conectado y sin mandar nada.
        return new Promise<void>(() => {})
      },
    })

    return Promise.resolve(
      new Response(cuerpo, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    )
  }

  test('un upstream que se duerme se corta y el cuerpo falla', async () => {
    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      idleTimeoutMs: 20,
      fetchImpl: (_url: string, init: RequestInit) => dormido(init),
    })

    const desenlace = await respuesta.arrayBuffer().then(
      () => 'completo',
      () => 'cortado',
    )

    expect(desenlace).toBe('cortado')
  })

  test('mientras el upstream dé señales de vida, la conexión sigue', async () => {
    // Cinco trozos cada 8 ms: 40 ms de reloj, más que el plazo de 15 ms. Pasa
    // sólo si el plazo se rearma con cada trozo. Un plazo total, que es el
    // arreglo obvio, mataría aquí la reproducción —y en la vida real, a los
    // treinta segundos de empezar una película.
    let enviados = 0

    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      idleTimeoutMs: 15,
      fetchImpl: (_url: string, init: RequestInit) => {
        const cuerpo = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (enviados >= 5) {
              controller.close()

              return
            }

            enviados += 1
            await Bun.sleep(8)

            // El upstream de verdad también se entera del abort: si el vigilante
            // cortó mientras dormía, el trozo no sale. Sin esto la prueba pasaría
            // con un plazo total, porque nadie rompería el cuerpo.
            if (init.signal?.aborted === true) {
              controller.error(new Error('el upstream dejó de responder'))

              return
            }

            controller.enqueue(new Uint8Array(4).fill(65))
          },
        })

        return Promise.resolve(
          new Response(cuerpo, { status: 200, headers: { 'content-type': 'video/mp4' } }),
        )
      },
    })

    const desenlace = await respuesta.arrayBuffer().then(
      () => `completo`,
      () => 'cortado',
    )

    expect(desenlace).toBe('completo')
  })

  test('un plazo de cero o menos lo desactiva, para poder medir otra cosa', async () => {
    const respuesta = await proxy({
      url: ARCHIVO,
      headers: {},
      idleTimeoutMs: 0,
      fetchImpl: () => dormido({}),
    })

    const lector = respuesta.body?.getReader()
    const primero = await lector?.read()

    expect(primero?.value?.byteLength).toBe(4)
    await lector?.cancel()
  })
})

describe('la salida por defecto', () => {
  /**
   * Un servidor de verdad en `127.0.0.1` y un nombre que no resuelve.
   *
   * Es lo que mide la mitad que el `fetch` de mentira no puede medir: que sin
   * `fetchImpl` el proxy **conecta a la dirección que validó el resolutor** y no
   * vuelve a preguntarle al DNS. Si volviera a preguntar —o si saliera por el
   * `fetch` global—, `pin.example.test` no resolvería y esto sería un 502.
   */
  async function servidorLocal(): Promise<{
    url: string
    cerrar: () => Promise<void>
    vistas: IncomingMessage[]
  }> {
    const vistas: IncomingMessage[] = []
    const servidor = createServer((req: IncomingMessage, res) => {
      vistas.push(req)
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end('bytes del video')
    })

    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
    const direccion = servidor.address()
    const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0

    return {
      url: `http://pin.example.test:${puerto}/v.mp4`,
      vistas,
      cerrar: async () => {
        await new Promise<void>((resolve) => servidor.close(() => resolve()))
      },
    }
  }

  test('conecta a la dirección validada y el nombre viaja en el `Host`', async () => {
    const local = await servidorLocal()

    try {
      const respuesta = await proxyBytes({
        url: local.url,
        headers: { Referer: 'https://sitio.example' },
        range: 'bytes=0-3',
        resolver: async () => ['127.0.0.1'],
        allowLoopback: true,
        idleTimeoutMs: 0,
      })

      expect(respuesta.status).toBe(200)
      expect(await respuesta.text()).toBe('bytes del video')
      expect(local.vistas).toHaveLength(1)
      expect(local.vistas[0]?.headers.host).toBe(`pin.example.test:${new URL(local.url).port}`)
      expect(local.vistas[0]?.headers.range).toBe('bytes=0-3')
      expect(local.vistas[0]?.headers['accept-encoding']).toBe('identity')
      expect(local.vistas[0]?.headers.referer).toBe('https://sitio.example')
    } finally {
      await local.cerrar()
    }
  })

  test('sin la excepción de loopback el destino se rechaza y el servidor no ve nada', async () => {
    const local = await servidorLocal()

    try {
      const respuesta = await proxyBytes({
        url: local.url,
        headers: {},
        resolver: async () => ['127.0.0.1'],
        idleTimeoutMs: 0,
      })

      expect(respuesta.status).toBe(502)
      expect(local.vistas).toHaveLength(0)
    } finally {
      await local.cerrar()
    }
  })
})
