/**
 * El diálogo de carpeta del anfitrión Tauri.
 *
 * En el navegador no existe: no hay forma de obtener una ruta absoluta del disco
 * desde la web, y fingirla con un `<input type="file">` daría nombres relativos
 * que el servidor no puede usar. Por eso el botón sólo se pinta cuando el
 * anfitrión está detrás.
 */

declare global {
  interface Window {
    readonly __TAURI_INTERNALS__?: {
      readonly invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
    }
  }
}

export function hayEscritorio(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
}

/** La carpeta elegida, o `undefined` si se canceló o no hay anfitrión. */
export async function elegirCarpetaDescargas(): Promise<string | undefined> {
  const tauri = window.__TAURI_INTERNALS__
  if (tauri === undefined) return undefined

  const ruta = await tauri.invoke<string | null>('elegir_carpeta_descargas')

  return ruta ?? undefined
}
