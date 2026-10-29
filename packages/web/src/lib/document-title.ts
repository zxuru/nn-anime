/**
 * El título de la pestaña, en un solo sitio.
 *
 * Cuatro fichas abiertas a la vez eran cuatro pestañas que decían «nn-anime»: no
 * había forma de saber cuál era cuál sin abrirlas una a una, y menos de saber por
 * qué episodio iba la que estaba reproduciendo. El título de la pestaña es la
 * única etiqueta que ve quien tiene varias abiertas, así que se compone aquí y
 * no a mano en cada pantalla.
 *
 * La composición es una función pura y una prueba la mide; el efecto que la
 * escribe son dos líneas. El nombre de la aplicación lo añade el gancho, siempre
 * al final: repetirlo en cada pantalla es la forma de que un día una lo olvide.
 *
 * En el renderizado de servidor no hay `document` y no se escribe nada: las
 * pruebas de marcado siguen funcionando sin un DOM.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeDetail } from '@nn-anime/core/models'
import { useEffect } from 'react'
import { t } from '../i18n'
import type { RouteName } from '../router'

/** Lo que separa las partes. Un punto medio, como el resto de la interfaz. */
const SEPARATOR = ' · '

/** Compone el título. Las partes vacías o ausentes no dejan separador suelto. */
export function composeTitle(parts: readonly (string | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(SEPARATOR)
}

/** Escribe el título de la pestaña. Sin `document` —servidor— no hace nada. */
export function setDocumentTitle(title: string): void {
  if (title === '' || typeof document === 'undefined') return

  document.title = title
}

/**
 * El título de una pantalla con el nombre de la aplicación al final.
 *
 * El nombre de la aplicación lo añade esta función y no cada pantalla: repetirlo
 * en cada sitio es la forma de que un día una lo olvide y su pestaña deje de
 * parecerse a las demás.
 */
export function pageTitle(parts: readonly (string | undefined)[]): string {
  return composeTitle([...parts, t(DEFAULT_LOCALE, 'app.name')])
}

/**
 * Fija el título de la pestaña con estas partes, más el nombre de la aplicación.
 *
 * Un título vacío no se escribe: entre dos pantallas, la que se desmonta no debe
 * borrar el de la que entra.
 */
export function useDocumentTitle(parts: readonly (string | undefined)[]): void {
  const title = pageTitle(parts)

  useEffect(() => {
    setDocumentTitle(title)
  }, [title])
}

/**
 * El título de las pantallas sin datos propios.
 *
 * El detalle y el reproductor no están aquí: su título lleva el nombre del
 * título, que sólo ellos conocen. Si esta función devolviera algo para ellos,
 * el efecto de la pantalla padre escribiría **después** del de la hija —los
 * efectos corren de dentro hacia fuera— y borraría el nombre del título.
 */
export function routeTitleParts(name: RouteName, path: string): readonly string[] {
  switch (name) {
    case 'home':
      return [t(DEFAULT_LOCALE, 'home.title')]
    case 'search': {
      // La consulta va delante de todo: es lo que distingue una búsqueda de otra.
      const consulta = new URLSearchParams(path.split('?')[1] ?? '').get('q')?.trim() ?? ''

      return consulta === ''
        ? [t(DEFAULT_LOCALE, 'search.title')]
        : [`«${consulta}»`, t(DEFAULT_LOCALE, 'search.title')]
    }
    case 'settings':
      return [t(DEFAULT_LOCALE, 'settings.title')]
    case 'profile':
      return [t(DEFAULT_LOCALE, 'profile.title')]
    case 'history':
      return [t(DEFAULT_LOCALE, 'history.title')]
    case 'library':
    case 'downloads':
      return [t(DEFAULT_LOCALE, 'library.title')]
    // El reproductor de una descarga conoce el título en un efecto, como la
    // pantalla de reproducción; aquí queda el nombre de la pantalla y el suyo no
    // se pisa desde la aplicación.
    case 'library-player':
      return [t(DEFAULT_LOCALE, 'library.playerTitle')]
    case 'not-found':
      return [t(DEFAULT_LOCALE, 'notFound.title')]
    default:
      return []
  }
}

/** El título de la ficha: el del anime en cuanto se sabe, y qué pasa mientras no. */
export function detailTitleParts(
  state: 'loading' | 'ready' | 'error',
  detail: AnimeDetail | undefined,
): readonly string[] {
  if (state === 'loading') return [t(DEFAULT_LOCALE, 'title.loading')]
  if (state === 'error') return [t(DEFAULT_LOCALE, 'title.error')]
  if (detail === undefined) return [t(DEFAULT_LOCALE, 'detail.notFound')]

  return [detail.title]
}

/**
 * El título de la reproducción: el del anime y por qué episodio va.
 *
 * El nombre del título es lo que distingue dos pestañas del mismo proveedor, y el
 * episodio lo que distingue dos pestañas del mismo título. Ninguno de los dos
 * está garantizado al montar la pantalla, así que lo que falte simplemente no se
 * pone: un hueco se lee, un «undefined» no.
 */
export function watchTitleParts(
  animeTitle: string | undefined,
  episodeLabel: string | undefined,
): readonly string[] {
  const partes = [animeTitle?.trim(), episodeLabel?.trim()].filter(
    (part): part is string => part !== undefined && part !== '',
  )

  return partes.length === 0 ? [t(DEFAULT_LOCALE, 'title.loading')] : partes
}

/**
 * Cómo se llama el episodio que se está viendo.
 *
 * El número y el nombre del episodio, y ninguno de los dos está garantizado: hay
 * proveedores que no numeran y cuyo nombre de episodio es el número otra vez
 * —«Episodio 3»—, así que repetirlo daría un «Episodio 3 · Episodio 3». Cuando
 * el nombre ya dice lo mismo, se queda el nombre.
 *
 * Devuelve nada cuando no hay ni número ni nombre: quien lo pinte decide qué
 * poner en su lugar, y aquí inventarse un texto sería mentir sobre el episodio.
 */
export function episodeLabel(
  number: number | undefined,
  title: string | undefined,
): string | undefined {
  const nombre = title?.trim() ?? ''

  if (number === undefined) return nombre === '' ? undefined : nombre

  const base = t(DEFAULT_LOCALE, 'player.episode', { number })

  if (nombre === '' || nombre === base) return nombre === '' ? base : nombre

  return t(DEFAULT_LOCALE, 'player.episodeNamed', { number, title: nombre })
}
