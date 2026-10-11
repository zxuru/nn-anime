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

/** Minúsculas, sin diacríticos, sin signos: lo que queda es comparable. */
function normalizar(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function baseTitle(title: string): string {
  let base = normalizar(title).replace(/\s+/g, ' ')

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
 */
const MARCADOR_DE_PELICULA_FINAL = /\s(?:the\s+)?(?:movie|gekijouban|pelicula)\s*\d*$/

/** El mismo marcador delante: «Gekijouban Kimetsu no Yaiba» es la saga de siempre. */
const MARCADOR_DE_PELICULA_INICIAL = /^(?:the\s+)?(?:movie|gekijouban|pelicula)\s+/

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
