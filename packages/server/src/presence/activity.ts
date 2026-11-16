/**
 * La actividad que se publica en Discord, como función pura.
 *
 * Aquí no hay red ni estado: recibe una foto del visionado y devuelve el JSON
 * que espera `SET_ACTIVITY`. Todo lo que puede filtrarse —el título, el número
 * de episodio— pasa por `limpiarTexto`, y el título **sólo se usa en el modo
 * completo**. Un título marcado para adultos llega como `null` y se queda en el
 * texto genérico: la presencia no puede delatar lo que el filtro esconde.
 */

/** El Application ID de RoNa en Discord. Es público: no hay secreto que guardar. */
export const DISCORD_APP_ID = '1571721886742876321'

/** La clave del asset subido al portal. Discord la guarda en minúsculas. */
export const ASSET_LARGE = 'rona'

/** Discord recorta los textos a 128 caracteres. */
export const MAX_TEXT = 128

/**
 * En qué consiste el modo discreto.
 *
 * `discreto` no publica el título ni el episodio; `completo` sí. Los dos
 * publican que hay algo reproduciéndose, que es el hecho que el usuario aceptó
 * al encender el ajuste.
 */
export type PresenceMode = 'discreto' | 'completo'

export interface PresenceSnapshot {
  readonly mode: PresenceMode
  /** El título ya resuelto por el servidor, o `null` si es +18 o no se conoce. */
  readonly title: string | null
  readonly episodeNumber: number | undefined
  readonly positionS: number
  readonly durationS: number
  readonly paused: boolean
}

export interface DiscordActivity {
  readonly type: number
  readonly details: string
  readonly state?: string
  readonly timestamps?: { readonly start: number; readonly end: number }
  readonly assets: { readonly large_image: string; readonly large_text: string }
  readonly status_display_type: number
}

/**
 * Deja el texto en una línea y con el tope de Discord.
 *
 * Se cuentan puntos de código y no unidades UTF-16: un emoji o un kanji no
 * pueden ocupar dos posiciones del límite y dejar el texto a medias. Los
 * caracteres de control —saltos, tabuladores, marcas de dirección— se sustituyen
 * por un espacio: Discord pinta una línea y no hay razón para colar un salto.
 */
export function limpiarTexto(texto: string, max: number = MAX_TEXT): string {
  const limpio = texto
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return [...limpio].slice(0, max).join('').trim()
}

/** Un número de segundos utilizable: finito, no negativo y entero. */
function segundos(valor: number): number {
  if (!Number.isFinite(valor) || valor <= 0) return 0

  return Math.floor(valor)
}

export function buildActivity(snapshot: PresenceSnapshot, nowMs: number): DiscordActivity {
  const titulo = snapshot.mode === 'completo' ? snapshot.title : null
  const details =
    titulo === null || limpiarTexto(titulo) === '' ? 'Viendo en RoNa' : limpiarTexto(titulo)

  const activity: DiscordActivity = {
    type: 3,
    details,
    assets: { large_image: ASSET_LARGE, large_text: 'RoNa' },
    status_display_type: 0,
  }

  if (snapshot.paused) {
    // Pausado no es «cero segundos»: es que el reloj no corre. Con timestamps,
    // Discord seguiría contando y diría que llevas una hora en pausa.
    return { ...activity, state: 'En pausa' }
  }

  const durationS = segundos(snapshot.durationS)
  const episodeNumber =
    snapshot.episodeNumber !== undefined && Number.isFinite(snapshot.episodeNumber)
      ? Math.max(0, Math.floor(snapshot.episodeNumber))
      : 0

  const state =
    snapshot.mode === 'completo' && episodeNumber > 0 ? `Episodio ${episodeNumber}` : undefined

  if (durationS === 0) {
    return state === undefined ? activity : { ...activity, state }
  }

  const positionS = Math.min(segundos(snapshot.positionS), durationS)
  const start = Math.floor(nowMs - positionS * 1000)

  return {
    ...activity,
    ...(state === undefined ? {} : { state }),
    timestamps: { start, end: start + durationS * 1000 },
  }
}
