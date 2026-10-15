/**
 * Lo que comparte todo el que habla de AniList.
 *
 * Son funciones puras —comparación de nombres, saneado de la descripción, mapa de
 * formato, la ruta de una imagen— y viven en `core` porque las usan los dos lados
 * de la frontera: el servidor cuando empareja una obra local con una de AniList y
 * compone lo que sale por HTTP, y la interfaz cuando decide qué pedir y cómo
 * enseñarlo.
 *
 * **La comparación es la misma identidad que usa la búsqueda** (`sameWork`), no una
 * segunda regla: una obra emparejada aquí y no allí daría una tarjeta con sinopsis
 * de una obra y nombre de otra. La diferencia es que AniList publica hasta diez
 * nombres —romaji, inglés, nativo y sinónimos en varios idiomas— y la obra local
 * publica uno o tres, así que la regla se lee en la dirección que importa: los
 * nombres locales están entre los de AniList, o hay uno visible que coincide.
 *
 * Un candidato que no cumple **no se enriquece**. Se prefiere no tener sinopsis a
 * tener la de otra obra: un dato ausente se nota, y un dato ajeno no.
 */

import { keysOfNames, namesOf, type TitleInput, type WorkNames } from './identity'
import type { TitleKind } from './models'

/** Los nombres con los que AniList publica una obra. */
export interface AniListNames {
  readonly romaji: string
  readonly english?: string | undefined
  readonly native?: string | undefined
  readonly synonyms?: readonly string[] | undefined
}

/** Una candidata de AniList, reducida a lo que hace falta para emparejarla. */
export interface AniListCandidate {
  readonly id: number
  readonly names: AniListNames
  readonly year?: number | undefined
  readonly kind?: TitleKind | undefined
}

/** Las clases de imagen que el servidor sabe servir. */
export type AniListImageKind = 'cover' | 'banner'

/**
 * Todos los nombres de una obra de AniList, sin repetir.
 *
 * El orden es el de fiabilidad —romaji, inglés, nativo, sinónimos—, que es el que
 * usa la elección de candidata para desempatar.
 */
export function anilistNames(names: AniListNames): readonly string[] {
  return [names.romaji, names.english, names.native, ...(names.synonyms ?? [])].filter(
    (nombre): nombre is string => nombre !== undefined && nombre.trim() !== '',
  )
}

/** Las claves comparables de una obra de AniList: una por cada nombre suyo. */
export function anilistKeys(names: AniListNames): ReadonlySet<string> {
  return keysOfNames(anilistNames(names))
}

/**
 * ¿Son la misma obra la local y la de AniList?
 *
 * La regla de `sameWork`, con los nombres de AniList como conjunto grande:
 * coincidencia de un nombre visible, o todos los nombres locales dentro de los
 * de AniList. Lo segundo es lo que junta «Danmachi» —título en una fuente— con
 * «Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka» —título de AniList
 * y referencia de la otra fuente—.
 */
export function sameAniListWork(local: WorkNames, names: AniListNames): boolean {
  const ajenas = anilistKeys(names)
  if (ajenas.size === 0) return false

  for (const clave of local.visibleKeys) if (ajenas.has(clave)) return true

  if (local.keys.size === 0) return false
  for (const clave of local.keys) if (!ajenas.has(clave)) return false

  return true
}

/** ¿Alguna de las claves de este nombre está en el conjunto? El vacío no está. */
function clavesDeNombre(nombre: string, conjunto: ReadonlySet<string>): boolean {
  for (const clave of keysOfNames([nombre])) if (conjunto.has(clave)) return true

  return false
}

/**
 * La candidata que corresponde a esta obra local, o nada.
 *
 * El desempate importa cuando la búsqueda devuelve varias entregas de la misma
 * saga: gana la del nombre idéntico —«Kimetsu no Yaiba» antes que «Kimetsu no
 * Yaiba: Hashira Geiko-hen» para la ficha de la primera— y, entre iguales, la del
 * año. Sin año en ninguna de las dos, la primera en el orden de AniList, que es
 * el de relevancia de su buscador.
 */
