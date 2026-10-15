/**
 * Las entregas de una saga, con lo que sabe la base y lo que declara AniList.
 *
 * Es una sola lista porque en pantalla es una sola cosa: la ficha de «Danmachi»
 * lleva a su segunda temporada, a su película y a sus OVA, y al que está mirando
 * no le importa de dónde salió el dato —le importa poder seguir—. Antes había dos
 * secciones: la de la barra lateral, que emparejaba por título de saga contra lo
 * que la base ya conocía —y de una franquicia larga suele conocer una entrega, la
 * que se acaba de abrir—, y una fila aparte con lo de AniList. Se veía la misma
 * obra dos veces y con dos nombres distintos.
 *
 * Cuatro decisiones que se ven en pantalla:
 *
 * 1. **El grupo lo decide el tipo, no el motivo de AniList.** Temporadas (serie,
 *    ONA y lo que no declara tipo), películas (película) y OVA (OVA y especial).
 *    AniList llama `sideStory` a la película de una serie y `parent` a la serie
 *    desde su película: agrupar por eso dejaría una sección de películas con
 *    series dentro.
 * 2. **La base manda y AniList rellena.** Una obra que ya está en la base no se
 *    repite aunque AniList la declare, y la identidad es la de siempre —`sameWork`,
 *    la misma regla que usa la búsqueda y el propio servidor— y no la del título a
 *    secas: hay fuentes que publican la misma entrega con el nombre largo y con el
 *    corto, y cada una guarda el de la otra en su referencia. Con el título a
 *    secas, esas dos salían las dos.
 * 3. **El motivo se conserva en la fila que viene de AniList.** «Secuela» o
 *    «Historia paralela» es lo que explica por qué esa entrega está ahí cuando el
 *    catálogo no la tiene, y es la atribución del dato sin una sección aparte.
 * 4. **Sin año no se inventa uno, y la temporada desempata.** El orden es el de
 *    siempre: año, número de temporada del título, y el título.
 */

