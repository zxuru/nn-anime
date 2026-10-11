/**
 * Superficie pública de `@nn-anime/provider-sdk`.
 *
 * Este paquete es lo que un autor de plugins importa y lo que el servidor usa
 * para cargarlos. Enumera a mano lo que es contrato público: el día que alguien
 * de fuera lo importe, lo que no esté aquí no existe.
 *
 * El contrato de tipos vive en `types.ts`; la validación, en `schema.ts`; las
 * llamadas que nunca lanzan, en `call.ts`; el alta, en `registry.ts`; y el test
 * de conformidad que el autor puede correr contra su plugin, en `conformance.ts`.
 */

export {
  getAnime,
  getEpisodes,
  getFeed,
  getTrending,
  resolveStream,
  search,
} from './call'
export {
  assertConforms,
  type ConformanceReport,
  inspectConformance,
  type MethodReport,
} from './conformance'
export {
  apiVersionMismatch,
  classifyThrow,
  describeProblems,
  duplicateId,
  failureKindOf,
  invalidShape,
  type ProviderFailureKind,
  type ProviderFailureOptions,
  providerFailure,
} from './errors'
export {
  type LoadedProvider,
  type LoadOptions,
  type LoadReport,
  loadProviders,
  PLUGIN_EXTENSIONS,
  pluginNames,
  type RejectedPlugin,
} from './loader'
export {
  createRegistry,
  type ProviderRegistry,
  readApiVersion,
  readProviderId,
  validateProvider,
} from './registry'
export {
  type ProviderResponse,
  type ProviderShape,
  providerAnimeDetailSchema,
  providerCapabilitiesSchema,
  providerEpisodesSchema,
  providerFeedSchema,
  providerIdSchema,
  providerSchema,
  providerSearchResultsSchema,
  providerStreamHeadersSchema,
  providerStreamSourceSchema,
  providerStreamSourcesSchema,
  RESPONSE_SCHEMAS,
} from './schema'
export {
  type CallOptions,
  OPTIONAL_PROVIDER_METHODS,
  PROVIDER_API_VERSION,
  PROVIDER_METHODS,
  type Provider,
  type ProviderCapabilities,
  type ProviderMethod,
  REQUIRED_PROVIDER_METHODS,
  type RequiredProviderMethod,
} from './types'
