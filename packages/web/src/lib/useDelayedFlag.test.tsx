import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { DELAY_ESQUELETO_MS, DelayedFlag, useDelayedFlag } from './useDelayedFlag'

/**
 * El retraso del esqueleto.
 *
 * Dos cosas que medir y que no se ven en una captura: que una espera corta no
 * llegue a encender el aviso —la respuesta rápida no parpadea— y que una espera
 * cancelada no encienda nada después. La primera versión de esto encendía el
 * esqueleto con la respuesta ya en pantalla; no rompía ninguna prueba, sólo se
 * veía un parpadeo.
 *
 * La mecánica se prueba en su clase, con temporizadores de verdad y esperas de
 * milisegundos, porque el gancho sólo la envuelve. El gancho se mide con
 * `renderToString`, que es lo único que se puede hacer sin un DOM.
 */

const espera = (ms: number): Promise<void> => Bun.sleep(ms)

describe('DelayedFlag', () => {
  test('con una espera corta no se enciende', async () => {
    const avisos: boolean[] = []
    const flag = new DelayedFlag((visible) => avisos.push(visible), 20)

    flag.update(true)
    await espera(5)
    flag.cancel()

    expect(avisos).toEqual([])
  })

  test('con la espera cumplida se enciende una sola vez', async () => {
    const avisos: boolean[] = []
    const flag = new DelayedFlag((visible) => avisos.push(visible), 10)

    flag.update(true)
    await espera(30)

    expect(avisos).toEqual([true])
  })

  test('pasar a inactivo apaga el aviso', () => {
    const avisos: boolean[] = []
    const flag = new DelayedFlag((visible) => avisos.push(visible), 1000)

    flag.update(false)

    expect(avisos).toEqual([false])
  })

  test('actualizar cancela la espera anterior', async () => {
    const avisos: boolean[] = []
    const flag = new DelayedFlag((visible) => avisos.push(visible), 10)

    flag.update(true)
    flag.update(true)
    await espera(30)

    // Dos programaciones y un solo encendido: la primera se canceló.
    expect(avisos).toEqual([true])
  })

  test('cancelar después de encendido no apaga el aviso', async () => {
    const avisos: boolean[] = []
    const flag = new DelayedFlag((visible) => avisos.push(visible), 10)

    flag.update(true)
    await espera(30)
    flag.cancel()

    expect(avisos).toEqual([true])
  })

  test('el umbral por defecto es de 150 ms', () => {
    expect(DELAY_ESQUELETO_MS).toBe(150)
  })
})

function Sonda(): ReactNode {
  const visible = useDelayedFlag(true, 10)

  return <span>{visible ? 'esqueleto' : 'nada'}</span>
}

describe('useDelayedFlag en el primer render', () => {
  test('el servidor no enseña el estado intermedio', () => {
    // Sin efectos no hay temporizador: el primer render nunca lo enseña.
    expect(renderToString(<Sonda />)).toContain('nada')
  })
})
