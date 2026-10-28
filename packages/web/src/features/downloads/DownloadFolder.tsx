/**
 * La carpeta donde se guardan las descargas.
 *
 * Son dos formas de elegirla y ninguna sirve en el sitio de la otra. En el
 * anfitrión de escritorio se abre el diálogo nativo, que es lo único que puede
 * devolver una ruta absoluta del disco. En el navegador ese diálogo no existe
 * —un `<input type="file">` daría nombres relativos que el servidor no puede
 * usar—, así que la carpeta se escribe a mano: es el ajuste de texto que el plan
 * de descargas ya preveía para la web.
 *
 * La forma de la ruta —absoluta y sin caracteres de control— la comprueba el
 * servidor. Repetir la regla aquí sería cómo se desincronizan las dos, y el
 * mensaje que vuelve de allí ya dice qué falla.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type FormEvent, type ReactNode, useState } from 'react'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'
import { elegirCarpetaDescargas, hayEscritorio } from './desktop'

const LOCALE = DEFAULT_LOCALE

export interface DownloadFolderProps {
  /** La carpeta que anuncia el servidor; `undefined` mientras no se sabe. */
  readonly current: string | undefined
  /** Guarda la carpeta. Lanza si el servidor la rechaza. */
  readonly onSave: (path: string) => Promise<void>
}

type Estado = 'idle' | 'saving' | 'saved' | 'error'

export function DownloadFolder(props: DownloadFolderProps): ReactNode {
  const [escrita, setEscrita] = useState<string | undefined>(undefined)
  const [estado, setEstado] = useState<Estado>('idle')
  const [mensaje, setMensaje] = useState<string | undefined>(undefined)

  // Mientras nadie escriba, el campo enseña lo que dice el servidor. Un valor
  // atado a `current` borraría lo tecleado en cada refresco de la cola, y la cola
  // se refresca cada dos segundos mientras algo se está bajando.
  const valor = escrita ?? props.current ?? ''
  const ocupado = estado === 'saving'

  const fallar = (cause: unknown): void => {
    const fallo = describirFallo(cause)
    setEstado('error')
    setMensaje(fallo.detalle ?? fallo.tecnico)
  }

  const aplicar = async (ruta: string): Promise<void> => {
    setEstado('saving')
    setMensaje(undefined)

    try {
      await props.onSave(ruta)
      setEscrita(ruta)
      setEstado('saved')
    } catch (cause) {
      fallar(cause)
    }
  }

  const guardar = (event: FormEvent): void => {
    event.preventDefault()
    const ruta = valor.trim()
    if (ruta === '') return

    void aplicar(ruta)
  }

  // Quien acaba de elegir una carpeta en la ventana del sistema no espera otro
  // clic en «guardar»: se aplica al momento y el campo lo refleja.
  const elegir = async (): Promise<void> => {
    let ruta: string | undefined

    try {
      ruta = await elegirCarpetaDescargas()
    } catch (cause) {
      fallar(cause)
      return
    }

    if (ruta === undefined) return

    await aplicar(ruta)
  }

  return (
    <section>
      <h2>{t(LOCALE, 'downloads.folder.title')}</h2>
      <form className="settings__form" onSubmit={guardar}>
        <div className="field">
          <label className="field__label" htmlFor="downloads-folder">
            {t(LOCALE, 'downloads.folder.label')}
          </label>
          <input
            id="downloads-folder"
            className="field__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="downloads-folder-hint"
            value={valor}
            onChange={(event) => {
              setEscrita(event.target.value)
              setEstado('idle')
            }}
          />
          <span className="field__hint" id="downloads-folder-hint">
            {t(LOCALE, 'downloads.folder.hint')}
          </span>
        </div>

        <div className="settings__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={ocupado || valor.trim() === ''}
          >
            {t(LOCALE, 'downloads.folder.save')}
          </button>
          {hayEscritorio() ? (
            <button
              type="button"
              className="button"
              disabled={ocupado}
              onClick={() => void elegir()}
            >
              {t(LOCALE, 'downloads.chooseFolder')}
            </button>
          ) : null}
        </div>

        {estado === 'saved' ? (
          <p className="field__hint" role="status">
            {t(LOCALE, 'downloads.folder.saved')}
          </p>
        ) : null}
        {estado === 'error' && mensaje !== undefined ? (
          <p className="downloads__error" role="alert">
            {t(LOCALE, 'downloads.folder.error', { message: mensaje })}
          </p>
        ) : null}
      </form>
    </section>
  )
}
