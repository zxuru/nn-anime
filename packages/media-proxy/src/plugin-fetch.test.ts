/**
 * La capacidad de red, sin salir a la red.
 *
 * Todo entra por opciones —el resolutor y el conector—, así que estas pruebas no
 * tocan el DNS ni abren un socket: el DNS es un mapa y la conexión es una cadena
 * de bytes que se suelta en trozos. Lo que se mide es la decisión —a dónde se
 * conecta, qué se lee, qué cruza un salto—, no el transporte.
 *
 * `203.0.113.0/24` es TEST-NET-3: la documentación la reserva para ejemplos, así
 * que ninguna de estas direcciones existe de verdad.
 */
import { describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import type { PluginFetch } from '@nn-anime/core'
import type { Resolver } from './destination-guard'
import {
  type ConnectTarget,
  connectorCon,
  createPluginFetch,
  type PluginTransport,
  type SocketLike,
} from './plugin-fetch'

const PUBLICO = '203.0.113.10'

/** Un cuerpo de respuesta HTTP/1.1, con sus cabeceras. */
function crudo(
  cuerpo: Buffer | string,
  opciones: { status?: number; headers?: readonly (readonly [string, string])[] } = {},
): Buffer {
  const binario = typeof cuerpo === 'string' ? Buffer.from(cuerpo, 'utf8') : cuerpo
  const lineas = [`HTTP/1.1 ${opciones.status ?? 200} OK`]

  for (const [nombre, valor] of opciones.headers ?? []) lineas.push(`${nombre}: ${valor}`)
  lineas.push('', '')

  return Buffer.concat([Buffer.from(lineas.join('\r\n'), 'latin1'), binario])
}

/**
 * Un socket de mentira.
 *
 * `destroy()` avisa del fallo, como el socket de verdad: es lo que hace que un
 * corte por plazo se vea como un corte y no como un cuerpo vacío.
 */
function transporteFalso(
  respuesta: Buffer,
  escritos: string[],
  trozos: number,
  silencio: boolean,
): PluginTransport {
  let alDatos: ((trozo: Buffer) => void) | undefined
  let alCerrar: (() => void) | undefined
  let alFallar: ((causa: Error) => void) | undefined

  return {
    write: (datos) => escritos.push(datos),
    end: () => {
      if (silencio) return

      const tamano = Math.max(1, Math.ceil(respuesta.length / trozos))
      for (let i = 0; i < respuesta.length; i += tamano) {
        alDatos?.(respuesta.subarray(i, i + tamano))
      }

      alCerrar?.()
    },
    destroy: () => alFallar?.(new Error('el socket se cerró')),
    onData: (cb) => {
      alDatos = cb
    },
    onEnd: (cb) => {
      alCerrar = cb
    },
    onError: (cb) => {
      alFallar = cb
    },
  }
}

/**
 * Un socket de mentira para las pruebas del conector: registra las escuchas y
 * dispara la del evento pedido. Así se comprueba **qué opciones** se le pasan a
 * TLS —el nombre en el SNI, la verificación encendida— sin abrir una conexión.
 */
function socketFalso(opciones: { alConectar?: boolean; causa?: Error }): SocketLike {
  return {
    setNoDelay: () => undefined,
    alConectar: (escucha) => {
      if (opciones.alConectar === true) queueMicrotask(() => escucha())

      return undefined
    },
    alFallar: (escucha) => {
      if (opciones.causa !== undefined) {
        queueMicrotask(() => escucha(opciones.causa ?? new Error('sin causa')))
      }

      return undefined
    },
    alRecibirDatos: () => undefined,
    alCerrar: () => undefined,
    write: () => undefined,
    end: () => undefined,
    destroy: () => undefined,
  }
}

interface Montaje {
  readonly fetch: PluginFetch
  /** Los destinos a los que se llegó a conectar, en orden. */
  readonly destinos: ConnectTarget[]
  /** El texto de cada petición escrita, por salto. */
  readonly escritos: string[]
  /** Los nombres que se resolvieron, en orden. */
  readonly llamadas: string[]
}

function montar(config: {
  respuestas: readonly Buffer[]
  direcciones?: readonly string[]
  trozos?: number
  silencio?: boolean
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  allowLoopback?: boolean
}): Montaje {
  const destinos: ConnectTarget[] = []
  const escritos: string[] = []
  const llamadas: string[] = []
  let indice = 0

  const resolver: Resolver = async (host) => {
    llamadas.push(host)
    return config.direcciones ?? [PUBLICO]
  }

  const fetch = createPluginFetch({
    resolver,
    connector: async (target) => {
      destinos.push(target)
      const respuesta = config.respuestas[indice] ?? crudo('')
      indice += 1

      return transporteFalso(respuesta, escritos, config.trozos ?? 1, config.silencio ?? false)
    },
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.maxBytes === undefined ? {} : { maxBytes: config.maxBytes }),
    ...(config.maxRedirects === undefined ? {} : { maxRedirects: config.maxRedirects }),
    ...(config.allowLoopback === undefined ? {} : { allowLoopback: config.allowLoopback }),
  })

  return { fetch, destinos, escritos, llamadas }
}

