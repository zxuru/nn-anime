/**
 * Lo que una tarjeta sabe de la ficha antes de abrirla.
 *
 * Al pulsar una tarjeta de la vitrina, la búsqueda o el perfil, la pantalla de
 * destino ya podría pintar el título y la portada: los tiene delante. Este módulo
 * convierte lo que la tarjeta conoce en el estado de navegación del enrutador, y
 * valida lo que llega de vuelta.
 *
 * **Se valida siempre.** El estado de una entrada del historial es un sitio donde
 * puede haber cualquier cosa —un `pushState` de una extensión, una entrada vieja
 * de otra versión—, y esta pantalla lo pinta en un `<h1>` y en la `src` de una
 * imagen. Nada entra sin comprobar su forma: ni el título, ni la portada, ni los
 * géneros, ni el número de episodios. Lo que no valida se descarta, y la ficha
 * simplemente espera al servidor como cuando se entra por una URL directa.
 */

import { isSafeUrl } from '../../lib/safe-url'

export interface DetailNavState {
  /** El título ya conocido. Sin él no hay adelanto que pintar. */
  readonly title: string
  /** La portada que la tarjeta ya estaba enseñando. */
  readonly poster?: string | undefined
  readonly year?: number | undefined
  readonly genres?: readonly string[] | undefined
  /** Cuántos episodios tiene, cuando la tarjeta lo sabe. */
  readonly episodes?: number | undefined
}

/** Lo que una tarjeta puede aportar: no todo está siempre. */
export interface TarjetaDetalle {
  readonly title: string
  readonly providerId?: string | undefined
  readonly ref?: string | undefined
  /** La portada ya compuesta —la de AniList— si la pieza la tenía. */
  readonly poster?: string | undefined
  readonly year?: number | undefined
  readonly genres?: readonly string[] | undefined
  readonly episodes?: number | undefined
}

/** Una ruta local del proxy. Es la forma que tienen las portadas de las tarjetas. */
const RUTA_LOCAL = /^\/api\/[A-Za-z0-9%._~!$&'()*+,;=:@/-]+$/

const LARGO_MAX_TITULO = 300
const LARGO_MAX_GENERO = 60
const MAX_GENEROS = 20

function tituloValido(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const limpio = value.trim()
  if (limpio === '' || limpio.length > LARGO_MAX_TITULO) return undefined

  // El título se pinta como texto, así que las etiquetas no son un problema; se
  // descartan igual porque un `<` suelto en un `<h1>` no es un título, es basura
  // de otra entrada, y el servidor traerá el de verdad.
  if (limpio.includes('<') || limpio.includes('>')) return undefined

  return limpio
}

/**
 * Una portada admisible: la ruta local que sirve el proxy o una URL http(s).
 *
 * Cualquier otra cosa —`javascript:`, `data:`, una ruta relativa rara— se
 * descarta y la ficha se pinta sin imagen adelantada hasta que llegue la real.
 */
function portadaValida(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined

  return RUTA_LOCAL.test(value) || isSafeUrl(value) ? value : undefined
}

function anioValido(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined

  return value >= 1800 && value <= 2200 ? value : undefined
}

function episodiosValidos(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined

  return value
}

function generosValidos(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const generos = value.filter(
    (genero): genero is string =>
      typeof genero === 'string' && genero !== '' && genero.length <= LARGO_MAX_GENERO,
  )

  return generos.length === 0 ? undefined : generos.slice(0, MAX_GENEROS)
}

/** El estado de navegación de una ficha, o nada si no hay título con el que pintarla. */
export function navStateDeTarjeta(tarjeta: TarjetaDetalle): DetailNavState | undefined {
  const title = tituloValido(tarjeta.title)
  if (title === undefined) return undefined

  const poster =
    portadaValida(tarjeta.poster) ??
    (tarjeta.providerId === undefined || tarjeta.ref === undefined
      ? undefined
      : `/api/cover/${encodeURIComponent(tarjeta.providerId)}/${encodeURIComponent(tarjeta.ref)}`)

  return {
    title,
    ...(poster === undefined ? {} : { poster }),
    ...(anioValido(tarjeta.year) === undefined ? {} : { year: anioValido(tarjeta.year) }),
    ...(generosValidos(tarjeta.genres) === undefined
      ? {}
      : { genres: generosValidos(tarjeta.genres) }),
    ...(episodiosValidos(tarjeta.episodes) === undefined
      ? {}
      : { episodes: episodiosValidos(tarjeta.episodes) }),
  }
}

/**
 * Lo que trae una entrada del historial, ya validado.
 *
 * Acepta cualquier `unknown` porque quien navega pudo dejar cualquier cosa. Una
 * entrada sin título —o con un título que no es un título— no da adelanto: la
 * ficha se comporta como una URL directa.
 */
export function readDetailNavState(raw: unknown): DetailNavState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined

  const title = tituloValido(Reflect.get(raw, 'title'))
  if (title === undefined) return undefined

  const poster = portadaValida(Reflect.get(raw, 'poster'))
  const year = anioValido(Reflect.get(raw, 'year'))
  const episodes = episodiosValidos(Reflect.get(raw, 'episodes'))
  const genres = generosValidos(Reflect.get(raw, 'genres'))

  return {
    title,
    ...(poster === undefined ? {} : { poster }),
    ...(year === undefined ? {} : { year }),
    ...(episodes === undefined ? {} : { episodes }),
    ...(genres === undefined ? {} : { genres }),
  }
}
