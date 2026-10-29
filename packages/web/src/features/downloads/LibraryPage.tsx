/**
 * La biblioteca: lo descargado, agrupado por título, y la cola que lo trae.
 *
 * Sustituye a la página de Descargas. La diferencia no es de nombre: una lista
 * de filas cuenta *trabajo* —qué se está bajando, qué falló— y una biblioteca
 * cuenta *una colección* —qué se puede ver ya—. Las dos cosas viven aquí porque
 * son el mismo asunto en dos momentos, y separarlas obligaba a mirar en dos
 * pantallas para saber si algo estaba listo.
 *
 * El reproductor de cada episodio es propio (`/library/:id`): abre el archivo
 * descargado sin preguntarle nada al proveedor ni a la red. La ficha del título
 * sigue siendo el sitio para ver la serie entera; aquí sólo se ve lo que ya está
 * en el equipo.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { IconoReproducir } from '../player/icons'
import {
  agruparBiblioteca,
  calcularVelocidad,
  type Descarga,
  estaActiva,
  estimarRestante,
  formatearBytes,
  formatearEspera,
  porcentaje,
  type SerieBiblioteca,
} from './biblioteca'
import { DownloadFolder } from './DownloadFolder'
import { useDownloads } from './useDownloads'

const LOCALE = DEFAULT_LOCALE

/** El nombre de la descarga en los textos que necesitan más que el estado. */
function estado(item: Descarga): string {
  switch (item.status) {
    case 'queued':
      return t(LOCALE, 'downloads.status.queued')
    case 'downloading':
      return t(LOCALE, 'downloads.status.downloading')
    case 'paused':
      return t(LOCALE, 'downloads.status.paused')
    case 'complete':
      return t(LOCALE, 'downloads.status.complete')
    case 'failed':
      return t(LOCALE, 'downloads.status.failed')
    case 'cancelled':
      return t(LOCALE, 'downloads.status.cancelled')
  }
}

/**
 * La velocidad de cada descarga activa, a partir de dos lecturas seguidas.
 *
 * La cola escribe el contador cada medio segundo y la pantalla lee cada segundo;
 * la velocidad es la diferencia entre dos lecturas, no una cifra que el motor
 * prometa. Si entre dos lecturas el contador no creció, se conserva la última
 * velocidad conocida en vez de pintar un cero que asustaría: el archivo puede
 * estar esperando al proveedor.
 */
function useVelocidades(items: readonly Descarga[]): ReadonlyMap<number, number> {
  const [velocidades, setVelocidades] = useState<ReadonlyMap<number, number>>(new Map())
  const anterior = useRef({ at: 0, bytes: new Map<number, number>() })

  useEffect(() => {
    const ahora = Date.now()
    const antes = anterior.current
    const segundos = (ahora - antes.at) / 1000
    const siguiente = new Map<number, number>()

    setVelocidades((previas) => {
      for (const item of items) {
        if (item.status !== 'downloading') continue

        const calculada = calcularVelocidad(item.bytes, antes.bytes.get(item.id), segundos)
        const valor = calculada ?? previas.get(item.id)
        if (valor !== undefined) siguiente.set(item.id, valor)
      }

      return siguiente
    })

    anterior.current = {
      at: ahora,
      bytes: new Map(
        items.filter((item) => item.status === 'downloading').map((item) => [item.id, item.bytes]),
      ),
    }
  }, [items])

  return velocidades
}

/** Lo que se lee debajo de la barra: avance, velocidad y lo que falta. */
function datos(item: Descarga, velocidad: number | undefined): string {
  const avance = porcentaje(item)
  const partes = [
    item.totalBytes === undefined || avance === undefined
      ? t(LOCALE, 'library.progressUnknown', { done: formatearBytes(item.bytes) })
      : t(LOCALE, 'library.progress', {
          percent: avance,
          done: formatearBytes(item.bytes),
          total: formatearBytes(item.totalBytes),
        }),
  ]

  if (velocidad !== undefined) {
    partes.push(t(LOCALE, 'library.speed', { speed: formatearBytes(velocidad) }))
  }

  const restante = estimarRestante(item.totalBytes, item.bytes, velocidad)
  if (restante !== undefined) {
    partes.push(t(LOCALE, 'library.eta', { time: formatearEspera(restante) }))
  }

  return partes.join(' · ')
}

/** El dibujo de la papelera. Es de la casa: trazo recto y `currentColor`. */
function IconoBorrar(): ReactNode {
  return (
    <svg className="library__remove-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16v2H4Zm3 3h10l-1 10H8Zm2-6h6v2H9Z" />
    </svg>
  )
}

