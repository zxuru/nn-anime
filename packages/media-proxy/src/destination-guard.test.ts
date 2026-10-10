import { describe, expect, test } from 'bun:test'
import {
  ALLOW_LOOPBACK_ENV,
  addressRule,
  allowLoopbackFromEnv,
  checkDestination,
  checkResolvedDestination,
  destinationError,
  fetchAllowed,
  MAX_REDIRECTS,
} from './destination-guard'

/** Resolutor de mentira: un nombre, una o varias direcciones. */
function resolverCon(mapa: Record<string, readonly string[]>) {
  const consultados: string[] = []

  return {
    consultados,
    resolver: async (host: string): Promise<readonly string[]> => {
      consultados.push(host)

      return mapa[host] ?? ['93.184.216.34']
    },
  }
}

describe('esquema', () => {
  test('sólo http y https', () => {
    expect(checkDestination('http://ejemplo/a.mp4').ok).toBe(true)
    expect(checkDestination('https://ejemplo/a.mp4').ok).toBe(true)
  })

  test('los cinco esquemas que no son destinos se rechazan', () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/plain,x',
      'ftp://ejemplo/a.mp4',
      'javascript:alert(1)',
      'ws://ejemplo/a',
    ]) {
      const salida = checkDestination(url)

      expect(salida.ok, url).toBe(false)
      if (!salida.ok) expect(salida.rule, url).toBe('scheme')
    }
  })

  test('una dirección que no se puede analizar es `malformed`', () => {
    const salida = checkDestination('no es una url')

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('malformed')
  })
})

describe('direcciones literales', () => {
  test('loopback, en sus formas', () => {
    for (const url of [
      'http://127.0.0.1:22',
      'http://127.1.2.3/',
      'http://0.0.0.0/',
      'http://[::1]/',
    ]) {
      const salida = checkDestination(url)

      expect(salida.ok, url).toBe(false)
      if (!salida.ok) expect(salida.rule, url).toBe('loopback')
    }
  })

  test('redes privadas', () => {
    for (const url of [
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://172.31.255.1/',
      'http://192.168.1.5/',
    ]) {
      const salida = checkDestination(url)

      expect(salida.ok, url).toBe(false)
      if (!salida.ok) expect(salida.rule, url).toBe('private')
    }
  })

  test('172.32 deja de ser privada', () => {
    expect(checkDestination('http://172.32.0.1/').ok).toBe(true)
  })

  test('link-local', () => {
    const salida = checkDestination('http://169.254.10.10/')

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('link-local')
  })

  test('metadata de nube, con su propia regla', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.200/',
      'http://192.0.0.192/',
    ]) {
      const salida = checkDestination(url)

      expect(salida.ok, url).toBe(false)
      if (!salida.ok) expect(salida.rule, url).toBe('metadata')
    }
  })

  test('IPv6: loopback, link-local y única local', () => {
    expect(addressRule('::1')).toBe('loopback')
    expect(addressRule('fe80::1')).toBe('link-local')
    expect(addressRule('fd00::1')).toBe('private')
    expect(addressRule('2001:db8::1')).toBeUndefined()
  })

  test('una IPv4 dentro de una IPv6 se comprueba como IPv4', () => {
    expect(addressRule('::ffff:127.0.0.1')).toBe('loopback')
    expect(addressRule('::ffff:10.0.0.1')).toBe('private')
    expect(addressRule('::ffff:93.184.216.34')).toBeUndefined()
  })

  test('multicast y broadcast no son destinos', () => {
    expect(addressRule('224.0.0.1')).toBe('malformed')
    expect(addressRule('255.255.255.255')).toBe('malformed')
  })

  test('localhost se rechaza sin resolver nada', () => {
    const salida = checkDestination('http://localhost:8080/a')

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('loopback')
  })

  test('un nombre público pasa la comprobación literal', () => {
    expect(checkDestination('https://ejemplo.example/a.mp4').ok).toBe(true)
  })
})

