import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { checkDestination } from '@nn-anime/media-proxy'
import { conCiclo, GOOD, HOST, JSON_HEADERS } from './fixtures'

/**
 * Las doce mitigaciones del spec, como pruebas.
 *
 * Un hallazgo que no se convierte en criterio de aceptación es un hallazgo
 * perdido: si alguien quita un guard, esta suite tiene que ponerse roja. Las
 * mitigaciones que ya tienen sus pruebas unitarias se citan; las que se pueden
 * comprobar de extremo a extremo se comprueban aquí, sobre la aplicación montada.
 *
 * Se barren **todas las rutas** y no una: una mitigación que se aplica a once
 * rutas de doce no es una mitigación, es un descuido esperando su turno.
 */

/** Las rutas que tienen que estar detrás de los guards. */
const RUTAS_PROTEGIDAS: readonly (readonly [string, string])[] = [
  ['GET', '/api/health'],
  ['GET', '/api/providers'],
  ['GET', '/api/search?q=aurora'],
  ['GET', '/api/anime/fixture/aurora-nocturna'],
  ['GET', '/api/anime/fixture/aurora-nocturna/episodes'],
  ['GET', '/api/cover/fixture/aurora-nocturna'],
  ['GET', '/api/favorites'],
  ['GET', '/api/watch/recent'],
  ['GET', '/api/recommendations'],
  ['GET', '/api/trending'],
  ['GET', '/api/feed'],
  ['GET', '/api/catalog/recent'],
  ['GET', '/api/settings'],
  ['GET', '/stream/inventado'],
  ['GET', '/api/subtitles/inventado'],
]

/** Las que mutan: además de la sesión, el guard de origen. */
const RUTAS_MUTANTES: readonly (readonly [string, string])[] = [
  ['POST', '/api/watch'],
  ['PATCH', '/api/watch/1'],
  ['POST', '/api/favorites'],
  ['POST', '/api/stream/resolve'],
  ['POST', '/api/play/mpv'],
  ['PATCH', '/api/settings'],
]

function peticion(_ruta: string, metodo: string, headers: Record<string, string>): RequestInit {
  return {
    method: metodo,
    headers,
    ...(metodo === 'GET' ? {} : { body: JSON.stringify({}) }),
  }
}

describe('M1 · el `Host` tiene que ser el nuestro', () => {
  test('un `Host` ajeno es 403 en toda ruta protegida', async () => {
    await conCiclo(async ({ pedir }) => {
      for (const [metodo, ruta] of [...RUTAS_PROTEGIDAS, ...RUTAS_MUTANTES]) {
        const respuesta = await pedir(ruta, {
          ...peticion(ruta, metodo, { ...JSON_HEADERS, host: 'evil.example' }),
        })

        expect(respuesta.status, `${metodo} ${ruta}`).toBe(403)
      }
    })
  })

  test('el caso de DNS rebinding: un nombre que resuelve a loopback', async () => {
    await conCiclo(async ({ pedir }) => {
      // Un nombre propio que resuelve a 127.0.0.1 es el ataque: el navegador
      // manda `Host: otro.example` y el guard lo rechaza.
      for (const host of ['otro.example', 'evil.example:7717', 'fixture.invalid']) {
        const respuesta = await pedir('/api/health', { headers: { ...GOOD, host } })

        expect(respuesta.status, host).toBe(403)
      }
    })
  })

  test('`localhost` también se rechaza: la decisión del Checkpoint H', async () => {
    // Las cookies ignoran el puerto, así que otra aplicación local en
    // `localhost:OTRO_PUERTO` es el mismo sitio para el navegador y podría leer la
    // cookie de sesión. Sólo se admite `127.0.0.1:PUERTO`, que es lo que el
    // arranque abre en el navegador.
    await conCiclo(async ({ pedir }) => {
      const respuesta = await pedir('/api/health', {
        headers: { ...GOOD, host: `localhost:${7717}` },
      })

      expect(respuesta.status).toBe(403)
    })
  })
})

