import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../../api/client'
import { muestraBotonSala, readPartyAvailable } from './usePartyAvailable'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

/** El health tal como lo devuelve el servidor (T300). */
function salud(party: boolean): Record<string, unknown> {
  return { version: '0.9.0', port: 7717, mpv: false, party, providers: [] }
}

describe('lo que el health dice del party', () => {
  test('se lee de `/api/health` y no se inventa', async () => {
    let pedida = ''
    const deps = {
      fetch: async (url: string) => {
        pedida = url

        return Response.json(salud(false))
      },
    }

    expect(await readPartyAvailable({ deps })).toBe(false)
    expect(pedida).toBe('/api/health')
  })

  test('con la sala montada devuelve true', async () => {
    const deps = { fetch: async () => Response.json(salud(true)) }

    expect(await readPartyAvailable({ deps })).toBe(true)
  })

  test('un health que falla se propaga: no se supone que haya sala', async () => {
    const deps = { fetch: async () => new Response('no', { status: 500 }) }

    await expect(readPartyAvailable({ deps })).rejects.toBeInstanceOf(ApiError)
  })

  /**
   * El caso que reportó el fallo: `party: false`, que es el servidor de fábrica.
   * El mando no se pinta y no hay ningún panel que pueda responder «esa sala no
   * existe». La reproducción no depende de esta lectura.
   */
  test('con party apagado el mando no se ofrece', () => {
    expect(muestraBotonSala('no')).toBe(false)
    // Y sin confirmación tampoco: ni mientras se comprueba ni si el health falla.
    expect(muestraBotonSala('comprobando')).toBe(false)
    expect(muestraBotonSala('sin-saber')).toBe(false)
    expect(muestraBotonSala('si')).toBe(true)
  })

  test('la pantalla de reproducción consulta el health antes de ofrecer la sala', async () => {
    const fuente = await readFile(`${ROOT}../player/WatchPage.tsx`, 'utf8')

    expect(fuente).toContain('usePartyAvailable')
    expect(fuente).toContain('muestraBotonSala(sala)')
  })
})
