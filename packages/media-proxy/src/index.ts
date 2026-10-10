/**
 * Superficie pública de `@nn-anime/media-proxy`.
 *
 * El módulo que se interpone entre el navegador y los sitios de video: emite
 * tickets opacos para que el cliente nunca vea una URL del upstream, y proxya
 * bytes, playlists y subtítulos. Hoy expone el almacén de tickets; el proxy de
 * bytes llega en T26.
 */

export {
  type ByteProxyRequest,
  type FetchLike,
  MAX_COVER_BYTES,
  parseRange,
  proxyBytes,
  RASTER_TYPES,
  type RangeOutcome,
  upstreamFailure,
} from './byte-proxy'
export {
  type AllowedFetchOptions,
  addressRule,
  checkDestination,
  checkResolvedDestination,
  type DestinationOutcome,
  type DestinationRule,
  destinationError,
  fetchAllowed,
  MAX_REDIRECTS,
  type Resolver,
  systemResolver,
} from './destination-guard'
export {
  createPlaylistCache,
  defaultSegPath,
  isPlaylist,
  MAX_PLAYLIST_BYTES,
  PLAYLIST_TTL_MS,
  type PlaylistCache,
  type PlaylistEntry,
  playlistTooLarge,
  type RewriteOptions,
  type RewrittenPlaylist,
  rewritePlaylist,
} from './hls'
export {
  ALLOWED_RESPONSE_HEADERS,
  contentTypeFor,
  type ResourceKind,
  resourceKind,
  type SanitizeOptions,
  sanitizeHeaders,
} from './response-headers'
export {
  createTicketStore,
  DEFAULT_CAPACITY,
  DEFAULT_TTL_S,
  type TicketContents,
  type TicketFailure,
  type TicketOutcome,
  type TicketStore,
  type TicketStoreOptions,
  ticketError,
} from './ticket-store'
