/**
 * Composición de catálogos del CLI.
 *
 * El CLI es el único punto donde se juntan los mensajes de `core` con los
 * suyos. Si falta una clave en el catálogo del CLI, se resuelve contra el de
 * `core`; si falta en los dos, `t` devuelve la clave, que delata el fallo.
 */

import {
  CATALOGS as CORE_CATALOGS,
  DEFAULT_LOCALE,
  type Locale,
  type MessageParams,
  type Messages,
  translate,
} from '@nn-anime/core'
import { messages as es } from './es'

export const CATALOGS: Readonly<Record<Locale, Messages>> = {
  es: { ...CORE_CATALOGS[DEFAULT_LOCALE], ...es },
}

export function t(locale: Locale, key: string, params?: MessageParams): string {
  return translate(CATALOGS, locale, key, params)
}
