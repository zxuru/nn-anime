/**
 * Lo que AniList publica y lo que este proyecto guarda.
 *
 * Dos formas distintas y a propósito:
 *
 * 1. **Lo que llega**, validado con schemas *no* estrictos. AniList añade campos
 *    con cada versión de su esquema y una clave de más no es un error suyo; lo
 *    que sí es un error es que falte lo que se usa.
 * 2. **Lo que se guarda y se compara** (`AniListEntry`, de `core`), con los
 *    nulos ya resueltos, la sinopsis en texto plano, la fecha en ISO y las
 *    direcciones comprobadas contra la lista blanca de hosts de imagen.
 *
 * Ahí en medio hay una decisión: una obra **sin portada utilizable o sin nombre**
 * no se convierte —se descarta—. La vitrina sabe dibujar el hueco de una portada
 * que no llega, pero no tiene con qué pedir una imagen que el servidor no podría
 * resolver: la ruta de la imagen sólo sirve direcciones de la CDN de AniList, y
 * una que apunte a otro sitio se quedaría en un 404 que nadie puede arreglar.
 */

import {
  type AniListAiringEntry,
  type AniListEntry,
  anilistEntrySchema,
  anilistRelationSchema,
  type DeepReadonly,
  httpUrlSchema,
  kindOfFormat,
  plainText,
  relationOf,
} from '@nn-anime/core'
import { z } from 'zod'
import { ANILIST_IMAGE_HOSTS } from './client'

