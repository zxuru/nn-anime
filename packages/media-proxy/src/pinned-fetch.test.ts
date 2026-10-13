import { describe, expect, test } from 'bun:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  createPinnedFetch,
  type PinnedRequestOptions,
  type RequestLike,
  type UpstreamRequest,
  type UpstreamResponse,
} from './pinned-fetch'

/**
 * La conexión fijada, medida.
 *
 * Dos capas, a propósito:
 *
 * - La **costura**: un `requestImpl` de mentira que hace lo que hace Node —pedir
 *   la dirección al `lookup` y con ella contestar— para poder mirar qué se le
 *   pidió, cuántas veces se resolvió el nombre y qué llega al cuerpo sin abrir un
 *   socket.
 * - Un **socket de verdad** contra un servidor en `127.0.0.1`, porque la costura
 *   sola no demuestra que la conexión vaya a la dirección validada: eso sólo se
 *   ve cuando el nombre no resuelve y la respuesta llega igual.
 */

interface Direccion {
  readonly address: string
  readonly family: number
}

/** Espera el rechazo y devuelve el error, sin conversiones de tipo. */
async function rechazoDe(promesa: Promise<unknown>): Promise<Error> {
  try {
    await promesa
  } catch (causa) {
    if (causa instanceof Error) return causa

    throw causa
  }

  throw new Error('la promesa no rechazó, y tenía que hacerlo')
}

/** Un resolutor que cuenta cuántas veces se le preguntó. */
function resolverContado(direcciones: readonly string[]): {
  resolver: (host: string) => Promise<readonly string[]>
  veces: () => number
} {
  let veces = 0

  return {
    resolver: async () => {
      veces += 1

      return direcciones
    },
    veces: () => veces,
  }
}

/** Una respuesta de mentira, que emite lo que le digan cuando se lo digan. */
interface Emisor {
  readonly respuesta: UpstreamResponse
  trozo(dato: string): void
  terminar(): void
  fallar(causa: Error): void
  destruida(): boolean
}

function emisorFalso(status: number, headers: Record<string, string | string[]>): Emisor {
  let alDato: ((dato: Uint8Array) => void) | undefined
  let alFin: (() => void) | undefined
  let alError: ((causa: Error) => void) | undefined
  let destruida = false

  return {
    respuesta: {
      statusCode: status,
      headers,
      onData: (escucha) => {
        alDato = escucha
      },
      onEnd: (escucha) => {
        alFin = escucha
      },
      onError: (escucha) => {
        alError = escucha
      },
      destroy: () => {
        destruida = true
      },
    },
    trozo: (dato) => alDato?.(new TextEncoder().encode(dato)),
    terminar: () => alFin?.(),
    fallar: (causa) => alError?.(causa),
    destruida: () => destruida,
  }
}

interface Banco {
  readonly requestImpl: RequestLike
  /** Lo que se le pidió a Node, en orden. */
  readonly pedidos: PinnedRequestOptions[]
  /** Las direcciones que devolvió el `lookup`, en orden. */
  readonly direcciones: Direccion[][]
  /** El emisor de la última respuesta, para cortarla desde la prueba. */
  readonly ultimoEmisor: () => Emisor | undefined
  /** Cuántas veces se destruyó la petición. */
  readonly destruidas: () => number
  /** El `error` de la petición: conexión rechazada, por ejemplo. */
  fallarPeticion(causa: Error): void
  responderCon(status: number, headers: Record<string, string | string[]>, trozos: string[]): void
  /** Contesta, manda los trozos y **no** termina el cuerpo. */
  responderSinTerminar(status: number, headers: Record<string, string | string[]>): void
}

/**
 * Un `requestImpl` que imita a Node: al enviarse, pregunta al `lookup` por la
 * dirección y con lo que responda contesta.
 *
 * La resolución del nombre la hace el `lookup` que construye `createPinnedFetch`,
 * que es justo lo que se quiere medir: aquí no se resuelve nada por cuenta
 * propia, igual que no lo hace Node.
 */