describe('la conexión va a la dirección validada', () => {
  test('resuelve una vez, conecta a esa dirección y pone el nombre en el SNI', async () => {
    const falso = montar({ respuestas: [crudo('hola')] })
    const respuesta = await falso.fetch('https://sitio.example/a')

    expect(respuesta.body).toBe('hola')
    expect(falso.destinos).toHaveLength(1)
    expect(falso.destinos[0]?.address).toBe(PUBLICO)
    expect(falso.destinos[0]?.servername).toBe('sitio.example')
    expect(falso.destinos[0]?.tls).toBe(true)
  })

  test('el nombre se resuelve una sola vez: no hay segunda respuesta que cambiar', async () => {
    const falso = montar({ respuestas: [crudo('hola')] })
    await falso.fetch('https://sitio.example/a')

    expect(falso.llamadas).toEqual(['sitio.example'])
  })

  test('un http va sin TLS y al puerto 80', async () => {
    const falso = montar({ respuestas: [crudo('hola')] })
    await falso.fetch('http://sitio.example/a')

    expect(falso.destinos[0]?.tls).toBe(false)
    expect(falso.destinos[0]?.port).toBe(80)
  })
})

describe('un destino interno no se pide', () => {
  test('un nombre que resuelve a loopback se rechaza sin conectar', async () => {
    const falso = montar({ direcciones: ['127.0.0.1'], respuestas: [crudo('no')] })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/loopback/)
    expect(falso.destinos).toHaveLength(0)
  })

  test('basta una respuesta interna entre varias para rechazar', async () => {
    const falso = montar({ direcciones: [PUBLICO, '10.0.0.1'], respuestas: [crudo('no')] })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/private/)
    expect(falso.destinos).toHaveLength(0)
  })

  test('la IPv4 mapeada en IPv6 también se rechaza', async () => {
    const falso = montar({ direcciones: ['::ffff:7f00:1'], respuestas: [crudo('no')] })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/loopback/)
    expect(falso.destinos).toHaveLength(0)
  })

  test('la metadata de la nube también', async () => {
    const falso = montar({ direcciones: ['169.254.169.254'], respuestas: [crudo('no')] })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/metadata/)
    expect(falso.destinos).toHaveLength(0)
  })
})

describe('las redirecciones se siguen a mano', () => {
  test('a una dirección interna no se sigue', async () => {
    const falso = montar({
      respuestas: [crudo('', { status: 302, headers: [['location', 'http://127.0.0.1/x']] })],
    })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/loopback/)
    expect(falso.destinos).toHaveLength(1)
  })

  test('a otro origen no se lleva la cookie del plugin', async () => {
    const falso = montar({
      respuestas: [
        crudo('', { status: 302, headers: [['location', 'https://otro.example/b']] }),
        crudo('ok'),
      ],
    })

    await falso.fetch('https://sitio.example/a', { headers: { cookie: 'sesion=secreta' } })

    expect(falso.escritos[0]).toContain('sesion=secreta')
    expect(falso.escritos[1]).not.toContain('sesion=secreta')
  })

  test('al mismo origen sí la conserva', async () => {
    const falso = montar({
      respuestas: [crudo('', { status: 302, headers: [['location', '/b']] }), crudo('ok')],
    })

    await falso.fetch('https://sitio.example/a', { headers: { cookie: 'sesion=secreta' } })

    expect(falso.escritos[1]).toContain('sesion=secreta')
  })

  test('los saltos tienen tope', async () => {
    const salto = crudo('', { status: 302, headers: [['location', '/x']] })
    const falso = montar({ respuestas: [salto, salto, salto, salto], maxRedirects: 2 })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/saltos/)

    // Dos saltos permitidos son tres peticiones: la primera y dos más.
    expect(falso.destinos).toHaveLength(3)
  })
})