/** Una dirección de imagen de la CDN de AniList, o nada. */
export function isAniListImageUrl(raw: string): boolean {
  const base = httpUrlSchema.safeParse(raw)
  if (!base.success) return false

  try {
    const url = new URL(raw)

    return url.protocol === 'https:' && ANILIST_IMAGE_HOSTS.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Una dirección de la ficha de AniList, o nada. */
function isAniListSiteUrl(raw: string): boolean {
  const base = httpUrlSchema.safeParse(raw)
  if (!base.success) return false

  try {
    return new URL(raw).hostname.toLowerCase().endsWith('anilist.co')
  } catch {
    return false
  }
}

const imagenSchema = z.object({
  extraLarge: z.string().nullable().optional(),
  large: z.string().nullable().optional(),
})

const tituloSchema = z.object({
  romaji: z.string().nullable().optional(),
  english: z.string().nullable().optional(),
  native: z.string().nullable().optional(),
})

/** Una obra de AniList tal y como llega, antes de normalizarla. */
export type RawMedia = z.infer<typeof mediaSchema>

/**
 * Una obra, tal y como la publica AniList.
 *
 * No es estricta: sobra lo que la API quiera añadir. Lo que se usa es lo que
 * está, y lo que falta se resuelve con `null` o se descarta la obra.
 */
export const mediaSchema = z.object({
  id: z.number().int().positive(),
  title: tituloSchema.nullable().optional(),
  synonyms: z.array(z.string()).nullable().optional(),
  format: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  /**
   * Obligatorio, no opcional, porque de la obra se guarda `adult` y el schema que
   * lo guarda lo exige. AniList publica el campo como booleano no nulo; si
   * faltara, la obra se descarta —como todo lo que falta de lo que se usa— en vez
   * de darse por apta.
   */
  isAdult: z.boolean(),
  // Los tres campos: la API devuelve el día cuando lo conoce —una película ya
  // estrenada— y sólo el año cuando no. Zod descarta lo que no se declara, y sin
  // `month`/`day` aquí la fecha se quedaba en el año sin que nadie lo notara.
  startDate: z
    .object({
      year: z.number().int().nullable().optional(),
      month: z.number().int().nullable().optional(),
      day: z.number().int().nullable().optional(),
    })
    .nullable()
    .optional(),
  episodes: z.number().int().nullable().optional(),
  duration: z.number().int().nullable().optional(),
  averageScore: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  studios: z
    .object({
      nodes: z
        .array(z.object({ name: z.string() }))
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  coverImage: imagenSchema.nullable().optional(),
  bannerImage: z.string().nullable().optional(),
  siteUrl: z.string().nullable().optional(),
  nextAiringEpisode: z
    .object({ episode: z.number().int().positive(), airingAt: z.number().int().positive() })
    .nullable()
    .optional(),
})

/** Un capítulo de la parrilla. */
export const scheduleSchema = z.object({
  episode: z.number().int().positive(),
  airingAt: z.number().int().positive(),
  media: mediaSchema.optional(),
})

export const mediaPageSchema = z.object({ Page: z.object({ media: z.array(mediaSchema) }) })
export const airingPageSchema = z.object({
  Page: z.object({ airingSchedules: z.array(scheduleSchema) }),
})

/**
 * Las relaciones de una obra.
 *
 * `node` es opcional aunque la API siempre lo publique: una arista sin obra no
 * es un error de nadie, es una arista que no se puede pintar, y se descarta al
 * convertir. `relations` admite `null` por el mismo motivo.
 */
export const relationsSchema = z.object({
  Media: z.object({
    relations: z
      .object({
        edges: z.array(z.object({ relationType: z.string(), node: mediaSchema.optional() })),
      })
      .nullable()
      .optional(),
  }),
})

/**
 * Una página **aliaseada**.
 *
 * AniList aplana el nodo `Page` cuando cuelga de un alias —`t0: { media: […] }`
 * en vez de `t0: { Page: { media: […] } }`, medido contra su API el 2026-10-15— y
 * mantiene el envoltorio cuando `Page` es el campo de raíz. Las dos formas se
 * aceptan aquí y no en dos sitios: la consulta del lote es la única aliaseada, y
 * quien la escribe no tiene por qué saber esta rareza.
 */
export const mediaAliasSchema = z.object({
  Page: mediaPageSchema.shape.Page.optional(),
  media: z.array(mediaSchema).optional(),
})

/** Las obras de una página aliaseada, con envoltorio o aplanada. */
export function mediaOfAlias(alias: z.infer<typeof mediaAliasSchema>): readonly RawMedia[] {
  return alias.Page?.media ?? alias.media ?? []
}

/** La respuesta del lote: una página por alias, con el nombre del alias de clave. */
export const mediaPagesSchema = z.record(z.string(), mediaAliasSchema)

/** Los estados de AniList, traducidos a los del dominio. */
function statusOf(status: string | null | undefined): AniListEntry['status'] {
  switch (status) {
    case 'RELEASING':
      return 'airing'
    case 'FINISHED':
      return 'finished'
    case 'NOT_YET_RELEASED':
      return 'upcoming'
    case 'CANCELLED':
    case 'HIATUS':
      return 'unknown'
    default:
      return undefined
  }
}

/** El año de emisión, si la API lo dice. */
function yearOf(media: z.infer<typeof mediaSchema>): number | undefined {
  const year = media.startDate?.year

  return year === null || year === undefined ? undefined : year
}

/** Una fecha Unix de AniList, en ISO. */
export function isoOf(epoch: number): string {
  return new Date(epoch * 1000).toISOString()
}

/**
 * Una obra de AniList en la forma que este proyecto guarda.
 *
 * Devuelve `undefined` cuando no hay con qué pintarla: sin nombre o sin una
 * portada de su CDN, la pieza no existe para la vitrina.
 */
export function toEntry(media: z.infer<typeof mediaSchema>): AniListEntry | undefined {
  const romaji = media.title?.romaji?.trim() ?? ''
  const english = media.title?.english?.trim() ?? ''
  const native = media.title?.native?.trim() ?? ''
  const principal = romaji === '' ? (english === '' ? native : english) : romaji
  if (principal === '') return undefined

  const portada = [media.coverImage?.extraLarge, media.coverImage?.large]
    .map((url) => url?.trim() ?? '')
    .find((url) => url !== '' && isAniListImageUrl(url))
  if (portada === undefined) return undefined

  const sitio = media.siteUrl?.trim() ?? ''
  if (!isAniListSiteUrl(sitio)) return undefined

  const banner = media.bannerImage?.trim() ?? ''
  const sinopsis = plainText(media.description ?? '')
  const siguiente = media.nextAiringEpisode ?? undefined

  return {
    id: media.id,
    names: {
      romaji: principal,
      ...(english === '' || english === principal ? {} : { english }),
      ...(native === '' || native === principal ? {} : { native }),
      ...(media.synonyms === null || media.synonyms === undefined || media.synonyms.length === 0
        ? {}
        : { synonyms: media.synonyms.filter((sinonimo) => sinonimo.trim() !== '') }),
    },
    ...(media.format === null || media.format === undefined ? {} : { format: media.format }),
    ...(statusOf(media.status) === undefined ? {} : { status: statusOf(media.status) }),
    ...(yearOf(media) === undefined ? {} : { year: yearOf(media) }),
    adult: media.isAdult,
    ...(media.episodes === null || media.episodes === undefined
      ? {}
      : { episodes: media.episodes }),
    ...(media.duration === null || media.duration === undefined
      ? {}
      : { durationMin: media.duration }),
    ...(media.averageScore === null || media.averageScore === undefined
      ? {}
      : { score: media.averageScore }),
    ...(sinopsis === '' ? {} : { synopsis: sinopsis }),
    genres: (media.genres ?? []).filter((genero) => genero.trim() !== ''),
    studios: (media.studios?.nodes ?? [])
      .map((estudio) => estudio.name.trim())
      .filter((estudio) => estudio !== ''),
    coverUrl: portada,
    ...(banner === '' || !isAniListImageUrl(banner) ? {} : { bannerUrl: banner }),
    siteUrl: sitio,
    ...(siguiente === null
      ? {}
      : siguiente === undefined
        ? {}
        : { nextEpisode: { number: siguiente.episode, airingAt: isoOf(siguiente.airingAt) } }),
  }
}

/** Si la obra es de la mitad que la interfaz llama «películas». */
export function isMovie(entry: AniListEntry): boolean {
  return kindOfFormat(entry.format ?? '') === 'movie'
}

/**
 * Una relación ya convertida: el motivo y la obra.
 *
 * Es la forma que se guarda en la caché de listas, y lleva la obra entera —y no
 * sólo su id— para que la ruta de la imagen resuelva sus portadas con el mismo
 * mecanismo que el top y la parrilla. El tipo es el de sólo lectura, como todo lo
 * que sale de `core`: lo que se lee de la caché no se muta por el camino.
 */
export const relatedEntrySchema = z.strictObject({
  relation: anilistRelationSchema,
  media: anilistEntrySchema,
})

export type RelatedEntry = DeepReadonly<z.infer<typeof relatedEntrySchema>>

/**
 * Las relaciones que esta aplicación enseña, en el orden en que llegan.
 *
 * Tres descartes, y los tres medidos contra la API: lo que **no es una entrega**
 * —`SOURCE` es el manga de origen—, lo que no es **anime** —el formato no tiene
 * tipo en esta aplicación, que es lo que descarta la novela y el manga— y lo que
 * **no se puede pintar** —sin nombre o sin portada de su CDN, `toEntry` ya
 * devuelve nada—.
 *
 * Una obra sale **una vez** aunque venga en dos aristas: AniList publica la
 * misma entrega como secuela de una y precuela de otra, y repetirla en la fila
 * sería el contenido duplicado que el spec de la ficha prohíbe.
 */
export function toRelatedEntries(raw: z.infer<typeof relationsSchema>): readonly RelatedEntry[] {
  const vistas = new Set<number>()
  const relaciones: RelatedEntry[] = []

  for (const arista of raw.Media.relations?.edges ?? []) {
    const relation = relationOf(arista.relationType)
    if (relation === undefined || arista.node === undefined) continue

    const media = toEntry(arista.node)
    if (media === undefined) continue
    if (kindOfFormat(media.format ?? '') === undefined) continue
    if (vistas.has(media.id)) continue

    vistas.add(media.id)
    relaciones.push({ relation, media })
  }

  return relaciones
}

/** Un capítulo de la parrilla, con su obra dentro. */
export function toAiringEntry(raw: z.infer<typeof scheduleSchema>): AniListAiringEntry | undefined {
  if (raw.media === undefined) return undefined

  const media = toEntry(raw.media)
  if (media === undefined) return undefined

  return { media, episode: raw.episode, airingAt: isoOf(raw.airingAt) }
}