describe('M2 · sin sesión no se pasa', () => {
  test('toda ruta protegida responde 401 sin cookie', async () => {
    await conCiclo(async ({ pedir }) => {
      for (const [metodo, ruta] of RUTAS_PROTEGIDAS) {
        const respuesta = await pedir(ruta, { headers: { origin: GOOD.origin } })

        expect(respuesta.status, `${metodo} ${ruta}`).toBe(401)
      }
    })
  })

  test('una cookie con otro valor tampoco vale', async () => {
    await conCiclo(async ({ pedir }) => {
      const respuesta = await pedir('/api/health', {
        headers: { cookie: 'nn_session=otra-cosa', origin: GOOD.origin },
      })

      expect(respuesta.status).toBe(401)
    })
  })

  test('el token de arranque sirve una sola vez', async () => {
    await conCiclo(async ({ pedir }) => {
      const primera = await pedir('/?boot=token-de-integracion', { headers: { host: HOST } })
      const segunda = await pedir('/?boot=token-de-integracion', { headers: { host: HOST } })

      // El segundo intento no redirige: el token ya se gastó y la petición llega
      // sin sesión.
      expect(primera.status).toBe(302)
      expect(segunda.status).not.toBe(302)
      expect(segunda.status).toBe(401)
    })
  })
})

describe('M3 · la comparación de la sesión', () => {
  test('la comparación es de tiempo constante, y se comprueba en el código', async () => {
    // La propiedad de tiempo constante **no se puede observar desde fuera**: una
    // comparación con `===` también devuelve 401 y también tarda poco. Lo que se
    // puede comprobar es que el código usa la primitiva correcta, y eso es una
    // comprobación por texto con todo lo que eso significa. Está aquí porque la
    // alternativa es no comprobarlo en absoluto.
    const fuente = await Bun.file(
      new URL('../packages/server/src/session.ts', import.meta.url).pathname,
    ).text()

    expect(fuente).toContain('timingSafeEqual')
    expect(fuente).not.toMatch(/return\s+\w+\s*===\s*\w+/)
  })

  test('una cookie de otra longitud da 401 y no lanza', async () => {
    await conCiclo(async ({ pedir }) => {
      // `timingSafeEqual` lanza si las longitudes no coinciden, y esa excepción
      // sería un 500 con la traza del servidor.
      for (const cookie of ['nn_session=', 'nn_session=x', `nn_session=${'x'.repeat(200)}`]) {
        const respuesta = await pedir('/api/health', {
          headers: { cookie, origin: GOOD.origin },
        })

        expect(respuesta.status, cookie).toBe(401)
      }
    })
  })
})

describe('M4 · el origen en métodos que mutan', () => {
  test('sin `Origin`, con `null` y con uno ajeno: 403', async () => {
    await conCiclo(async ({ pedir }) => {
      for (const origin of [undefined, 'null', 'https://otro.example']) {
        const respuesta = await pedir('/api/favorites', {
          method: 'POST',
          headers: {
            cookie: GOOD.cookie,
            'content-type': 'application/json',
            ...(origin === undefined ? {} : { origin }),
          },
          body: JSON.stringify({ ref: { providerId: 'fixture', value: 'aurora-nocturna' } }),
        })

        expect(respuesta.status, String(origin)).toBe(403)
      }
    })
  })

  test('en lectura, un origen ajeno no importa: no hay nada que mutar', async () => {
    await conCiclo(async ({ pedir }) => {
      const respuesta = await pedir('/api/health', {
        headers: { cookie: GOOD.cookie, origin: 'https://otro.example' },
      })

      expect(respuesta.status).toBe(200)
    })
  })
})

