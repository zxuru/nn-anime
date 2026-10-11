import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { WatchPage } from './WatchPage'

const DIRECCION = '/watch/fixture/aurora-nocturna%233?anime=aurora-nocturna'

function render(node: ReactNode, path: string = DIRECCION): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory(path)}>{node}</HistoryProvider>,
  )
}

function pantalla(path?: string): string {
  return render(<WatchPage providerId="fixture" ref="aurora-nocturna#3" />, path)
}

describe('la salida de la pantalla de reproducción', () => {
  /**
   * La ficha es a donde se vuelve.
   *
   * La cabecera de la aplicación lleva a la home, no al título, así que sin este
   * enlace la única vuelta era el botón de atrás del navegador: en una pantalla
   * que se pone a pantalla completa, eso es no tener vuelta.
   */
  test('lleva a la ficha del título que se está viendo', () => {
    const html = pantalla()

    expect(html).toContain('href="/anime/fixture/aurora-nocturna"')
    expect(html).toContain('Volver a la ficha')
  })

  /**
   * El destino no se adivina dos veces.
   *
   * La referencia del título es la que la dirección trae en `?anime=`, que la
   * escribió la ficha. Cuando no la trae —una dirección escrita a mano— queda la
   * deducción del episodio, que es la misma que usa el registro del visionado.
   */
  test('sin el título en la dirección, la vuelta usa el del episodio', () => {
    const html = pantalla('/watch/fixture/aurora-nocturna%233')

    expect(html).toContain('href="/anime/fixture/aurora-nocturna"')
  })
})
