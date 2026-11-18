/**
 * La sección «Descargas» de Ajustes.
 *
 * La carpeta se cambia en la Biblioteca, junto a la cola y al espacio, que es
 * donde se ve lo que ocupa y lo que falta. Aquí no se duplica ese formulario:
 * se enseña dónde está y cuánto queda, y se enlaza a la pantalla que lo edita.
 * Duplicar el campo sería tener dos sitios que guardan la misma ruta y dos
 * formas de fallar al hacerlo.
 *
 * La lectura es de una sola vez: el espacio no cambia mientras se mira esta
 * pantalla y la Biblioteca ya tiene su refresco para cuando lo hace.
 */

import { type DownloadsSpace, downloadsSpaceSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'
import { t } from '../../i18n'
import { Link } from '../../router'
import { formatearBytes } from '../downloads/biblioteca'

export interface DownloadsSummaryProps {
  /** El espacio leído; `undefined` mientras no se sabe. */
  readonly space: DownloadsSpace | undefined
  /** La lectura falló. */
  readonly failed?: boolean | undefined
}

/** La parte que se puede pintar sin red: la prueba la usa con datos. */
export function DownloadsSummary(props: DownloadsSummaryProps): ReactNode {
  return (
    <section>
      <h3>{t(DEFAULT_LOCALE, 'settings.downloads.title')}</h3>
      <p>{t(DEFAULT_LOCALE, 'settings.downloads.body')}</p>

      {props.space === undefined ? (
        props.failed === true ? (
          <p className="field__hint" role="status">
            {t(DEFAULT_LOCALE, 'settings.downloads.error')}
          </p>
        ) : (
          <p className="field__hint" role="status">
            {t(DEFAULT_LOCALE, 'settings.downloads.loading')}
          </p>
        )
      ) : (
        <dl className="settings__paths">
          <dt>{t(DEFAULT_LOCALE, 'settings.downloads.folder')}</dt>
          <dd>{props.space.path}</dd>
          <dt>{t(DEFAULT_LOCALE, 'settings.downloads.space')}</dt>
          <dd>
            {t(DEFAULT_LOCALE, 'downloads.space', {
              free: formatearBytes(props.space.freeBytes),
              total: formatearBytes(props.space.totalBytes),
              used: formatearBytes(props.space.downloadsBytes),
            })}
          </dd>
        </dl>
      )}

      <p className="settings__actions">
        <Link className="button" to="/library">
          {t(DEFAULT_LOCALE, 'settings.downloads.action')}
        </Link>
      </p>
    </section>
  )
}

/** La sección con su lectura. El fallo no rompe la página: se cuenta y sigue. */
export function DownloadsSettings(): ReactNode {
  const [space, setSpace] = useState<DownloadsSpace | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let vivo = true

    apiGet('/api/downloads/space', downloadsSpaceSchema).then(
      (leido) => {
        if (!vivo) return
        setSpace(leido)
        setFailed(false)
      },
      () => {
        if (!vivo) return
        setFailed(true)
      },
    )

    return () => {
      vivo = false
    }
  }, [])

  return <DownloadsSummary space={space} failed={failed} />
}