describe('el cuerpo tiene tope', () => {
  test('una bomba de compresión se corta sin llegar a asignarla', async () => {
    // Un megabyte de ceros comprimido ocupa un kilobyte: cabe bajo el tope en
    // crudo y pasa de largo al descomprimir. Es el caso que `content-length` no
    // delata.
    const bomba = gzipSync(Buffer.alloc(1024 * 1024))
    const falso = montar({
      respuestas: [crudo(bomba, { headers: [['content-encoding', 'gzip']] })],
      maxBytes: 4096,
    })

    expect(bomba.byteLength).toBeLessThan(4096)
    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/descomprimido/)
  })

  test('lo que llega sin content-length también se corta', async () => {
    const falso = montar({ respuestas: [crudo(Buffer.alloc(4096, 0x61))], maxBytes: 1024 })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/se corta/)
  })

  test('lo que se declara por encima del tope se corta al llegar', async () => {
    const falso = montar({
      respuestas: [crudo(Buffer.alloc(4096, 0x61), { headers: [['content-length', '4096']] })],
      maxBytes: 1024,
    })

    await expect(falso.fetch('https://sitio.example/a')).rejects.toThrow(/se corta/)
  })
})

describe('el cuerpo se lee entero', () => {
  test('sin content-length, hasta que el servidor cierra', async () => {
    const falso = montar({ respuestas: [crudo('linea uno\nlinea dos')] })
    const respuesta = await falso.fetch('https://sitio.example/a')

    expect(respuesta.body).toBe('linea uno\nlinea dos')
  })

  test('troceado, aunque llegue en pedazos', async () => {
    const troceado =
      'HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhola \r\n6\r\nmundo!\r\n0\r\n\r\n'
    const falso = montar({ respuestas: [Buffer.from(troceado, 'latin1')], trozos: 7 })
    const respuesta = await falso.fetch('https://sitio.example/a')

    expect(respuesta.body).toBe('hola mundo!')
  })

  test('un cuerpo comprimido se descomprime', async () => {
    const falso = montar({
      respuestas: [
        crudo(gzipSync(Buffer.from('con acentos: ñ', 'utf8')), {
          headers: [['content-encoding', 'gzip']],
        }),
      ],
    })
    const respuesta = await falso.fetch('https://sitio.example/a')

    expect(respuesta.body).toBe('con acentos: ñ')
  })
})

describe('lo que ve el plugin', () => {
  test('set-cookie llega entero y lo demás se filtra', async () => {
    const falso = montar({
      respuestas: [
        crudo('ok', {
          headers: [
            ['set-cookie', 'a=1; Path=/'],
            ['set-cookie', 'b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT'],
            ['content-type', 'text/html'],
            ['x-raro', 'no'],
          ],
        }),
      ],
    })

    const respuesta = await falso.fetch('https://sitio.example/a')

    expect(respuesta.setCookie).toHaveLength(2)
    expect(respuesta.setCookie[1]).toContain('Expires=Wed, 21 Oct 2015')
    expect(respuesta.headers['content-type']).toBe('text/html')
    expect(respuesta.headers['x-raro']).toBeUndefined()
  })

  test('el plugin no elige el host ni el tamaño de su cuerpo', async () => {
    const falso = montar({ respuestas: [crudo('ok')] })

    await falso.fetch('https://sitio.example/a', {
      headers: {
        host: 'malo.example',
        'content-length': '999999',
        referer: 'https://sitio.example/',
      },
    })

    expect(falso.escritos[0]).toContain('Host: sitio.example')
    expect(falso.escritos[0]).not.toContain('malo.example')
    expect(falso.escritos[0]).not.toContain('999999')
  })

  test('una cabecera con salto de línea se rechaza antes de conectar', async () => {
    const falso = montar({ respuestas: [crudo('ok')] })

    await expect(
      falso.fetch('https://sitio.example/a', { headers: { referer: 'a\r\nX-Inyectada: si' } }),
    ).rejects.toThrow(/no se puede usar/)

    expect(falso.destinos).toHaveLength(0)
  })

  test('un POST manda su cuerpo y su longitud', async () => {
    const falso = montar({ respuestas: [crudo('ok')] })

    await falso.fetch('https://sitio.example/a', {
      method: 'POST',
      body: 'a=1&b=2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(falso.escritos[0]).toContain('POST /a HTTP/1.1')
    expect(falso.escritos[0]).toContain('Content-Length: 7')
    expect(falso.escritos[0]).toContain('a=1&b=2')
  })
})

describe('el plazo', () => {
  test('una respuesta que no llega se corta y lo dice', async () => {
    const falso = montar({ respuestas: [crudo('')], silencio: true, timeoutMs: 30 })

    // La carrera no es adorno: sin ella, una implementación que no corte dejaría
    // la prueba —y la suite entera— esperando para siempre, en vez de fallar. Bun
    // 1.4.3 no interrumpe una promesa que nunca se resuelve, así que el plazo de
    // esta prueba lo pone la prueba.
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const plazoDeLaPrueba = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => rechazar(new Error('la capacidad no cortó')), 2000)
    })

    try {
      await expect(
        Promise.race([falso.fetch('https://sitio.example/a'), plazoDeLaPrueba]),
      ).rejects.toThrow(/no terminó en 30 ms/)
    } finally {
      clearTimeout(temporizador)
    }
  })
})

