/**
 * El estado del formulario de alta y su traducción a la petición.
 *
 * Vive aparte del componente por el motivo de siempre: esto es lo que se puede
 * probar sin navegador. El componente queda para pintar y recoger lo que se
 * escribe; lo que decide **qué se manda** se decide aquí, y se prueba aquí.
 *
 * Los valores por defecto no son decoración. Son la diferencia entre un
 * formulario que hay que rellenar entero y uno en el que se escriben tres cosas
 * —identificador, nombre y dirección— porque las rutas y los nombres de campo ya
 * son los que usa casi cualquier API.
 */

import type { ProviderDraft } from '@nn-anime/core/api'

/** Los campos de la respuesta que el formulario deja ajustar. */
export type FieldKey =
  | 'searchItems'
  | 'searchId'
  | 'searchTitle'
  | 'animeTitle'
  | 'animeGenres'
  | 'animeStudios'
  | 'episodeItems'
  | 'episodeNumber'
  | 'episodeTitle'
  | 'streamUrl'

export type EndpointKey = 'search' | 'anime' | 'episodes' | 'stream' | 'trending'

/** Lo que se puede marcar. `search` no: un proveedor sin búsqueda no se ofrece. */
export type CapabilityKey = 'sub' | 'dub'

export interface ProviderForm {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly capabilities: Readonly<Record<CapabilityKey, boolean>>
  readonly endpoints: Readonly<Record<EndpointKey, string>>
  readonly fields: Readonly<Record<FieldKey, string>>
}

export const EMPTY_FORM: ProviderForm = {
  id: '',
  name: '',
  baseUrl: '',
  capabilities: { sub: true, dub: false },
  endpoints: {
    search: '/search?q={query}',
    anime: '/anime/{ref}',
    episodes: '/anime/{ref}/episodes',
    stream: '/watch/{ref}',
    trending: '',
  },
  fields: {
    searchItems: '',
    searchId: 'id',
    searchTitle: 'title',
    animeTitle: 'title',
    animeGenres: 'genres',
    animeStudios: 'studios',
    episodeItems: '',
    episodeNumber: 'number',
    episodeTitle: 'title',
    streamUrl: 'url',
  },
}

/**
 * El cuerpo que se manda al servidor.
 *
 * No es el tipo `ProviderDraft` del contrato porque ése es el que sale del
 * schema, con los doce campos ya rellenos. Aquí sólo van los diez que el
 * formulario toca: los dos que faltan se quedan en su valor por defecto, que es
 * exactamente lo que declara el schema.
 */
export interface ProviderDraftRequest {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly capabilities: ProviderDraft['capabilities']
  readonly endpoints: {
    readonly search: string
    readonly anime: string
    readonly episodes: string
    readonly stream: string
    readonly trending?: string
  }
  readonly fields: Readonly<Record<FieldKey, string>>
}

/**
 * El formulario, convertido en petición.
 *
 * `trending` no lleva casilla propia: la capacidad se deduce de que haya ruta.
 * Una casilla que dijera «sé traer tendencias» sin decir por dónde es una casilla
 * que miente —el plugin no cargaría— y dos controles para una sola decisión es
 * una forma de que acaben discrepando.
 */
export function toProviderDraft(form: ProviderForm): ProviderDraftRequest {
  const trending = form.endpoints.trending.trim()

  return {
    id: form.id.trim(),
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    capabilities: {
      search: true,
      sub: form.capabilities.sub,
      dub: form.capabilities.dub,
      trending: trending !== '',
    },
    endpoints: {
      search: form.endpoints.search.trim(),
      anime: form.endpoints.anime.trim(),
      episodes: form.endpoints.episodes.trim(),
      stream: form.endpoints.stream.trim(),
      ...(trending === '' ? {} : { trending }),
    },
    fields: { ...form.fields },
  }
}
