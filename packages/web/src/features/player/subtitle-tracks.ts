/**
 * Pistas de subtítulos que el reproductor web puede ofrecer.
 *
 * El navegador entiende `vtt` y no entiende `ass`: un `<track>` con un `ass`
 * apunta a algo que el reproductor no puede pintar, así que la pista se omite
 * **en la web** aunque el proxy la sirva tal cual para mpv (T30). Omitir y no
 * fallar es lo correcto: la pista existe, este reproductor no la sabe usar.
 *
 * La dirección tiene que ser una ruta del proxy —el ticket— y no una del
 * upstream: si un proveedor colara una dirección absoluta, se estaría pidiendo a
 * un tercero desde la página. Es la misma lista blanca de esquemas (T31a) usada
 * con criterio: aquí sólo valen las rutas internas.
 */

import type { SafeTrack } from './usePlayer'

export interface SubtitleCandidate {
  readonly url: string
  readonly lang?: string | undefined
  readonly label?: string | undefined
  readonly format?: string | undefined
}

/** Un `<track>` de la web: ruta del proxy y formato que el navegador entiende. */
export interface WebTrack {
  readonly url: string
  readonly lang: string
  readonly label: string
}

/** ¿La dirección es una ruta del proxy? */
export function isProxyPath(url: string): boolean {
  return url.startsWith('/api/subtitles/') || url.startsWith('/stream/')
}

/**
 * Las pistas que se pueden ofrecer, en orden.
 *
 * Se descartan las que el navegador no entiende —`ass`— y las que no son una
 * ruta interna. El idioma y la etiqueta se conservan tal cual: son datos del
 * proveedor y sirven para que el usuario elija.
 */
export function webTracks(candidatas: readonly SubtitleCandidate[]): readonly WebTrack[] {
  return candidatas
    .filter((candidata) => candidata.format !== 'ass' && isProxyPath(candidata.url))
    .map((candidata) => ({
      url: candidata.url,
      lang: candidata.lang ?? '',
      label: candidata.label ?? candidata.lang ?? '',
    }))
}

/**
 * El índice de la pista que viene marcada por defecto.
 *
 * Es la primera: el proveedor las ordena por preferencia, y elegir otra sería
 * contradecirle sin motivo. Sin pistas, `-1`.
 */
export function defaultTrackIndex(pistas: readonly WebTrack[]): number {
  return pistas.length === 0 ? -1 : 0
}

/** Las pistas de una fuente de reproducción, ya filtradas para la web. */
export function tracksFromSource(source: {
  readonly subtitles?: readonly SubtitleCandidate[] | undefined
}): readonly WebTrack[] {
  return webTracks(source.subtitles ?? [])
}

/** Lo que `usePlayer` necesita para pintar los `<track>`. */
export function toSafeTracks(pistas: readonly WebTrack[]): readonly SafeTrack[] {
  return pistas.map((pista) => ({ url: pista.url, lang: pista.lang, label: pista.label }))
}
