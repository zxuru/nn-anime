/**
 * Contrato público de un proveedor de contenido.
 *
 * Los tipos del dominio se **reexportan** desde `@nn-anime/core` en lugar de
 * escribirse otra vez: son los mismos que valida el almacén y los que consume la
 * interfaz, y dos definiciones de la misma forma acaban divergiendo. Lo que este
 * archivo añade es lo que `core` no puede saber: la forma de un plugin.
 *
 * Aquí no se ejecuta nada. Son formas; la validación vive en `schema.ts`, la
 * conversión de excepciones en `errors.ts` y las llamadas que nunca lanzan en
 * `call.ts`.
 */

import type {
  AnimeDetail,
  ProviderCapabilities as CoreProviderCapabilities,
  Episode,
  ProviderRef,
  SearchResult,
  StreamRequest,
  StreamSource,
} from '@nn-anime/core'

export type { AnimeDetail, Episode, ProviderRef, SearchResult, StreamRequest, StreamSource }

/**
 * Versión del contrato que este SDK implementa.
 *
 * Un plugin con otra versión se rechaza con un mensaje que nombra ésta, en lugar
 * de fallar más tarde al llamar a un método con otra firma.
 */
export const PROVIDER_API_VERSION = '1'

/** Métodos del contrato, en el orden en que el spec los declara. */
export const REQUIRED_PROVIDER_METHODS = [
  'search',
  'getAnime',
  'getEpisodes',
  'resolveStream',
] as const

/** Métodos que un plugin puede no implementar. */
export const OPTIONAL_PROVIDER_METHODS = ['getTrending'] as const

export type RequiredProviderMethod = (typeof REQUIRED_PROVIDER_METHODS)[number]
export type OptionalProviderMethod = (typeof OPTIONAL_PROVIDER_METHODS)[number]
export type ProviderMethod = RequiredProviderMethod | OptionalProviderMethod

export const PROVIDER_METHODS: readonly ProviderMethod[] = [
  ...REQUIRED_PROVIDER_METHODS,
  ...OPTIONAL_PROVIDER_METHODS,
]

/**
 * Las capacidades son las de `core`, no una copia.
 *
 * La interfaz recibe las mismas en `/api/providers`, así que una segunda
 * definición aquí sólo serviría para divergir de la otra.
 */
export type ProviderCapabilities = CoreProviderCapabilities

export interface CallOptions {
  readonly signal: AbortSignal
  /** Milisegundos. El módulo ya aplica un timeout mayor; esto es una sugerencia. */
  readonly timeoutMs: number
}

/**
 * Lo que un plugin tiene que exportar para ser cargado.
 *
 * `apiVersion` es el literal `'1'` y no `string`: un plugin que declare otra
 * versión no compila contra estos tipos, además de rechazarse en tiempo de
 * carga. El error se ve antes y en el sitio donde se puede entender.
 */
export interface Provider {
  /** Identificador estable, kebab-case, único entre plugins. Ej: 'mi-fuente'. */
  readonly id: string
  /** Nombre para mostrar. */
  readonly name: string
  readonly apiVersion: typeof PROVIDER_API_VERSION
  readonly capabilities: ProviderCapabilities

  search(query: string, options: CallOptions): Promise<readonly SearchResult[]>
  getAnime(ref: ProviderRef, options: CallOptions): Promise<AnimeDetail>
  getEpisodes(ref: ProviderRef, options: CallOptions): Promise<readonly Episode[]>
  resolveStream(request: StreamRequest, options: CallOptions): Promise<readonly StreamSource[]>
  /** Opcional. Listas curadas para arranque en frío de `recsys`. */
  getTrending?(options: CallOptions): Promise<readonly SearchResult[]>
}

/**
 * Lo que devuelve cada método **no se declara aquí**.
 *
 * Se deriva de los schemas de respuesta en `schema.ts`
 * (`ProviderResponse<M>`), porque dos listas de la misma forma —una de tipos y
 * otra de validación— acaban divergiendo, y la que se olvida de actualizar es
 * siempre la que nadie ejecuta.
 */
