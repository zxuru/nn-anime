/**
 * La clave de TMDB en Ajustes.
 *
 * Es la única salida de red que el usuario configura a mano. La clave **no vuelve
 * del servidor**, así que la pantalla no puede enseñarla: sólo dice si hay una y
 * ofrece reemplazarla o quitarla. El campo se vacía al guardar para que la clave no
 * se quede escrita en el DOM.
 *
 * La validación de la forma —32 hexadecimales— vive en el schema del servidor. Aquí
 * sólo se comprueba que no esté vacía: repetir la regla en dos sitios es cómo se
 * desincronizan.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type FormEvent, type ReactNode, useState } from 'react'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'

export interface TmdbSettingsProps {
  readonly configured: boolean
  /** Guarda la clave, o la borra con `null`. Lanza si no se pudo. */
  readonly onSave: (key: string | null) => Promise<void>
}

type Estado = 'idle' | 'saving' | 'saved' | 'error'

export function TmdbSettings(props: TmdbSettingsProps): ReactNode {
  const [clave, setClave] = useState('')
  const [estado, setEstado] = useState<Estado>('idle')
  const [mensaje, setMensaje] = useState<string | undefined>(undefined)

  const ocupado = estado === 'saving'

  const guardar = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const limpia = clave.trim()
    if (limpia === '') return

    setEstado('saving')
    setMensaje(undefined)

    try {
      await props.onSave(limpia)
      setClave('')
      setEstado('saved')
    } catch (cause) {
      setEstado('error')
      const fallo = describirFallo(cause)
      setMensaje(fallo.detalle ?? fallo.tecnico)
    }
  }

  const borrar = async (): Promise<void> => {
    setEstado('saving')
    setMensaje(undefined)

    try {
      await props.onSave(null)
      setEstado('saved')
    } catch (cause) {
      setEstado('error')
      const fallo = describirFallo(cause)
      setMensaje(fallo.detalle ?? fallo.tecnico)
    }
  }

  return (
    <section>
      <h2>{t(DEFAULT_LOCALE, 'settings.tmdb')}</h2>
      <form className="settings__form" onSubmit={guardar}>
        <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.tmdb.body')}</p>
        <p className="field__hint">
          {t(
            DEFAULT_LOCALE,
            props.configured ? 'settings.tmdb.configured' : 'settings.tmdb.notConfigured',
          )}
        </p>

        <label className="field" htmlFor="tmdb-key">
          <span className="field__label">{t(DEFAULT_LOCALE, 'settings.tmdb.key')}</span>
          <input
            id="tmdb-key"
            className="field__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={clave}
            onChange={(event) => setClave(event.target.value)}
            placeholder={t(DEFAULT_LOCALE, 'settings.tmdb.placeholder')}
          />
          <span className="field__hint">{t(DEFAULT_LOCALE, 'settings.tmdb.hint')}</span>
        </label>

        <div className="settings__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={ocupado || clave === ''}
          >
            {t(DEFAULT_LOCALE, 'settings.tmdb.save')}
          </button>
          {props.configured ? (
            <button
              type="button"
              className="button"
              disabled={ocupado}
              onClick={() => void borrar()}
            >
              {t(DEFAULT_LOCALE, 'settings.tmdb.clear')}
            </button>
          ) : null}
        </div>

        {estado === 'saved' ? (
          <p className="field__hint" role="status">
            {t(DEFAULT_LOCALE, 'settings.tmdb.saved')}
          </p>
        ) : null}
        {estado === 'error' && mensaje !== undefined ? (
          <p className="search__error" role="alert">
            {t(DEFAULT_LOCALE, 'settings.tmdb.error', { message: mensaje })}
          </p>
        ) : null}
      </form>
    </section>
  )
}
