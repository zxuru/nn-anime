/**
 * La identidad de una obra cuando cada fuente la nombra a su manera.
 *
 * La misma obra sale dos veces —una tarjeta por proveedor, dos secciones de
 * relacionados que no se ven entre sí— cuando los nombres no coinciden letra a
 * letra: «Danmachi» en una fuente y «Dungeon ni Deai wo Motomeru no wa
 * Machigatteiru Darou ka» en la otra. Comparar sólo el título que la fuente
 * muestra deja ese caso fuera, y es el caso que se reportó.
 *
 * Lo comparable sin red es todo lo que la fuente ya dijo del título:
 *
 * 1. El nombre que muestra.
 * 2. Su título alternativo (`titleAlt`), que el contrato de plugins tiene desde
 *    el principio y hasta ahora sólo se pintaba bajo el nombre.
 * 3. La referencia escrita como título. En estos catálogos el slug de la
 *    referencia suele ser el título original —`dungeon-ni-deai-wo-motomeru-no-wa-
 *    machigatteiru-darou-ka`—, y es lo que ata la ficha de una fuente con el
 *    nombre que la otra enseña. Sólo cuenta si lleva letras: una referencia
 *    numérica es un identificador y no dice nada del título.
 *
 * La clave de comparación es **título base más temporada**, no título de saga.
 * El título de saga corta el subtítulo, y «Kimetsu no Yaiba: Hashira Geiko-hen»
 * no es la misma obra que «Kimetsu no Yaiba»; el título base lo conserva y las
 * separa. La temporada entra porque el título base la quita: «Overlord» y
 * «Overlord IV» son dos obras, y sin ella serían una.
 *
 * Dos obras son la misma cuando **todos los nombres de una están entre los de la
 * otra** o cuando sus nombres coinciden. Lo primero junta «Danmachi» —una fuente
 * la llama así y su referencia es el título original— con «Dungeon ni Deai…»
 * —la otra la llama por el título original y guarda «Danmachi» en la
 * referencia, que es donde ambos nombres se encuentran—. Un nombre que sólo
 * tiene una de las dos parejas —el subtítulo propio de un spin-off— deja la
 * pareja fuera: es el falso positivo que se paga por no preguntar a la red, y el
 * daño es una tarjeta de más, no una de menos.
 */

import type { ProviderRef } from './models'
import { baseTitle, seasonNumberOf } from './titles'

/** Lo que una fuente dice de un título: su nombre, su alternativa y su referencia. */
export interface TitleInput {
  readonly title: string
  readonly titleAlt?: string
  /** La referencia del proveedor, sin el proveedor: puede ser un slug del título. */
  readonly ref?: string
}

/**
 * Los nombres con los que se reconoce una obra.
 *
 * `title` es el que la fuente muestra y el único que se pinta; `visible` añade
 * su alternativa y `variants` la referencia escrita como título. Ninguno de los
 * dos últimos sale en pantalla.
 *
 * Las claves vienen calculadas: comparar dos obras es mirar conjuntos, y
 * recalcular la normalización en cada comparación es lo que hace lenta una fila
 * de doscientas entradas.
 */
export interface WorkNames {
  readonly title: string
  /** El título y su alternativa: los nombres que la fuente **enseña**. */
  readonly visible: readonly string[]
  /** Lo comparable: lo visible más la referencia escrita como título. */
  readonly variants: readonly string[]
  /** Las claves de `variants`. */
  readonly keys: ReadonlySet<string>
  /** Las claves de `visible`. */
  readonly visibleKeys: ReadonlySet<string>
}

/** Una entrada de una lista: lo mínimo para reconocer de qué obra es. */
export interface WorkItem {
  readonly ref: ProviderRef
  readonly title: string
  readonly titleAlt?: string
  readonly year?: number
}

/** Una referencia con letras puede leerse como título. */
const LETRAS = /\p{L}/u

/**
 * La referencia escrita como título, si lo parece.
 *
 * Los separadores del slug pasan a espacios y lo que no es letra ni dígito se
 * cae: `dandadan/12` es `dandadan 12`, que no empareja con nada y tampoco
 * estorba.
 */
