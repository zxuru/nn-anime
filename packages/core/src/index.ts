/**
 * Superficie pública de `@nn-anime/core`: el kernel sin dependencias que
 * comparten todos los demás paquetes.
 *
 * Este archivo no reexporta el árbol completo del paquete: enumera a mano lo
 * que es contrato público. Un módulo nuevo se añade aquí cuando alguien de
 * fuera del paquete lo necesita.
 */

export {
  APP_DIR_NAME,
  type ConfigEnvironment,
  type ConfigOverrides,
  type ConfigPaths,
  ensureDirs,
  type LoadConfigOptions,
  loadConfig,
} from './config'
export {
  AppError,
  type AppErrorOptions,
  type ErrorCode,
  type ErrorContext,
  ProviderError,
  StoreError,
  UpstreamError,
} from './errors'
export {
  CATALOGS,
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type MessageParams,
  type Messages,
  resolveLocale,
  t,
  translate,
} from './i18n'
export {
  createLogger,
  isSensitiveKey,
  LOG_LEVELS,
  type LogEntry,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  REDACTED,
  SENSITIVE_KEYS,
  toJsonLine,
} from './logger'
export {
  type AiringStatus,
  type AnimeDetail,
  type CacheHit,
  type Candidate,
  type DeepReadonly,
  type Episode,
  type Mode,
  type ProviderRef,
  type PublicStreamSource,
  type SearchResult,
  type StreamMode,
  type StreamRequest,
  type StreamSource,
  type SubtitleFormat,
  type SubtitleTrack,
  type TitleKind,
  toPublicStreamSource,
  type WatchEventInput,
} from './models'
export { type Err, err, map, mapErr, type Ok, ok, type Result, unwrapOr } from './result'
export {
  airingStatusSchema,
  animeDetailSchema,
  cacheHitSchema,
  candidateSchema,
  episodeSchema,
  modeSchema,
  providerRefSchema,
  searchResultSchema,
  streamHeadersSchema,
  streamKindSchema,
  streamModeSchema,
  streamRequestSchema,
  streamSourceSchema,
  subtitleFormatSchema,
  subtitleTrackSchema,
  titleKindSchema,
  watchEventInputSchema,
} from './schema'
export {
  MAX_PORT,
  MIN_PORT,
  readSettings,
  type Settings,
  settingsSchema,
} from './settings'