describe('comprobación después de resolver', () => {
  test('un nombre que resuelve a loopback se rechaza igual que la IP literal', async () => {
    const { resolver } = resolverCon({ 'mi-dominio.example': ['127.0.0.1'] })

    const salida = await checkResolvedDestination('http://mi-dominio.example/a.mp4', resolver)

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('loopback')
  })

  test('basta con que una respuesta sea prohibida', async () => {
    const { resolver } = resolverCon({ 'mixto.example': ['93.184.216.34', '10.0.0.5'] })

    const salida = await checkResolvedDestination('http://mixto.example/a.mp4', resolver)

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('private')
  })

  test('un nombre que resuelve a una dirección pública pasa', async () => {
    const { resolver, consultados } = resolverCon({ 'ejemplo.example': ['93.184.216.34'] })

    const salida = await checkResolvedDestination('https://ejemplo.example/a.mp4', resolver)

    expect(salida.ok).toBe(true)
    expect(consultados).toEqual(['ejemplo.example'])
  })

  test('una dirección literal no se resuelve: ya se sabe lo que es', async () => {
    const { resolver, consultados } = resolverCon({})

    await checkResolvedDestination('http://93.184.216.34/a.mp4', resolver)

    expect(consultados).toEqual([])
  })

  test('un nombre que no resuelve se rechaza con su regla', async () => {
    const salida = await checkResolvedDestination('http://no-existe.example/a', async () => {
      throw new Error('ENOTFOUND')
    })

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('dns')
  })

  test('un DNS sin respuestas tampoco pasa', async () => {
    const salida = await checkResolvedDestination('http://vacio.example/a', async () => [])

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('dns')
  })
})

