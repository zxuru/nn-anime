/**
 * Composición de catálogos de la interfaz.
 *
 * Igual que en el CLI: los mensajes propios se mezclan sobre los de `core`, y
 * una clave que falte aquí se resuelve contra el catálogo de `core`.
 */

import {
  CATALOGS as CORE_CATALOGS,
  DEFAULT_LOCALE,
  type Locale,
  type MessageParams,
  type Messages,
  translate,
} from '@nn-anime/core/i18n'
import { messages as es } from './es'

export const CATALOGS: Readonly<Record<Locale, Messages>> = {
  es: { ...CORE_CATALOGS[DEFAULT_LOCALE], ...es },
}

export function t(locale: Locale, key: string, params?: MessageParams): string {
  return translate(CATALOGS, locale, key, params)
}
