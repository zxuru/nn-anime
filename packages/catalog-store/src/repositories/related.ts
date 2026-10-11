/**
 * Los hermanos de saga de un título, leídos de la base.
 *
 * La fuente no declara relaciones, así que el emparejamiento es por **título de
 * saga** (`sagaTitle`, en `core`) y **cruza proveedores**: la misma saga suele
 * estar en dos fuentes a la vez, y la ficha no tiene por qué esconder la mitad.
 * Una obra sale **una vez**, con el proveedor de la ficha delante.
 *
 * Se leen **dos** sitios y no uno. La tabla `anime` sólo tiene las fichas
 * abiertas; los listados cacheados —búsquedas, tendencias y novedades— ya traen
 * la saga entera en cuanto alguien la busca. Sin ellos, abrir «Kimetsu no Yaiba»
 * deja la sección vacía aunque sus cinco entregas estén en la caché de la
 * búsqueda que llevó hasta ahí.
 *
 * **Dos consultas preparadas, ninguna por fila.** La primera trae el título de la
 * referencia pedida —por referencia, no por título: dos títulos distintos pueden
 * llamarse igual—; la segunda, los candidatos que empiezan por la misma palabra,
 * que es el único prefiltro que SQLite puede hacer. El resto de la comparación es
 * en memoria porque la normalización no se escribe en SQL, y una consulta por
 * candidato sería justo el patrón que el spec del almacén prohíbe.
 *
 * Sólo relaciona lo que la base ya conoce. Rellenar la sección preguntando al
 * proveedor sería una petición de red por cada ficha abierta, y el spec prohíbe
 * la precarga especulativa.
 */

import type { Database } from 'bun:sqlite'
import {
  type AnimeSummary,
  normalizeQuery,
  type ProviderRef,
  sagaTitle,
  titleKindSchema,
} from '@nn-anime/core'

/**
 * Tope de filas que se traen para comparar.
 *
 * El prefiltro por la primera palabra ya descarta casi todo; el tope es la red
 * de seguridad para una base que crezca mucho —una saga de verdad no tiene mil
 * entregas— y evita que una lectura se lleve la caché entera a memoria.
 */
export const RELATED_SCAN_LIMIT = 1000

/**
 * Los candidatos: lo que la base conoce y empieza por la misma palabra.
 *
 * La palabra la pone el título de la ficha, así que el patrón llega como
 * parámetro. Los tres listados comparten forma —una `FeedEntry` es un
 * `SearchResult` con fecha opcional—, y por eso la misma expresión sirve para los
 * tres. `json_each` expande el array guardado en cada fila.
 */
const CANDIDATOS = `
  WITH conocidos AS (
    SELECT provider_id, provider_ref AS ref, title, cover_url, year,
           json_extract(raw_json, '$.kind') AS kind
      FROM anime
     WHERE title LIKE ?
    UNION ALL
    SELECT c.provider_id, json_extract(j.value, '$.ref.value'), json_extract(j.value, '$.title'),
           json_extract(j.value, '$.coverUrl'), json_extract(j.value, '$.year'),
           json_extract(j.value, '$.kind')
      FROM search_cache c, json_each(c.results_json) AS j
     WHERE json_extract(j.value, '$.title') LIKE ?
    UNION ALL
    SELECT c.provider_id, json_extract(j.value, '$.ref.value'), json_extract(j.value, '$.title'),
           json_extract(j.value, '$.coverUrl'), json_extract(j.value, '$.year'),
           json_extract(j.value, '$.kind')
      FROM trending_cache c, json_each(c.results_json) AS j
     WHERE json_extract(j.value, '$.title') LIKE ?
    UNION ALL
    SELECT c.provider_id, json_extract(j.value, '$.ref.value'), json_extract(j.value, '$.title'),
           json_extract(j.value, '$.coverUrl'), json_extract(j.value, '$.year'),
           json_extract(j.value, '$.kind')
      FROM feed_cache c, json_each(c.results_json) AS j
     WHERE json_extract(j.value, '$.title') LIKE ?
  )
  SELECT provider_id, ref, title, cover_url, year, kind
    FROM conocidos
   WHERE ref IS NOT NULL AND title IS NOT NULL
   ORDER BY year DESC, title
   LIMIT ?`

interface RelatedRow {
  readonly provider_id: string
  readonly ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
}

interface OwnRow {
  readonly title: string
  readonly year: number | null
}

/**
 * El tipo del título, validado.
 *
 * Vive en el JSON y podría no estar o no ser uno de los que la interfaz sabe
 * pintar; el schema lo comprueba y si no encaja se omite el campo en vez de
 * inventarlo.
 */
