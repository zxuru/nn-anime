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
import { ChevronRight, Film, HardDrive, Library, ListVideo, Play, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Confirmacion } from '../../components/Confirmacion'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { ANCLAS } from '../guia/guia'
import {
  agruparBiblioteca,
  calcularVelocidad,
  type Descarga,
  estaActiva,
  estimarRestante,
  faltanBytes,
  formatearBytes,
  formatearEspera,
  ordenarActivas,
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

/**
 * Lo que se lee debajo de la barra: lo que lleva, lo que falta, la velocidad y
 * el tiempo.
 *
 * «Llevas» y «faltan» se dicen con palabras y no sólo con una razón de bytes: la
 * pregunta que la fila contesta es cuánto queda, y una cifra suelta entre dos
 * tamaños obliga a restar. El porcentaje va primero porque es lo que se mira de
 * reojo.
 */
export function datos(item: Descarga, velocidad: number | undefined): string {
  const avance = porcentaje(item)
  const partes: string[] = []

  if (avance !== undefined) {
    partes.push(t(LOCALE, 'library.percent', { percent: avance }))
  }

  if (item.totalBytes === undefined || avance === undefined) {
    partes.push(t(LOCALE, 'library.progressUnknown', { done: formatearBytes(item.bytes) }))
  } else {
    partes.push(
      t(LOCALE, 'library.progress', {
        done: formatearBytes(item.bytes),
        total: formatearBytes(item.totalBytes),
      }),
    )

    const falta = faltanBytes(item)
    if (falta !== undefined) {
      partes.push(t(LOCALE, 'library.remaining', { left: formatearBytes(falta) }))
    }
  }

  if (velocidad !== undefined) {
    partes.push(t(LOCALE, 'library.speed', { speed: formatearBytes(velocidad) }))
  }

  const restante = estimarRestante(item.totalBytes, item.bytes, velocidad)
  if (restante !== undefined) {
    partes.push(t(LOCALE, 'library.eta', { time: formatearEspera(restante) }))
  }

  return partes.join(' · ')
}

/**
 * Lo que se está a punto de borrar.
 *
 * Una descarga de la cola o de la estantería, o todas las completadas de una vez.
 * Las dos cosas son destructivas y las dos pasan por la misma confirmación: lo que
 * cambia es el texto, no el gesto.
 */
type Borrado =
  | { readonly tipo: 'descarga'; readonly id: number; readonly etiqueta: string }
  | { readonly tipo: 'completadas'; readonly count: number; readonly bytes: number }

function FilaDescarga(props: {
  readonly item: Descarga
  readonly velocidad: number | undefined
  readonly onPause: (id: number) => Promise<void>
  readonly onResume: (id: number) => Promise<void>
  readonly onBorrar: () => void
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
            className="button button--icono"
            aria-label={t(LOCALE, 'library.removeEpisode', { episode: item.episodeLabel })}
            title={t(LOCALE, 'library.removeEpisode', { episode: item.episodeLabel })}
            onClick={props.onBorrar}
          >
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
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
            <ListVideo size={12} strokeWidth={2} />
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
  readonly onPedirBorrado: (episodio: Descarga) => void
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
                <Play size={18} strokeWidth={2} fill="currentColor" />
              </span>
              <span className="library__episode-label">{episodio.episodeLabel}</span>
              <span className="library__episode-size">{formatearBytes(episodio.bytes)}</span>
            </Link>
            <button
              type="button"
              className="library__episode-remove"
              aria-label={t(LOCALE, 'library.removeEpisode', { episode: episodio.episodeLabel })}
              title={t(LOCALE, 'library.removeEpisode', { episode: episodio.episodeLabel })}
              onClick={() => props.onPedirBorrado(episodio)}
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
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
  const activas = ordenarActivas(items.filter(estaActiva))
  const series = agruparBiblioteca(items)
  const [seleccion, setSeleccion] = useState<string | undefined>(undefined)
  /**
   * Si la cola está desplegada.
   *
   * Empieza cerrada: la cola es lo que cambia, pero la estantería es lo que se
   * viene a ver, y una serie entera apuntada son cientos de filas que empujan la
   * colección fuera de la pantalla. La cabecera sigue diciendo cuántas hay.
   */
  const [colaAbierta, setColaAbierta] = useState(false)
  /** Lo que espera confirmación para borrarse. */
  const [borrado, setBorrado] = useState<Borrado | undefined>(undefined)

  // Si la serie elegida desaparece —se borró su último episodio—, manda la
  // primera de la estantería: una selección que ya no existe dejaría el panel
  // vacío sin decir por qué.
  const activa = series.find((serie) => serie.key === seleccion) ?? series[0]

  const completas = items.filter((item) => item.status === 'complete').length
  const bytesCompletas = items
    .filter((item) => item.status === 'complete')
    .reduce((total, item) => total + item.bytes, 0)
  const totalEpisodios = series.reduce((total, serie) => total + serie.episodes.length, 0)
  const totalBytes = series.reduce((total, serie) => total + serie.bytes, 0)
  const ocupado =
    space === undefined || space.totalBytes <= 0
      ? 0
      : Math.min(100, Math.round((space.downloadsBytes / space.totalBytes) * 100))

  const textoBorrado =
    borrado === undefined
      ? undefined
      : borrado.tipo === 'descarga'
        ? {
            titulo: t(LOCALE, 'library.delete.title'),
            cuerpo: t(LOCALE, 'library.delete.body', { episode: borrado.etiqueta }),
            confirmar: t(LOCALE, 'library.delete.confirm'),
          }
        : {
            titulo: t(LOCALE, 'library.cleanup.title'),
            cuerpo: t(LOCALE, 'library.cleanup.body', {
              count: borrado.count,
              size: formatearBytes(borrado.bytes),
            }),
            confirmar: t(LOCALE, 'library.cleanup.confirm'),
          }

  return (
    <section className="pagina library">
      <header className="library__head" data-tour={ANCLAS.bibliotecaResumen}>
        <h1>{t(LOCALE, 'library.title')}</h1>
        {series.length === 0 ? (
          <p className="library__lede">{t(LOCALE, 'library.summaryEmpty')}</p>
        ) : (
          /*
           * Tres cifras con su dibujo en lugar de una frase: el espacio, los
           * episodios y los títulos son la misma pregunta —cuánto tengo— y en un
           * teléfono la frase se partía en dos renglones. La etiqueta se esconde
           * donde no cabe; el número y el dibujo dicen lo mismo.
           */
          <ul className="library__stats">
            <li className="library__stat">
              <Library size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
              <strong className="library__stat-valor">{series.length}</strong>
              <span className="library__stat-etiqueta">{t(LOCALE, 'library.stat.titles')}</span>
            </li>
            <li className="library__stat">
              <Film size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
              <strong className="library__stat-valor">{totalEpisodios}</strong>
              <span className="library__stat-etiqueta">{t(LOCALE, 'library.stat.episodes')}</span>
            </li>
            <li className="library__stat">
              <HardDrive size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
              <strong className="library__stat-valor">{formatearBytes(totalBytes)}</strong>
              <span className="library__stat-etiqueta">{t(LOCALE, 'library.stat.size')}</span>
            </li>
          </ul>
        )}
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
            <div className="library__zone-tools">
              <span className="library__count">
                {t(LOCALE, 'library.activeCount', { count: activas.length })}
              </span>
              <button
                type="button"
                className="button library__toggle"
                aria-expanded={colaAbierta}
                aria-controls="library-downloads-list"
                onClick={() => setColaAbierta(!colaAbierta)}
              >
                {t(LOCALE, colaAbierta ? 'library.downloads.hide' : 'library.downloads.show')}
              </button>
            </div>
          </div>

          {/* El envoltorio existe aunque esté cerrada: `aria-controls` apunta a
              un id que tiene que estar en el documento, no a uno que aparece al
              desplegar. La lista no se pinta cerrada, así que mil filas dormidas
              tampoco se construyen. */}
          <div id="library-downloads-list">
            {colaAbierta ? (
              <ul className="library__downloads">
                {activas.map((item) => (
                  <FilaDescarga
                    key={item.id}
                    item={item}
                    velocidad={velocidades.get(item.id)}
                    onPause={pause}
                    onResume={resume}
                    onBorrar={() =>
                      setBorrado({
                        tipo: 'descarga',
                        id: item.id,
                        etiqueta: item.episodeLabel,
                      })
                    }
                  />
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      )}

      <section
        className="library__zone"
        aria-labelledby="library-collection-title"
        data-tour={ANCLAS.bibliotecaColeccion}
      >
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
            {activa === undefined ? null : (
              <DetalleSerie
                serie={activa}
                onPedirBorrado={(episodio) =>
                  setBorrado({
                    tipo: 'descarga',
                    id: episodio.id,
                    etiqueta: episodio.episodeLabel,
                  })
                }
              />
            )}
          </div>
        )}
      </section>

      <details className="library__settings" data-tour={ANCLAS.bibliotecaAjustes}>
        <summary className="library__settings-summary">
          <ChevronRight
            className="library__settings-flecha"
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
          />
          <HardDrive size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(LOCALE, 'library.settings')}
        </summary>
        <div className="library__settings-body">
          {space === undefined ? null : (
            <div className="library__space">
              <div
                className="library__space-barra"
                role="progressbar"
                aria-label={t(LOCALE, 'library.space.label')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ocupado}
              >
                <span className="library__space-fill" style={{ inlineSize: `${ocupado}%` }} />
              </div>
              <p className="library__space-texto">
                {t(LOCALE, 'downloads.space', {
                  free: formatearBytes(space.freeBytes),
                  total: formatearBytes(space.totalBytes),
                  used: formatearBytes(space.downloadsBytes),
                })}
              </p>
            </div>
          )}
          <DownloadFolder current={space?.path} onSave={setDir} />
          {completas === 0 ? null : (
            <button
              type="button"
              className="button button--destructivo"
              onClick={() =>
                setBorrado({ tipo: 'completadas', count: completas, bytes: bytesCompletas })
              }
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
              {t(LOCALE, 'downloads.cleanup', { count: String(completas) })}
            </button>
          )}
        </div>
      </details>

      {textoBorrado === undefined ? null : (
        <Confirmacion
          open
          titulo={textoBorrado.titulo}
          cuerpo={textoBorrado.cuerpo}
          confirmar={textoBorrado.confirmar}
          cancelar={t(LOCALE, 'library.delete.cancel')}
          onCerrar={() => setBorrado(undefined)}
          onConfirmar={() => {
            if (borrado === undefined) return
            if (borrado.tipo === 'completadas') void cleanup()
            else void remove(borrado.id)
          }}
        />
      )}
    </section>
  )
}