import type { AniListRelatedItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { namesOf, sameWork, type WorkNames } from '@nn-anime/core/identity'
import type { AnimeSummary, ProviderRef } from '@nn-anime/core/models'
import { seasonNumberOf } from '@nn-anime/core/titles'
import { t } from '../../i18n'
import { destinoDe, fichaPath } from '../home/descubrir'
import { claveDeRelacion } from './relacion'

/** Una fila del rail, venga de la base o de AniList. */
export interface FilaDeSaga {
  /** Lo que la identifica en la lista: su referencia o su id de AniList. */
  readonly clave: string
  readonly title: string
  /** A dónde lleva: la ficha si la base la conoce, la búsqueda si no. */
  readonly to: string
  /** La referencia local, cuando la hay: es la portada del proxy. */
  readonly providerId?: string | undefined
  readonly ref?: string | undefined
  /** Una portada ya compuesta —la de AniList— cuando no hay referencia. */
  readonly portada?: string | undefined
  readonly year?: number | undefined
  /** El número que el título lleva escrito, para la insignia «Temporada N». */
  readonly temporada?: number | undefined
  /** El motivo de AniList, ya traducido. Sin él, la fila es de la base. */
  readonly motivo?: string | undefined
  /** La entrega que se está viendo: va marcada y sin enlace. */
  readonly actual?: boolean | undefined
}

export interface SagaRailInput {
  /** La entrega que se está viendo, con lo que la ficha sabe de ella. */
  readonly current: AnimeSummary
  /** Los hermanos de saga que el servidor encontró en lo que la base conoce. */
  readonly siblings: readonly AnimeSummary[]
  /** Los hermanos de franquicia: la misma lectura con la clave de la secuela. */
  readonly franchise: readonly AnimeSummary[]
  /** Lo que AniList declara de la obra emparejada. */
  readonly anilistRelated: readonly AniListRelatedItem[]
}

export interface SagaGroups {
  readonly seasons: readonly FilaDeSaga[]
  readonly movies: readonly FilaDeSaga[]
  readonly ovas: readonly FilaDeSaga[]
  /** Sólo lo que no está ya en los grupos de arriba. */
  readonly franchise: readonly FilaDeSaga[]
  /** Si alguna fila viene de AniList: es lo que decide si se atribuye el dato. */
  readonly deAniList: boolean
}

type Grupo = 'seasons' | 'movies' | 'ovas'

/**
 * El grupo de una entrega, por su tipo.
 *
 * El tipo que falta cuenta como serie: los proveedores que no lo declaran sirven
 * sobre todo temporadas, y mandarlas al grupo de las películas sería peor que
 * dejarlas donde casi siempre van.
 */
function grupoDe(kind: AnimeSummary['kind'] | AniListRelatedItem['kind']): Grupo {
  if (kind === 'movie') return 'movies'
  if (kind === 'ova' || kind === 'special') return 'ovas'

  return 'seasons'
}

/** Una fila con el grupo al que va: la clasificación se decide una sola vez. */
interface ConGrupo {
  readonly grupo: Grupo
  readonly fila: FilaDeSaga
}

/** Los nombres con los que se reconoce una obra de la base. */
function nombresDeResumen(item: AnimeSummary): WorkNames {
  return namesOf({ title: item.title, ref: item.ref.value })
}

/** Los nombres con los que se reconoce una relación de AniList. */
function nombresDeRelacion(item: AniListRelatedItem): WorkNames {
  return namesOf({
    title: item.title,
    ...(item.ref === undefined ? {} : { ref: item.ref.value }),
  })
}

/** La fila de una obra de la base: su ficha y su portada por referencia. */
function deResumen(item: AnimeSummary, actual: boolean): ConGrupo {
  const temporada = seasonNumberOf(item.title)

  return {
    grupo: grupoDe(item.kind),
    fila: {
      clave: `${item.ref.providerId}:${item.ref.value}`,
      title: item.title,
      to: fichaPath(item.ref.providerId, item.ref.value),
      providerId: item.ref.providerId,
      ref: item.ref.value,
      ...(item.year === undefined ? {} : { year: item.year }),
      ...(temporada === undefined ? {} : { temporada }),
      ...(actual ? { actual: true } : {}),
    },
  }
}

/**
 * La fila de una relación de AniList.
 *
 * La portada es la del proveedor cuando la base conoce la obra —así todas las
 * filas de la misma lista se parecen— y la de AniList cuando no, que es la única
 * que hay.
 */
function deRelacion(item: AniListRelatedItem): ConGrupo {
  const temporada = seasonNumberOf(item.title)
  const local = item.ref !== undefined

  return {
    grupo: grupoDe(item.kind),
    fila: {
      clave: `anilist:${item.anilistId}`,
      title: item.title,
      to: destinoDe(item),
      ...(local
        ? { providerId: item.ref?.providerId, ref: item.ref?.value }
        : { portada: item.cover }),
      ...(item.year === undefined ? {} : { year: item.year }),
      ...(temporada === undefined ? {} : { temporada }),
      motivo: t(DEFAULT_LOCALE, claveDeRelacion(item.relation)),
    },
  }
}

/**
 * La clave de orden: año, después temporada, después título.
 *
 * `Infinity` para lo que no se sabe, que es lo que las manda al final sin
 * inventarles un año.
 */
function orden(a: FilaDeSaga, b: FilaDeSaga): number {
  const añoA = a.year ?? Number.POSITIVE_INFINITY
  const añoB = b.year ?? Number.POSITIVE_INFINITY
  if (añoA !== añoB) return añoA - añoB

  const temporadaA = a.temporada ?? Number.POSITIVE_INFINITY
  const temporadaB = b.temporada ?? Number.POSITIVE_INFINITY
  if (temporadaA !== temporadaB) return temporadaA - temporadaB

  return a.title.localeCompare(b.title)
}

/** Las filas de un grupo, en orden. */
function grupo(items: readonly ConGrupo[], cual: Grupo): readonly FilaDeSaga[] {
  return items
    .filter((item) => item.grupo === cual)
    .map((item) => item.fila)
    .sort(orden)
}

/** Lo que ya está listado: la referencia de cada ficha y los nombres de cada obra. */
interface Listado {
  readonly refs: Set<string>
  readonly nombres: WorkNames[]
}

function registrar(listado: Listado, ref: ProviderRef | undefined, nombres: WorkNames): void {
  if (ref !== undefined) listado.refs.add(`${ref.providerId}:${ref.value}`)
  listado.nombres.push(nombres)
}

/**
 * ¿Está ya listada esta obra?
 *
 * Dos señales, y las dos hacen falta. La **referencia** —proveedor y valor— dice
 * que es la misma ficha, la nombre quien la nombre: es lo que el servidor ya
 * resolvió al emparejar con AniList. La **identidad** de `sameWork` dice que es la
 * misma obra cuando cada fuente la publica con un nombre y una referencia
 * distintos —«Danmachi: Sword Oratoria» y «Dungeon ni Deai wo Motomeru no wa
 * Machigatteiru Darou ka Gaiden: Sword Oratoria», donde el nombre largo de una es
 * la referencia de la otra—. Con una sola de las dos, alguno de los dos casos
 * vuelve a salir dos veces.
 */
function yaListada(listado: Listado, ref: ProviderRef | undefined, nombres: WorkNames): boolean {
  if (ref !== undefined && listado.refs.has(`${ref.providerId}:${ref.value}`)) return true

  return listado.nombres.some((otra) => sameWork(otra, nombres))
}

export function filasDeSaga(input: SagaRailInput): SagaGroups {
  // Lo ya listado, con la referencia de cada ficha y los nombres de cada obra. Se
  // registra lo de la base primero —y la entrega que se está viendo— para que
  // AniList no repita nada de eso.
  const listado: Listado = { refs: new Set(), nombres: [] }
  registrar(listado, input.current.ref, nombresDeResumen(input.current))

  const hermanos = input.siblings.map((item) => {
    registrar(listado, item.ref, nombresDeResumen(item))

    return deResumen(item, false)
  })

  const deAniList: ConGrupo[] = []
  for (const item of input.anilistRelated) {
    const nombres = nombresDeRelacion(item)
    if (yaListada(listado, item.ref, nombres)) continue

    registrar(listado, item.ref, nombres)
    deAniList.push(deRelacion(item))
  }

  const todas = [deResumen(input.current, true), ...hermanos, ...deAniList]

  // La franquicia contiene a la saga: sin este filtro, cada temporada saldría dos
  // veces en la misma columna.
  const franquicia: FilaDeSaga[] = []
  for (const item of input.franchise) {
    const nombres = nombresDeResumen(item)
    if (yaListada(listado, item.ref, nombres)) continue

    registrar(listado, item.ref, nombres)
    franquicia.push(deResumen(item, false).fila)
  }

  return {
    seasons: grupo(todas, 'seasons'),
    movies: grupo(todas, 'movies'),
    ovas: grupo(todas, 'ovas'),
    franchise: franquicia.sort(orden),
    deAniList: deAniList.length > 0,
  }
}