describe('M5 · las cabeceras de seguridad', () => {
  test('toda respuesta lleva CSP, `nosniff`, `Referrer-Policy` y `X-Frame-Options`', async () => {
    await conCiclo(async ({ pedir }) => {
      for (const [metodo, ruta] of [...RUTAS_PROTEGIDAS, ...RUTAS_MUTANTES]) {
        const respuesta = await pedir(ruta, peticion(ruta, metodo, JSON_HEADERS))

        expect(respuesta.headers.get('content-security-policy'), `${metodo} ${ruta}`).toContain(
          "default-src 'self'",
        )
        expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff')
        expect(respuesta.headers.get('referrer-policy')).toBeTruthy()
        expect(respuesta.headers.get('x-frame-options')).toBeTruthy()
      }
    })
  })

  test('ninguna respuesta abre CORS', async () => {
    await conCiclo(async ({ pedir }) => {
      for (const [metodo, ruta] of [...RUTAS_PROTEGIDAS, ...RUTAS_MUTANTES]) {
        const respuesta = await pedir(ruta, peticion(ruta, metodo, JSON_HEADERS))

        expect(respuesta.headers.get('access-control-allow-origin'), ruta).toBeNull()
      }
    })
  })

  test('la CSP no permite guiones en línea ni marcos ajenos', async () => {
    await conCiclo(async ({ pedir }) => {
      const csp = (await pedir('/api/health')).headers.get('content-security-policy') ?? ''

      expect(csp).not.toContain("'unsafe-inline'")
      expect(csp).not.toContain("'unsafe-eval'")
      expect(csp).toContain("frame-ancestors 'none'")
    })
  })
})

describe('M6 y M7 · nada del upstream llega al cliente', () => {
  test('un `Set-Cookie` del upstream no aparece en la respuesta del proxy', async () => {
    await conCiclo(async ({ pedir }) => {
      const stream = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
          mode: 'sub',
        }),
      })
      const cuerpo = (await stream.json()) as { sources: { url: string }[] }
      const ruta = cuerpo.sources[0]?.url ?? ''

      const respuesta = await pedir(ruta, { headers: GOOD })

      expect(respuesta.headers.get('set-cookie')).toBeNull()
      expect(respuesta.headers.get('server')).toBeNull()
      expect(respuesta.headers.get('x-powered-by')).toBeNull()
    })
  })

  test('las cabeceras de la respuesta están dentro de la lista blanca', async () => {
    await conCiclo(async ({ pedir }) => {
      const stream = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
          mode: 'sub',
        }),
      })
      const cuerpo = (await stream.json()) as { sources: { url: string }[] }
      const respuesta = await pedir(cuerpo.sources[0]?.url ?? '', { headers: GOOD })

      // La lista blanca exacta se prueba en `byte-proxy.test.ts`, donde está el
      // código. Aquí se comprueba lo que importa de extremo a extremo: que no
      // aparezca nada del upstream que no sean datos del medio.
      for (const nombre of ['server', 'x-powered-by', 'set-cookie', 'x-aspnet-version']) {
        expect(respuesta.headers.get(nombre), nombre).toBeNull()
      }

      // Y las de seguridad siguen puestas: el proxy no las quita.
      expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff')
    })
  })
})

describe('M8 · el proxy no sale a donde no debe', () => {
  test('los cinco destinos prohibidos del spec se rechazan', () => {
    for (const url of [
      'http://127.0.0.1:22/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'file:///etc/passwd',
      'data:text/plain,x',
    ]) {
      expect(checkDestination(url).ok, url).toBe(false)
    }
  })

  test('una IPv4 dentro de una IPv6 tampoco pasa la lista blanca', () => {
    // La forma hexadecimal es la que produce `new URL` a partir de la forma con
    // puntos, y la que la lista blanca no reconocía: era loopback para el
    // sistema y transparente para el guard.
    for (const url of [
      'http://[::ffff:127.0.0.1]:8080/',
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:10.0.0.1]/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[64:ff9b::7f00:1]/',
    ]) {
      expect(checkDestination(url).ok, url).toBe(false)
    }

    // Y el unicast global de verdad sigue entrando.
    expect(checkDestination('http://[2606:4700::1111]/').ok).toBe(true)
  })

  test('un ticket hacia loopback disfrazado de IPv6 se rechaza al pedirlo', async () => {
    await conCiclo(async ({ pedir, container }) => {
      const ticket = container.tickets.issue({
        url: 'http://[::ffff:169.254.169.254]/latest/meta-data/',
        headers: {},
      })
      const respuesta = await pedir(`/stream/${ticket}`, { headers: GOOD })

      expect(respuesta.status).not.toBe(200)
    })
  })

  test('un ticket hacia la red local se rechaza al pedirlo, no al emitirlo', async () => {
    await conCiclo(async ({ pedir, container }) => {
      // El ticket se emite —es sólo un identificador— y **se rechaza al
      // resolverlo**: la comprobación va en el camino de salida, que es donde
      // tiene que estar.
      const ticket = container.tickets.issue({ url: 'http://127.0.0.1:22/', headers: {} })
      const respuesta = await pedir(`/stream/${ticket}`, { headers: GOOD })

      // El rechazo no es un 200 y el motivo no se inventa: la petición no sale.
      expect(respuesta.status).toBeGreaterThanOrEqual(400)
      expect(respuesta.status).not.toBe(200)
    })
  })

  test('la excepción de loopback está cerrada por defecto', async () => {
    await conCiclo(async ({ pedir, container }) => {
      const ticket = container.tickets.issue({ url: 'http://10.0.0.1/x', headers: {} })
      const respuesta = await pedir(`/stream/${ticket}`, { headers: GOOD })

      expect(respuesta.status).not.toBe(200)
    })
  })
})