function banco(): Banco {
  const pedidos: PinnedRequestOptions[] = []
  const direcciones: Direccion[][] = []
  let alFallar: ((causa: Error) => void) | undefined
  let alResponder: ((respuesta: UpstreamResponse) => void) | undefined
  let emisor: Emisor | undefined
  let destruidas = 0
  let configuracion: {
    status: number
    headers: Record<string, string | string[]>
    trozos: string[]
    terminar: boolean
  } = { status: 200, headers: {}, trozos: [], terminar: true }

  const requestImpl: RequestLike = (opciones, onResponse) => {
    pedidos.push(opciones)
    alResponder = onResponse

    const peticion: UpstreamRequest = {
      onError: (escucha) => {
        alFallar = escucha
      },
      destroy: () => {
        destruidas += 1
      },
      end: () => {
        opciones.lookup(opciones.host, { family: 0 }, (err, address) => {
          if (err !== null) {
            // Lo mismo que Node: un `lookup` que falla sale por el `error` de la
            // petición, no por una respuesta.
            alFallar?.(err)

            return
          }

          const lista: Direccion[] =
            typeof address === 'string'
              ? [{ address, family: 4 }]
              : address.map((una) => ({ address: una.address, family: una.family }))
          direcciones.push(lista)

          const nuevo = emisorFalso(configuracion.status, configuracion.headers)
          emisor = nuevo
          alResponder?.(nuevo.respuesta)

          // Después de enganchar: los trozos se emiten cuando ya hay quien lea.
          for (const trozo of configuracion.trozos) nuevo.trozo(trozo)
          if (configuracion.terminar) nuevo.terminar()
        })
      },
    }

    return peticion
  }

  return {
    requestImpl,
    pedidos,
    direcciones,
    ultimoEmisor: () => emisor,
    destruidas: () => destruidas,
    fallarPeticion: (causa) => alFallar?.(causa),
    responderCon: (status, headers, trozos) => {
      configuracion = { status, headers, trozos, terminar: true }
    },
    responderSinTerminar: (status, headers) => {
      configuracion = { status, headers, trozos: [], terminar: false }
    },
  }
}

/** Lee el cuerpo entero por trozos, para poder contar cuántos llegaron. */
async function trozosDe(respuesta: Response): Promise<string[]> {
  const lector = respuesta.body?.getReader()
  if (lector === undefined) return []

  const vistos: string[] = []
  for (;;) {
    const paso = await lector.read()
    if (paso.done === true) break
    vistos.push(new TextDecoder().decode(paso.value))
  }

  return vistos
}

