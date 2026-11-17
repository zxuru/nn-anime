/**
 * Lo que ya se vio de un título.
 *
 * La ficha lo lee para marcar sus filas; la columna de episodios del reproductor
 * no lo pedía, y es justo donde se encadena: con doce capítulos hay que recordar,
 * y con mil ciento ochenta es imposible. El endpoint es el mismo y no toca el
 * contrato del reproductor.
 */

import { type WatchedEpisodePayload, watchedResponseSchema } from '@rona/core/api'
import { apiGet } from '../../api/client'

/** Los episodios vistos o empezados del título, si la petición contesta. */
export async function loadWatched(
  providerId: string,
  ref: string,
  signal?: AbortSignal,
): Promise<readonly WatchedEpisodePayload[]> {
  const ruta = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/watched`

  try {
    const respuesta = await apiGet(
      ruta,
      watchedResponseSchema,
      signal === undefined ? {} : { signal },
    )

    return respuesta.episodes
  } catch {
    // Sin la marca la lista sigue sirviendo: el renglón se pinta como siempre y
    // la pantalla no pierde la navegación por un dato de adorno.
    return []
  }
}
