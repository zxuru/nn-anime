/**
 * El reproductor de una descarga.
 *
 * Es una pantalla propia y no un enlace a la ficha porque lo descargado tiene
 * que verse **sin el proveedor**: si el plugin se desinstaló o no hay red, el
 * archivo sigue en el equipo y la aplicación lo sirve por su id. La ficha sigue
 * siendo el sitio para ver la serie entera; aquí se abre un episodio concreto.
 *
 * **La serie entera, en la misma pantalla.** Antes sólo había un episodio y para
 * ver el siguiente había que volver a la estantería. Ahora la descarga trae a sus
 * hermanas —las completas del mismo título, en el orden de la biblioteca— y la
 * pantalla es la de siempre: el video a la izquierda y la lista a la derecha, con
 * las flechas y la cuenta atrás del siguiente. La preferencia de reproducción
 * automática es la misma que la de la reproducción del proveedor.
 *
 * La fuente es la misma ruta que usa el reproductor de la ficha cuando encuentra
 * una copia local —`/api/downloads/:id/file`—, así que los segmentos y los MP4
 * se tratan igual que allí: el servidor decide qué sirve y con qué rangos.
 */

import { downloadItemSchema, downloadsResponseSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'
import { Link, useNavigate } from '../../router'
import { SEGUNDOS_DEL_SIGUIENTE } from '../player/controls'
import { Player } from '../player/Player'
import { almacenLocal, guardarAutoplay, leerAutoplay } from '../player/storage'
import { coverPath } from '../search/ResultCard'
import { agruparBiblioteca, type Descarga, vecinosDe } from './biblioteca'

const LOCALE = DEFAULT_LOCALE

type Estado = 'loading' | 'ready' | 'error'

/**
 * El aviso de «esto quedó en segmentos» y su botón.
 *
 * Exportado para poder medirlo sin montar la pantalla entera: la página pide la
 * descarga en un efecto y un render a texto no lo ejecuta. Lo que se mide aquí
 * es que el texto dice la verdad y que el botón no se puede pulsar dos veces.
 */
export function AvisoDeConversion(props: {
  readonly convirtiendo: boolean
  readonly onConvertir: () => void
}): ReactNode {
  return (
    <div className="library-player__remux">
      <p className="library-player__note">{t(LOCALE, 'library.player.segments')}</p>
      <button
        type="button"
        className="button"
        onClick={props.onConvertir}
        aria-busy={props.convirtiendo}
        disabled={props.convirtiendo}
      >
        {props.convirtiendo
          ? t(LOCALE, 'library.player.converting')
          : t(LOCALE, 'library.player.convert')}
      </button>
    </div>
  )
}

export function LibraryPlayerPage(props: { readonly id: string }): ReactNode {
  const id = Number(props.id)
  const valido = Number.isInteger(id) && id > 0
  const [item, setItem] = useState<Descarga | undefined>()
  /** Las descargas completas de la misma serie, la actual incluida. */
  const [episodios, setEpisodios] = useState<readonly Descarga[]>([])
  const [estado, setEstado] = useState<Estado>(valido ? 'loading' : 'error')
  const [convirtiendo, setConvirtiendo] = useState(false)
  const [falloConversion, setFalloConversion] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>(
    valido ? undefined : t(LOCALE, 'library.player.invalid'),
  )
  const [autoplay, setAutoplay] = useState(() => leerAutoplay(almacenLocal()))
  const [cuenta, setCuenta] = useState<number | undefined>(undefined)
  const navegar = useNavigate()

  /**
   * Pasar a MP4 lo que quedó en segmentos.
   *
   * La petición devuelve la fila ya actualizada, así que la pantalla cambia de
   * reproductor —de hls.js a `<video>`— con el dato del servidor y sin volver a
   * preguntar. El MP4 se escribe al lado de la carpeta: la dirección no cambia,
   * cambia lo que hay detrás.
   */
  const convertir = async (): Promise<void> => {
    if (item === undefined || convirtiendo) return

    setConvirtiendo(true)
    setFalloConversion(undefined)

    try {
      const actualizada = await apiPostJson(
        `/api/downloads/${item.id}/remux`,
        undefined,
        downloadItemSchema,
      )
      setItem(actualizada)
    } catch (cause) {
      const fallo = describirFallo(cause)
      setFalloConversion(fallo.detalle ?? fallo.tecnico)
    } finally {
      setConvirtiendo(false)
    }
  }

  useEffect(() => {
    if (!valido) return undefined

    const controlador = new AbortController()

    apiGet(`/api/downloads/${id}`, downloadItemSchema, {
      signal: controlador.signal,
    }).then(
      (descarga) => {
        if (controlador.signal.aborted) return

        setItem(descarga)
        if (descarga.status === 'complete') {
          setEstado('ready')
          setError(undefined)
          return
        }

        setEstado('error')
        setError(t(LOCALE, 'library.player.notReady'))
      },
      (cause: unknown) => {
        if (controlador.signal.aborted) return

        const fallo = describirFallo(cause)
        setError(fallo.detalle ?? fallo.tecnico)
        setEstado('error')
      },
    )

    return () => controlador.abort()
  }, [id, valido])

  /**
   * Las hermanas de esta descarga.
   *
   * Se piden a la lista de la biblioteca y no a un endpoint propio: es la misma
   * lectura que pinta la estantería, y el agrupado ya sabe cuáles son episodios
   * del mismo título y en qué orden. Si la lista falla o no incluye la descarga
   * —el tope de doscientas filas—, la pantalla se queda con la actual y sin
   * flechas: la reproducción no depende de esto.
   */
  useEffect(() => {
    if (item === undefined) return undefined

    const controlador = new AbortController()

    void apiGet('/api/downloads', downloadsResponseSchema, { signal: controlador.signal }).then(
      (respuesta) => {
        if (controlador.signal.aborted) return

        const serie = agruparBiblioteca(respuesta.items).find(
          (candidata) =>
            candidata.providerId === item.providerId && candidata.animeRef === item.animeRef.value,
        )
        const lista = serie?.episodes ?? []
        setEpisodios(lista.some((episodio) => episodio.id === item.id) ? lista : [item])
      },
      () => {
        if (controlador.signal.aborted) return

        setEpisodios([item])
      },
    )

    return () => controlador.abort()
  }, [item])

  const posicion = vecinosDe(episodios, item?.id ?? -1)
  const anterior = posicion.anterior
  const siguiente = posicion.siguiente
  const rutaSiguiente = siguiente === undefined ? undefined : `/library/${siguiente.id}`

  const cambiarAutoplay = useCallback((valor: boolean) => {
    setAutoplay(valor)
    guardarAutoplay(almacenLocal(), valor)
  }, [])

  const alTerminar = useCallback(() => {
    if (rutaSiguiente === undefined || !autoplay) return

    setCuenta(SEGUNDOS_DEL_SIGUIENTE)
  }, [autoplay, rutaSiguiente])

  useEffect(() => {
    if (cuenta === undefined) return undefined

    if (cuenta <= 0) {
      if (rutaSiguiente !== undefined) navegar.push(rutaSiguiente)

      return undefined
    }

    const reloj = setTimeout(() => setCuenta((valor) => (valor ?? 1) - 1), 1000)

    return () => clearTimeout(reloj)
  }, [cuenta, rutaSiguiente, navegar])

  return (
    <section className="library-player">
      <header className="library-player__head">
        <Link className="library-player__back" to="/library">
          {t(LOCALE, 'library.player.back')}
        </Link>
        <div className="library-player__titles">
          <h1>{item?.title ?? t(LOCALE, 'library.playerTitle')}</h1>
          {item === undefined ? null : (
            <p className="library-player__episode">{item.episodeLabel}</p>
          )}
        </div>
        <span className="library-player__badge">{t(LOCALE, 'library.downloaded')}</span>
      </header>

      {estado === 'loading' ? (
        <p className="library-player__loading">{t(LOCALE, 'library.player.loading')}</p>
      ) : null}

      {estado === 'error' ? (
        <div className="library-player__error" role="alert">
          <p>
            {t(LOCALE, 'library.player.error', {
              message: error ?? t(LOCALE, 'library.player.invalid'),
            })}
          </p>
          <Link className="button" to="/library">
            {t(LOCALE, 'library.player.back')}
          </Link>
        </div>
      ) : null}

      {estado === 'ready' && item !== undefined ? (
        <div className="watch__layout">
          <div className="watch__main">
            {/*
              La `key` lleva el modo: al convertir, la misma dirección pasa de
              servir un manifiesto a servir un MP4, y el `<video>` tiene que
              montarse otra vez para leerlo con el otro reproductor.
            */}
            <Player
              key={`${item.id}-${item.kind}`}
              url={`/api/downloads/${item.id}/file`}
              kind={item.kind === 'segments' ? 'hls' : 'file'}
              title={`${item.title} · ${item.episodeLabel}`}
              poster={coverPath(item.providerId, item.animeRef.value)}
              autoplay={autoplay}
              onAutoplay={cambiarAutoplay}
              onEnded={alTerminar}
            />

            {/* Las flechas, cuando hay más de un capítulo descargado. La lista de
                la derecha hace lo mismo, pero después del final la flecha es lo
                que se busca; y el número dice en qué punto de la serie se está. */}
            {episodios.length <= 1 ? null : (
              <nav className="library-player__steps" aria-label={t(LOCALE, 'library.player.steps')}>
                {anterior === undefined ? (
                  <button type="button" className="button" disabled>
                    {t(LOCALE, 'library.player.previous')}
                  </button>
                ) : (
                  <Link
                    className="button"
                    to={`/library/${anterior.id}`}
                    ariaLabel={t(LOCALE, 'library.player.previousLabel', {
                      episode: anterior.episodeLabel,
                    })}
                    title={t(LOCALE, 'library.player.previousLabel', {
                      episode: anterior.episodeLabel,
                    })}
                  >
                    {t(LOCALE, 'library.player.previous')}
                  </Link>
                )}

                <span className="library-player__position">
                  {t(LOCALE, 'library.player.position', {
                    index: posicion.indice + 1,
                    total: episodios.length,
                  })}
                </span>

                {siguiente === undefined ? (
                  <button type="button" className="button" disabled>
                    {t(LOCALE, 'library.player.next')}
                  </button>
                ) : (
                  <Link
                    className="button"
                    to={`/library/${siguiente.id}`}
                    ariaLabel={t(LOCALE, 'library.player.nextLabel', {
                      episode: siguiente.episodeLabel,
                    })}
                    title={t(LOCALE, 'library.player.nextLabel', {
                      episode: siguiente.episodeLabel,
                    })}
                  >
                    {t(LOCALE, 'library.player.next')}
                  </Link>
                )}
              </nav>
            )}

            {cuenta === undefined || rutaSiguiente === undefined ? null : (
              <div className="watch__next">
                <p className="watch__next-text">
                  {t(LOCALE, 'player.next.in', { seconds: cuenta })}
                </p>
                <Link className="button button--primary" to={rutaSiguiente}>
                  {t(LOCALE, 'player.next.now')}
                </Link>
                <button type="button" className="button" onClick={() => setCuenta(undefined)}>
                  {t(LOCALE, 'player.next.cancel')}
                </button>
              </div>
            )}

            {item.kind === 'segments' ? (
              <AvisoDeConversion convirtiendo={convirtiendo} onConvertir={() => void convertir()} />
            ) : null}

            {falloConversion === undefined ? null : (
              <p className="library-player__remux-error" role="alert">
                {t(LOCALE, 'library.player.convertError', { message: falloConversion })}
              </p>
            )}

            <p className="library-player__note">{t(LOCALE, 'library.player.offline')}</p>
          </div>

          <aside className="watch__aside">
            <h2 className="watch__aside-title">{t(LOCALE, 'library.player.episodes')}</h2>
            <ol className="watch__list">
              {episodios.map((episodio) => (
                <li key={episodio.id}>
                  <Link
                    className="watch__list-item"
                    to={`/library/${episodio.id}`}
                    ariaCurrent={episodio.id === item.id ? 'page' : undefined}
                    title={episodio.episodeLabel}
                  >
                    <span className="watch__list-title">{episodio.episodeLabel}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