function FilaDescarga(props: {
  readonly item: Descarga
  readonly velocidad: number | undefined
  readonly onPause: (id: number) => Promise<void>
  readonly onResume: (id: number) => Promise<void>
  readonly onRemove: (id: number) => Promise<void>
}): ReactNode {
  const { item } = props
  const avance = porcentaje(item)
  const indeterminada = avance === undefined

  return (
    <li className="library__download" data-estado={item.status}>
      <div className="library__download-head">
        <div className="library__download-text">
          <strong className="library__download-title">{item.title}</strong>
          <span className="library__download-episode">{item.episodeLabel}</span>
        </div>
        <span className="library__download-state">{estado(item)}</span>
      </div>

      <div
        className="library__bar"
        role="progressbar"
        aria-label={t(LOCALE, 'library.progressLabel', { episode: item.episodeLabel })}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(indeterminada
          ? { 'data-indeterminate': 'true' }
          : {
              'aria-valuenow': avance,
              'aria-valuetext': t(LOCALE, 'library.percent', { percent: avance }),
            })}
      >
        <span
          className="library__bar-fill"
          style={indeterminada ? undefined : { transform: `scaleX(${avance / 100})` }}
        />
      </div>

      <div className="library__download-foot">
        <span className="library__download-data">{datos(item, props.velocidad)}</span>
        <div className="library__download-actions">
          {item.status === 'downloading' || item.status === 'queued' ? (
            <button
              type="button"
              className="button"
              aria-label={t(LOCALE, 'library.pauseEpisode', { episode: item.episodeLabel })}
              onClick={() => void props.onPause(item.id)}
            >
              {t(LOCALE, 'downloads.pause')}
            </button>
          ) : null}
          {item.status === 'paused' || item.status === 'failed' ? (
            <button
              type="button"
              className="button"
              aria-label={t(LOCALE, 'library.resumeEpisode', { episode: item.episodeLabel })}
              onClick={() => void props.onResume(item.id)}
            >
              {t(LOCALE, 'downloads.resume')}
            </button>
          ) : null}
          <button
            type="button"
            className="button"
            aria-label={t(LOCALE, 'library.removeEpisode', { episode: item.episodeLabel })}
            onClick={() => void props.onRemove(item.id)}
          >
            {t(LOCALE, 'downloads.delete')}
          </button>
        </div>
      </div>

      {item.error === undefined ? null : (
        <p className="library__download-error" role="alert">
          {item.error}
        </p>
      )}
    </li>
  )
}

function TarjetaSerie(props: {
  readonly serie: SerieBiblioteca
  readonly activa: boolean
  readonly onElegir: () => void
}): ReactNode {
  const { serie } = props

  return (
    <li>
      <button
        type="button"
        className="library__serie"
        aria-pressed={props.activa}
        aria-controls="library-detail"
        onClick={props.onElegir}
      >
        <span className="library__cover-box">
          <Cover providerId={serie.providerId} ref={serie.animeRef} className="library__cover" />
          <span className="library__serie-count" aria-hidden="true">
            {serie.episodes.length}
          </span>
        </span>
        <span className="library__serie-title">{serie.title}</span>
        <span className="library__serie-meta">
          {t(LOCALE, 'library.seriesMeta', {
            episodes: serie.episodes.length,
            size: formatearBytes(serie.bytes),
          })}
        </span>
      </button>
    </li>
  )
}

