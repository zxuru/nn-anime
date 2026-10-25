import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HOST,
  DEFAULT_SERVER_ENV,
  hostForUrl,
  isLoopbackHost,
  MIN_TOKEN_LENGTH,
  networkPolicy,
  serverEnvironment,
} from './server-env'

const TOKEN = 'token-de-servidor-de-32-caracteres'

function value(env: Readonly<Record<string, string | undefined>>) {
  const result = serverEnvironment(env)
  if (!result.ok) throw new Error(`se esperaba un entorno válido: ${result.error.key}`)

  return result.value
}

describe('sin variables', () => {
  test('el modo local sigue siendo loopback, puerto por defecto y navegador abierto', () => {
    expect(value({})).toEqual(DEFAULT_SERVER_ENV)
  })

  test('las variables vacías no son una respuesta', () => {
    expect(
      value({
        NN_ANIME_HOST: '   ',
        NN_ANIME_PORT: '',
        NN_ANIME_TOKEN: ' ',
        NN_ANIME_PUBLIC_ORIGIN: '',
      }),
    ).toEqual(DEFAULT_SERVER_ENV)
  })

  test('el host por defecto es 127.0.0.1', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1')
  })
})

describe('host y puerto', () => {
  test('un host válido se conserva en minúsculas', () => {
    expect(value({ NN_ANIME_HOST: '192.168.1.10', NN_ANIME_TOKEN: TOKEN }).host).toBe(
      '192.168.1.10',
    )
  })

  test('localhost se normaliza a 127.0.0.1', () => {
    expect(value({ NN_ANIME_HOST: 'localhost' }).host).toBe('127.0.0.1')
  })

  test('un host con esquema, barras o espacios se rechaza', () => {
    for (const host of ['http://127.0.0.1', 'mi host', 'carpeta/host']) {
      const result = serverEnvironment({ NN_ANIME_HOST: host })
      expect(result.ok, host).toBe(false)
    }
  })

  test('un IPv6 entre corchetes se acepta y se guarda sin corchetes', () => {
    expect(value({ NN_ANIME_HOST: '[::1]' }).host).toBe('::1')
  })

  test('el puerto se parsea', () => {
    expect(value({ NN_ANIME_PORT: '8080' }).port).toBe(8080)
    expect(value({ NN_ANIME_PORT: '1' }).port).toBe(1)
    expect(value({ NN_ANIME_PORT: '65535' }).port).toBe(65535)
  })

  test('un puerto inválido se rechaza en vez de caer al de siempre', () => {
    for (const port of ['0', '65536', '-1', 'abc', '8080.5']) {
      const result = serverEnvironment({ NN_ANIME_PORT: port })
      expect(result.ok, port).toBe(false)
      if (result.ok) continue

      expect(result.error.key).toBe('cli.env.invalidPort')
      expect(result.error.params.value).toBe(port)
    }
  })

  test('un puerto sin dígitos no se confunde con el de por defecto', () => {
    expect(value({ NN_ANIME_PORT: '  ' }).port).toBeUndefined()
  })
})

describe('interruptores', () => {
  test('NN_ANIME_NO_OPEN acepta 1 y true', () => {
    expect(value({ NN_ANIME_NO_OPEN: '1' }).noOpen).toBe(true)
    expect(value({ NN_ANIME_NO_OPEN: 'true' }).noOpen).toBe(true)
  })

  test('NN_ANIME_NO_OPEN no se enciende con otros valores', () => {
    for (const flag of ['0', 'false', 'sí', '']) {
      expect(value({ NN_ANIME_NO_OPEN: flag }).noOpen, flag).toBe(false)
    }
  })

  test('NN_ANIME_LOCKED acepta 1 y true', () => {
    expect(value({ NN_ANIME_LOCKED: '1' }).locked).toBe(true)
    expect(value({ NN_ANIME_LOCKED: 'true' }).locked).toBe(true)
    expect(value({ NN_ANIME_LOCKED: '0' }).locked).toBe(false)
  })
})

