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

/**
 * Si el texto pide algún género.
 *
 * La regla es «algún término empieza por `#` y no es el `#` a secas»: un `#` suelto no
 * pide ningún género y no hay nada que buscar por él. No se comprueba que el género
 * exista —eso necesita la lista de AniList, y quien la tiene es el servidor—: aquí sólo
 * se decide **quién contesta**.
 */
export function hasGenreToken(input: string): boolean {
  return input
    .normalize('NFC')
    .split(/\s+/)
    .some((token) => token.startsWith('#') && token.length > 1)
}
