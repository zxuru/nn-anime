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

import type { ProviderDraft } from '@rona/core/api'
import type { MediaFamily } from '@rona/core/models'

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

/** Las tres familias de contenido, en el orden en que se ofrecen. */
export const FAMILY_OPTIONS: readonly MediaFamily[] = ['anime', 'animation', 'live']

/**
 * Marca o desmarca una familia, sin dejar nunca el conjunto vacío.
 *
 * Un manifiesto sin familias no se puede cargar y el formulario lo diría tarde:
 * quitar la última casilla deja marcada la de anime, que es el defecto del
 * contrato. Es una función pura para poder medirla sin un DOM.
 */
export function toggleFamilia(
  familias: readonly MediaFamily[],
  familia: MediaFamily,
): readonly MediaFamily[] {
  if (familias.includes(familia)) {
    return familias.length === 1 ? familias : familias.filter((una) => una !== familia)
  }

  // Se mantiene el orden del contrato: dos manifiestos con las mismas familias
  // escritas en otro orden serían dos textos para la misma declaración.
  return FAMILY_OPTIONS.filter((una) => una === familia || familias.includes(una))
}

export interface ProviderForm {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly capabilities: Readonly<Record<CapabilityKey, boolean>>
  /**
   * Qué familias sirve, como conjunto.
   *
   * Se pregunta aquí y no se deduce: el autor del plugin lo sabe y el usuario no,
   * y una fuente de acción real que se declarara de anime dejaría su pestaña vacía
   * sin que nada explicara por qué. Tres casillas y no un desplegable: una fuente
   * puede servir anime y acción real sin servir animación occidental.
   */
  readonly families: readonly MediaFamily[]
  readonly endpoints: Readonly<Record<EndpointKey, string>>
  readonly fields: Readonly<Record<FieldKey, string>>
}

export const EMPTY_FORM: ProviderForm = {
  id: '',
  name: '',
  baseUrl: '',
  capabilities: { sub: true, dub: false },
  families: ['anime'],
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
      // El asistente no ofrece un feed: un RSS necesita parseo XML y esto genera
      // rutas JSON. La capacidad existe para plugins escritos a mano.
      feed: false,
      // La declaración nueva gana sobre `media`; el asistente escribe la nueva y
      // no la heredada, para que un plugin recién creado no dependa del legado.
      families: [...form.families],
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
