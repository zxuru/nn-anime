/**
 * Los hermanos de saga de un título y las otras fuentes de la misma obra.
 *
 * La fuente no declara relaciones, así que el emparejamiento es por **título de
 * saga** (`sagaTitle`, en `core`) y **cruza proveedores**: la misma saga suele
 * estar en dos fuentes a la vez, y la ficha no tiene por qué esconder la mitad.
 * Una obra sale **una vez**, con el proveedor de la ficha delante.
 *
 * Las dos lecturas viven aquí porque comparten la mitad del trabajo: la consulta
 * de candidatos, el prefiltro por la primera palabra, el tope de filas y la forma
 * del resumen. `list` devuelve los hermanos —la misma saga sin la misma obra— y
 * `listSources` la misma obra en otras fuentes, que es la clave de título exacta.
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

import type { Database, Statement } from 'bun:sqlite'
import {
  type AnimeSummary,
  franchiseTitle,
  groupByWork,
  namesOf,
  type ProviderRef,
  sagaTitle,
  sameWork,
  titleKindSchema,
  type WorkItem,
  type WorkNames,
} from '@nn-anime/core'

/**
 * Con qué se emparejan los candidatos.
 *
 * `'saga'` es el comportamiento de siempre y el valor por defecto: ninguna
 * llamada que ya existía cambia. `'franchise'` es la sección de al lado, la que
 * junta una serie con su secuela cuando la fuente las nombra distinto.
 */
export type RelatedScope = 'saga' | 'franchise'

/**
 * Tope de filas que se traen para comparar.
 *
 * El prefiltro por la primera palabra ya descarta casi todo; el tope es la red
 * de seguridad para una base que crezca mucho —una saga de verdad no tiene mil
 * entregas— y evita que una lectura se lleve la caché entera a memoria.
 */
export const RELATED_SCAN_LIMIT = 1000

/**
 * Los candidatos: lo que la base conoce y empieza por alguna de las palabras de
 * la obra.
 *
 * Las palabras las pone el título de la ficha, y son **hasta tres** —los nombres
 * con los que la obra se reconoce—, porque la misma obra puede estar en la base
 * con el nombre corto en una fuente y el título original en la otra: con una
 * sola palabra, la temporada que la otra fuente publica con el nombre largo
 * queda fuera de la lectura. Los patrones que sobran repiten el primero: es la
 * misma comparación y una sola sentencia preparada, que es lo que el spec mide.
 *
 * Los tres listados comparten forma —una `FeedEntry` es un `SearchResult` con
 * fecha opcional—, y por eso la misma expresión sirve para los tres. `json_each`
 * expande el array guardado en cada fila.
 */
const CANDIDATOS = `
  WITH patrones AS (
    SELECT value AS p FROM json_each(?)
  ),
  conocidos AS (
    SELECT provider_id, provider_ref AS ref, title, title_alt, cover_url, year,
           json_extract(raw_json, '$.kind') AS kind
      FROM anime
     WHERE EXISTS (
       SELECT 1 FROM patrones WHERE title LIKE p || '%' OR provider_ref LIKE p || '%'
     )
    UNION ALL
    SELECT c.provider_id, json_extract(j.value, '$.ref.value'), json_extract(j.value, '$.title'),
           json_extract(j.value, '$.titleAlt'), json_extract(j.value, '$.coverUrl'),
           json_extract(j.value, '$.year'), json_extract(j.value, '$.kind')
      FROM search_cache c, json_each(c.results_json) AS j
     WHERE EXISTS (
       SELECT 1 FROM patrones WHERE json_extract(j.value, '$.title') LIKE p || '%'
     )
    UNION ALL
    SELECT c.provider_id, json_extract(j.value, '$.ref.value'), json_extract(j.value, '$.title'),
           json_extract(j.value, '$.titleAlt'), json_extract(j.value, '$.coverUrl'),
           json_extract(j.value, '$.year'), json_extract(j.value, '$.kind')
      FROM trending_cache c, json_each(c.results_json) AS j
     WHERE EXISTS (
       SELECT 1 FROM patrones WHERE json_extract(j.value, '$.title') LIKE p || '%'
     )
    UNION ALL
    SELECT c.provider_id, json_extract(j.value, '$.ref.value'), json_extract(j.value, '$.title'),
           json_extract(j.value, '$.titleAlt'), json_extract(j.value, '$.coverUrl'),
           json_extract(j.value, '$.year'), json_extract(j.value, '$.kind')
      FROM feed_cache c, json_each(c.results_json) AS j
     WHERE EXISTS (
       SELECT 1 FROM patrones WHERE json_extract(j.value, '$.title') LIKE p || '%'
     )
  )
  SELECT provider_id, ref, title, title_alt, cover_url, year, kind
    FROM conocidos
   WHERE ref IS NOT NULL AND title IS NOT NULL
   ORDER BY year DESC, title
   LIMIT ?`

interface RelatedRow {
  readonly provider_id: string
  readonly ref: string
  readonly title: string
  readonly title_alt: string | null
  readonly cover_url: string | null
  readonly year: number | null
  readonly kind: string | null
}

