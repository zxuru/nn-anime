import { describe, expect, test } from 'bun:test'
import {
  CAST_SDK_URL,
  type CastSdkDocument,
  type CastSdkScript,
  type CastSdkWindow,
  cargarCastSdk,
} from './cast-sdk'

function entorno(): {
  readonly ventana: CastSdkWindow
  readonly documento: CastSdkDocument
  readonly guion: () => CastSdkScript | undefined
} {
  const ventana: CastSdkWindow = {}
  let script: CastSdkScript | undefined

  const documento: CastSdkDocument = {
    createElement: () => {
      script = { src: '', async: false, onload: null, onerror: null }

      return script
    },
    head: { append: () => {} },
  }

  return { ventana, documento, guion: () => script }
}

describe('el cargador del SDK de Cast', () => {
  test('el guion es el de gstatic y pide el framework', () => {
    expect(CAST_SDK_URL).toBe(
      'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1',
    )
  })

  test('carga una sola vez y resuelve cuando `cast.framework` está listo', async () => {
    const { ventana, documento, guion } = entorno()

    const primera = cargarCastSdk({ window: ventana, document: documento })
    const segunda = cargarCastSdk({ window: ventana, document: documento })

    expect(segunda).toBe(primera)
    expect(guion()?.src).toBe(CAST_SDK_URL)
    expect(guion()?.async).toBe(true)

    ventana.cast = { framework: {} }
    guion()?.onload?.()

    await primera
  })

  test('un fallo de red rechaza y deja reintentar', async () => {
    const { ventana, documento, guion } = entorno()

    const primera = cargarCastSdk({ window: ventana, document: documento })
    guion()?.onerror?.()

    await expect(primera).rejects.toThrow('no se pudo cargar el SDK de Cast')

    const reintento = cargarCastSdk({ window: ventana, document: documento })
    expect(reintento).not.toBe(primera)
    guion()?.onerror?.()

    await expect(reintento).rejects.toThrow('no se pudo cargar el SDK de Cast')
  })

  test('si carga sin `cast.framework`, también rechaza', async () => {
    const { ventana, documento, guion } = entorno()

    const carga = cargarCastSdk({ window: ventana, document: documento })
    guion()?.onload?.()

    await expect(carga).rejects.toThrow('sin `cast.framework`')
  })

  test('un guion que no llama ni a onload ni a onerror se corta por plazo', async () => {
    const { ventana, documento } = entorno()

    const carga = cargarCastSdk({ window: ventana, document: documento, timeoutMs: 1 })

    await expect(carga).rejects.toThrow('no cargó a tiempo')
  })

  test('sin navegador rechaza en vez de lanzar', async () => {
    await expect(cargarCastSdk({ window: {}, document: undefined })).rejects.toThrow(
      'el cast necesita un navegador',
    )
  })
})
