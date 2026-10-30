/**
 * El selector de episodios.
 *
 * Tres piezas y cada una con su dueño: `EpisodePager` son los mandos —página
 * anterior y siguiente, salto por número, último episodio—, `EpisodeRows` es lo
 * que se dibuja y `EpisodeList` es quien pide las páginas.
 *
 * **La lista se pide por páginas al servidor.** Antes la ficha pedía la lista
 * entera y el navegador recortaba cien filas: con mil ciento ochenta episodios eso
 * es un cuerpo que crece con la serie y una búsqueda por número que sólo
 * encontraba lo que ya estaba descargado. El servidor trocea —con la página que el
 * plugin declare o en trozos de cien— y aquí sólo se guarda la que se está
 * mirando.
 *
 * **El salto por número pregunta al servidor**, no a la lista cargada: si el
 * episodio 743 existe, se abre; y si el proveedor contesta que no está, se dice
 * con un texto, sin dejar la pantalla en blanco. Un número que no se encuentra no
 * es un fallo de la aplicación: es que ese episodio no está.
 *
 * Las filas siguen siendo enlaces —el episodio es la acción de la pantalla— y el
 * número viaja en la dirección (`?n=`) porque quien lo conoce es esta lista: el
 * reproductor lo lee para pedir los vecinos sin descargar el título entero.
 *
 * **Una película no tiene capítulos.** La misma lectura de una parte suelta se
 * pinta de dos formas según lo que el título sea: una serie numera sus episodios
 * y una película ofrece verla. Numerar «Episodio 1 de 1» es inventar una lista
 * donde no hay nada que elegir.
 *
 * **Un título con temporadas se lee por temporadas.** Hay fuentes que juntan las
 * nueve temporadas de una serie en un solo título de noventa y un episodios, y
 * una lista así no se recorre: el índice de temporadas lo calcula el servidor
 * —sale de la lista entera, que es la única que las conoce— y aquí se pinta una
 * banda con la temporada de cada uno. Elegir una temporada la pide al servidor,
 * que devuelve sus episodios numerados contra el título: la fila sigue diciendo
 * «Episodio 12 de 91», que es la etiqueta de la fuente y lo que enseña el
 * reproductor. Sin índice —una fuente que no marca la temporada, o una sola
 * temporada— la lista se lee entera, como siempre.
 */

import type { EpisodeSeason, EpisodesResponse, WatchedEpisodePayload } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import { Play } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { IconLabel } from '../../components/IconLabel'
import { t } from '../../i18n'
import { Link, useNavigate } from '../../router'
import { type PlayMode, watchPath } from '../player/watch-route'
import { EPISODE_WINDOW, watchedInWindow, windowAt } from './episode-window'
import {
  formatDuration,
  loadEpisodeByNumber,
  loadEpisodesPage,
  loadLatestEpisode,
  parseJump,
  watchedPercent,
} from './useDetail'

/**
 * Las claves del catálogo, escritas una a una.
 *
 * Una clave compuesta con el modo —`detail.mode.${modo}`— funcionaría igual en
 * tiempo de ejecución y escondería las claves al buscador de textos sin usar:
 * acabarían borradas del catálogo por parecer huérfanas.
 */
const MODE_KEYS = {
  sub: 'detail.mode.sub',
  dub: 'detail.mode.dub',
  raw: 'detail.mode.raw',
} as const

/**
 * Los textos del estado, escritos uno a uno y por forma del título.
 *
 * Una película no tiene episodios, así que el «cargando los episodios» de la
 * lista tampoco vale para ella: son dos pantallas distintas y cada una dice lo
 * suyo. Van literales y no compuestos con el tipo —`detail.movie.${estado}`—
 * porque una clave compuesta se esconde del buscador de textos sin usar y acaba
 * borrada del catálogo por parecer huérfana.
 */
