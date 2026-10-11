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
 */
export interface WorkNames {
  readonly title: string
  /** El título y su alternativa: los nombres que la fuente **enseña**. */
  readonly visible: readonly string[]
  /** Lo comparable: lo visible más la referencia escrita como título. */
  readonly variants: readonly string[]
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
 * Los nombres de una obra a partir de lo que la fuente dijo.
 *
 * Se quitan los repetidos por clave: el título y su slug suelen ser el mismo
 * nombre escrito dos veces, y contarlo dos veces no añade nada a la comparación.
 */
export function namesOf(input: TitleInput): WorkNames {
  const visible = sinRepetir([input.title, input.titleAlt])
  const referencia = input.ref === undefined ? undefined : comoTitulo(input.ref)

  return { title: input.title, visible, variants: sinRepetir([...visible, referencia]) }
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
  return claves(names.variants)
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
  const clavesUno = workKeys(uno)
  const clavesOtro = workKeys(otro)

  if (contiene(clavesUno, clavesOtro) || contiene(clavesOtro, clavesUno)) return true

  // O un nombre que las dos enseñan —el título o su alternativa—, con la
  // referencia de cada una por su lado. La alternativa entra aquí y no sólo en
  // la lista de nombres: es el nombre con el que una tercera fuente puede
  // titular la obra, y entonces es lo único que las dos tienen en común.
  return solapan(claves(uno.visible), claves(otro.visible))
}
