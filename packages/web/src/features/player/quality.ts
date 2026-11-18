/**
 * La calidad preferida del reproductor.
 *
 * El contrato de `POST /api/stream/resolve` ya acepta `preferredQuality` y el
 * catálogo la respeta al elegir la fuente que cachea. La interfaz no puede
 * inventar una query nueva: manda el campo tal y como está pactado y, cuando la
 * respuesta trae varias fuentes, elige la que coincide. Si ninguna coincide, se
 * queda la primera, que es el orden de preferencia del proveedor —la misma regla
 * que aplica `chooseSource` en `catalog-store`—.
 *
 * La lista es cerrada porque el ajuste se elige de una lista y no se teclea: un
 * valor libre acabaría guardado en `localStorage` y viajaría al servidor sin que
 * nadie lo hubiera ofrecido.
 */

import type { StreamSourceResponse } from '@rona/core/api'

/** Las calidades que ofrece el ajuste, de la más alta a la más baja. */
export const CALIDADES = ['1080p', '720p', '480p', '360p'] as const

export type Calidad = (typeof CALIDADES)[number]

/** ¿Este texto es una de las calidades que el ajuste sabe guardar? */
export function esCalidad(valor: unknown): valor is Calidad {
  return CALIDADES.some((calidad) => calidad === valor)
}

/**
 * La fuente que toca reproducir de las que devolvió el servidor.
 *
 * Sin preferencia —o sin coincidencia— manda la primera: la respuesta del
 * proveedor ya viene en su orden y no hay motivo para reordenarla aquí. Se
 * devuelve `undefined` sólo si no hay ninguna fuente, que es el caso que la
 * pantalla ya trata como «este episodio no está».
 */
export function elegirFuente(
  sources: readonly StreamSourceResponse[],
  calidad: Calidad | undefined,
): StreamSourceResponse | undefined {
  if (calidad === undefined) return sources[0]

  return sources.find((source) => source.quality === calidad) ?? sources[0]
}
