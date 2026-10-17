import { describe, expect, test } from 'bun:test'
import type { WatchHistoryItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { t } from '../../i18n'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { HistoryPage, historyPagePath } from './HistoryPage'
import { PiezaDeHistorial, ProfilePage } from './ProfilePage'
import { historyPath, pageOfPath } from './useProfile'

function render(element: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/')}>{element}</HistoryProvider>,
  )
}

/** Un visionado del historial, con lo mínimo que la pieza mira. */
function item(extra: Partial<WatchHistoryItem> = {}): WatchHistoryItem {
  return {
    id: 1,
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#3' },
    episodeNumber: 3,
    mode: 'sub',
    positionS: 600,
    durationS: 1440,
    ratio: 0.4166,
    watchedAt: '2026-10-12T10:00:00.000Z',
    finished: false,
    ...extra,
  }
}

/**
 * La ruta de una página del Historial.
 *
 * La página va **siempre** en la lectura —una dirección sin página y otra con
 * `?page=1` son dos claves distintas en la caché del cliente— pero la primera no se
 * escribe en la dirección: `?page=1` y la ausencia del parámetro son la misma
 * pantalla, y dos direcciones para lo mismo le dan al botón de atrás dos entradas
 * donde sólo hubo un movimiento.
 */
describe('la página del historial, en la dirección', () => {
  test('la lectura lleva siempre su página', () => {
    expect(historyPath(1)).toBe('/api/watch/history?page=1')
    expect(historyPath(7)).toBe('/api/watch/history?page=7')
  })

  test('la primera página no se escribe en la dirección', () => {
    expect(historyPagePath(1)).toBe('/history')
    expect(historyPagePath(2)).toBe('/history?page=2')
  })

  test('lo que no se entiende como página es la primera', () => {
    expect(pageOfPath('/history')).toBe(1)
    expect(pageOfPath('/history?page=3')).toBe(3)
    // Cero, negativo, decimal, texto y vacío caen a la 1: pedir «la página 0» al
    // servidor sería un 400 que la pantalla no ha provocado.
    expect(pageOfPath('/history?page=0')).toBe(1)
    expect(pageOfPath('/history?page=-2')).toBe(1)
    expect(pageOfPath('/history?page=1.5')).toBe(1)
    expect(pageOfPath('/history?page=abc')).toBe(1)
    expect(pageOfPath('/history?page=')).toBe(1)
  })
})

/**
 * Una pieza del historial.
 *
 * Es una tarjeta del historial, así que lleva episodio y progreso, y el terminado lo
 * dice **con una palabra**: un 100 % y un «terminado» no se distinguen por el color
 * cuando no se ve el color.
 */
describe('la pieza de un visionado', () => {
  test('el que está a medias lleva su episodio y su barra', () => {
    const html = render(<PiezaDeHistorial item={item()} indice={0} />)

    expect(html).toContain('Aurora Nocturna')
    expect(html).toContain(t(DEFAULT_LOCALE, 'home.episode', { number: 3 }))
    // La barra es un `<progress>` de verdad y su etiqueta accesible dice el
    // porcentaje: sin ella, quien no ve la barra no sabe cuánto se vio.
    expect(html).toContain('<progress')
    expect(html).toContain(t(DEFAULT_LOCALE, 'history.watched', { percent: 42 }))
    expect(html).not.toContain(t(DEFAULT_LOCALE, 'history.finished'))
  })

  test('el terminado lo dice con una palabra, no sólo con la barra llena', () => {
    const html = render(
      <PiezaDeHistorial item={item({ positionS: 1440, ratio: 1, finished: true })} indice={0} />,
    )

    expect(html).toContain(t(DEFAULT_LOCALE, 'history.finished'))
    // Y no promete un tiempo restante que ya no existe.
    expect(html).not.toContain(t(DEFAULT_LOCALE, 'home.remaining', { time: '0 min' }))
  })

  test('el enlace va al episodio con su número detrás de la almohadilla', () => {
    const html = render(<PiezaDeHistorial item={item()} indice={0} />)

    expect(html).toContain('/watch/fixture/aurora-nocturna%233')
  })
})

/**
 * Las dos pantallas, en su primer render.
 *
 * El primer render **no depende de la red**: sale el esqueleto y se dice qué está
 * llegando. Lo que necesita un navegador —las cuatro secciones con datos, el
 * troceado de páginas— es del e2e, y así está declarado en el plan.
 */
describe('el primer render de las pantallas', () => {
  test('el Perfil arranca cargando, sin pedir nada todavía', () => {
    const html = render(<ProfilePage />)

    expect(html).toContain(t(DEFAULT_LOCALE, 'profile.loading'))
    expect(html).toContain('aria-busy="true"')
  })

  test('el Historial arranca cargando, sin pedir nada todavía', () => {
    const html = render(<HistoryPage path="/history" />)

    expect(html).toContain(t(DEFAULT_LOCALE, 'history.loading'))
    expect(html).toContain('aria-busy="true"')
  })
})