function kindOf(raw: string | null): AnimeSummary['kind'] {
  if (raw === null) return undefined

  const kind = titleKindSchema.safeParse(raw)

  return kind.success ? kind.data : undefined
}

/** La primera palabra de la saga. Es el único prefiltro que SQLite puede hacer. */
function primeraPalabra(saga: string): string {
  return saga.split(' ')[0] ?? ''
}

/**
 * Cuál de las dos filas de la misma obra se queda.
 *
 * Gana la del proveedor de la ficha —pulsarla no cambia de sitio— y, si ninguna
 * o las dos son de ahí, la del id alfabéticamente menor: el resultado no puede
 * depender del orden en que SQLite devolvió las filas.
 */
function preferida(candidata: RelatedRow, actual: RelatedRow, providerId: string): boolean {
  const candidataEsPropia = candidata.provider_id === providerId
  const actualEsPropia = actual.provider_id === providerId
  if (candidataEsPropia !== actualEsPropia) return candidataEsPropia

  return candidata.provider_id < actual.provider_id
}

function resumen(fila: RelatedRow): AnimeSummary {
  const kind = kindOf(fila.kind)

  return {
    ref: { providerId: fila.provider_id, value: fila.ref },
    title: fila.title,
    ...(fila.cover_url === null ? {} : { coverUrl: fila.cover_url }),
    ...(fila.year === null ? {} : { year: fila.year }),
    ...(kind === undefined ? {} : { kind }),
  }
}

/**
 * Ordena por cercanía al año pedido.
 *
 * Mismo año primero y después el más próximo: entre dos temporadas de la misma
 * saga, la de al lado es la que se busca. Sin año, al final; y con el mismo
 * año, la más reciente. El orden es estable, así que dos llamadas seguidas
 * pintan la misma fila en el mismo orden.
 */
export function byYearProximity(year: number | undefined) {
  return (a: AnimeSummary, b: AnimeSummary): number => {
    if (year === undefined) return (b.year ?? 0) - (a.year ?? 0)

    const distanciaA = a.year === undefined ? Number.POSITIVE_INFINITY : Math.abs(a.year - year)
    const distanciaB = b.year === undefined ? Number.POSITIVE_INFINITY : Math.abs(b.year - year)
    if (distanciaA !== distanciaB) return distanciaA - distanciaB

    return (b.year ?? 0) - (a.year ?? 0)
  }
}

export function createRelatedRepository(db: Database) {
  const selectPropia = db.query<OwnRow, [string, string]>(
    'SELECT title, year FROM anime WHERE provider_id = ? AND provider_ref = ?',
  )
  const selectCandidatos = db.query<RelatedRow, [string, string, string, string, number]>(
    CANDIDATOS,
  )

  return {
    /**
     * Los hermanos de saga de `ref`, sin él mismo.
     *
     * Lista vacía cuando no hay ninguno: «no hay» no es «no se pudo», y quien
     * pinta la sección necesita distinguirlo para explicarse.
     */
    list(ref: ProviderRef, limit: number): readonly AnimeSummary[] {
      // Sin la fila propia no hay título que normalizar. Pasa cuando la
      // referencia no está en la base: nadie abrió esa ficha todavía, y eso no
      // es un error.
      const propia = selectPropia.get(ref.providerId, ref.value)
      if (propia === null) return []

      const saga = sagaTitle(propia.title)
      const palabra = primeraPalabra(saga)
      if (palabra === '') return []

      const patron = `${palabra}%`
      const filas = selectCandidatos.all(patron, patron, patron, patron, RELATED_SCAN_LIMIT)

      // La misma obra en otro proveedor no es un hermano de saga: es la misma
      // ficha, y repetirla en la sección sería el «contenido repetido» que se
      // reportó. La comparación es por título normalizado, no por referencia.
      const obraPropia = normalizeQuery(propia.title)

      // Una obra, una fila: la misma entrega en dos proveedores no puede salir
      // dos veces en la sección. La clave es el título tal cual —no la saga—,
      // porque dos entregas distintas de la misma saga son dos filas.
      const porObra = new Map<string, RelatedRow>()
      for (const fila of filas) {
        if (fila.provider_id === ref.providerId && fila.ref === ref.value) continue
        if (sagaTitle(fila.title) !== saga) continue

        const obra = normalizeQuery(fila.title)
        if (obra === obraPropia) continue

        const actual = porObra.get(obra)
        if (actual === undefined || preferida(fila, actual, ref.providerId)) porObra.set(obra, fila)
      }

      return [...porObra.values()]
        .map(resumen)
        .sort(byYearProximity(propia.year ?? undefined))
        .slice(0, limit)
    },
  }
}

export type RelatedStore = ReturnType<typeof createRelatedRepository>