function comoTitulo(ref: string): string | undefined {
  const texto = ref
    .replace(/[-_/]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return LETRAS.test(texto) ? texto : undefined
}

/**
 * La clave de un nombre: el título base y su temporada.
 *
 * Cadena vacía cuando no queda nada comparable —un título sin letras ni
 * dígitos—, y esas claves no entran en ningún conjunto: si entraran, dos títulos
 * basura emparejarían entre sí.
 */
function clave(name: string): string {
  const base = baseTitle(name)

  return base === '' ? '' : `${base}|${seasonNumberOf(name) ?? ''}`
}

function claves(names: readonly string[]): ReadonlySet<string> {
  const conjunto = new Set<string>()

  for (const name of names) {
    const una = clave(name)
    if (una !== '') conjunto.add(una)
  }

  return conjunto
}

/**
 * Las claves comparables de una lista de nombres.
 *
 * Es la misma normalización que usan `namesOf` y `sameWork`, expuesta para quien
 * compara contra **muchos** nombres a la vez —una obra de AniList publica hasta
 * diez, entre sinónimos— sin fabricar un `TitleInput` que no existe.
 */
export function keysOfNames(names: readonly string[]): ReadonlySet<string> {
  return claves(names)
}

/**
 * Los nombres de una obra a partir de lo que la fuente dijo.
 *
 * Se quitan los repetidos por clave: el título y su slug suelen ser el mismo
 * nombre escrito dos veces, y contarlo dos veces no añade nada a la comparación.
 */
export function namesOf(input: TitleInput): WorkNames {
  const visible = sinRepetir([input.title, input.titleAlt])
  const referencia = input.ref === undefined ? undefined : comoTitulo(input.ref)
  const variants = sinRepetir([...visible, referencia])

  return {
    title: input.title,
    visible,
    variants,
    keys: claves(variants),
    visibleKeys: claves(visible),
  }
}

/** Los candidatos que dejan una clave comparable, sin repetirla. */
function sinRepetir(candidatos: readonly (string | undefined)[]): readonly string[] {
  const vistas = new Set<string>()
  const nombres: string[] = []

  for (const candidato of candidatos) {
    if (candidato === undefined || candidato.trim() === '') continue

    const una = clave(candidato)
    if (una === '' || vistas.has(una)) continue

    vistas.add(una)
    nombres.push(candidato)
  }

  return nombres
}

/** Las claves con las que se reconoce una obra: una por cada nombre suyo. */
export function workKeys(names: WorkNames): ReadonlySet<string> {
  return names.keys
}

/** ¿Está todo `parte` dentro de `todo`? El vacío no está dentro de nada. */
function contiene(todo: ReadonlySet<string>, parte: ReadonlySet<string>): boolean {
  if (parte.size === 0) return false

  for (const una of parte) if (!todo.has(una)) return false

  return true
}

function solapan(uno: ReadonlySet<string>, otro: ReadonlySet<string>): boolean {
  for (const una of uno) if (otro.has(una)) return true

  return false
}

/**
 * ¿Son la misma obra?
 *
 * El año **no** entra: quien compara decide si lo usa. En la búsqueda no hay año
 * que usar —los proveedores no lo devuelven en los resultados— y las dos reglas
 * de aquí ya separan las entregas por la temporada del título.
 */
export function sameWork(uno: WorkNames, otro: WorkNames): boolean {
  // Los nombres de una, todos entre los de la otra: es el caso de las dos
  // fuentes que se llaman distinto y se encuentran en la referencia.
  if (contiene(uno.keys, otro.keys) || contiene(otro.keys, uno.keys)) return true

  // O un nombre que las dos enseñan —el título o su alternativa—, con la
  // referencia de cada una por su lado. La alternativa entra aquí y no sólo en
  // la lista de nombres: es el nombre con el que una tercera fuente puede
  // titular la obra, y entonces es lo único que las dos tienen en común.
  return solapan(uno.visibleKeys, otro.visibleKeys)
}

/** Los nombres de una entrada de lista. */
function nombresDeItem(item: WorkItem): WorkNames {
  return namesOf({
    title: item.title,
    ...(item.titleAlt === undefined ? {} : { titleAlt: item.titleAlt }),
    ref: item.ref.value,
  })
}

/**
 * Las entradas agrupadas por obra, en el orden de llegada.
 *
 * `mismoAño` decide si el año entra en la comparación: quien lee un listado de
 * la caché lo tiene y lo compara, y quien lee resultados de proveedores casi
 * nunca lo tiene.
 *
 * **Un índice de claves evita comparar cada entrada con todas.** Sólo se prueba
 * contra las obras que comparten algún nombre, que es lo que la regla necesita
 * para poder ser la misma —si los nombres de una están todos entre los de la
 * otra, comparten los de la primera—; sin el índice, una fila de doscientas
 * entradas haría veinte mil comparaciones.
 */
export function groupByWork<T extends WorkItem>(
  items: readonly T[],
  mismoAño: (uno: T, otro: T) => boolean,
): readonly (readonly T[])[] {
  const grupos: { readonly items: T[]; readonly nombres: WorkNames[] }[] = []
  const indice = new Map<string, number[]>()

  for (const item of items) {
    const nombres = nombresDeItem(item)
    const candidatos = new Set<number>()

    for (const una of nombres.keys) {
      for (const grupo of indice.get(una) ?? []) candidatos.add(grupo)
    }

    const encontrado = [...candidatos].find((numero) => {
      const grupo = grupos[numero]
      const primero = grupo?.items[0]
      if (grupo === undefined || primero === undefined) return false
      if (!mismoAño(primero, item)) return false

      // Contra todos los nombres del grupo: la tercera fuente que sólo comparte
      // la alternativa con la segunda entra contra ella y no contra la primera.
      return grupo.nombres.some((uno) => sameWork(uno, nombres))
    })

    const numero = encontrado ?? grupos.length
    if (encontrado === undefined) grupos.push({ items: [item], nombres: [nombres] })

    const grupo = grupos[numero]
    if (grupo === undefined) continue

    if (encontrado !== undefined) {
      grupo.items.push(item)
      grupo.nombres.push(nombres)
    }

    for (const una of nombres.keys) {
      const lista = indice.get(una) ?? []
      if (!lista.includes(numero)) lista.push(numero)
      indice.set(una, lista)
    }
  }

  return grupos.map((grupo) => grupo.items)
}

/**
 * La primera entrada de cada obra, en el orden de llegada.
 *
 * Es lo que necesitan las filas de la home: una tarjeta por obra, y la que se
 * queda es la primera —el orden lo pone quien llama, que en las dos filas es de
 * más nueva a más vieja—.
 */
export function uniqueByWork<T extends WorkItem>(
  items: readonly T[],
  mismoAño: (uno: T, otro: T) => boolean,
): readonly T[] {
  const unicas: T[] = []

  for (const grupo of groupByWork(items, mismoAño)) {
    const primera = grupo[0]
    if (primera !== undefined) unicas.push(primera)
  }

  return unicas
}