describe('la conexión va a la dirección validada', () => {
  test('el nombre se resuelve una vez y la conexión usa lo que devolvió', async () => {
    const doble = banco()
    doble.responderCon(200, { 'content-type': 'video/mp4' }, ['hola'])
    const contado = resolverContado(['93.184.216.34'])

    const respuesta = await createPinnedFetch({
      resolver: contado.resolver,
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    expect(await respuesta.text()).toBe('hola')
    expect(contado.veces()).toBe(1)
    expect(doble.direcciones).toEqual([[{ address: '93.184.216.34', family: 4 }]])
    // El nombre sigue siendo el nombre: es lo que va en el `Host`.
    expect(doble.pedidos[0]?.host).toBe('sitio.example')
    expect(doble.pedidos[0]?.path).toBe('/v.mp4')
  })

  test('en https el nombre viaja en el SNI y no se apaga la verificación del certificado', async () => {
    const doble = banco()
    doble.responderCon(200, {}, ['ok'])

    await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('https://sitio.example/v.mp4')

    expect(doble.pedidos[0]?.protocol).toBe('https:')
    expect(doble.pedidos[0]?.servername).toBe('sitio.example')
    expect(doble.pedidos[0]?.port).toBe(443)
    // Si alguien apaga la verificación para «que funcione», esto lo dice.
    expect(Object.keys(doble.pedidos[0] ?? {})).not.toContain('rejectUnauthorized')
  })

  test('el puerto y el esquema salen de la URL, y http no lleva SNI', async () => {
    const doble = banco()
    doble.responderCon(200, {}, ['ok'])

    await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example:8080/v.mp4')

    expect(doble.pedidos[0]?.protocol).toBe('http:')
    expect(doble.pedidos[0]?.port).toBe(8080)
    expect(doble.pedidos[0]?.servername).toBeUndefined()
  })

  test('entre una IPv6 y una IPv4 elige la IPv4', async () => {
    const doble = banco()
    doble.responderCon(200, {}, ['ok'])

    await createPinnedFetch({
      resolver: async () => ['2606:4700::1111', '93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    expect(doble.direcciones).toEqual([[{ address: '93.184.216.34', family: 4 }]])
  })
})

describe('todas las respuestas del DNS se juzgan', () => {
  const rechaza = async (
    direcciones: readonly string[],
    allowLoopback?: boolean,
  ): Promise<Error> => {
    const doble = banco()

    return await rechazoDe(
      createPinnedFetch({
        resolver: async () => direcciones,
        requestImpl: doble.requestImpl,
        ...(allowLoopback === undefined ? {} : { allowLoopback }),
      })('http://sitio.example/v.mp4'),
    )
  }

  test('una respuesta interna entre varias públicas rechaza el destino', async () => {
    const causa = await rechaza(['93.184.216.34', '10.0.0.1'])

    expect(causa.message).toContain('private')
    expect((await rechaza(['127.0.0.1'])).message).toContain('loopback')
  })

  test('una IPv4 embebida en IPv6 se juzga como la IPv4 que es', async () => {
    expect((await rechaza(['::ffff:7f00:1'])).message).toContain('loopback')
  })

  test('un resolutor que falla es un error de DNS, no una conexión a ciegas', async () => {
    const doble = banco()
    const causa = await rechazoDe(
      createPinnedFetch({
        resolver: async () => {
          throw new Error('NXDOMAIN')
        },
        requestImpl: doble.requestImpl,
      })('http://sitio.example/v.mp4'),
    )

    expect(causa.message).toContain('dns')
    expect(doble.direcciones).toEqual([])
  })
})

describe('la excepción de loopback', () => {
  const conecta = async (direcciones: readonly string[]): Promise<boolean> => {
    const doble = banco()
    doble.responderCon(200, {}, ['ok'])

    return await createPinnedFetch({
      resolver: async () => direcciones,
      requestImpl: doble.requestImpl,
      allowLoopback: true,
    })('http://sitio.example/v.mp4').then(
      () => true,
      () => false,
    )
  }

  test('abre loopback y red privada', async () => {
    expect(await conecta(['127.0.0.1'])).toBe(true)
    expect(await conecta(['10.0.0.1'])).toBe(true)
  })

  test('no abre la metadata de nube ni link-local', async () => {
    expect(await conecta(['169.254.169.254'])).toBe(false)
    expect(await conecta(['169.254.1.1'])).toBe(false)
  })
})

describe('el cuerpo', () => {
  test('los trozos llegan por separado, sin acumularse', async () => {
    const doble = banco()
    doble.responderCon(200, { 'content-type': 'video/mp4' }, ['uno', 'dos', 'tres'])

    const respuesta = await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    expect(await trozosDe(respuesta)).toEqual(['uno', 'dos', 'tres'])
  })

  test('un 204 y un HEAD no traen cuerpo', async () => {
    const doble = banco()
    doble.responderCon(204, {}, [])
    const fetchFijado = createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })

    expect((await fetchFijado('http://sitio.example/v.mp4')).body).toBeNull()

    const otro = banco()
    otro.responderCon(200, {}, ['no debería llegar'])
    const conHead = createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: otro.requestImpl,
    })

    expect((await conHead('http://sitio.example/v.mp4', { method: 'HEAD' })).body).toBeNull()
  })

  test('cancelar corta la conexión con el upstream', async () => {
    const doble = banco()
    doble.responderSinTerminar(200, {})

    const respuesta = await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    await respuesta.body?.cancel()

    expect(doble.ultimoEmisor()?.destruida()).toBe(true)
    expect(doble.destruidas()).toBe(1)
  })

  test('las cabeceras que vienen repetidas no se pierden', async () => {
    const doble = banco()
    doble.responderCon(200, { 'set-cookie': ['a=1', 'b=2'], 'content-type': 'video/mp4' }, [])

    const respuesta = await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    expect(respuesta.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    expect(respuesta.headers.get('content-type')).toBe('video/mp4')
  })

  test('un corte a mitad de cuerpo no se toma por un final limpio', async () => {
    const doble = banco()
    doble.responderSinTerminar(200, { 'content-length': '100' })

    const respuesta = await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    // El emisor manda un trozo y después se corta, como un upstream que se muere.
    doble.ultimoEmisor()?.trozo('cinco')
    doble.ultimoEmisor()?.fallar(new Error('el upstream cortó la respuesta antes de terminarla'))

    const desenlace = await trozosDe(respuesta).then(
      () => 'completo',
      () => 'cortado',
    )

    expect(desenlace).toBe('cortado')
  })
})

describe('lo que no hace', () => {
  test('no sigue redirecciones: devuelve el 3xx tal cual, con su `location`', async () => {
    const doble = banco()
    doble.responderCon(302, { location: 'http://otro.example/v.mp4' }, [])

    const respuesta = await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    expect(respuesta.status).toBe(302)
    expect(respuesta.headers.get('location')).toBe('http://otro.example/v.mp4')
  })

  test('rechaza un esquema que no sea http o https, sin abrir nada', async () => {
    const doble = banco()
    const causa = await rechazoDe(
      createPinnedFetch({
        resolver: async () => ['93.184.216.34'],
        requestImpl: doble.requestImpl,
      })('file:///etc/passwd'),
    )

    expect(causa.message).toContain('scheme')
    expect(doble.pedidos).toEqual([])
  })

  test('un cuerpo de petición no se pierde en silencio: se rechaza', async () => {
    const doble = banco()
    const causa = await rechazoDe(
      createPinnedFetch({
        resolver: async () => ['93.184.216.34'],
        requestImpl: doble.requestImpl,
      })('http://sitio.example/v.mp4', { method: 'POST', body: 'algo' }),
    )

    expect(causa.message).toContain('cuerpo')
    expect(doble.pedidos).toEqual([])
  })

  test('un error de la conexión rechaza la petición', async () => {
    const doble = banco()
    const promesa = createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4')

    doble.fallarPeticion(new Error('conexión rechazada'))

    expect((await rechazoDe(promesa)).message).toContain('conexión rechazada')
  })

  test('abortar antes de enviar rechaza y no abre nada', async () => {
    const doble = banco()
    const controlador = new AbortController()
    controlador.abort()

    const causa = await rechazoDe(
      createPinnedFetch({
        resolver: async () => ['93.184.216.34'],
        requestImpl: doble.requestImpl,
      })('http://sitio.example/v.mp4', { signal: controlador.signal }),
    )

    expect(causa.message).toContain('abortado')
    expect(doble.direcciones).toEqual([])
  })

  test('abortar a mitad destruye la petición', async () => {
    const doble = banco()
    doble.responderSinTerminar(200, {})
    const controlador = new AbortController()

    const respuesta = await createPinnedFetch({
      resolver: async () => ['93.184.216.34'],
      requestImpl: doble.requestImpl,
    })('http://sitio.example/v.mp4', { signal: controlador.signal })

    controlador.abort()

    expect(doble.destruidas()).toBe(1)
    expect(respuesta.status).toBe(200)
  })
})

/** Un servidor de verdad en `127.0.0.1`, con las peticiones que recibió. */
async function servidorLocal(cuerpo: string): Promise<{
  url: string
  cerrar: () => Promise<void>
  vistas: IncomingMessage[]
  conexiones: () => number
}> {
  const vistas: IncomingMessage[] = []
  let conexiones = 0
  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    vistas.push(req)
    res.writeHead(200, { 'content-type': 'video/mp4' })
    res.end(cuerpo)
  })
  servidor.on('connection', () => {
    conexiones += 1
  })

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  const direccion = servidor.address()
  const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0

  return {
    url: `http://pin.example.test:${puerto}/v.mp4`,
    vistas,
    conexiones: () => conexiones,
    cerrar: async () => {
      await new Promise<void>((resolve) => servidor.close(() => resolve()))
    },
  }
}

