/**
 * La sección «Perfil» de Ajustes: exportar e importar las marcas del usuario.
 *
 * Exportar es un enlace y no un `fetch` con `blob`: el servidor ya manda el
 * archivo como adjunto con su nombre, así que el navegador lo descarga sin que
 * esta pantalla tenga que leer ni volver a construir el JSON. Importar sí pasa
 * por aquí, porque hay que leer el archivo elegido y enseñar qué se fusionó.
 *
 * La importación no reemplaza nada: el servidor suma las marcas que no estaban y
 * cuenta las referencias que esta instalación no conoce. Por eso el resultado se
 * dice con cifras y no con un «hecho»: un archivo restaurado en otra instalación
 * puede dejar fichas fuera, y callarlo haría creer que está todo.
 */

import { type ProfileImportResponse, profileImportResponseSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { Download } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { apiPostJson } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'

/** La ruta que descarga el archivo; el servidor pone el nombre y el tipo. */
export const PROFILE_EXPORT_PATH = '/api/profile/export'

/** La ruta que fusiona un archivo exportado. */
export const PROFILE_IMPORT_PATH = '/api/profile/import'

type Estado = 'idle' | 'reading' | 'done' | 'error'

export interface ProfileImportSummaryProps {
  readonly result: ProfileImportResponse
}

/** El resumen de una importación, sin estado ni peticiones: se puede probar solo. */
export function ProfileImportSummary({ result }: ProfileImportSummaryProps): ReactNode {
  return (
    <p className="field__hint" role="status" aria-live="polite">
      {t(DEFAULT_LOCALE, 'settings.profile.importDone', {
        favorites: result.favorites,
        watched: result.watched,
        planToWatch: result.planToWatch,
        skipped: result.skipped,
      })}
    </p>
  )
}

export function ProfileSettings(): ReactNode {
  const [estado, setEstado] = useState<Estado>('idle')
  const [resumen, setResumen] = useState<ProfileImportResponse | undefined>(undefined)
  const [mensaje, setMensaje] = useState<string | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)

  const ocupado = estado === 'reading'

  const importar = async (archivo: File): Promise<void> => {
    setEstado('reading')
    setResumen(undefined)
    setMensaje(undefined)

    try {
      const texto = await archivo.text()

      // Se analiza aquí sólo para dar un mensaje que se entienda antes de salir a
      // la red; la validación de la forma la hace el servidor con el schema.
      let crudo: unknown
      try {
        crudo = JSON.parse(texto)
      } catch {
        setEstado('error')
        setMensaje(
          t(DEFAULT_LOCALE, 'settings.profile.importFailed', {
            message: t(DEFAULT_LOCALE, 'settings.profile.importInvalid'),
          }),
        )
        return
      }

      const resultado = await apiPostJson(PROFILE_IMPORT_PATH, crudo, profileImportResponseSchema)

      setResumen(resultado)
      setEstado('done')
    } catch (cause) {
      const fallo = describirFallo(cause)
      setEstado('error')
      setMensaje(
        t(DEFAULT_LOCALE, 'settings.profile.importFailed', {
          message: fallo.detalle ?? fallo.tecnico,
        }),
      )
    } finally {
      // El mismo archivo se puede volver a elegir sin cerrar el selector: sin
      // vaciar el campo, el navegador no dispara otro `change` con el mismo nombre.
      if (input.current !== null) input.current.value = ''
    }
  }

  return (
    <section>
      <h3>{t(DEFAULT_LOCALE, 'settings.profile.title')}</h3>
      <p>{t(DEFAULT_LOCALE, 'settings.profile.body')}</p>

      <p className="settings__actions">
        <a className="button" href={PROFILE_EXPORT_PATH} download>
          <Download size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(DEFAULT_LOCALE, 'settings.profile.export')}
        </a>
      </p>
      <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.profile.exportHint')}</p>

      <label className="field" htmlFor="perfil-importar">
        <span className="field__label">{t(DEFAULT_LOCALE, 'settings.profile.import')}</span>
        <input
          ref={input}
          id="perfil-importar"
          className="field__input"
          type="file"
          accept="application/json,.json"
          disabled={ocupado}
          aria-describedby="perfil-importar-ayuda"
          onChange={(event) => {
            const archivo = event.target.files?.[0]
            if (archivo !== undefined) void importar(archivo)
          }}
        />
        <span className="field__hint" id="perfil-importar-ayuda">
          {t(DEFAULT_LOCALE, 'settings.profile.importHint')}
        </span>
      </label>

      {ocupado ? (
        <p className="field__hint" role="status">
          {t(DEFAULT_LOCALE, 'settings.profile.importing')}
        </p>
      ) : null}

      {estado === 'done' && resumen !== undefined ? (
        <ProfileImportSummary result={resumen} />
      ) : null}

      {estado === 'error' && mensaje !== undefined ? (
        <p className="search__error" role="alert">
          {mensaje}
        </p>
      ) : null}
    </section>
  )
}