interface OwnRow {
  readonly title: string
  readonly title_alt: string | null
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

/** Los nombres comparables de una fila: el título, su alternativa y su referencia. */
function nombresDe(fila: {
  readonly title: string
  readonly title_alt: string | null
  readonly ref: string
}): WorkNames {
  return namesOf({
    title: fila.title,
    ...(fila.title_alt === null ? {} : { titleAlt: fila.title_alt }),
    ref: fila.ref,
  })
}

/** Las sagas con las que se reconoce una obra: una por cada nombre suyo. */
function sagasDe(names: WorkNames, clave: (title: string) => string): ReadonlySet<string> {
  return new Set(names.variants.map(clave).filter((saga) => saga !== ''))
}

/**
 * Los prefiltros de la consulta, o `undefined` si no hay ninguno.
 *
 * Van como un **array JSON** en un solo parámetro y no como un hueco por patrón:
 * el número de nombres con los que se reconoce una obra cambia —una ficha local
 * tiene hasta tres, una de AniList hasta diez— y con un hueco por nombre cada
 * lector necesitaría su propia sentencia preparada. `json_each` deja una sola.
 *
 * El tope de 64 es una defensa: el prefiltro es para que SQLite no recorra la
 * tabla entera, y sesenta y cuatro palabras ya lo consiguen. El número sale de
 * una fila de la vitrina entera —treinta obras, dos nombres cada una— que se
 * empareja en **una** consulta.
 */
function patronesDe(palabras: readonly string[]): string | undefined {
  const distintas = [...new Set(palabras.filter((palabra) => palabra !== ''))].slice(0, 64)

  return distintas.length === 0 ? undefined : JSON.stringify(distintas)
}

/** Las primeras palabras de una lista de nombres, que es lo que se pasa a `patronesDe`. */
function palabrasDe(nombres: ReadonlySet<string> | readonly string[]): readonly string[] {
  return [...nombres].map((nombre) => primeraPalabra(nombre)).filter((palabra) => palabra !== '')
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
    'SELECT title, title_alt, year FROM anime WHERE provider_id = ? AND provider_ref = ?',
  )
  const selectCandidatos = db.query<RelatedRow, [string, number]>(CANDIDATOS)

  /**
   * La lectura por nombre se prepara la primera vez que se usa.
   *
   * Quien sólo lee hermanos y fuentes no paga por una consulta que no usa, y el
   * contador de sentencias de las pruebas de esos dos sigue midiendo lo mismo: dos.
   */
  let selectPorNombre: Statement<RelatedRow, [string, number]> | undefined

