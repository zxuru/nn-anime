/**
 * Superficie pública de `@nn-anime/core`: el kernel sin dependencias que
 * comparten todos los demás paquetes.
 *
 * Este archivo no reexporta el árbol completo del paquete: enumera a mano lo
 * que es contrato público. Un módulo nuevo se añade aquí cuando alguien de
 * fuera del paquete lo necesita.
 */

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
export { type Err, err, map, mapErr, type Ok, ok, type Result, unwrapOr } from './result'
