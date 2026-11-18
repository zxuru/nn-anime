/**
 * Quién contesta a una búsqueda escrita en la casilla.
 *
 * De la búsqueda de una sola casilla contra AniList queda **esta regla y nada más**: los
 * términos que empiezan por `#` son **géneros** y el resto es el **título**. Un término
 * con `#` no lo entiende ninguna fuente —buscan el texto literal, y `#aventura` no es un
 * título—, así que esa búsqueda la contesta el catálogo y a los proveedores no se les
 * pregunta.
 *
 * Vive en `core` porque son **dos lados** los que tienen que decidirlo igual: el servidor,
 * que elige a quién preguntar, y la interfaz, que elige qué pinta. Con una copia en cada
 * lado, la pantalla pediría una cosa y pintaría otra.
 */

import { normalizeTerm } from './models'

/**
 * El término de género de una consulta, plegado; o nada si no lo pide.
 *
 * La regla es «algún término empieza por `#` y no es el `#` a secas»: un `#` suelto no
 * pide ningún género y no hay nada que buscar por él. No se comprueba que el género
 * exista —eso necesita la lista de AniList, y quien la tiene es el servidor—: aquí sólo
 * se decide **qué término** viaja.
 *
 * El término sale plegado con `normalizeTerm`, y el `#` se puede escribir pegado o
 * separado: `#acción`, `#accion`, `#ACCIÓN` y `# acción` producen el mismo género y
 * la misma clave de caché. Lo que se pinta en la casilla no se toca: esto es lo que
 * se manda, no lo que se ve.
 */
export function genreTerm(input: string): string | undefined {
  const fichas = normalizeTerm(input).split(' ')
  const marca = fichas.findIndex((ficha) => ficha.startsWith('#'))

  if (marca === -1) return undefined

  const termino = fichas.slice(marca).join(' ').replace(/^#\s*/, '')

  return termino === '' ? undefined : termino
}

/**
 * Si el texto pide algún género.
 *
 * Se decide con `genreTerm`, que es la misma regla que elige el término: con dos
 * copias, la pantalla podría creer que hay género y el servidor que no.
 */
export function hasGenreToken(input: string): boolean {
  return genreTerm(input) !== undefined
}