  return {
    /**
     * Los hermanos de `ref`, sin él mismo, con el alcance pedido.
     *
     * `'saga'` —el de por defecto, y el de siempre— empareja por título de saga:
     * «Dandadan» con «Dandadan 2nd Season». `'franchise'` empareja por franquicia
     * y junta lo que la fuente nombra como secuela con otro nombre: «Naruto» con
     * «Naruto Shippuden», «Dragon Ball» con «Dragon Ball Z».
     *
     * La comparación es contra **todas** las sagas de la obra —una por cada
     * nombre con el que se la reconoce— y no sólo contra la del título que la
     * ficha enseña. Es lo que junta la temporada que la otra fuente publica con
     * el título original con la ficha que la llama por el nombre corto.
     *
     * Lista vacía cuando no hay ninguno: «no hay» no es «no se pudo», y quien
     * pinta la sección necesita distinguirlo para explicarse.
     */
    list(ref: ProviderRef, limit: number, scope: RelatedScope = 'saga'): readonly AnimeSummary[] {
      // Sin la fila propia no hay título que normalizar. Pasa cuando la
      // referencia no está en la base: nadie abrió esa ficha todavía, y eso no
      // es un error.
      const propia = selectPropia.get(ref.providerId, ref.value)
      if (propia === null) return []

      // El alcance elige la clave y nada más: la consulta preparada, el mapa por
      // obra y el orden son los mismos. Con dos lecturas paralelas, la mitad de
      // las reglas se quedaría sin aplicar en una de las dos.
      const clave = scope === 'franchise' ? franchiseTitle : sagaTitle
      const nombres = nombresDe({ ...propia, ref: ref.value })
      const sagas = sagasDe(nombres, clave)
      const patrones = patronesDe(palabrasDe(sagas))
      if (patrones === undefined) return []

      const filas = selectCandidatos.all(patrones, RELATED_SCAN_LIMIT)

      // Una obra, una fila: la misma entrega en dos proveedores no puede salir
      // dos veces en la sección, y la identidad no la da el título —hay fuentes
      // que publican la misma entrega con el nombre largo y con el corto:
      // «Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka Gaiden: Sword
      // Oratoria» y «Danmachi: Sword Oratoria» son la misma—. La resuelve
      // `sameWork`, la misma regla que excluye la ficha propia, y `groupByWork`
      // lleva su índice de claves: agrupar no es comparar cada fila con todas.
      const porRef = new Map<string, RelatedRow>()
      const candidatos: WorkItem[] = []

      for (const fila of filas) {
        if (fila.provider_id === ref.providerId && fila.ref === ref.value) continue

        const nombresFila = nombresDe(fila)

        // La misma obra en otro proveedor no es un hermano de saga: es la misma
        // ficha, y repetirla en la sección sería el «contenido repetido» que se
        // reportó. La identidad la resuelve `sameWork`, que junta las dos fichas
        // aunque cada fuente las nombre distinto.
        if (sameWork(nombres, nombresFila)) continue

        const suyas = sagasDe(nombresFila, clave)
        if (![...suyas].some((saga) => sagas.has(saga))) continue

        const item: WorkItem = {
          ref: { providerId: fila.provider_id, value: fila.ref },
          title: fila.title,
          ...(fila.title_alt === null ? {} : { titleAlt: fila.title_alt }),
        }

        candidatos.push(item)
        porRef.set(`${item.ref.providerId}:${item.ref.value}`, fila)
      }

      // De cada obra se queda una fila: la del proveedor de la ficha —pulsarla no
      // cambia de sitio— y, si ninguna o las dos son de ahí, la del id
      // alfabéticamente menor. Sin el año en la comparación: las dos fuentes
      // publican el mismo estreno con años distintos y sigue siendo una obra.
      const elegidas: RelatedRow[] = []
      for (const grupo of groupByWork(candidatos, () => true)) {
        let elegida: RelatedRow | undefined

        for (const item of grupo) {
          const fila = porRef.get(`${item.ref.providerId}:${item.ref.value}`)
          if (fila === undefined) continue
          if (elegida === undefined || preferida(fila, elegida, ref.providerId)) elegida = fila
        }

        if (elegida !== undefined) elegidas.push(elegida)
      }

      return elegidas
        .map(resumen)
        .sort(byYearProximity(propia.year ?? undefined))
        .slice(0, limit)
    },

    /**
     * Las otras fuentes que tienen **esta misma obra**, sin ella misma.
     *
     * No son hermanos de saga: es la misma ficha en otro sitio, y es lo que la
     * ficha necesita para ofrecer elegir fuente. La identidad es la de la
     * búsqueda y la de los hermanos —`sameWork`, que junta las dos fichas aunque
     * cada fuente las nombre distinto—, y el año sigue siendo parte de la
     * comparación: dos obras homónimas de años distintos son dos obras.
     *
     * Reutiliza la consulta de candidatos de los relacionados: las cuatro tablas
     * —la ficha, las búsquedas, las tendencias y las novedades— ya están ahí, y una
     * segunda lectura sería la mitad de las reglas escrita dos veces.
     */
    listSources(ref: ProviderRef, limit: number): readonly AnimeSummary[] {
      const propia = selectPropia.get(ref.providerId, ref.value)
      if (propia === null) return []

      const nombres = nombresDe({ ...propia, ref: ref.value })
      const patrones = patronesDe(palabrasDe(sagasDe(nombres, sagaTitle)))
      if (patrones === undefined) return []

      const filas = selectCandidatos.all(patrones, RELATED_SCAN_LIMIT)

      const porProveedor = new Map<string, RelatedRow>()
      for (const fila of filas) {
        // La fuente que se está viendo no es una alternativa a sí misma.
        if (fila.provider_id === ref.providerId) continue
        if (fila.year !== propia.year) continue
        if (!sameWork(nombres, nombresDe(fila))) continue

        // Una entrada por fuente: dos referencias de la misma fuente para la misma
        // obra no son dos sitios donde elegir. Gana la menor alfabéticamente, para
        // que el resultado no dependa del orden en que SQLite devolvió las filas.
        const actual = porProveedor.get(fila.provider_id)
        if (actual === undefined || fila.ref < actual.ref) porProveedor.set(fila.provider_id, fila)
      }

      return [...porProveedor.entries()]
        .sort(([uno], [otro]) => (uno < otro ? -1 : uno > otro ? 1 : 0))
        .slice(0, limit)
        .map(([, fila]) => resumen(fila))
    },

    /**
     * Los candidatos de la base que empiezan como alguno de estos nombres.
     *
     * Es la mitad de la lectura de hermanos y de fuentes, expuesta aparte para
     * quien compara contra los nombres de una obra **que no tiene fila aquí**
     * —una de AniList, que llega de la red—: necesita el mismo prefiltro y las
     * mismas cuatro tablas, no una segunda consulta escrita al lado. Quien llama
     * decide después, con la misma identidad de siempre, cuál es la misma obra.
     *
     * El orden es el de la consulta —año descendente y título—, para que dos
     * llamadas seguidas devuelvan lo mismo.
     */
    candidatesByNames(names: readonly string[], limit: number): readonly AnimeSummary[] {
      const patrones = patronesDe(palabrasDe(names))
      if (patrones === undefined) return []

      selectPorNombre ??= db.query<RelatedRow, [string, number]>(CANDIDATOS)

      return selectPorNombre.all(patrones, limit).map(resumen)
    },
  }
}

export type RelatedStore = ReturnType<typeof createRelatedRepository>
