/**
 * El título base: el título sin su marcador de temporada.
 *
 * Sirve para emparejar los hermanos de una saga dentro del mismo proveedor
 * —«Sousou no Frieren 2nd Season» con «Sousou no Frieren»— sin pedirle nada a la
 * red y sin que la fuente tenga que declarar relaciones. Es una heurística y se
 * llama así: una fuente que nombre la secuela de otra forma («Frieren: Beyond
 * Journey's End») no empareja.
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
