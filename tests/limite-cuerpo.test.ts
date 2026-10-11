/**
 * El tope de cuerpo, contra un servidor de verdad.
 *
 * No se puede probar con `app.request()`: el tope lo aplica `Bun.serve` antes de
 * que la petición llegue al manejador, así que esta prueba levanta el servidor
 * como lo levanta el arranque y le manda un cuerpo por encima del límite. Sin
 * ella, quitar `maxRequestBodySize` no pondría nada rojo y el tope volvería a ser
 * el de por defecto: 128 MiB acumulados en memoria por cada petición.
 */

import { describe, expect, test } from 'bun:test'
import { openDb } from '@nn-anime/catalog-store'
import {
  createContainer,
  createSession,
  MAX_REQUEST_BODY_BYTES,
  SESSION_COOKIE,
  startServer,
} from '@nn-anime/server'

describe('el cuerpo de una petición tiene tope', () => {
  test(`un cuerpo de más de ${MAX_REQUEST_BODY_BYTES} bytes no se lee`, async () => {
    const session = createSession()
    const container = createContainer({ db: openDb(':memory:') })
    const servidor = startServer({
      port: 0,
      session,
      bootToken: 'token-de-prueba',
      version: '0.1.0',
      container,
    })

    try {
      const cabeceras = {
        cookie: `${SESSION_COOKIE}=${session.value}`,
        origin: servidor.url,
        'content-type': 'application/json',
      }

      // Un byte por encima del tope: lo que se comprueba es la frontera, no un
      // cuerpo enorme que también fallaría por otras razones.
      const grande = `{"ref":{"providerId":"x","value":"${'a'.repeat(MAX_REQUEST_BODY_BYTES)}"}}`
      const respuesta = await fetch(`${servidor.url}/api/favorites`, {
        method: 'POST',
        headers: cabeceras,
        body: grande,
      })

      expect(respuesta.status).toBe(413)

      // Y una petición normal sigue pasando: un tope que rompe el uso legítimo
      // no es un tope, es una avería.
      const pequena = await fetch(`${servidor.url}/api/favorites`, {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify({ ref: { providerId: 'x', value: 'y' }, value: true }),
      })

      expect(pequena.status).not.toBe(413)
    } finally {
      await servidor.stop()
      await container.close().catch(() => {})
    }
  })
})
