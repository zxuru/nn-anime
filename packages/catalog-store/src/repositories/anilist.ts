/**
 * Las tres cachés de AniList.
 *
 * Cada una guarda lo que caduca a su ritmo, y las tres comparten una regla: **son
 * para no repetir una consulta, no para tener el catálogo de AniList en disco**.
 * Sus términos de uso prohíben usarla «como servicio de respaldo o de
 * almacenamiento», y una caché sin TTL de lo que un tercero publica es
 * exactamente eso. Por eso cada escritura lleva su `ttl_s` y nada se guarda que
 * nadie haya pedido antes.
 *
 * `readList` pide el **schema** del contenido, como `getSetting`: la tabla guarda
 * el JSON de listas con dos formas —obras del top y capítulos de la parrilla— y el
 * repositorio no puede saber cuál le toca. Validar en quien lee es lo que hace
 * que una fila de otra forma sea un error visible y no un dato que se cuela.
 */

import type { Database } from 'bun:sqlite'
import {
  type AniListEntry,
  type AniListImageKind,
  anilistEntrySchema,
  type CacheHit,
  StoreError,
} from '@nn-anime/core'
import type { z } from 'zod'
import { cacheHit, TTL_SECONDS } from '../cache-policy'

interface MediaRow {
  readonly title_key: string
  readonly media_json: string | null
  readonly fetched_at: number
  readonly ttl_s: number
}

interface ListRow {
  readonly query_key: string
  readonly payload_json: string
  readonly fetched_at: number
  readonly ttl_s: number
}

interface ImageRow {
  readonly url: string
}

export interface AniListRepository {
  /** El emparejamiento guardado. `value: null` es «se buscó y no hay». */
  readMedia(titleKey: string, now?: number): CacheHit<AniListEntry | null> | null
  /**
   * Guarda el emparejamiento **con sus direcciones de imagen**.
   *
   * Las dos cosas van juntas porque la ficha pide la imagen por el id de esta
   * fila: guardar la obra y no sus direcciones deja la portada y el banner en un
   * 404 que el navegador pinta como una imagen rota. `null` —«se buscó y no
   * hay»— no tiene imágenes que guardar.
   */
  writeMedia(titleKey: string, media: AniListEntry | null, now?: number): void
  readList<T>(key: string, schema: z.ZodType<T>, now?: number): CacheHit<readonly T[]> | null
  writeList<T>(key: string, items: readonly T[], ttlS: number, now?: number): void
  readImage(mediaId: number, kind: AniListImageKind): string | undefined
  /**
   * Guarda las direcciones de imagen de una obra.
   *
   * Las listas también traen obras —y sus portadas—, así que esto se llama al
   * cachear un emparejamiento **y** al cachear una lista: la ruta de la imagen
   * tiene que poder resolver un id que la vitrina está enseñando, sin salir a la
   * red y sin que nadie haya abierto su ficha.
   */
  writeImages(media: AniListEntry): void
}

export function createAniListRepository(db: Database): AniListRepository {
  const selectMedia = db.query<MediaRow, [string]>(
    'SELECT title_key, media_json, fetched_at, ttl_s FROM anilist_media WHERE title_key = ?',
  )
  const upsertMedia = db.query(
    `INSERT INTO anilist_media (title_key, media_json, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (title_key) DO UPDATE SET
       media_json = excluded.media_json,
       fetched_at = excluded.fetched_at,
       ttl_s      = excluded.ttl_s`,
  )
  const selectList = db.query<ListRow, [string]>(
    'SELECT query_key, payload_json, fetched_at, ttl_s FROM anilist_list_cache WHERE query_key = ?',
  )
  const upsertList = db.query(
    `INSERT INTO anilist_list_cache (query_key, payload_json, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (query_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       fetched_at   = excluded.fetched_at,
       ttl_s        = excluded.ttl_s`,
  )
  const selectImage = db.query<ImageRow, [number, string]>(
    'SELECT url FROM anilist_image WHERE media_id = ? AND kind = ?',
  )
  const upsertImage = db.query(
    `INSERT INTO anilist_image (media_id, kind, url)
     VALUES (?, ?, ?)
     ON CONFLICT (media_id, kind) DO UPDATE SET url = excluded.url`,
  )

  /**
   * Las direcciones de imagen de una obra, por su id.
   *
   * El banner es opcional —hay obras sin él— y el `undefined` no escribe fila:
   * una fila con la cadena «undefined» sería una dirección que la ruta intentaría
   * resolver y no resolvería.
   */
  function guardarImagenes(media: AniListEntry): void {
    upsertImage.run(media.id, 'cover', media.coverUrl)
    if (media.bannerUrl !== undefined) upsertImage.run(media.id, 'banner', media.bannerUrl)
  }

  return {
    readMedia(titleKey, now = Date.now()) {
      const fila = selectMedia.get(titleKey)
      if (fila === null) return null

      if (fila.media_json === null) {
        return cacheHit<AniListEntry | null>(null, fila.fetched_at, fila.ttl_s, now)
      }

      const crudo: unknown = JSON.parse(fila.media_json)
      const media = anilistEntrySchema.safeParse(crudo)

      if (!media.success) {
        throw new StoreError({
          message: 'el emparejamiento de AniList tiene una forma que no se entiende',
          context: { titleKey },
          op: 'readAniListMedia',
        })
      }

      return cacheHit<AniListEntry | null>(media.data, fila.fetched_at, fila.ttl_s, now)
    },

    writeMedia(titleKey, media, now = Date.now()) {
      const ttlS = media === null ? TTL_SECONDS.anilistMiss : TTL_SECONDS.anilistMedia

      upsertMedia.run(titleKey, media === null ? null : JSON.stringify(media), now, ttlS)

      // El emparejamiento y sus imágenes, en la misma escritura: quien sirve la
      // ficha resuelve el banner contra `anilist_image` por el id de esta fila, y
      // guardar sólo una de las dos mitades dejaba la ficha sin imagen.
      if (media !== null) guardarImagenes(media)
    },

    readList<T>(key: string, schema: z.ZodType<T>, now = Date.now()) {
      const fila = selectList.get(key)
      if (fila === null) return null

      const crudo: unknown = JSON.parse(fila.payload_json)
      const items = schema.array().safeParse(crudo)

      if (!items.success) {
        throw new StoreError({
          message: 'una lista cacheada de AniList tiene una forma que no se entiende',
          context: { key },
          op: 'readAniListList',
        })
      }

      return cacheHit<readonly T[]>(items.data, fila.fetched_at, fila.ttl_s, now)
    },

    writeList<T>(key: string, items: readonly T[], ttlS: number, now = Date.now()) {
      upsertList.run(key, JSON.stringify(items), now, ttlS)
    },

    readImage(mediaId, kind) {
      return selectImage.get(mediaId, kind)?.url
    },

    writeImages(media) {
      guardarImagenes(media)
    },
  }
}