export function pickAniListMatch(
  local: WorkNames,
  year: number | undefined,
  candidates: readonly AniListCandidate[],
): AniListCandidate | undefined {
  const validas = candidates.filter((candidata) => sameAniListWork(local, candidata.names))
  if (validas.length === 0) return undefined

  const clavesLocales = keysOfNames(local.visible)

  // El grupo con nombre compartido: la señal fuerte, que separa «Kimetsu no
  // Yaiba» de su temporada cuando la búsqueda devuelve las dos. El año desempata
  // **dentro** del grupo, no antes: dos candidatas del mismo nombre son justo el
  // caso en que el año decide.
  const conNombre = validas.filter((candidata) =>
    anilistNames(candidata.names).some((nombre) => clavesDeNombre(nombre, clavesLocales)),
  )
  const grupo = conNombre.length === 0 ? validas : conNombre

  if (year !== undefined) {
    const delAno = grupo.find((candidata) => candidata.year === year)
    if (delAno !== undefined) return delAno
  }

  return grupo[0]
}

/**
 * El texto plano de una descripción de AniList.
 *
 * La API sirve la sinopsis con etiquetas —`<br>`, `<i>` y compañía— y entidades.
 * Se pide `asHtml: false` —así ya llega casi limpia— y se sanea igualmente: una
 * etiqueta que quede se pinta como texto, y **nunca** se inyecta HTML en la
 * interfaz. Es la frontera del dato ajeno, y la lista de entidades es corta a
 * propósito: lo que no se reconoce se queda tal cual y se ve, que es mejor que
 * borrarlo en silencio.
 */
export function plainText(descripcion: string): string {
  const sinEtiquetas = descripcion.replace(/<[^>]*>/g, ' ')
  const decodificada = sinEtiquetas.replace(
    ENTIDAD,
    (_todo, nombre: string | undefined, numero: string | undefined, hex: string | undefined) => {
      if (numero !== undefined) return puntoDeCodigo(numero, 10)
      if (hex !== undefined) return puntoDeCodigo(hex, 16)

      return (nombre === undefined ? undefined : ENTIDADES[nombre]) ?? `&${nombre ?? ''};`
    },
  )

  return decodificada.replace(/\s+/g, ' ').trim()
}

/** Las entidades que la API publica de verdad, y ninguna más. */
const ENTIDADES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
}

const ENTIDAD = /&(?:([a-zA-Z]+)|#(\d+)|#x([0-9a-fA-F]+));/g

function puntoDeCodigo(valor: string, base: number): string {
  const code = Number.parseInt(valor, base)

  return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : `&#${valor};`
}

/**
 * El `kind` del dominio para el formato de AniList.
 *
 * `MUSIC` no es de ninguna de las dos mitades de la aplicación, y devolver
 * `undefined` es la respuesta: una pieza musical no tiene ficha que abrir.
 */
export function kindOfFormat(formato: string): TitleKind | undefined {
  switch (formato) {
    case 'TV':
    case 'TV_SHORT':
      return 'tv'
    case 'MOVIE':
      return 'movie'
    case 'SPECIAL':
      return 'special'
    case 'OVA':
      return 'ova'
    case 'ONA':
      return 'ona'
    default:
      return undefined
  }
}

/**
 * La ruta de una imagen de AniList, por su id.
 *
 * El cliente manda una **referencia** —la clase de imagen y el id—, nunca una
 * dirección: la URL que AniList publica la resuelve el servidor contra su caché, y
 * el navegador no puede convertirse en un proxy hacia donde quiera. Un id que no
 * sea el de una obra se corta aquí, donde se sabe, y no en una petición que la
 * ruta contestaría con un 404.
 */
export function anilistImagePath(kind: AniListImageKind, id: number): string {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`id de AniList inválido: ${id}`)
  }

  return `/api/anilist/image/${kind}/${id}`
}

/** Lo que hace falta para emparejar una ficha local: sus nombres y su año. */
export interface LocalWork {
  readonly names: WorkNames
  readonly year?: number | undefined
}

/** Los nombres de una obra local a partir de lo que la fuente dijo. */
export function localWork(input: TitleInput, year?: number): LocalWork {
  return { names: namesOf(input), ...(year === undefined ? {} : { year }) }
}
