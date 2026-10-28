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
  ALLOW_LOOPBACK_ENV,
  type AllowedFetchOptions,
  addressRule,
  allowLoopbackFromEnv,
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
  downloadFile,
  type FileDownloadInput,
  type FileDownloadResult,
  MAX_FILE_BYTES,
} from './download/file'
export {
  downloadHls,
  type HlsDownloadInput,
  type HlsDownloadResult,
  type RemuxFn,
  readLocalPlaylist,
} from './download/hls-download'
export {
  createPlaylistCache,
  defaultKeyPath,
  defaultSegPath,
  isPlaylist,
  MAX_PLAYLIST_BYTES,
  PLAYLIST_TTL_MS,
  type PlaylistCache,
  type PlaylistEntry,
  playlistTooLarge,
  playlistTooManyLines,
  type RewriteOptions,
  type RewrittenPlaylist,
  rewritePlaylist,
} from './hls'
export {
  createMpvPlayer,
  hasMpv,
  MAX_STDERR_BYTES,
  type MpvEvent,
  type MpvPlayer,
  type MpvPlayerOptions,
  type MpvProcess,
  mpvUnavailable,
  type PlayOptions,
  type PlayOutcome,
  type SpawnMpv,
  spawnMpvProcess,
  trimStderr,
} from './mpv'
export {
  HEADER_FIELD_FLAG,
  HEADER_NAME_RE,
  invalidHeaderError,
  type MpvArgsOptions,
  type MpvArgsOutcome,
  mpvArgs,
  validHeaderName,
  validHeaderValue,
} from './mpv-args'
export {
  createPinnedFetch,
  type PinnedFetch,
  type PinnedFetchOptions,
  type PinnedRequestOptions,
  type RequestLike,
  type UpstreamRequest,
  type UpstreamResponse,
} from './pinned-fetch'
export {
  createPluginFetch,
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  type PluginFetchOptions,
  type PluginTransport,
  pluginFetchFactory,
  type SocketLike,
  systemConnector,
} from './plugin-fetch'
export {
  ALLOWED_RESPONSE_HEADERS,
  contentTypeFor,
  type ResourceKind,
  resourceKind,
  type SanitizeOptions,
  sanitizeHeaders,
} from './response-headers'
export {
  type DecodedSubtitle,
  decodeSubtitle,
  type ExtractedSubtitle,
  extractFirstSubtitle,
  isRarBytes,
  isZipBytes,
  MAX_SUBTITLE_BYTES,
  type SubtitleKind,
  srtToVtt,
  subtitleKind,
  subtitleNotInArchive,
  subtitleRarUnsupported,
  subtitleTooLarge,
} from './subtitles'
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
