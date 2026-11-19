/**
 * El cargador del SDK de Google Cast.
 *
 * Es el único guion de terceros de la aplicación. No se carga al abrir la
 * página: se pide cuando alguien abre el mando de transmitir, y sólo si el
 * servidor dijo que la función está encendida. Sin `RONA_CAST=1` no hay
 * petición a `gstatic`, y la CSP no se relaja.
 *
 * La carga es idempotente: dos clics seguidos comparten la misma promesa. Si el
 * guion falla o tarda más de diez segundos, se rechaza con un motivo que la
 * interfaz puede enseñar; la caché se limpia para que un reintento sea posible.
 */

export const CAST_SDK_URL =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

const DEFAULT_TIMEOUT_MS = 10_000

/** Lo que el cargador necesita de un `<script>`. */
export interface CastSdkScript {
  src: string
  async: boolean
  onload: (() => void) | null
  onerror: (() => void) | null
}

/** Lo mínimo del documento para inyectar el guion; en tests, un doble. */
export interface CastSdkDocument {
  createElement(tag: 'script'): CastSdkScript
  head: { append(nodo: CastSdkScript): void }
}

/** Lo mínimo de la ventana para saber si el SDK ya está listo. */
export interface CastSdkWindow {
  cast?: { framework?: unknown }
}

export interface CastSdkOptions {
  readonly document?: CastSdkDocument
  readonly window?: CastSdkWindow
  readonly timeoutMs?: number
}

/** ¿El SDK ya está cargado y con su `framework`? */
function yaCargado(window: CastSdkWindow): boolean {
  return window.cast?.framework !== undefined
}

const cargas = new WeakMap<CastSdkWindow, Promise<void>>()

export function cargarCastSdk(options: CastSdkOptions = {}): Promise<void> {
  const ventana =
    options.window ??
    (typeof window === 'undefined' ? undefined : (window as unknown as CastSdkWindow))
  const documento =
    options.document ??
    (typeof document === 'undefined' ? undefined : (document as unknown as CastSdkDocument))

  if (ventana === undefined || documento === undefined) {
    return Promise.reject(new Error('el cast necesita un navegador'))
  }

  if (yaCargado(ventana)) return Promise.resolve()

  const existente = cargas.get(ventana)
  if (existente !== undefined) return existente

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const carga = new Promise<void>((resolve, reject) => {
    const script = documento.createElement('script')
    let temporizador: ReturnType<typeof setTimeout> | undefined

    const limpiar = (): void => {
      if (temporizador !== undefined) clearTimeout(temporizador)
      script.onload = null
      script.onerror = null
    }

    temporizador = setTimeout(() => {
      limpiar()
      reject(new Error('el SDK de Cast no cargó a tiempo'))
    }, timeoutMs)

    script.src = CAST_SDK_URL
    script.async = true
    script.onload = () => {
      limpiar()

      if (yaCargado(ventana)) {
        resolve()
      } else {
        reject(new Error('el SDK de Cast cargó sin `cast.framework`'))
      }
    }
    script.onerror = () => {
      limpiar()
      reject(new Error('no se pudo cargar el SDK de Cast'))
    }

    documento.head.append(script)
  }).catch((error: unknown) => {
    cargas.delete(ventana)

    throw error
  })

  cargas.set(ventana, carga)

  return carga
}
