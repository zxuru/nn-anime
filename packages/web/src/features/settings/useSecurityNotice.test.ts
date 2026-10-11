import { describe, expect, test } from 'bun:test'
import { loadNotice } from './useSecurityNotice'

/**
 * La descarga del aviso, con un doble de `fetch`.
 *
 * Se prueba la función y no el gancho porque lo que puede fallar está aquí: que
 * una respuesta que no es 200 no se tome por un documento, y que el texto llegue
 * entero. El gancho sólo la llama.
 */

function responder(response: Response): { fetch: (input: string) => Promise<Response> } {
  return { fetch: async () => response }
}

describe('la descarga del aviso', () => {
  test('pide la ruta relativa, nunca una URL absoluta', async () => {
    const pedidas: string[] = []
    const deps = {
      fetch: async (input: string): Promise<Response> => {
        pedidas.push(input)
        return new Response('# Seguridad\n')
      },
    }

    expect(await loadNotice(deps)).toBe('# Seguridad\n')
    expect(pedidas).toEqual(['/SECURITY.md'])
  })

  test('la sesión viaja en la cookie, sin adjuntar nada a mano', async () => {
    let credenciales: RequestCredentials | undefined
    const deps = {
      fetch: async (_input: string, init: RequestInit): Promise<Response> => {
        credenciales = init.credentials
        return new Response('ok')
      },
    }

    await loadNotice(deps)
    expect(credenciales).toBe('same-origin')
  })

  test('una respuesta de error no se toma por un documento', async () => {
    const deps = responder(new Response('no está', { status: 404, statusText: 'Not Found' }))

    expect(loadNotice(deps)).rejects.toThrow('404 Not Found')
  })

  test('un error de red se propaga tal cual', async () => {
    const deps = {
      fetch: async (): Promise<Response> => {
        throw new Error('sin red')
      },
    }

    expect(loadNotice(deps)).rejects.toThrow('sin red')
  })
})
