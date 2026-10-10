/**
 * Contrato de internacionalización.
 *
 * Añadir un idioma es añadir su literal a `LOCALES`, su catálogo en
 * `i18n/<locale>.ts` y su entrada en `CATALOGS`. Ningún componente cambia.
 *
 * `translate` recibe los catálogos como parámetro para que el respaldo entre
 * idiomas sea verificable sin depender de que exista un segundo idioma real.
 */

import { messages as es } from './i18n/es'

export type Locale = 'es'

export const LOCALES: readonly Locale[] = ['es']

/** Idioma de respaldo: toda clave ausente se busca aquí. */
export const DEFAULT_LOCALE: Locale = 'es'

export type Messages = Readonly<Record<string, string>>

export type MessageParams = Readonly<Record<string, string | number>>

export const CATALOGS: Readonly<Record<Locale, Messages>> = { es }

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * Normaliza lo que pida el usuario a un idioma soportado.
 *
 * Acepta `es`, `ES`, `es-AR` y `es_MX`. Cualquier cosa que no reconozca cae al
 * idioma por defecto en lugar de fallar: un idioma mal escrito no debe impedir
 * que la aplicación arranque.
 */
export function resolveLocale(requested?: string | undefined): Locale {
  if (requested === undefined) return DEFAULT_LOCALE

  const base = requested.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return LOCALES.find((locale) => locale === base) ?? DEFAULT_LOCALE
}

/**
 * Traduce una clave contra un conjunto de catálogos.
 *
 * Orden de búsqueda: idioma pedido, idioma por defecto, la propia clave. Nunca
 * lanza: una clave ausente se ve en pantalla como su identificador, que es más
 * útil que una cadena vacía.
 */
export function translate(
  catalogs: Readonly<Record<string, Messages>>,
  locale: string,
  key: string,
  params?: MessageParams,
): string {
  const template = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE]?.[key]
  if (template === undefined) return key
  if (params === undefined) return template

  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** Traduce contra los catálogos reales de la aplicación. */
export function t(locale: Locale, key: string, params?: MessageParams): string {
  return translate(CATALOGS, locale, key, params)
}
