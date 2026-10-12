/**
 * La lista de episodios de la pantalla de reproducción.
 *
 * Es la columna de al lado: mientras se ve un episodio, tener a mano el resto es
 * lo que hace que cambiar de episodio no sea volver a la ficha. La fila del que se
 * está viendo va marcada con `aria-current="page"` y la lista se desplaza sola
 * hasta dejarla a la vista.
 *
 * **La lista se pide por páginas**, de cien en cien, y no entera: un título de mil
 * ciento ochenta episodios no se descarga para pintar una columna, que es
 * justamente lo que la pantalla dejó de hacer. La primera página es la misma que
 * la pantalla pide para saber los vecinos —el servidor la cachea cinco minutos— y
 * el resto se piden cuando alguien pulsa «ver más».
 *
 * Cuando el episodio que se está viendo **no está** en lo que se ha cargado —el
 * 700 de una serie, con la primera página delante— se añade su fila arriba y
 * marcada: sin ella, la columna diría que se está viendo cualquier cosa menos lo
 * que suena.
 *
 * El modo con el que se está viendo viaja en cada enlace, igual que en las
 * flechas, y el número también: cambiar a doblado y saltar al 5 tiene que abrir el
 * 5 en doblado y sin que la pantalla que se abra tenga que adivinar su número.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { episodeLabel } from '../../lib/document-title'
import { Link } from '../../router'
import { loadEpisodesPage } from '../detail/useDetail'
import { type PlayMode, watchPath } from './watch-route'

/** Lo que la pantalla sabe del episodio que se está viendo. */
export interface EpisodioActual {
  readonly number: number
  readonly title?: string | undefined
}

export interface WatchEpisodesProps {
  readonly providerId: string
  /** La referencia del título, que es con la que se piden sus episodios. */
  readonly titleRef: string
  readonly currentRef: string
  readonly mode: PlayMode
  readonly actual?: EpisodioActual | undefined
}

/** Sólo los episodios de este proveedor: la página puede traer los de otro. */
function delProveedor(episodes: readonly Episode[], providerId: string): readonly Episode[] {
  return episodes.filter((episodio) => episodio.ref.providerId === providerId)
}

export function WatchEpisodes(props: WatchEpisodesProps): ReactNode {
  const lista = useRef<HTMLOListElement | null>(null)
  const [episodios, setEpisodios] = useState<readonly Episode[]>([])
  const [pagina, setPagina] = useState(1)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)
  const cuantos = episodios.length

  useEffect(() => {
    let vivo = true

    setCargando(true)
    setFallo(false)

    void loadEpisodesPage(props.providerId, props.titleRef, pagina).then(
      (salida) => {
        if (!vivo) return

        const propios = delProveedor(salida.episodes, props.providerId)
        setEpisodios((previos) => (pagina === 1 ? propios : [...previos, ...propios]))
        setHayMas(salida.hasMore)
        setCargando(false)
      },
      () => {
        if (!vivo) return

        setCargando(false)
        setFallo(true)
      },
    )

    return () => {
      vivo = false
    }
  }, [props.providerId, props.titleRef, pagina])

  /**
   * La fila del episodio que se está viendo, a la vista.
   *
   * Se lleva el desplazamiento a mano —al centro de la lista— y no con
   * `scrollIntoView`: aquello desplaza **también** la página cuando el contenedor
   * no da de sí, así que al abrir el episodio 40 la pantalla aparecía con el video
   * a medio camino. Sin `behavior: smooth` a propósito: es una colocación, no una
   * animación, y el spec pide respetar el movimiento reducido.
   *
   * `cuantos` en las dependencias: la lista llega **después** del primer render
   * —la pide una petición— y sin él el efecto se quedaría con la lista vacía y no
   * llevaría la vista a ninguna parte.
   */
  useEffect(() => {
    if (cuantos === 0) return

    const contenedor = lista.current
    const actual = contenedor?.querySelector('[aria-current="page"]')

    if (!(contenedor instanceof HTMLElement) || !(actual instanceof HTMLElement)) return

    contenedor.scrollTop = Math.max(actual.offsetTop - contenedor.clientHeight / 2, 0)
  }, [cuantos])

  const mas = useCallback(() => setPagina((valor) => valor + 1), [])

  /** Una fila de la lista: el número, el título y si es la que se está viendo. */
  const fila = (episodio: {
    readonly value: string
    readonly number: number
    readonly title: string | undefined
  }): ReactNode => {
    const etiqueta =
      episodeLabel(episodio.number, episodio.title) ??
      t(DEFAULT_LOCALE, 'player.episode', { number: episodio.number })
    const actual = episodio.value === props.currentRef
    const contenido = (
      <>
        <span className="watch__list-number">{episodio.number}</span>
        {episodio.title === undefined ? null : (
          <span className="watch__list-title">{episodio.title}</span>
        )}
      </>
    )

    return actual ? (
      <Link
        className="watch__list-item"
        ariaLabel={etiqueta}
        ariaCurrent="page"
        to={rutaDe(episodio)}
      >
        {contenido}
      </Link>
    ) : (
      <Link className="watch__list-item" ariaLabel={etiqueta} to={rutaDe(episodio)}>
        {contenido}
      </Link>
    )
  }

  const rutaDe = (episodio: { readonly value: string; readonly number: number }): string =>
    watchPath(props.providerId, episodio.value, {
      mode: props.mode,
      anime: props.titleRef,
      n: episodio.number,
    })

  // El que se está viendo, si no está entre los cargados: va arriba y marcado.
  const conocido = episodios.some((episodio) => episodio.ref.value === props.currentRef)
  const suelto =
    props.actual === undefined || conocido
      ? undefined
      : {
          value: props.currentRef,
          number: props.actual.number,
          title: props.actual.title,
        }

  if (episodios.length === 0 && suelto === undefined && !cargando && !fallo) return null

  return (
    <>
      <h2 className="watch__aside-title">{t(DEFAULT_LOCALE, 'player.episodes')}</h2>
      <ol className="watch__list" ref={lista} aria-label={t(DEFAULT_LOCALE, 'player.episodes')}>
        {suelto === undefined ? null : <li key={suelto.value}>{fila(suelto)}</li>}
        {episodios.map((episodio) => (
          <li key={episodio.ref.value}>
            {fila({
              value: episodio.ref.value,
              number: episodio.number,
              title: episodio.title,
            })}
          </li>
        ))}
      </ol>

      {fallo ? (
        <p className="watch__list-note">{t(DEFAULT_LOCALE, 'player.episodes.error')}</p>
      ) : cargando ? (
        <p className="watch__list-note">{t(DEFAULT_LOCALE, 'player.episodes.loading')}</p>
      ) : hayMas ? (
        <button type="button" className="button watch__list-more" onClick={mas}>
          {t(DEFAULT_LOCALE, 'player.episodes.more')}
        </button>
      ) : null}
    </>
  )
}
