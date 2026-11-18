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

import { type DownloadItem, downloadItemSchema, downloadsResponseSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { ChevronLeft, ChevronRight, CircleCheck, Info, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'
import { Link, useNavigate } from '../../router'
import { SEGUNDOS_DEL_SIGUIENTE } from '../player/controls'
import { Player } from '../player/Player'
import {
  almacenLocal,
  guardarAutoplay,
  guardarProgreso,
  leerAutoplay,
  olvidarProgreso,
} from '../player/storage'
import type { SafeTrack } from '../player/usePlayer'
import { UPDATE_INTERVAL_MS, useWatchEvents } from '../player/useWatchEvents'
import { coverPath } from '../search/ResultCard'
import { agruparBiblioteca, type Descarga, vecinosDe } from './biblioteca'
import {
  claveDeLaDescarga,
  etiquetaDeAudio,
  etiquetaDeSubtitulos,
  mandosDelReproductor,
  opcionesDeVisionado,
  posicionDeLaDescarga,
} from './visionado'

const LOCALE = DEFAULT_LOCALE

type Estado = 'loading' | 'ready' | 'error'

/**
 * Las pistas guardadas, con la forma que entiende el reproductor.
 *
 * La descarga trae la URL interna de cada pista —`/api/downloads/:id/subtitles/:indice`—,
 * no la del upstream: la del proveedor caducó o ya no existe, que es justo el
 * caso de verlo sin conexión. Un episodio sin pistas no inventa ninguna.
 *
 * Exportada para medirla sin montar la pantalla: el render a texto no ejecuta
 * efectos, y lo que hay que comprobar es que la lista llega tal cual.
 */
export function pistasDeLaDescarga(item: DownloadItem): readonly SafeTrack[] {
  return (item.subtitles ?? []).map((pista) => ({
    url: pista.url,
    lang: pista.lang,
    label: pista.label,
  }))
}

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

/**
 * El reproductor de la descarga, con su visionado.
 *
 * Se monta una vez por episodio —la `key` la pone quien lo usa— porque el
 * registro del servidor abre una fila por reproducción y esa fila tiene que morir
 * con el capítulo. Si el reproductor sobreviviera al cambio de id, el avance del
 * siguiente se apuntaría sobre la fila del anterior.
 *
 * Tres cosas que el `<Player>` no puede saber y que se resuelven aquí: de dónde
 * reanudar —el almacén del navegador, no el proveedor—, con qué modo se baja el
 * episodio, y a quién avisar de que se está viendo. La posición se guarda con el
 * mismo ritmo que en la pantalla del proveedor: cada cinco segundos, al pausar y
 * al desmontar. Sin lo último, cerrar la pestaña perdería los segundos que hacen
 * que reanudar sirva de algo.
 */
function ReproductorDescargado(props: {
  readonly item: Descarga
  readonly autoplay: boolean
  readonly onAutoplay: (valor: boolean) => void
  readonly onEnded: () => void
}): ReactNode {
  const { item } = props
  const [inicio] = useState(() => posicionDeLaDescarga(item))
  const visionado = useWatchEvents(opcionesDeVisionado(item, inicio))
  const almacen = almacenLocal()
  const clave = claveDeLaDescarga(item)
  const vivo = useRef({ positionS: 0, durationS: 0, guardado: 0 })

  const guardar = useCallback(
    (forzar: boolean) => {
      const { positionS, durationS } = vivo.current
      // Sin duración no hay proporción vista: guardar ese cero marcaría el
      // episodio como empezado y no dejaría reanudar donde de verdad iba.
      if (durationS <= 0) return

      const ahora = Date.now()
      if (!forzar && ahora - vivo.current.guardado < UPDATE_INTERVAL_MS) return

      vivo.current = { ...vivo.current, guardado: ahora }
      guardarProgreso(almacen, clave, { positionS, durationS })
    },
    [almacen, clave],
  )

  const guardarAvance = useCallback(
    (positionS: number, durationS: number) => {
      vivo.current = { ...vivo.current, positionS, durationS }
      guardar(false)
    },
    [guardar],
  )

  const terminar = useCallback(() => {
    // El capítulo está visto: lo apuntado a medias ya no sirve para reanudar.
    olvidarProgreso(almacen, clave)
    props.onEnded()
  }, [almacen, clave, props.onEnded])

  // Al desmontar —cambiar de episodio o salir de la pantalla—, la posición
  // final. El aviso periódico puede ser de hace cinco segundos, y ésos son justo
  // los que se pierden si no se guarda aquí.
  useEffect(() => {
    const referencia = vivo

    return () => {
      const { positionS, durationS } = referencia.current
      if (durationS > 0) guardarProgreso(almacen, clave, { positionS, durationS })
    }
  }, [almacen, clave])

  const mandos = mandosDelReproductor({
    eventos: visionado,
    guardar: () => guardar(true),
    guardarAvance,
    terminar,
  })

  return (
    <Player
      key={`${item.id}-${item.kind}`}
      url={`/api/downloads/${item.id}/file`}
      kind={item.kind === 'segments' ? 'hls' : 'file'}
      title={`${item.title} · ${item.episodeLabel}`}
      poster={coverPath(item.providerId, item.animeRef.value)}
      // Las pistas que se bajaron con el episodio: sin ellas, verlo sin
      // conexión sería verlo sin subtítulos aunque estén en disco.
      tracks={pistasDeLaDescarga(item)}
      autoplay={props.autoplay}
      onAutoplay={props.onAutoplay}
      startAtS={inicio}
      onPlay={mandos.onPlay}
      onPause={mandos.onPause}
      onProgress={mandos.onProgress}
      onEnded={mandos.onEnded}
    />
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
  const subtitulos = item === undefined ? undefined : etiquetaDeSubtitulos(item)

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
        <Link
          className="library-player__back"
          to="/library"
          ariaLabel={t(LOCALE, 'library.player.back')}
        >
          <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
          <span className="library-player__back-texto">{t(LOCALE, 'library.player.back')}</span>
        </Link>
        <div className="library-player__titles">
          <h1>{item?.title ?? t(LOCALE, 'library.playerTitle')}</h1>
          {item === undefined ? null : (
            <p className="library-player__episode">
              {item.episodeLabel} · {etiquetaDeAudio(item.mode)}
              {subtitulos === undefined ? null : ` · ${subtitulos}`}
            </p>
          )}
        </div>
        <span className="library-player__badge" title={t(LOCALE, 'library.downloaded')}>
          <CircleCheck size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          <span className="library-player__badge-texto">{t(LOCALE, 'library.downloaded')}</span>
        </span>
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
            <ReproductorDescargado
              key={item.id}
              item={item}
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
                  <button type="button" className="button button--con-icono" disabled>
                    <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                    <span className="library-player__paso-texto">
                      {t(LOCALE, 'library.player.previous')}
                    </span>
                  </button>
                ) : (
                  <Link
                    className="button button--con-icono"
                    to={`/library/${anterior.id}`}
                    ariaLabel={t(LOCALE, 'library.player.previousLabel', {
                      episode: anterior.episodeLabel,
                    })}
                    title={t(LOCALE, 'library.player.previousLabel', {
                      episode: anterior.episodeLabel,
                    })}
                  >
                    <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                    <span className="library-player__paso-texto">
                      {t(LOCALE, 'library.player.previous')}
                    </span>
                  </Link>
                )}

                <span className="library-player__position">
                  {t(LOCALE, 'library.player.position', {
                    index: posicion.indice + 1,
                    total: episodios.length,
                  })}
                </span>

                {siguiente === undefined ? (
                  <button type="button" className="button button--con-icono" disabled>
                    <span className="library-player__paso-texto">
                      {t(LOCALE, 'library.player.next')}
                    </span>
                    <ChevronRight size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                  </button>
                ) : (
                  <Link
                    className="button button--con-icono"
                    to={`/library/${siguiente.id}`}
                    ariaLabel={t(LOCALE, 'library.player.nextLabel', {
                      episode: siguiente.episodeLabel,
                    })}
                    title={t(LOCALE, 'library.player.nextLabel', {
                      episode: siguiente.episodeLabel,
                    })}
                  >
                    <span className="library-player__paso-texto">
                      {t(LOCALE, 'library.player.next')}
                    </span>
                    <ChevronRight size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
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

            <p className="library-player__note">
              <Info size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
              {t(LOCALE, 'library.player.offline')}
            </p>
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
                    {episodio.id === item.id ? (
                      <Play
                        className="watch__list-icon"
                        size={14}
                        strokeWidth={2}
                        fill="currentColor"
                        aria-hidden="true"
                        focusable="false"
                      />
                    ) : null}
                    <span className="watch__list-title">{episodio.episodeLabel}</span>
                    <span className="watch__list-mark">{etiquetaDeAudio(episodio.mode)}</span>
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
