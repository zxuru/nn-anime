/**
 * La preferencia de tema que comparte el arranque con la aplicación.
 *
 * El tema de verdad vive en los ajustes del servidor, y `useAppTheme` sigue
 * mandando después de hidratar. Esto es sólo la caché local que
 * `public/theme-boot.js` puede leer antes del primer pintado: sin ella, el
 * navegador no tiene forma de saber que se guardó claro sobre un sistema oscuro
 * y pinta el fondo oscuro hasta que llega `GET /api/settings`.
 *
 * La clave y los colores del arranque temprano están duplicados en el script.
 * No se pueden importar desde aquí: la CSP obliga a que sea un archivo suelto y
 * clásico. Una prueba lee los dos y falla si la clave, los colores o la regla de
 * resolución se separan.
 *
 * Todo acceso al almacén va envuelto: `localStorage` lanza en el renderizado de
 * servidor y en un navegador con el almacenamiento bloqueado. Perder la caché
 * del tema es un destello posible; una aplicación que no arranca por no poder
 * escribir una preferencia es un fallo.
 */

/** Los tres valores que entiende `GET /api/settings`. */
export type TemaPreferido = 'dark' | 'light' | 'system'

/** La clave de `localStorage`. El arranque temprano escribe la misma. */
export const CLAVE_TEMA = 'rona:tema'

/** Lo que hace falta de `localStorage`, para poder pasar uno de mentira. */
export interface AlmacenTema {
  getItem(clave: string): string | null
  setItem(clave: string, valor: string): void
}

function esTema(valor: string | null): valor is TemaPreferido {
  return valor === 'dark' || valor === 'light' || valor === 'system'
}

/** El almacén del navegador, o nada si no se puede tocar. */
export function almacenDeTema(): AlmacenTema | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/** Lo guardado por el selector de tema, si es un valor que entendemos. */
export function leerTemaPreferido(almacen = almacenDeTema()): TemaPreferido | undefined {
  if (almacen === undefined) return undefined

  try {
    const valor = almacen.getItem(CLAVE_TEMA)

    return esTema(valor) ? valor : undefined
  } catch {
    return undefined
  }
}

/** Guarda el tema para el próximo arranque. Un fallo no rompe nada. */
export function guardarTemaPreferido(tema: TemaPreferido, almacen = almacenDeTema()): void {
  if (almacen === undefined) return

  try {
    almacen.setItem(CLAVE_TEMA, tema)
  } catch {
    // Sin caché se vuelve al sistema en el próximo arranque; no es un fallo.
  }
}
