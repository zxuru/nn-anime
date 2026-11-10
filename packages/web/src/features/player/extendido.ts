/**
 * La preferencia del modo extendido, recordada entre visitas.
 *
 * El modo extendido no es la pantalla completa del navegador: llena la ventana
 * de la aplicación sin pedirle nada al sistema, así que el tamaño de la ventana
 * —y su barra de título nativa en el escritorio— no cambia. Es una preferencia de
 * la ventana y no del visionado, y por eso vive en `localStorage` y no en la base
 * del servidor, igual que la reproducción automática.
 *
 * Todo el acceso pasa por aquí por el mismo motivo que en `storage.ts`:
 * `localStorage` **lanza** —no existe en el renderizado de servidor y un
 * navegador con el almacenamiento bloqueado lo prohíbe—, y una pantalla que no
 * carga porque no pudo leer una preferencia es un fallo. Perder qué modo se
 * eligió es una molestia menor.
 *
 * Las funciones reciben el almacén en vez de buscarlo ellas para poder probarlas
 * sin navegador, que es donde se rompen.
 */

import type { Almacen } from './storage'

/** La clave con la que se guarda si el reproductor abre extendido. */
export const CLAVE_EXTENDIDO = 'nn-anime:extendido'

/**
 * ¿El reproductor debe abrirse en modo extendido?
 *
 * Cualquier cosa que no sea el «sí» que escribe esta aplicación se lee como no:
 * el valor de fábrica es la ventana normal, que es la que enseña la lista de
 * episodios al lado del video.
 */
export function leerExtendido(almacen: Almacen | undefined): boolean {
  if (almacen === undefined) return false

  try {
    return almacen.getItem(CLAVE_EXTENDIDO) === 'si'
  } catch {
    return false
  }
}

/** Guarda la preferencia. Sin sitio para apuntarla, vale para esta visita. */
export function guardarExtendido(almacen: Almacen | undefined, valor: boolean): void {
  if (almacen === undefined) return

  try {
    almacen.setItem(CLAVE_EXTENDIDO, valor ? 'si' : 'no')
  } catch {
    // Un almacén lleno o prohibido no puede impedir reproducir.
  }
}