const ESTADO_KEYS = {
  serie: { loading: 'detail.episodes.loading', error: 'detail.episodes.error' },
  pelicula: { loading: 'detail.movie.loading', error: 'detail.movie.error' },
} as const

/**
 * La ruta del reproductor para un episodio.
 *
 * La escriben tres sitios —la fila, el salto por número y la acción de una
 * película— y con tres copias la primera que cambie deja a las otras dos
 * pidiendo otra cosa.
 */
function rutaDe(episode: Episode, mode: PlayMode | undefined): string {
  return watchPath(episode.ref.providerId, episode.ref.value, {
    ...(mode === undefined ? {} : { mode }),
    // El título viaja con el enlace: la lista lo trae en cada episodio, y sin él
    // el reproductor tenía que adivinarlo de la referencia y con jkanime
    // adivinaba mal.
    anime: episode.animeRef.value,
    // El número va escrito porque quien lo conoce es esta lista: el reproductor
    // lo lee para pedir los vecinos sin la lista entera.
    n: episode.number,
    // Y la temporada, si el episodio la declara: sin ella el número no identifica
    // nada en una serie que numera por temporada.
    ...(episode.season === undefined ? {} : { s: episode.season }),
  })
}

/**
 * La página a la que lleva cada botón.
 *
 * La anterior no baja de la primera: una página cero es un 400 del servidor, y
 * una pantalla que manda una petición que ya sabe que va a fallar es una pantalla
 * que no comprobó sus propios límites.
 */
export function pageAfter(page: number, direction: -1 | 1): number {
  return Math.max(1, page + direction)
}

/** Lo que se pinta en la fila por haberlo visto: terminado, a medias o nada. */
type Marca = { readonly tipo: 'visto' } | { readonly tipo: 'progreso'; readonly percent: number }

/**
 * La marca de una fila.
 *
 * Sin duración no hay proporción, y sin proporción no se marca nada: un episodio
 * abierto y cerrado en el segundo uno no está «a medias» de nada.
 */
function marcaDe(visto: WatchedEpisodePayload | undefined): Marca | undefined {
  if (visto === undefined) return undefined
  if (visto.finished) return { tipo: 'visto' }
  if (visto.durationS <= 0) return undefined

  return { tipo: 'progreso', percent: watchedPercent(visto.ratio) }
}

export interface EpisodeRowsProps {
  readonly episodes: readonly Episode[]
  readonly mode?: PlayMode
  /** Lo que ya se vio de este título, por número de episodio. */
  readonly watched?: readonly WatchedEpisodePayload[]
  /** Cuántos episodios tiene el título, cuando el proveedor lo dice. */
  readonly total?: number
}

/**
 * Las filas de una página.
 *
 * Es una lista ordenada y no una rejilla: el número importa y el orden importa, y
 * `<ol>` dice las dos cosas sin ayuda. Cada episodio muestra su modo, porque un
 * título puede tener el 3 en subtitulado y el 4 doblado, y elegir sin saberlo es
 * la forma más rápida de que la reproducción falle.
 *
 * **Cada fila es un enlace al reproductor**, no una fila que parece pulsable: un
 * `<li>` con `onClick` no se puede abrir en otra pestaña, ni copiar, ni recorrer
 * con el teclado sin inventar nada.
 *
 * **La ventana de cien sigue recortando lo que se dibuja**, por si una página del
 * plugin trae más de cien episodios: el tope es de pintado, no de datos.
 */
