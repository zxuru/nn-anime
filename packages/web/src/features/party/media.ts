/**
 * Construcción del contenido de la sala desde lo que sabe la pantalla.
 *
 * El reproductor conoce el título, el episodio y su duración; el protocolo sólo
 * acepta una forma pequeña y estricta de contarlo: nada de `providerId`, `ref`,
 * URL ni ticket. Aquí se adapta lo uno a lo otro y se descarta lo que no se
 * puede decir con honestidad: una sala sin título o sin número de episodio no
 * se anuncia, porque el invitado no sabría qué abrir.
 */

import {
  PARTY_MAX_POSITION_S,
  PARTY_MAX_TITLE_LENGTH,
  type PartyMedia,
  partyMediaSchema,
} from '@nn-anime/core/party'

export interface WatchMediaInput {
  readonly title: string | undefined
  readonly kind: 'episode' | 'movie'
  /** El número del episodio; una película no lo lleva. */
  readonly episode?: number | undefined
  readonly season?: number | undefined
  /** El título propio del episodio, si la fuente lo trae. */
  readonly episodeTitle?: string | undefined
  /** Duración declarada por el reproductor, en segundos. */
  readonly durationS?: number | undefined
}

/** Un entero positivo dentro del rango del protocolo, o `undefined`. */
function entero(valor: number | undefined, minimo: number, maximo: number): number | undefined {
  if (valor === undefined || !Number.isFinite(valor)) return undefined

  const redondeado = Math.round(valor)

  return redondeado < minimo || redondeado > maximo ? undefined : redondeado
}

/** Recorta el texto al tope del protocolo, sin dejar espacios en los bordes. */
function recorte(texto: string): string {
  return texto.trim().slice(0, PARTY_MAX_TITLE_LENGTH).trim()
}

/**
 * La forma que viaja en la sala, o `undefined` si no hay nada que anunciar.
 *
 * La duración se acota al máximo del protocolo y sólo se incluye si es un número
 * positivo: un cero de un reproductor que todavía no cargó no es una duración.
 */
export function buildPartyMedia(input: WatchMediaInput): PartyMedia | undefined {
  const title = input.title === undefined ? '' : recorte(input.title)
  if (title === '') return undefined

  const media: Record<string, unknown> = { kind: input.kind, title }

  if (input.kind === 'episode') {
    const episode = entero(input.episode, 1, 100_000)
    if (episode === undefined) return undefined
    media.episode = episode

    const season = entero(input.season, 1, 1_000)
    if (season !== undefined) media.season = season
  }

  const episodeTitle = input.episodeTitle === undefined ? '' : recorte(input.episodeTitle)
  if (episodeTitle !== '') media.episodeTitle = episodeTitle

  const durationS = input.durationS
  if (
    durationS !== undefined &&
    Number.isFinite(durationS) &&
    durationS > 0 &&
    durationS <= PARTY_MAX_POSITION_S
  ) {
    media.durationS = durationS
  }

  // Se valida con el schema compartido antes de devolverlo: si esta adaptación
  // se desvía del contrato, falla aquí y no en el servidor del anfitrión.
  const parsed = partyMediaSchema.safeParse(media)

  return parsed.success ? parsed.data : undefined
}