describe('la excepción de red interna es sólo loopback', () => {
  test('sin la excepción, un sitio en la propia máquina se rechaza', async () => {
    const falso = montar({ direcciones: ['127.0.0.1'], respuestas: [crudo('no')] })

    await expect(falso.fetch('http://sitio.example/a')).rejects.toThrow(/loopback/)
    expect(falso.destinos).toHaveLength(0)
  })

  test('con la excepción, un nombre que resuelve a la propia máquina se pide', async () => {
    const falso = montar({
      direcciones: ['127.0.0.1'],
      respuestas: [crudo('ok')],
      allowLoopback: true,
    })

    const respuesta = await falso.fetch('http://sitio.example/a')

    expect(respuesta.body).toBe('ok')
    expect(falso.destinos[0]?.address).toBe('127.0.0.1')
  })

  test('con la excepción, una dirección literal de loopback también, y sin resolver', async () => {
    const falso = montar({ respuestas: [crudo('ok')], allowLoopback: true })

    const respuesta = await falso.fetch('http://127.0.0.1:8080/a')

    expect(respuesta.body).toBe('ok')
    expect(falso.destinos[0]?.address).toBe('127.0.0.1')
    expect(falso.llamadas).toEqual([])
  })

  test('la excepción no abre una red privada', async () => {
    const falso = montar({
      direcciones: ['192.168.1.10'],
      respuestas: [crudo('no')],
      allowLoopback: true,
    })

    await expect(falso.fetch('http://sitio.example/a')).rejects.toThrow(/private/)
    expect(falso.destinos).toHaveLength(0)
  })

  test('ni la metadata de la nube', async () => {
    const falso = montar({
      direcciones: ['169.254.169.254'],
      respuestas: [crudo('no')],
      allowLoopback: true,
    })

    await expect(falso.fetch('http://sitio.example/a')).rejects.toThrow(/metadata/)
    expect(falso.destinos).toHaveLength(0)
  })
})

describe('cuántas veces se resuelve el nombre', () => {
  test('una redirección resuelve otra vez, y sólo una vez más', async () => {
    const falso = montar({
      respuestas: [
        crudo('', { status: 302, headers: [['location', 'https://otro.example/b']] }),
        crudo('ok'),
      ],
    })

    await falso.fetch('https://sitio.example/a')

    expect(falso.llamadas).toEqual(['sitio.example', 'otro.example'])
  })

  test('una dirección literal no se resuelve ninguna vez', async () => {
    const falso = montar({ respuestas: [crudo('ok')] })

    await falso.fetch('https://203.0.113.10/a')

    expect(falso.llamadas).toEqual([])
    expect(falso.destinos[0]?.servername).toBe('203.0.113.10')
  })
})

describe('el conector de TLS', () => {
  test('va a la dirección validada, con el nombre en el SNI y la verificación encendida', async () => {
    const opciones: { host?: string; servername?: string; rejectUnauthorized?: boolean }[] = []
    const conector = connectorCon(
      (pedido) => {
        opciones.push(pedido)

        return socketFalso({ alConectar: true })
      },
      () => {
        throw new Error('no se esperaba TCP')
      },
    )

    await conector({
      address: PUBLICO,
      port: 443,
      servername: 'sitio.example',
      tls: true,
      signal: new AbortController().signal,
    })

    expect(opciones[0]?.host).toBe(PUBLICO)
    expect(opciones[0]?.servername).toBe('sitio.example')
    expect(opciones[0]?.rejectUnauthorized).toBe(true)
  })

  test('un certificado que no corresponde al nombre se rechaza', async () => {
    const falta = Object.assign(new Error('el certificado es de otro nombre'), {
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
    const conector = connectorCon(
      () => socketFalso({ causa: falta }),
      () => {
        throw new Error('no se esperaba TCP')
      },
    )

    const promesa = conector({
      address: PUBLICO,
      port: 443,
      servername: 'sitio.example',
      tls: true,
      signal: new AbortController().signal,
    })

    await expect(promesa).rejects.toThrow(/el certificado es de otro nombre/)
    await expect(promesa).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
  })

  test('un http va por el conector sin TLS', async () => {
    const opciones: { host?: string; servername?: string }[] = []
    const conector = connectorCon(
      () => {
        throw new Error('no se esperaba TLS')
      },
      (pedido) => {
        opciones.push(pedido)

        return socketFalso({ alConectar: true })
      },
    )

    await conector({
      address: PUBLICO,
      port: 80,
      servername: 'sitio.example',
      tls: false,
      signal: new AbortController().signal,
    })

    expect(opciones[0]?.host).toBe(PUBLICO)
    expect(opciones[0]?.servername).toBeUndefined()
  })
})