describe('contra un socket de verdad', () => {
  test('el nombre no resuelve y la respuesta llega: se conectó a la dirección validada', async () => {
    const local = await servidorLocal('bytes del video')

    try {
      const respuesta = await createPinnedFetch({
        resolver: async () => ['127.0.0.1'],
        allowLoopback: true,
      })(local.url)

      expect(respuesta.status).toBe(200)
      expect(await respuesta.text()).toBe('bytes del video')
      // El `Host` que vio el servidor es el nombre, no la dirección, así que el
      // certificado de un https se validaría contra el nombre.
      expect(local.vistas[0]?.headers.host).toBe(`pin.example.test:${new URL(local.url).port}`)
    } finally {
      await local.cerrar()
    }
  })

  test('sin la excepción, el mismo destino se rechaza antes de conectar', async () => {
    const local = await servidorLocal('no debería llegar')

    try {
      const causa = await rechazoDe(
        createPinnedFetch({ resolver: async () => ['127.0.0.1'] })(local.url),
      )

      expect(causa.message).toContain('loopback')
      expect(local.vistas).toHaveLength(0)
    } finally {
      await local.cerrar()
    }
  })

  test('cada petición abre su conexión: ninguna reutilizada se salta el pin', async () => {
    const local = await servidorLocal('ok')

    try {
      const fetchFijado = createPinnedFetch({
        resolver: async () => ['127.0.0.1'],
        allowLoopback: true,
      })

      await (await fetchFijado(local.url)).text()
      await (await fetchFijado(local.url)).text()

      // Una conexión tiene una sola `lookup`: la que se validó. Reutilizarla
      // para la petición siguiente sería salir por una dirección que no se
      // volvió a juzgar, y por eso el agente va apagado.
      expect(local.vistas).toHaveLength(2)
      expect(local.conexiones()).toBe(2)
    } finally {
      await local.cerrar()
    }
  })

  test('un servidor que se corta a mitad de cuerpo no da un final limpio', async () => {
    const servidor = createServer((_req: IncomingMessage, res: ServerResponse) => {
      // Declara cien bytes y manda cinco: el cliente tiene que notar el corte.
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '100' })
      res.write('cinco')
      setTimeout(() => res.destroy(), 10)
    })

    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
    const direccion = servidor.address()
    const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0

    try {
      const respuesta = await createPinnedFetch({
        resolver: async () => ['127.0.0.1'],
        allowLoopback: true,
      })(`http://pin.example.test:${puerto}/v.mp4`)

      const desenlace = await respuesta.text().then(
        () => 'completo',
        () => 'cortado',
      )

      expect(desenlace).toBe('cortado')
    } finally {
      await new Promise<void>((resolve) => servidor.close(() => resolve()))
    }
  })
})