describe('token', () => {
  test('en loopback el token es opcional', () => {
    expect(value({}).token).toBeUndefined()
  })

  test('el token se recorta', () => {
    expect(value({ NN_ANIME_TOKEN: '  un-token-largo  ' }).token).toBe('un-token-largo')
  })

  test('fuera de loopback sin token no se arranca', () => {
    for (const host of ['0.0.0.0', '192.168.1.10', '::']) {
      const result = serverEnvironment({ NN_ANIME_HOST: host })
      expect(result.ok, host).toBe(false)
      if (result.ok) continue

      expect(result.error.key).toBe('cli.env.noTokenOnServer')
    }
  })

  test('fuera de loopback con token se arranca', () => {
    const env = value({ NN_ANIME_HOST: '0.0.0.0', NN_ANIME_TOKEN: TOKEN })

    expect(env.host).toBe('0.0.0.0')
    expect(env.token).toBe(TOKEN)
  })

  test('fuera de loopback un token corto se rechaza', () => {
    const result = serverEnvironment({
      NN_ANIME_HOST: '0.0.0.0',
      NN_ANIME_TOKEN: 'corto',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.key).toBe('cli.env.weakToken')
    expect(result.error.params.min).toBe(MIN_TOKEN_LENGTH)
  })

  test('en loopback un token corto no impide el arranque de desarrollo', () => {
    expect(value({ NN_ANIME_TOKEN: 'corto' }).token).toBe('corto')
  })

  test('un origen público no loopback también exige token', () => {
    const result = serverEnvironment({
      NN_ANIME_PUBLIC_ORIGIN: 'https://nn.example.com',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.key).toBe('cli.env.noTokenOnServer')
    expect(result.error.params.where).toBe('https://nn.example.com')
  })
})

describe('origen público', () => {
  test('se normaliza y una URL con ruta se queda en el origen', () => {
    const env = value({
      NN_ANIME_HOST: '0.0.0.0',
      NN_ANIME_TOKEN: TOKEN,
      NN_ANIME_PUBLIC_ORIGIN: 'https://nn.example.com/app',
    })

    expect(env.publicOrigin).toBe('https://nn.example.com')
    expect(env.secureCookie).toBe(true)
  })

  test('https marca la cookie Secure; http no', () => {
    const https = value({
      NN_ANIME_HOST: '0.0.0.0',
      NN_ANIME_TOKEN: TOKEN,
      NN_ANIME_PUBLIC_ORIGIN: 'https://nn.example.com',
    })
    const http = value({
      NN_ANIME_HOST: '0.0.0.0',
      NN_ANIME_TOKEN: TOKEN,
      NN_ANIME_PUBLIC_ORIGIN: 'http://192.168.1.10:8080',
    })

    expect(https.secureCookie).toBe(true)
    expect(http.secureCookie).toBe(false)
  })

  test('un origen inválido se rechaza', () => {
    for (const origin of [
      'nn.example.com',
      'ftp://nn.example.com',
      'https://usuario:clave@nn.example.com',
    ]) {
      const result = serverEnvironment({ NN_ANIME_PUBLIC_ORIGIN: origin })
      expect(result.ok, origin).toBe(false)
      if (result.ok) continue

      expect(result.error.key).toBe('cli.env.invalidOrigin')
    }
  })
})

describe('isLoopbackHost', () => {
  test('reconoce loopback y no confunde 0.0.0.0', () => {
    for (const host of ['127.0.0.1', '127.0.0.2', '::1', '[::1]', 'localhost']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }

    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'nn.example.com']) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
  })
})

describe('hostForUrl', () => {
  test('el wildcard se enseña como loopback y el IPv6 entre corchetes', () => {
    expect(hostForUrl('0.0.0.0')).toBe('127.0.0.1')
    expect(hostForUrl('::')).toBe('127.0.0.1')
    expect(hostForUrl('::1')).toBe('[::1]')
    expect(hostForUrl('192.168.1.10')).toBe('192.168.1.10')
  })
})

describe('networkPolicy', () => {
  test('el modo local puro no añade nada', () => {
    expect(networkPolicy({ host: '127.0.0.1', port: 7717, publicOrigin: undefined })).toEqual({
      extraHosts: [],
      allowAnyHost: false,
      extraOrigins: [],
      sameOrigin: true,
    })
  })

  test('sin origen público y con wildcard se acepta cualquier Host', () => {
    const policy = networkPolicy({ host: '0.0.0.0', port: 8080, publicOrigin: undefined })

    expect(policy.allowAnyHost).toBe(true)
    expect(policy.extraHosts).toEqual([])
  })

  test('el origen público fija el Host y el Origin', () => {
    const policy = networkPolicy({
      host: '0.0.0.0',
      port: 8080,
      publicOrigin: 'https://nn.example.com:8443',
    })

    expect(policy.allowAnyHost).toBe(false)
    expect(policy.extraHosts).toEqual(['nn.example.com:8443'])
    expect(policy.extraOrigins).toEqual(['https://nn.example.com:8443'])
  })

  test('un host explícito de la LAN añade su Host y su Origin', () => {
    const policy = networkPolicy({ host: '192.168.1.10', port: 8080, publicOrigin: undefined })

    expect(policy.allowAnyHost).toBe(true)
    expect(policy.extraHosts).toEqual(['192.168.1.10:8080'])
    expect(policy.extraOrigins).toEqual(['http://192.168.1.10:8080'])
  })

  test('un host IPv6 se escribe entre corchetes', () => {
    const policy = networkPolicy({ host: '::1', port: 8080, publicOrigin: undefined })

    expect(policy.allowAnyHost).toBe(false)
    expect(policy.extraHosts).toEqual(['[::1]:8080'])
    expect(policy.extraOrigins).toEqual(['http://[::1]:8080'])
  })
})