describe('redirecciones', () => {
  function cadena(saltos: readonly string[], destinoFinal = 'https://final.example/a.mp4') {
    const pedidas: string[] = []
    let indice = 0

    return {
      pedidas,
      fetchImpl: async (url: string): Promise<Response> => {
        pedidas.push(url)
        const siguiente = saltos[indice]
        indice += 1

        if (siguiente === undefined) {
          return new Response('ok', { status: 200, headers: { 'content-type': 'video/mp4' } })
        }

        return new Response(null, { status: 302, headers: { location: siguiente } })
      },
      destinoFinal,
    }
  }

  test('sigue un salto permitido', async () => {
    const fake = cadena(['https://otro.example/b.mp4'])

    const respuesta = await fetchAllowed({
      url: 'https://ejemplo.example/a.mp4',
      headers: {},
      fetchImpl: fake.fetchImpl,
      resolver: async () => ['93.184.216.34'],
    })

    expect(respuesta.status).toBe(200)
    expect(fake.pedidas).toEqual(['https://ejemplo.example/a.mp4', 'https://otro.example/b.mp4'])
  })

  test('una cadena permitido → prohibido se corta en el salto', async () => {
    const fake = cadena(['http://127.0.0.1:22/'])

    await expect(
      fetchAllowed({
        url: 'https://ejemplo.example/a.mp4',
        headers: {},
        fetchImpl: fake.fetchImpl,
        resolver: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow(/loopback/)

    expect(fake.pedidas).toEqual(['https://ejemplo.example/a.mp4'])
  })

  test('un salto a un esquema que no vale también se corta', async () => {
    const fake = cadena(['file:///etc/passwd'])

    await expect(
      fetchAllowed({
        url: 'https://ejemplo.example/a.mp4',
        headers: {},
        fetchImpl: fake.fetchImpl,
        resolver: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow(/scheme|http/)
  })

  test(`el salto ${MAX_REDIRECTS + 1} devuelve error`, async () => {
    const saltos = Array.from({ length: MAX_REDIRECTS + 1 }, (_item, indice) => `/salto-${indice}`)
    const fake = cadena(saltos)

    await expect(
      fetchAllowed({
        url: 'https://ejemplo.example/a.mp4',
        headers: {},
        fetchImpl: fake.fetchImpl,
        resolver: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow(/redirección/)
  })

  test('una redirección relativa se resuelve contra la URL actual', async () => {
    const fake = cadena(['/otra/ruta.mp4'])

    await fetchAllowed({
      url: 'https://ejemplo.example/dir/a.mp4',
      headers: {},
      fetchImpl: fake.fetchImpl,
      resolver: async () => ['93.184.216.34'],
    })

    expect(fake.pedidas[1]).toBe('https://ejemplo.example/otra/ruta.mp4')
  })

  test('un 3xx sin `location` se devuelve tal cual', async () => {
    const respuesta = await fetchAllowed({
      url: 'https://ejemplo.example/a.mp4',
      headers: {},
      fetchImpl: async () => new Response(null, { status: 304 }),
      resolver: async () => ['93.184.216.34'],
    })

    expect(respuesta.status).toBe(304)
  })
})

describe('el error dice la regla y no la URL entera', () => {
  test('nombra la regla y el host', () => {
    const error = destinationError(
      'metadata',
      'http://169.254.169.254/latest/meta-data/?token=secreto',
    )

    expect(error.message).toContain('metadata')
    expect(error.context.rule).toBe('metadata')
    expect(error.context.host).toBe('169.254.169.254')
    expect(error.message).not.toContain('secreto')
    expect(JSON.stringify(error.context)).not.toContain('meta-data')
  })

  test('cada regla tiene su texto', () => {
    for (const regla of [
      'scheme',
      'loopback',
      'private',
      'link-local',
      'metadata',
      'malformed',
      'redirect-limit',
      'dns',
    ] as const) {
      expect(destinationError(regla, 'https://ejemplo/a').message.length).toBeGreaterThan(10)
    }
  })
})

describe('la excepción de loopback', () => {
  test('por defecto está cerrada', () => {
    expect(allowLoopbackFromEnv({})).toBe(false)
    expect(allowLoopbackFromEnv({ [ALLOW_LOOPBACK_ENV]: '0' })).toBe(false)
    expect(allowLoopbackFromEnv({ [ALLOW_LOOPBACK_ENV]: 'sí' })).toBe(false)
  })

  test('se abre con `1` o `true`, y sólo así', () => {
    expect(allowLoopbackFromEnv({ [ALLOW_LOOPBACK_ENV]: '1' })).toBe(true)
    expect(allowLoopbackFromEnv({ [ALLOW_LOOPBACK_ENV]: 'true' })).toBe(true)
  })

  test('abierta, el loopback y las redes privadas pasan', () => {
    expect(checkDestination('http://127.0.0.1:8080/a', { allowLoopback: true }).ok).toBe(true)
    expect(checkDestination('http://10.0.0.5/a', { allowLoopback: true }).ok).toBe(true)
    expect(checkDestination('http://localhost:8080/a', { allowLoopback: true }).ok).toBe(true)
  })

  test('cerrada, se rechazan igual que siempre', () => {
    expect(checkDestination('http://127.0.0.1:8080/a', { allowLoopback: false }).ok).toBe(false)
    expect(checkDestination('http://127.0.0.1:8080/a').ok).toBe(false)
  })

  test('**la metadata de nube se sigue rechazando** aunque esté abierta', () => {
    const salida = checkDestination('http://169.254.169.254/latest/meta-data/', {
      allowLoopback: true,
    })

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.rule).toBe('metadata')
  })

  test('el esquema se sigue comprobando: abrir el loopback no abre todo', () => {
    expect(checkDestination('file:///etc/passwd', { allowLoopback: true }).ok).toBe(false)
    expect(checkDestination('http://[::1]/', { allowLoopback: true }).ok).toBe(true)
  })

  test('la comprobación tras resolver también la respeta', async () => {
    const { resolver } = resolverCon({ 'mi-casa.example': ['127.0.0.1'] })

    const cerrada = await checkResolvedDestination('http://mi-casa.example/a', resolver)
    const abierta = await checkResolvedDestination('http://mi-casa.example/a', resolver, {
      allowLoopback: true,
    })

    expect(cerrada.ok).toBe(false)
    expect(abierta.ok).toBe(true)
  })
})
