/**
 * El título base: el título sin su marcador de temporada.
 *
 * Sirve para emparejar los hermanos de una saga sin pedirle nada a la red y sin
 * que la fuente tenga que declarar relaciones. Es una heurística y se llama así:
 * una fuente que nombre la secuela de otra forma («Frieren: Beyond Journey's
 * End») no empareja.
 *
 * La lista de marcadores es **cerrada**, y ésa es la decisión que importa.
 * «Quitar lo que parezca un número» convierte «86» en cadena vacía y «5-toubun
 * no Hanayome» en «toubun no hanayome», y entonces dos títulos sin nada que ver
 * salen como la misma saga.
 *
 * Los romanos finales sí se quitan, con su falso positivo declarado: «Final
 * Fantasy VII» queda en «final fantasy». El daño es una fila de más en una
 * sección de conveniencia; el de no quitarlos es que «Overlord IV» no encuentre
 * a «Overlord».
 */

/** Un marcador de temporada, escrito uno a uno. */
const MARCADORES: readonly RegExp[] = [
  /\b(?:the\s+)?final\s+season\b/g,
  /\b\d+(?:st|nd|rd|th)\s+season\b/g,
  /\bseason\s+\d+\b/g,
  /\btemporada\s+\d+\b/g,
  /\b\d+\s+temporada\b/g,
  /\bpart\s+\d+\b/g,
  /\bparte\s+\d+\b/g,
  /\bcour\s+\d+\b/g,
]

/** El romano final. Sólo al final: «Fate/stay night» no lleva marcador. */
const ROMANO_FINAL = /\s+(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/

/**
 * El título reducido a lo comparable.
 *
 * Dos fuentes escriben el mismo anime de otra manera —mayúsculas, un signo de
 * más, acentos— y la referencia no lo delata: cada una numera a su aire. Lo que
 * queda es minúsculas sin diacríticos y sin signos, que es lo que hace que «One
 * Piece» de una fuente y «one  piece!» de la otra sean la misma obra.
 *
 * Es la misma normalización que `baseTitle` usa por dentro, y por eso vive aquí y
 * no duplicada: la búsqueda, el top y las filas del arranque en frío comparan
 * títulos, y con dos copias de esta regla la misma obra se agruparía en una
 * pantalla y no en la de al lado.
 */
export function titleKey(title: string): string {
  return (
    title
      .normalize('NFD')
      // El dakuten cambia la letra japonesa: sólo se pliegan marcas latinas.
      .replace(/([a-z])\p{M}+/giu, '$1')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{Nd}\p{M}]+/gu, ' ')
      .trim()
  )
}

export function baseTitle(title: string): string {
  let base = titleKey(title).replace(/\s+/g, ' ')

  // Hasta que no cambie: «Sousou no Frieren 2nd Season Part 2» lleva dos.
  for (;;) {
    const anterior = base

    for (const marcador of MARCADORES) base = base.replace(marcador, ' ')
    base = base.replace(ROMANO_FINAL, '')
    base = base.replace(/\s+/g, ' ').trim()

    if (base === anterior) return base
  }
}

/**
 * El separador entre el nombre de la saga y el subtítulo de una entrega.
 *
 * El guion suelto no cuenta: «5-toubun no Hanayome» es un título, y cortarlo por
 * ahí dejaría «5». El guion rodeado de espacios sí, porque en estos catálogos
 * separa igual que los dos puntos.
 */
const SEPARADOR_DE_SUBTITULO = /[:：]|\s[-–—]\s/

/**
 * El marcador de película al final del nombre de la saga.
 *
 * «Kimetsu no Yaiba Movie 1» y «Kimetsu no Yaiba Movie» son la misma saga que
 * «Kimetsu no Yaiba»; sin quitarlo, la película queda fuera de su propia saga.
 *
 * `film` está en la lista porque los catálogos lo escriben en inglés tanto como
 * `movie`, y faltaba: «One Piece Film: Red» quedaba en «one piece film» y no
 * entraba en su propia saga.
 */
const MARCADOR_DE_PELICULA_FINAL = /\s(?:the\s+)?(?:movie|film|gekijouban|pelicula)\s*\d*$/

/** El mismo marcador delante: «Gekijouban Kimetsu no Yaiba» es la saga de siempre. */
const MARCADOR_DE_PELICULA_INICIAL = /^(?:the\s+)?(?:movie|film|gekijouban|pelicula)\s+/

/**
 * El título de la saga: el título base sin el subtítulo de la entrega.
 *
 * «Kimetsu no Yaiba: Mugen Ressha-hen», «Kimetsu no Yaiba Movie 1: Mugenjou-hen
 * - Akaza Sairai» y «Kimetsu no Yaiba» son la misma saga, y el catálogo local
 * así lo enseña: la ficha de la primera relaciona a la segunda.
 *
 * El corte es por el **primer** separador, y ésa es la decisión que se paga: un
 * subtítulo que nombra una obra distinta de la saga —«Boku no Hero Academia:
 * Vigilantes», un spin-off— entra en ella. El daño es una fila de más en una
 * sección de conveniencia; el de no cortar es que media saga de estos catálogos
 * —la que sólo se distingue por el subtítulo— no se relacione nunca.
 */