function DetalleSerie(props: {
  readonly serie: SerieBiblioteca
  readonly onRemove: (id: number) => Promise<void>
}): ReactNode {
  const { serie } = props

  return (
    <div className="library__detail" id="library-detail">
      <div className="library__detail-head">
        <h3 className="library__detail-title">{serie.title}</h3>
        <p className="library__detail-meta">
          {t(LOCALE, 'library.seriesMeta', {
            episodes: serie.episodes.length,
            size: formatearBytes(serie.bytes),
          })}
        </p>
      </div>

      <ul className="library__episodes">
        {serie.episodes.map((episodio) => (
          <li className="library__episode" key={episodio.id}>
            <Link
              className="library__episode-link"
              to={`/library/${episodio.id}`}
              title={t(LOCALE, 'library.playEpisode', { episode: episodio.episodeLabel })}
            >
              <span className="library__episode-icon" aria-hidden="true">
                <IconoReproducir className="library__play-icon" />
              </span>
              <span className="library__episode-label">{episodio.episodeLabel}</span>
              <span className="library__episode-size">{formatearBytes(episodio.bytes)}</span>
            </Link>
            <button
              type="button"
              className="library__episode-remove"
              aria-label={t(LOCALE, 'library.removeEpisode', { episode: episodio.episodeLabel })}
              title={t(LOCALE, 'library.removeEpisode', { episode: episodio.episodeLabel })}
              onClick={() => void props.onRemove(episodio.id)}
            >
              <IconoBorrar />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LibraryPage(): ReactNode {
  const { items, space, loading, error, pause, resume, remove, cleanup, setDir } = useDownloads()
  const velocidades = useVelocidades(items)
  const activas = items.filter(estaActiva)
  const series = agruparBiblioteca(items)
  const [seleccion, setSeleccion] = useState<string | undefined>(undefined)

  // Si la serie elegida desaparece —se borró su último episodio—, manda la
  // primera de la estantería: una selección que ya no existe dejaría el panel
  // vacío sin decir por qué.
  const activa = series.find((serie) => serie.key === seleccion) ?? series[0]

  const completas = items.filter((item) => item.status === 'complete').length
  const totalEpisodios = series.reduce((total, serie) => total + serie.episodes.length, 0)
  const totalBytes = series.reduce((total, serie) => total + serie.bytes, 0)

  return (
    <section className="library">
      <header className="library__head">
        <h1>{t(LOCALE, 'library.title')}</h1>
        <p className="library__lede">
          {series.length === 0
            ? t(LOCALE, 'library.summaryEmpty')
            : t(LOCALE, 'library.summary', {
                titles: series.length,
                episodes: totalEpisodios,
                size: formatearBytes(totalBytes),
              })}
        </p>
      </header>

      {error === undefined ? null : (
        <p className="downloads__error" role="alert">
          {error}
        </p>
      )}

      {activas.length === 0 ? null : (
        <section className="library__zone" aria-labelledby="library-downloads-title">
          <div className="library__zone-head">
            <h2 id="library-downloads-title">{t(LOCALE, 'library.downloads')}</h2>
            <span className="library__count">
              {t(LOCALE, 'library.activeCount', { count: activas.length })}
            </span>
          </div>
          <ul className="library__downloads">
            {activas.map((item) => (
              <FilaDescarga
                key={item.id}
                item={item}
                velocidad={velocidades.get(item.id)}
                onPause={pause}
                onResume={resume}
                onRemove={remove}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="library__zone" aria-labelledby="library-collection-title">
        <div className="library__zone-head">
          <h2 id="library-collection-title">{t(LOCALE, 'library.collection')}</h2>
          <span className="library__count">
            {t(LOCALE, 'library.titles', { count: series.length })}
          </span>
        </div>

        {loading ? <p className="library__loading">{t(LOCALE, 'downloads.loading')}</p> : null}

        {!loading && series.length === 0 ? (
          activas.length > 0 ? (
            <p className="library__pending">{t(LOCALE, 'library.empty.pending')}</p>
          ) : (
            <div className="library__empty">
              <p className="library__empty-title">{t(LOCALE, 'library.empty.title')}</p>
              <p className="library__empty-body">{t(LOCALE, 'library.empty.body')}</p>
              <Link className="button button--primary" to="/">
                {t(LOCALE, 'library.empty.action')}
              </Link>
            </div>
          )
        ) : null}

        {series.length === 0 ? null : (
          <div className="library__collection">
            <ul className="library__shelf">
              {series.map((serie) => (
                <TarjetaSerie
                  key={serie.key}
                  serie={serie}
                  activa={serie.key === activa?.key}
                  onElegir={() => setSeleccion(serie.key)}
                />
              ))}
            </ul>
            {activa === undefined ? null : <DetalleSerie serie={activa} onRemove={remove} />}
          </div>
        )}
      </section>

      <details className="library__settings">
        <summary className="library__settings-summary">{t(LOCALE, 'library.settings')}</summary>
        <div className="library__settings-body">
          {space === undefined ? null : (
            <p className="library__space">
              {t(LOCALE, 'downloads.space', {
                free: formatearBytes(space.freeBytes),
                total: formatearBytes(space.totalBytes),
                used: formatearBytes(space.downloadsBytes),
              })}
            </p>
          )}
          <DownloadFolder current={space?.path} onSave={setDir} />
          {completas === 0 ? null : (
            <button type="button" className="button" onClick={() => void cleanup()}>
              {t(LOCALE, 'downloads.cleanup', { count: String(completas) })}
            </button>
          )}
        </div>
      </details>
    </section>
  )
}
