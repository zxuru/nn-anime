import { describe, expect, test } from 'bun:test'
import { entradaAutomatica, esNavegacion, sesionVigente } from './dev-session'

const NAVEGACION = { accept: 'text/html,application/xhtml+xml' }

describe('esNavegacion', () => {
  test('una navegación a la raíz entra sola', () => {
    expect(esNavegacion({ method: 'GET', url: '/', headers: NAVEGACION })).toBe(true)
  })

  test('un enlace profundo de la SPA también', () => {
    expect(esNavegacion({ method: 'GET', url: '/perfil?tab=historial', headers: NAVEGACION })).toBe(
      true,
    )
  })

  test('las llamadas a la API no se tocan', () => {
    expect(esNavegacion({ method: 'GET', url: '/api/health', headers: NAVEGACION })).toBe(false)
    expect(esNavegacion({ method: 'GET', url: '/stream/abc', headers: NAVEGACION })).toBe(false)
  })

  test('la propia entrada no se redirige a sí misma', () => {
    expect(esNavegacion({ method: 'GET', url: '/__dev/boot', headers: NAVEGACION })).toBe(false)
  })

  test('la URL que ya lleva el token va al canje', () => {
    expect(esNavegacion({ method: 'GET', url: '/?boot=abc', headers: NAVEGACION })).toBe(false)
  })

  test('un archivo con extensión lo sirve Vite', () => {
    expect(esNavegacion({ method: 'GET', url: '/assets/index-abc.js', headers: NAVEGACION })).toBe(
      false,
    )
  })

  test('sólo HTML: un fetch sin esa cabecera no es una navegación', () => {
    expect(esNavegacion({ method: 'GET', url: '/perfil', headers: { accept: '*/*' } })).toBe(false)
    expect(esNavegacion({ method: 'GET', url: '/perfil', headers: {} })).toBe(false)
  })

  test('un POST no es una navegación', () => {
    expect(esNavegacion({ method: 'POST', url: '/', headers: NAVEGACION })).toBe(false)
  })

  test('HEAD sí navega', () => {
    expect(esNavegacion({ method: 'HEAD', url: '/', headers: NAVEGACION })).toBe(true)
  })
})

describe('entradaAutomatica', () => {
  test('la raíz va a la entrada sin destino', () => {
    expect(entradaAutomatica('/')).toBe('/__dev/boot')
  })

  test('el enlace pedido se conserva codificado', () => {
    expect(entradaAutomatica('/perfil?tab=historial')).toBe(
      '/__dev/boot?next=%2Fperfil%3Ftab%3Dhistorial',
    )
  })

  test('una ruta que no es local no se cuela en el destino', () => {
    expect(entradaAutomatica('//evil.example/robo')).toBe('/__dev/boot')
    expect(entradaAutomatica('https://evil.example/robo')).toBe('/__dev/boot')
  })
})

describe('sesionVigente', () => {
  test('sin cookie no hay nada que comprobar', async () => {
    let llamadas = 0
    const fetchFalso = (async () => {
      llamadas += 1
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    expect(await sesionVigente(undefined, 'http://127.0.0.1:7717/api/health', fetchFalso)).toBe(
      false,
    )
    expect(await sesionVigente('   ', 'http://127.0.0.1:7717/api/health', fetchFalso)).toBe(false)
    expect(llamadas).toBe(0)
  })

  test('pregunta a la salud con la cookie y acepta un 200', async () => {
    let vista: { url: string; cookie: string | undefined } | undefined
    const fetchFalso = (async (url: string, init?: RequestInit) => {
      vista = { url, cookie: (init?.headers as Record<string, string> | undefined)?.cookie }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    expect(
      await sesionVigente('nn_session=buena', 'http://127.0.0.1:7717/api/health', fetchFalso),
    ).toBe(true)
    expect(vista).toEqual({
      url: 'http://127.0.0.1:7717/api/health',
      cookie: 'nn_session=buena',
    })
  })

  test('un 401 es una sesión que ya no vale', async () => {
    const fetchFalso = (async () => new Response('', { status: 401 })) as unknown as typeof fetch

    expect(
      await sesionVigente('nn_session=vieja', 'http://127.0.0.1:7717/api/health', fetchFalso),
    ).toBe(false)
  })

  test('si el server no contesta se deja pasar a Vite', async () => {
    const fetchFalso = (async () => {
      throw new Error('sin servidor')
    }) as unknown as typeof fetch

    expect(
      await sesionVigente('nn_session=buena', 'http://127.0.0.1:7717/api/health', fetchFalso),
    ).toBe(true)
  })
})
