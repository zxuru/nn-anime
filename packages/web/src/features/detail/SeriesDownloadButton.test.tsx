import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { BotonDeSerie, SeriesDownloadButton, textoDeSerie } from './SeriesDownloadButton'

const REF = { providerId: 'fixture', value: 'aurora-nocturna' }

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{node}</HistoryProvider>,
  )
}

describe('el botón de descargar la serie', () => {
  /**
   * Desde el primer render, sin consultar la fuente.
   *
   * Descargar no es una capacidad del plugin: la aplicación resuelve el stream.
   * Si volviera una comprobación de `capabilities.download`, este render —que no
   * ejecuta efectos— se quedaría sin botón.
   */
  test('está desde el primer render y no nace deshabilitado', () => {
    const html = render(<SeriesDownloadButton providerId="fixture" animeRef={REF} />)

    expect(html).toContain('Descargar la serie')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  test('una película se apunta con su propio rótulo', () => {
    const html = render(<BotonDeSerie estado="listo" movie onDescargar={() => {}} />)

    expect(html).toContain('Descargar la película')
  })

  /** Mientras envía no se puede pedir dos veces. */
  test('mientras envía se cierra y lo dice', () => {
    const html = render(<BotonDeSerie estado="enviando" onDescargar={() => {}} />)

    expect(html).toContain('disabled')
    expect(html).toContain('Apuntando los capítulos…')
  })

  /**
   * Tres desenlaces y tres textos.
   *
   * «En cola» no es lo mismo que «ya está» ni que «quedó a medias»: el primero se
   * resuelve solo, el segundo no hay que tocarlo y el tercero se mira en la
   * biblioteca. Un único «hecho» dejaría al usuario sin saber qué hacer.
   */
  test('cuenta lo que espera turno y enlaza a la biblioteca', () => {
    const html = render(
      <BotonDeSerie
        estado="hecho"
        respuesta={{ episodes: 12, pending: 12, complete: 0 }}
        onDescargar={() => {}}
      />,
    )

    expect(html).toContain('12 de 12 capítulos en cola')
    expect(html).toContain('Ver la biblioteca')
    expect(html).toContain('href="/library"')
    expect(html).not.toContain('disabled')
  })

  test('con la serie completa lo dice y no anuncia trabajo', () => {
    const html = render(
      <BotonDeSerie
        estado="hecho"
        respuesta={{ episodes: 12, pending: 0, complete: 12 }}
        onDescargar={() => {}}
      />,
    )

    expect(html).toContain('Ya está descargada.')
    expect(html).not.toContain('en cola')
  })

  test('lo que quedó a medias dice cuántos hay, sin prometer que se bajan', () => {
    const html = render(
      <BotonDeSerie
        estado="hecho"
        respuesta={{ episodes: 12, pending: 0, complete: 8 }}
        onDescargar={() => {}}
      />,
    )

    expect(html).toContain('8 de 12 capítulos descargados.')
    expect(html).not.toContain('en cola')
  })

  test('un título sin capítulos lo dice en vez de apuntar nada', () => {
    expect(textoDeSerie('hecho', { episodes: 0, pending: 0, complete: 0 }, undefined)).toBe(
      'Este título no tiene capítulos que descargar.',
    )
  })

  /**
   * El fallo no cierra el botón: volver a pulsar es el reintento. Y el aviso es
   * una región viva, no un párrafo que aparece sin anunciarse.
   */
  test('el fallo se anuncia y deja reintentar', () => {
    const html = render(<BotonDeSerie estado="error" mensaje="sin red" onDescargar={() => {}} />)

    expect(html).toContain('role="alert"')
    expect(html).toContain('sin red')
    expect(html).not.toContain('disabled')
  })

  test('el estado de la petición, en texto, sin redondearlo a «hecho»', () => {
    expect(textoDeSerie('listo', undefined, undefined)).toBeUndefined()
    expect(textoDeSerie('enviando', undefined, undefined)).toBe('Apuntando los capítulos…')
  })
})
