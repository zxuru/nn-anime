/**
 * La página de Descargas.
 *
 * Muestra lo que hay en la cola y deja pausar, reanudar o borrar. El archivo se
 * pide por el id: la interfaz no arma rutas de archivo. Lo único que se escribe
 * a mano es **la carpeta de destino**, que es un ajuste y no una ruta de nada
 * descargado. Una descarga de segmentos —sin ffmpeg— no ofrece «abrir»: se
 * reproducirá desde la aplicación, y decirlo es mejor que un enlace que
 * descarga una carpeta.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { DownloadFolder } from './DownloadFolder'
import { type Descarga, useDownloads } from './useDownloads'

const LOCALE = DEFAULT_LOCALE

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`

  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

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

function porcentaje(item: Descarga): number | undefined {
  if (item.totalBytes === undefined || item.totalBytes <= 0) return undefined

  return Math.min(100, Math.round((item.bytes / item.totalBytes) * 100))
}

function Fila(props: {
  readonly item: Descarga
  readonly onPause: (id: number) => Promise<void>
  readonly onResume: (id: number) => Promise<void>
  readonly onRemove: (id: number) => Promise<void>
}): ReactNode {
  const { item } = props
  const avance = porcentaje(item)

  return (
    <li className="downloads__item">
      <div className="downloads__text">
        <strong>{item.title}</strong>
        <span>{item.episodeLabel}</span>
        <span className="downloads__state">
          {estado(item)}
          {item.bytes > 0 ? ` · ${bytes(item.bytes)}` : ''}
          {avance === undefined ? '' : ` · ${avance} %`}
        </span>
        {item.error === undefined ? null : <span className="downloads__error">{item.error}</span>}
      </div>
      {avance === undefined ? null : (
        <progress className="downloads__progress" value={avance} max={100}>
          {avance} %
        </progress>
      )}
      <div className="downloads__actions">
        {item.status === 'downloading' || item.status === 'queued' ? (
          <button type="button" onClick={() => void props.onPause(item.id)}>
            {t(LOCALE, 'downloads.pause')}
          </button>
        ) : null}
        {item.status === 'paused' || item.status === 'failed' ? (
          <button type="button" onClick={() => void props.onResume(item.id)}>
            {t(LOCALE, 'downloads.resume')}
          </button>
        ) : null}
        {item.status === 'complete' && item.kind !== 'segments' ? (
          <a className="button" href={`/api/downloads/${item.id}/file`} download>
            {t(LOCALE, 'downloads.open')}
          </a>
        ) : null}
        {item.kind === 'segments' && item.status === 'complete' ? (
          <span className="downloads__note">{t(LOCALE, 'downloads.segments')}</span>
        ) : null}
        <button type="button" onClick={() => void props.onRemove(item.id)}>
          {t(LOCALE, 'downloads.delete')}
        </button>
      </div>
    </li>
  )
}

export function DownloadsPage(): ReactNode {
  const { items, space, loading, error, pause, resume, remove, cleanup, setDir } = useDownloads()
  const completas = items.filter((item) => item.status === 'complete').length

  return (
    <section className="downloads">
      <h1>{t(LOCALE, 'downloads.title')}</h1>
      {space === undefined ? null : (
        <p className="downloads__space">
          {t(LOCALE, 'downloads.space', {
            free: bytes(space.freeBytes),
            total: bytes(space.totalBytes),
            used: bytes(space.downloadsBytes),
          })}
        </p>
      )}
      <DownloadFolder current={space?.path} onSave={setDir} />
      {completas === 0 ? null : (
        <button type="button" onClick={() => void cleanup()}>
          {t(LOCALE, 'downloads.cleanup', { count: String(completas) })}
        </button>
      )}
      {error === undefined ? null : (
        <p className="downloads__error" role="alert">
          {error}
        </p>
      )}
      {loading ? <p>{t(LOCALE, 'downloads.loading')}</p> : null}
      {!loading && items.length === 0 ? <p>{t(LOCALE, 'downloads.empty')}</p> : null}
      <ul className="downloads__list">
        {items.map((item) => (
          <Fila key={item.id} item={item} onPause={pause} onResume={resume} onRemove={remove} />
        ))}
      </ul>
    </section>
  )
}