describe('M9 · confinamiento de los archivos servidos', () => {
  test('el ascenso con puntos no se sirve', async () => {
    // La comprobación vive en `static-assets.test.ts`, que es donde está el
    // código; aquí se comprueba que sigue habiendo pruebas que la miran.
    const fuente = await Bun.file(
      new URL('../packages/server/src/static-assets.test.ts', import.meta.url).pathname,
    ).text()

    expect(fuente).toContain('bloquea el ascenso con puntos suspensivos')
    expect(fuente).toContain('bloquea el ascenso escondido en medio')
  })
})

describe('M10 · inyección hacia mpv', () => {
  test('un valor con salto de línea se rechaza', async () => {
    const { mpvArgs } = await import('@nn-anime/media-proxy')
    const salida = mpvArgs({
      url: 'http://127.0.0.1/stream/abc',
      headers: { Referer: 'https://sitio.example\nX-Inventada: 1' },
    })

    expect(salida.ok).toBe(false)
  })
})

describe('M11 · esquemas de datos de proveedor', () => {
  test('`safeUrl` rechaza lo que ejecuta', async () => {
    const { safeUrl } = await import('../packages/web/src/lib/safe-url')

    for (const malo of [
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc/passwd',
    ]) {
      expect(safeUrl(malo), malo).toBeNull()
    }
  })
})

describe('M12 · nada sensible en los registros ni en el disco', () => {
  test('el token de arranque no se escribe en el disco', async () => {
    await conCiclo(async ({ pedir }) => {
      await pedir('/?boot=token-de-integracion', { headers: { host: GOOD.origin } })

      // El directorio de trabajo del arnés no puede acabar con el token dentro.
      const entradas = await readdir(new URL('..', import.meta.url).pathname)
      for (const entrada of entradas) {
        expect(entrada).not.toContain('token-de-integracion')
      }
    })
  })

  test('el registro no escribe la cookie ni el token', async () => {
    const { createLogger } = await import('@nn-anime/core')
    const lineas: string[] = []
    const logger = createLogger({
      level: 'debug',
      sink: (linea) => lineas.push(JSON.stringify(linea)),
    })

    logger.debug('petición', {
      cookie: 'nn_session=secreto',
      authorization: 'Bearer secreto',
      referer: 'https://sitio.example/secreto',
      ticket: 'ticket-secreto',
    })

    const texto = lineas.join('\n')

    expect(texto).not.toContain('secreto')
    expect(texto).not.toContain('nn_session=')
  })
})

describe('el `Range` malformado no llega al upstream', () => {
  test('un rango imposible responde 416 sin pedir nada', async () => {
    await conCiclo(async ({ pedir, upstream }) => {
      const stream = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
          mode: 'sub',
        }),
      })
      const cuerpo = (await stream.json()) as { sources: { url: string }[] }
      const antes = upstream.llamadas

      const respuesta = await pedir(cuerpo.sources[0]?.url ?? '', {
        headers: { ...GOOD, range: 'bytes=0-1,5-6' },
      })

      expect(respuesta.status).toBe(416)
      expect(upstream.llamadas).toBe(antes)
    })
  })
})