export function sagaTitle(title: string): string {
  const corte = title.search(SEPARADOR_DE_SUBTITULO)
  let base = baseTitle(corte === -1 ? title : title.slice(0, corte))

  // Hasta que no cambie: «Kimetsu no Yaiba Movie 1» pierde el marcador y el
  // título base en la misma vuelta, y «2nd Season Movie» necesita las dos.
  for (;;) {
    const anterior = base

    base = base.replace(MARCADOR_DE_PELICULA_FINAL, '')
    base = base.replace(MARCADOR_DE_PELICULA_INICIAL, '')
    base = baseTitle(base)

    if (base === anterior) return base
  }
}

/**
 * Los números de temporada, escritos uno a uno, con su grupo.
 *
 * Se leen en **orden**, y el primero que casa manda: «Shingeki no Kyojin Season 3
 * Part 2» lleva las dos palabras y el número es el de la temporada, no el de la
 * parte. Los marcadores de parte **no** dan número propio —«Part 2» es la segunda
 * mitad de la misma temporada, y «The Final Season Part 2» no es la temporada 2 de
 * nada—, con prueba.
 *
 * El texto llega ya normalizado, así que «3ª temporada» es «3 temporada» y no
 * hace falta un patrón para el ordinal.
 */
const NUMERO_DE_TEMPORADA: readonly RegExp[] = [
  /\b(\d+)(?:st|nd|rd|th)\s+season\b/,
  /\bseason\s+(\d+)\b/,
  /\btemporada\s+(\d+)\b/,
  /\b(\d+)\s+temporada\b/,
]

/** El romano final, con su valor. Sólo al final, como en `baseTitle`. */
const ROMANOS: Readonly<Record<string, number>> = {
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
}

/**
 * El número de temporada que el título lleva escrito, si lo lleva.
 *
 * «Sousou no Frieren 2nd Season» es 2 y «Shingeki no Kyojin Season 3 Part 2» es 3.
 * **No se inventa el uno**: una obra sin marcador —«One Piece», «Bleach»— devuelve
 * `undefined`, porque decir «temporada 1» de lo que la fuente no numera es un dato
 * que nadie dio y que la interfaz pintaría como cierto.
 *
 * «The Final Season» tampoco da número: no hay ningún entero que signifique «la
 * última», y quien ordene tiene el año para colocarla.
 */
export function seasonNumberOf(title: string): number | undefined {
  const base = titleKey(title).replace(/\s+/g, ' ')

  for (const patron of NUMERO_DE_TEMPORADA) {
    const numero = patron.exec(base)?.[1]
    if (numero !== undefined) return Number(numero)
  }

  const romano = /(?:^|\s)([ivx]+)$/.exec(base)?.[1]

  return romano === undefined ? undefined : ROMANOS[romano]
}

/**
 * Un sufijo que abre una entrega nueva de la misma franquicia.
 *
 * La lista es **cerrada**, como la de los marcadores de temporada, y por el mismo
 * motivo: quitar lo que parezca una continuación juntaría «One Punch Man» con
 * «One Piece». Aquí sólo entran los sufijos que estos catálogos usan de verdad
 * para nombrar la secuela de una serie larga, y hay una prueba por cada uno.
 */
const SUFIJOS_DE_FRANQUICIA: readonly RegExp[] = [
  /\s+shippuden$/,
  /\s+shippuuden$/,
  /\s+super$/,
  /\s+daima$/,
  /\s+gt$/,
  /\s+kai$/,
  /\s+z$/,
  /\s+brotherhood$/,
  /\s+heroes$/,
]

/**
 * El paréntesis —«(Original)», «(TV)», «(2024)»— es un calificador, no el nombre.
 *
 * En cualquier posición: «Ranma ½ (2024) 3rd Season» lo lleva en medio y sin
 * quitarlo la franquicia queda en «ranma 2024».
 */
const CALIFICADOR = /\s*\([^)]*\)/g

/**
 * La franquicia: el título de la saga sin el sufijo de la secuela.
 *
 * «Naruto Shippuden» y «Dragon Ball Z» pertenecen a «naruto» y a «dragon ball»,
 * y sus fichas llevan meses sin poder encadenarse: `sagaTitle` los deja como dos
 * sagas distintas, que es lo correcto —son dos obras— y a la vez lo que impide
 * pasar de una a la otra.
 *
 * Es una heurística y se llama así. Los falsos positivos declarados son los de
 * siempre: un spin-off con nombre propio entra en la franquicia de su serie
 * —«Naruto SD: Rock Lee no Seishun Full-Power Ninden» no, porque su saga es
 * «naruto sd» y el sufijo no está en la lista—, y una obra que acabe en «z» sin
 * ser una secuela pierde su última letra. El daño es una fila de más en una
 * sección de conveniencia.
 */
export function franchiseTitle(title: string): string {
  const sinCalificador = title.replace(CALIFICADOR, '')
  let base = sagaTitle(sinCalificador)

  for (;;) {
    const anterior = base

    for (const sufijo of SUFIJOS_DE_FRANQUICIA) base = base.replace(sufijo, '')
    base = base.replace(/\s+/g, ' ').trim()

    if (base === anterior) return base
  }
}
