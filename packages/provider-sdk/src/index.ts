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
  invalidShape,
  type ProviderFailureKind,
  type ProviderFailureOptions,
  providerFailure,
} from './errors'
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
