/**
 * La dirección de una ficha y el rastro de la búsqueda de la que viene.
 *
 * El servidor anota en `search_history` la búsqueda que trajo a una ficha, pero
 * sólo la anota si la petición la lleva: `GET /api/anime/:providerId/:ref?q=…`.
 * Esa fila es la señal con la que el motor recomienda lo que el usuario está
 * buscando y, hasta ahora, no se la decía nadie —la tarjeta llevaba a la ficha y
 * la ficha pedía su detalle sin la consulta—, así que `search_history` se quedaba
 * vacía y el motor no cambiaba con lo que se buscaba: con el historial de
 * visionado vacío, todos los candidatos puntuaban cero y el orden lo decidía sólo
 * el desempate, que da siempre el mismo.
 *
 * Aquí viven las dos mitades de ese acuerdo —componer la dirección con la
 * consulta y volver a leerla de la dirección— para que la tarjeta, las listas de
 * la búsqueda y la pantalla de la ficha no tengan cada una la suya.
 */

/**
 * Si la dirección es la de una ficha.
 *
 * La de la aplicación (`/anime/…`) y la del servidor (`/api/anime/…`) son la
 * misma cosa dicha en dos sitios. Una pieza que no está en ninguna fuente lleva a
 * la búsqueda de su título, y esa dirección ya trae su propio `q`: no es una
 * ficha y no se le pega nada.
 */
function esFicha(to: string): boolean {
  return to.startsWith('/anime/') || to.startsWith('/api/anime/')
}

/** La dirección de una ficha. La referencia viaja codificada: puede tener barras. */
export function rutaDeFicha(providerId: string, ref: string): string {
  return `/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`
}

/**
 * La dirección con la consulta que la trajo, si es una ficha.
 *
 * Sin consulta —la vitrina, el perfil, la ficha abierta por su dirección— sale
 * tal cual, para que una navegación que no viene de una búsqueda no invente un
 * rastro que no existe.
 */
export function conLaConsulta(to: string, consulta: string | undefined): string {
  const termino = consulta?.trim() ?? ''
  if (termino === '' || !esFicha(to)) return to

  return `${to}${to.includes('?') ? '&' : '?'}q=${encodeURIComponent(termino)}`
}

/** La consulta que viaja en una dirección de ficha, si viaja alguna. */
export function consultaDeLaFicha(path: string): string | undefined {
  const consulta = path.split('?')[1] ?? ''
  const termino = new URLSearchParams(consulta).get('q')?.trim() ?? ''

  return termino === '' ? undefined : termino
}