export function EpisodeRows(props: EpisodeRowsProps): ReactNode {
  const [ventana, setVentana] = useState(0)

  if (props.episodes.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.noEpisodes')}</p>
  }

  const cuantos = props.episodes.length
  const numeros = props.episodes.map((episode) => episode.number)
  const conVentanas = cuantos > EPISODE_WINDOW
  const rango = conVentanas ? windowAt(ventana, cuantos) : { start: 0, end: cuantos }
  const visibles = conVentanas ? props.episodes.slice(rango.start, rango.end) : props.episodes
  const vistos = new Map((props.watched ?? []).map((fila) => [fila.number, fila]))

  return (
    <>
      {conVentanas ? (
        <div className="episodes__windows">
          <button
            type="button"
            className="button"
            disabled={rango.start === 0}
            onClick={() => setVentana(ventana - 1)}
          >
            {t(DEFAULT_LOCALE, 'detail.window.previous')}
          </button>

          <span className="episodes__range">
            {t(DEFAULT_LOCALE, 'detail.window.range', {
              from: visibles[0]?.number ?? 1,
              to: visibles[visibles.length - 1]?.number ?? cuantos,
            })}
          </span>

          <button
            type="button"
            className="button"
            disabled={rango.end >= cuantos}
            onClick={() => setVentana(ventana + 1)}
          >
            {t(DEFAULT_LOCALE, 'detail.window.next')}
          </button>

          <p className="episodes__watched">
            {t(DEFAULT_LOCALE, 'detail.window.watched', {
              seen: watchedInWindow(rango, numeros, props.watched ?? []),
              total: rango.end - rango.start,
            })}
          </p>
        </div>
      ) : null}

      <ol className="episodes" start={rango.start + 1}>
        {visibles.map((episode) => {
          const duracion = formatDuration(episode.durationS)
          const marca = marcaDe(vistos.get(episode.number))

          return (
            <li
              key={`${episode.ref.providerId}:${episode.ref.value}`}
              id={`episodio-${episode.season ?? ''}-${episode.number}`}
            >
              <Link
                className={marca?.tipo === 'visto' ? 'episode episode--visto' : 'episode'}
                to={rutaDe(episode, props.mode)}
              >
                <span className="episode__number">
                  {/* El total sólo se dice cuando el proveedor lo da: un «de 26»
                      inventado es peor que no decir de cuántos. */}
                  {props.total === undefined
                    ? t(DEFAULT_LOCALE, 'detail.episode', { number: episode.number })
                    : t(DEFAULT_LOCALE, 'detail.episodeOf', {
                        number: episode.number,
                        total: props.total,
                      })}
                </span>
                {episode.title === undefined ? null : (
                  <span className="episode__title">{episode.title}</span>
                )}
                {/* Las marcas van juntas al borde derecho de la fila: la duración,
                    el progreso, el «visto» y el modo son lo que se compara al
                    bajar por la lista, y sin título delante quedaban a media
                    anchura con la fila vacía al lado. */}
                <span className="episode__marcas">
                  {marca?.tipo === 'progreso' ? (
                    <progress
                      className="episode__progress"
                      value={marca.percent}
                      max={100}
                      aria-label={t(DEFAULT_LOCALE, 'detail.episode.progress', {
                        percent: marca.percent,
                      })}
                    />
                  ) : null}
                  {duracion === undefined ? null : (
                    <span className="episode__time">{duracion}</span>
                  )}
                  {marca?.tipo === 'visto' ? (
                    // La palabra, no sólo el color: el estado tiene que leerse también
                    // sin distinguir colores.
                    <span className="badge badge--visto">
                      {t(DEFAULT_LOCALE, 'detail.episode.watched')}
                    </span>
                  ) : null}
                  <span className="badge">{t(DEFAULT_LOCALE, MODE_KEYS[episode.mode])}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </>
  )
}

/**
 * La banda de temporadas.
 *
 * Una temporada por botón, con `aria-pressed` para decir cuál se está mirando
 * —lo que ya lee el resto de la interfaz, y sin depender del color—, y su número
 * de episodios al lado: sin él, saber si una temporada son doce capítulos o
 * cuarenta cuesta entrar en cada una.
 *
 * El nombre de cada temporada lo escribe la fuente, y aquí se enseña tal cual:
 * `Temporada 0` es como TMDB numera los especiales, y renumerarlos sería
 * inventar una temporada que nadie declaró.
 */
export function SeasonPicker(props: {
  readonly seasons: readonly EpisodeSeason[]
  readonly active: number
  readonly onPick: (season: number) => void
}): ReactNode {
  return (
    <ul className="episodes__seasons" aria-label={t(DEFAULT_LOCALE, 'detail.seasons')}>
      {props.seasons.map((season) => (
        <li key={season.season}>
          <button
            type="button"
            className="button"
            aria-pressed={season.season === props.active}
            onClick={() => props.onPick(season.season)}
          >
            {t(DEFAULT_LOCALE, 'detail.season', { number: season.season })}
            <span className="badge">
              {t(DEFAULT_LOCALE, 'detail.season.count', { count: season.count })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export interface EpisodePagerProps {
  readonly page: number
  readonly hasMore: boolean
  /** El número que se pidió y el proveedor no tiene, si pasó. */
  readonly notFound?: number | undefined
  /**
   * El motivo que dio el servidor cuando el salto falló.
   *
   * No es un «error de red» genérico: el plugin real contesta 502 con lo que pasó
   * —«no tiene el episodio 999: la ficha dice 26»— y ese texto es lo único que
   * explica el fallo. Se enseña tal cual.
   */
  readonly jumpMessage?: string | undefined
  /** El último episodio no se pudo averiguar, sin motivo que enseñar. */
  readonly latestMissing?: boolean
  /** El motivo que dio el servidor cuando el último episodio falló. */
  readonly latestMessage?: string | undefined
  readonly onPage: (direction: -1 | 1) => void
  readonly onJump: (number: number) => void
  readonly onLatest: () => void
}

/**
 * Los mandos del selector.
 *
 * Las flechas se apagan en los extremos —la primera página no tiene anterior y
 * `hasMore` falso no tiene siguiente— porque un botón que existe y no hace nada se
 * lee como una aplicación rota. El número de página se ve: sin él, «siguiente» no
 * dice a dónde va.
 *
 * La barra va en **un renglón**: el grupo de páginas a la izquierda, el salto a la
 * derecha y el último episodio al final. Los botones son un escalón más bajos que
 * el de la ficha y las flechas enseñan la palabra corta —«Anterior», «Siguiente»—
 * mientras el nombre accesible sigue diciendo «Página anterior»: con los rótulos
 * largos y el alto completo, siete mandos no cabían y la barra ocupaba dos filas.
 *
 * El salto es un formulario para que la tecla Intro funcione sin JavaScript de
 * más, y admite decimales porque hay fuentes que numeran `7.5`.
 */
export function EpisodePager(props: EpisodePagerProps): ReactNode {
  const [salto, setSalto] = useState('')

  return (
    <div className="episodes__windows">
      <div className="episodes__pager">
        <button
          type="button"
          className="button"
          aria-label={t(DEFAULT_LOCALE, 'detail.page.previous')}
          disabled={props.page === 1}
          onClick={() => props.onPage(-1)}
        >
          {t(DEFAULT_LOCALE, 'detail.page.previousShort')}
        </button>

        <span className="episodes__range">
          {t(DEFAULT_LOCALE, 'detail.page.label', { page: props.page })}
        </span>

        <button
          type="button"
          className="button"
          aria-label={t(DEFAULT_LOCALE, 'detail.page.next')}
          disabled={!props.hasMore}
          onClick={() => props.onPage(1)}
        >
          {t(DEFAULT_LOCALE, 'detail.page.nextShort')}
        </button>
      </div>

      <form
        className="episodes__jump"
        onSubmit={(event) => {
          event.preventDefault()
          const numero = parseJump(salto)
          if (numero !== undefined) props.onJump(numero)
        }}
      >
        <label className="field__label" htmlFor="salto-episodio">
          {t(DEFAULT_LOCALE, 'detail.window.jump')}
        </label>
        <input
          id="salto-episodio"
          className="field__input episodes__input"
          type="number"
          min={1}
          // `step="any"` y no el paso entero por defecto: una fuente que numera
          // 7.5 se busca escribiéndolo, y el navegador lo rechazaría antes de
          // que el número llegara al formulario.
          step="any"
          value={salto}
          onChange={(event) => setSalto(event.target.value)}
        />
        <button type="submit" className="button">
          {t(DEFAULT_LOCALE, 'detail.window.go')}
        </button>
      </form>

      <button type="button" className="button" onClick={props.onLatest}>
        {t(DEFAULT_LOCALE, 'detail.latest')}
      </button>

      {props.notFound === undefined ? null : (
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'detail.jump.notFound', { number: props.notFound })}
        </p>
      )}

      {props.jumpMessage === undefined ? null : (
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'detail.jump.failed', { message: props.jumpMessage })}
        </p>
      )}

      {props.latestMissing === true ? (
        <p className="search__error">{t(DEFAULT_LOCALE, 'detail.latest.error')}</p>
      ) : null}

      {props.latestMessage === undefined ? null : (
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'detail.latest.failed', { message: props.latestMessage })}
        </p>
      )}
    </div>
  )
}

export interface EpisodeListProps {
  readonly providerId: string
  /** La referencia del **título**, que es con la que se piden sus episodios. */
  readonly ref: string
  /** El modo con el que se abre el reproductor. Sin él, el que elija el reproductor. */
  readonly mode?: PlayMode
  readonly watched?: readonly WatchedEpisodePayload[]
  /**
   * El título es una película.
   *
   * Una película no tiene capítulos, así que con la marca puesta y **una sola
   * parte** —sin nada detrás— la pantalla ofrece verla en vez de numerar un
   * «Episodio 1 de 1» que nadie puede elegir. Si el proveedor la parte en varias
   * o publica más páginas, la lista vuelve: esconder partes detrás de un botón
   * dejaría contenido sin puerta.
   *
   * La marca la pone la ficha con el `kind` que declara el proveedor. Un título
   * de un solo episodio sin tipo declarado sigue siendo una lista: llamar película
   * a un OVA de uno es peor que numerarlo.
   */
  readonly movie?: boolean
}

/**
 * La parte que se ofrece como acción suelta, o nada.
 *
 * Una parte con más páginas detrás no es única aunque venga sola en la página: lo
 * que se mira es el título, y el título no se termina de leer hasta que el
 * servidor dice que no queda nada.
 */
export function parteUnicaDe(pagina: EpisodesResponse): Episode | undefined {
  return pagina.episodes.length === 1 && !pagina.hasMore ? pagina.episodes[0] : undefined
}

/**
 * La acción de una película: un enlace que abre su única parte.
 *
 * Es un enlace y no un botón con `onClick` —igual que las filas de la lista— para
 * que se pueda abrir en otra pestaña, copiar y seguir con el teclado.
 */
export function MovieAction(props: {
  readonly episode: Episode
  readonly mode?: PlayMode
}): ReactNode {
  return (
    <Link className="button button--primary" to={rutaDe(props.episode, props.mode)}>
      <IconLabel icon={Play} label={t(DEFAULT_LOCALE, 'detail.movie.watch')} />
    </Link>
  )
}

/**
 * Lo que el selector está pidiendo.
 *
 * Es una petición y no una página porque el salto por número y el último episodio
 * también se piden aquí: los tres estados tienen que convivir —el aviso de un
 * salto que no encontró nada se pinta **encima** de la página que ya estaba, no en
 * su lugar—, y con tres banderas sueltas el componente tendría tres caminos que se
 * pisan entre sí.
 *
 * `season` va en la página y no aparte porque la temporada **cambia la página**:
 * la lista entera y una temporada suya tienen cada una su primera página, y son
 * dos peticiones distintas.
 */
type Solicitud =
  | { readonly tipo: 'pagina'; readonly page: number; readonly season?: number }
  | { readonly tipo: 'numero'; readonly number: number; readonly season?: number }
  | { readonly tipo: 'ultimo'; readonly season?: number }

/**
 * Los mandos sólo cuando sirven de algo.
 *
 * Con una sola página y sin más detrás, una barra de paginación para doce filas es
 * un mueble; pero en cuanto hay una página 2, el proveedor dice que queda algo o
 * la página trae más de cien episodios, los mandos son la única forma de llegar al
 * resto.
 */
export function conMandos(pagina: EpisodesResponse): boolean {
  return pagina.page > 1 || pagina.hasMore || (pagina.total ?? 0) > EPISODE_WINDOW
}

export function EpisodeList(props: EpisodeListProps): ReactNode {
  const navegar = useNavigate()
  const [solicitud, setSolicitud] = useState<Solicitud>({ tipo: 'pagina', page: 1 })
  const [pagina, setPagina] = useState<EpisodesResponse | undefined>(undefined)
  /**
   * La temporada de la página que se está mirando.
   *
   * Va aparte de la petición porque no es lo mismo: un salto o el último episodio
   * no cambian la lista que hay debajo, así que la temporada que manda en la banda
   * es la de la última página que se pintó, no la de la última petición.
   */
  const [temporada, setTemporada] = useState<number | undefined>(undefined)
  /**
   * El estado de la página que se está mirando.
   *
   * Un salto que falla **no** lo cambia: el aviso se pinta junto a la página que ya
   * estaba, porque vaciar la lista por no encontrar un episodio deja sin nada a
   * quien se equivocó al escribir un número.
   */
  const [estado, setEstado] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notFound, setNotFound] = useState<number | undefined>(undefined)
  const [jumpMessage, setJumpMessage] = useState<string | undefined>(undefined)
  const [latestMissing, setLatestMissing] = useState(false)
  const [latestMessage, setLatestMessage] = useState<string | undefined>(undefined)

  const { providerId, ref } = props

  /**
   * El modo, en una referencia.
   *
   * Va aquí y no en las dependencias del efecto porque el modo se puede cambiar en
   * la ficha con la lista ya cargada: como dependencia, cambiar de subtitulado a
   * doblado volvería a pedir la página y la lista parpadearía para nada.
   */
  const modoRef = useRef(props.mode)
  modoRef.current = props.mode

  useEffect(() => {
    let vivo = true

    setNotFound(undefined)
    setJumpMessage(undefined)
    setLatestMissing(false)
    setLatestMessage(undefined)

    /**
     * Abrir un episodio suelto.
     *
     * Se navega en vez de pintarlo dentro de la página porque el episodio tiene su
     * propia pantalla: es lo que hace el enlace de cada fila, y hacerlo de dos
     * formas distintas según cómo se llegó serían dos comportamientos para el
     * mismo gesto.
     */
    const abrir = (episode: Episode): void => {
      navegar.push(rutaDe(episode, modoRef.current))
    }

    if (solicitud.tipo === 'pagina') {
      setEstado('loading')
      void loadEpisodesPage(providerId, ref, {
        page: solicitud.page,
        ...(solicitud.season === undefined ? {} : { season: solicitud.season }),
      }).then(
        (respuesta) => {
          if (!vivo) return

          /**
           * El título tiene temporadas y esta lectura no pedía ninguna.
           *
           * Es la primera lectura de la ficha, que no puede saber que el título
           * las tiene: se pide la primera temporada y no se pinta la lista entera,
           * porque pintarla y cambiarla dos milisegundos después es justo el
           * parpadeo que la banda existe para evitar.
           */
          const primera = respuesta.seasons?.[0]
          if (
            solicitud.tipo === 'pagina' &&
            solicitud.season === undefined &&
            primera !== undefined
          ) {
            setSolicitud({ tipo: 'pagina', page: respuesta.page, season: primera.season })
            return
          }

          setPagina(respuesta)
          setTemporada(solicitud.tipo === 'pagina' ? solicitud.season : undefined)
          setEstado('ready')
        },
        () => {
          if (!vivo) return

          setEstado('error')
        },
      )
    }

    if (solicitud.tipo === 'numero') {
      const { number } = solicitud
      // El lector no rechaza: distingue «no está» de «falló con este motivo». El
      // plugin real contesta 502 con el motivo cuando el episodio no existe —no
      // puede construir un 404—, así que ese texto se enseña tal cual en vez de
      // contarlo como un proveedor caído.
      void loadEpisodeByNumber(providerId, ref, number, {}, solicitud.season).then((salida) => {
        if (!vivo) return

        if (salida.kind === 'found') abrir(salida.episode)
        else if (salida.kind === 'missing') setNotFound(number)
        else setJumpMessage(salida.message)
      })
    }

    if (solicitud.tipo === 'ultimo') {
      void loadLatestEpisode(providerId, ref, {}, solicitud.season).then((salida) => {
        if (!vivo) return

        if (salida.kind === 'found') abrir(salida.episode)
        else if (salida.kind === 'missing') setLatestMissing(true)
        else setLatestMessage(salida.message)
      })
    }

    return () => {
      vivo = false
    }
  }, [providerId, ref, solicitud, navegar])

  if (pagina === undefined) {
    const claves = props.movie === true ? ESTADO_KEYS.pelicula : ESTADO_KEYS.serie

    return (
      <p className={estado === 'error' ? 'search__error' : 'empty'}>
        {t(DEFAULT_LOCALE, estado === 'error' ? claves.error : claves.loading)}
      </p>
    )
  }

  // Una película de la que el proveedor no sirve ninguna parte no se queda con el
  // «no tiene episodios»: tampoco tiene episodios de los que hablar.
  if (props.movie === true && pagina.episodes.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.movie.missing')}</p>
  }

  const unica = props.movie === true ? parteUnicaDe(pagina) : undefined

  if (unica !== undefined) return <MovieAction episode={unica} mode={props.mode} />

  // La temporada que manda en la banda: la de la página que se está mirando. El
  // respaldo es por el orden de los fotogramas —siempre hay una elegida cuando hay
  // índice—, no por si acaso.
  const activa = pagina.seasons === undefined ? undefined : (temporada ?? pagina.seasons[0]?.season)

  return (
    <>
      {pagina.seasons === undefined || activa === undefined ? null : (
        <SeasonPicker
          seasons={pagina.seasons}
          active={activa}
          onPick={(season) => setSolicitud({ tipo: 'pagina', page: 1, season })}
        />
      )}

      {conMandos(pagina) ? (
        <EpisodePager
          page={pagina.page}
          hasMore={pagina.hasMore}
          notFound={notFound}
          jumpMessage={jumpMessage}
          latestMissing={latestMissing}
          latestMessage={latestMessage}
          onPage={(direction) =>
            setSolicitud({
              tipo: 'pagina',
              page: pageAfter(pagina.page, direction),
              ...(activa === undefined ? {} : { season: activa }),
            })
          }
          onJump={(number) =>
            setSolicitud({
              tipo: 'numero',
              number,
              ...(activa === undefined ? {} : { season: activa }),
            })
          }
          onLatest={() =>
            setSolicitud({
              tipo: 'ultimo',
              ...(activa === undefined ? {} : { season: activa }),
            })
          }
        />
      ) : null}

      {/* La clave remonta las filas al cambiar de página o de temporada: la ventana
          de cien es de la página que se está mirando, no del componente. */}
      <EpisodeRows
        key={`${providerId}:${ref}:${pagina.page}:${activa ?? ''}`}
        episodes={pagina.episodes}
        mode={props.mode}
        watched={props.watched}
        total={pagina.total}
      />
    </>
  )
}
