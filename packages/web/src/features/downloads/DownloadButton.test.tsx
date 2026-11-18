import { describe, expect, test } from 'bun:test'
import { downloadStartRequestSchema } from '@rona/core/api'
import type { ProviderCapabilities, ProviderRef } from '@rona/core/models'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import {
  BotonDeDescarga,
  DownloadButton,
  modoDeAudio,
  modosDelProveedor,
  pedirDescarga,
} from './DownloadButton'

const REF: ProviderRef = { providerId: 'fixture', value: 'aurora-nocturna#1' }

function render(node: ReactNode): string {
  return renderToString(node)
}

function capacidades(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    search: true,
    sub: true,
    dub: false,
    trending: false,
    ...overrides,
    feed: overrides.feed ?? false,
  }
}

describe('el botón de descargar', () => {
  /**
   * Sin esperar a la fuente.
   *
   * El estado inicial del componente es «listo»: el efecto que lee
   * `/api/providers` corre después del primer render y el botón no lo espera. Si
   * volviera la comprobación bloqueante, este render —que no ejecuta efectos— se
   * quedaría en «comprobando» y no habría botón.
   */
  test('está desde el primer render, declare lo que declare la fuente', () => {
    const html = render(<DownloadButton providerId="fixture" animeRef={REF} episodeRef={REF} />)

    expect(html).toContain('Descargar')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  /**
   * El motivo es un tooltip, no un párrafo.
   *
   * Anclado al encabezado del reproductor, un texto de error al lado empujaba la
   * sala y rompía la medida de «cabe en una ventana». El `title` lo muestra el
   * navegador al pasar por encima; el `solo-lectores` mantiene el aviso para
   * quien no ve el tooltip.
   */
  test('el fallo va en el `title` y en la región que se anuncia', () => {
    const html = render(
      <BotonDeDescarga
        estado="error"
        mensaje="el proveedor no dio stream"
        onDescargar={() => {}}
      />,
    )

    expect(html).toContain('title="el proveedor no dio stream"')
    expect(html).toContain('solo-lectores')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('downloads__error')
  })

  test('un fallo no cierra el botón: volver a pulsar es el reintento', () => {
    const html = render(<BotonDeDescarga estado="error" mensaje="sin red" onDescargar={() => {}} />)

    expect(html).not.toContain('disabled')
    expect(html).toContain('Descargar')
  })

  test('mientras guarda y una vez en cola no se pide dos veces', () => {
    const guardando = render(<BotonDeDescarga estado="guardando" onDescargar={() => {}} />)
    const hecha = render(<BotonDeDescarga estado="hecho" onDescargar={() => {}} />)

    expect(guardando).toContain('disabled')
    expect(guardando).toContain('Enviando…')
    expect(hecha).toContain('disabled')
    expect(hecha).toContain('En cola')
  })
})

describe('la elección de audio antes de descargar', () => {
  test('con las dos capacidades se ofrecen los dos modos y se marca el elegido', () => {
    const html = render(
      <BotonDeDescarga
        estado="listo"
        modes={['sub', 'dub']}
        mode="dub"
        onMode={() => {}}
        onDescargar={() => {}}
      />,
    )

    expect(html).toContain('audio-switch')
    expect(html).toContain('Subtitulado')
    expect(html).toContain('Doblado')
    // El activo es el que se va a mandar, y se lee sin abrir nada.
    expect(html).toMatch(/aria-pressed="true">Doblado/)
    expect(html).toMatch(/aria-pressed="false">Subtitulado/)
  })

  /**
   * Con una sola capacidad no se pregunta: la descarga se manda con la que hay.
   * Un conmutador de un solo botón no es una elección y, además, prometería un
   * modo que la fuente no sirve.
   */
  test('con una sola capacidad no hay conmutador', () => {
    const html = render(
      <BotonDeDescarga
        estado="listo"
        modes={['dub']}
        mode="dub"
        onMode={() => {}}
        onDescargar={() => {}}
      />,
    )

    expect(html).not.toContain('audio-switch')
    expect(html).toContain('Descargar')
  })

  test('las capacidades del proveedor se traducen a los modos que la interfaz sabe pedir', () => {
    expect(modosDelProveedor(capacidades({ dub: true }))).toEqual(['sub', 'dub'])
    expect(modosDelProveedor(capacidades())).toEqual(['sub'])
    expect(modosDelProveedor(capacidades({ sub: false, dub: true }))).toEqual(['dub'])
    expect(modosDelProveedor(undefined)).toEqual([])
  })

  test('lo elegido manda; sin elección, el primer modo disponible', () => {
    expect(modoDeAudio(['sub', 'dub'], 'dub')).toBe('dub')
    expect(modoDeAudio(['sub', 'dub'], undefined)).toBe('sub')
    expect(modoDeAudio(['dub'], undefined)).toBe('dub')
    // Una preferencia que la fuente ya no ofrece no puede abrir un modo que falla.
    expect(modoDeAudio(['sub'], 'dub')).toBe('sub')
    // Sin lectura de proveedores se conserva el respaldo de siempre.
    expect(modoDeAudio([], undefined)).toBe('sub')
  })

  /**
   * El cuerpo que de verdad se manda.
   *
   * No basta con que exista una función que sepa construir el `mode`: lo que
   * viaja en el `POST` es lo que el servidor guarda y con lo que la cola resuelve
   * el stream. Se mide sobre el `fetch` inyectado, no sobre una copia.
   */
  test('el modo elegido viaja en el cuerpo del alta', async () => {
    const cuerpos: unknown[] = []
    const deps = {
      fetch: (_input: string, init: RequestInit): Promise<Response> => {
        cuerpos.push(init.body === undefined ? undefined : JSON.parse(String(init.body)))
        return Promise.resolve(
          new Response(JSON.stringify({ id: 7 }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        )
      },
    }

    await pedirDescarga({ providerId: 'fixture', animeRef: REF, episodeRef: REF }, 'dub', deps)

    expect(cuerpos).toHaveLength(1)
    // Se valida con el schema del contrato: un campo que el servidor no admite
    // no puede colarse por una prueba escrita a mano.
    expect(downloadStartRequestSchema.parse(cuerpos[0])).toEqual({
      providerId: 'fixture',
      animeRef: REF,
      episodeRef: REF,
      mode: 'dub',
    })
  })
})
