/**
 * El selector de carpeta dentro de la aplicación.
 *
 * El navegador no puede abrir el diálogo de carpetas del sistema —ni
 * `showDirectoryPicker` devuelve una ruta, ni `<input webkitdirectory>` sale de
 * nombres relativos—, así que este diálogo navega con `GET /api/downloads/dirs`:
 * enseña las carpetas de una ruta, deja entrar en una y elegir la que se está
 * viendo. Es el mismo gesto que el diálogo del escritorio —mirar y pulsar—, sin
 * escribir una ruta a mano.
 *
 * Es el `<dialog>` nativo, como el aviso de seguridad: el navegador pone el foco
 * atrapado, `Esc` y el fondo inerte. Un `div` con `role="dialog"` es justo el
 * camino por el que se cuelan los modales inaccesibles.
 */

import { type DownloadsDirs, downloadsDirsSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { apiGet } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { t } from '../../i18n'

const LOCALE = DEFAULT_LOCALE

const LISTADO = '/api/downloads/dirs'

/**
 * La ruta que se le pide al servidor.
 *
 * La ruta viaja en la consulta y no en el cuerpo porque es una lectura: así se
 * cachea por URL y el servidor la recibe igual en un `GET`. `encodeURIComponent`
 * no es adorno: un nombre con `#`, `&` o un espacio se comería la mitad de la
 * ruta, y en Windows sobra con una carpeta llamada «Temporada #2».
 */
export function rutaDeListado(path: string | undefined): string {
  return path === undefined ? LISTADO : `${LISTADO}?path=${encodeURIComponent(path)}`
}

export interface DirectoryPickerProps {
  readonly open: boolean
  /** De dónde abre; sin esto el servidor arranca en la raíz de descargas. */
  readonly start: string | undefined
  readonly onClose: () => void
  /** La carpeta elegida. Se aplica al momento, como el diálogo del sistema. */
  readonly onChoose: (path: string) => Promise<void>
}

export function DirectoryPicker(props: DirectoryPickerProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const [listado, setListado] = useState<DownloadsDirs | undefined>(undefined)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const cargar = useCallback(async (path: string | undefined): Promise<void> => {
    setCargando(true)
    setError(undefined)

    try {
      setListado(await apiGet(rutaDeListado(path), downloadsDirsSchema))
    } catch (cause) {
      const fallo = describirFallo(cause)
      setError(fallo.detalle ?? fallo.tecnico)
    } finally {
      setCargando(false)
    }
  }, [])

  // `showModal` y no el atributo `open`: el atributo pinta el diálogo pero no lo
  // hace modal, y sin modal no hay foco atrapado ni `Esc`.
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return

    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  }, [props.open])

  // Al abrir se relee siempre: entre una vez y la siguiente el usuario pudo
  // crear carpetas, y enseñar una lista vieja es peor que tardar un instante.
  useEffect(() => {
    if (!props.open) return
    void cargar(props.start)
  }, [props.open, props.start, cargar])

  // El clic en el fondo llega con el propio diálogo como destino; dentro, el
  // destino es siempre un hijo. Cerrar con el teclado ya es `Esc`, del navegador.
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return

    const enFondo = (event: MouseEvent): void => {
      if (event.target === dialog) props.onClose()
    }

    dialog.addEventListener('click', enFondo)
    return () => dialog.removeEventListener('click', enFondo)
  }, [props.onClose])

  const elegir = async (): Promise<void> => {
    if (listado === undefined) return

    setGuardando(true)
    setError(undefined)

    try {
      await props.onChoose(listado.path)
      props.onClose()
    } catch (cause) {
      const fallo = describirFallo(cause)
      setError(fallo.detalle ?? fallo.tecnico)
    } finally {
      setGuardando(false)
    }
  }

  const ocupado = cargando || guardando
  const padre = listado?.parent ?? undefined
  const listo = listado !== undefined

  return (
    <dialog ref={ref} className="notice" aria-labelledby="picker-title" onClose={props.onClose}>
      <header className="notice__head">
        <h2 id="picker-title" className="notice__title">
          {t(LOCALE, 'downloads.picker.title')}
        </h2>
        <button type="button" className="notice__close" onClick={props.onClose}>
          {t(LOCALE, 'downloads.picker.close')}
        </button>
      </header>

      <div className="notice__body">
        <p className="picker__path">{listado?.path ?? t(LOCALE, 'downloads.picker.loading')}</p>

        {error === undefined ? null : (
          <p className="downloads__error" role="alert">
            {t(LOCALE, 'downloads.picker.error', { message: error })}
          </p>
        )}

        <div className="picker__actions">
          {padre === undefined ? null : (
            <button
              type="button"
              className="button"
              disabled={ocupado}
              onClick={() => void cargar(padre)}
            >
              {t(LOCALE, 'downloads.picker.up')}
            </button>
          )}
          {(listado?.volumes ?? []).map((unidad) => (
            <button
              key={unidad}
              type="button"
              className="button"
              disabled={ocupado}
              onClick={() => void cargar(unidad)}
            >
              {unidad}
            </button>
          ))}
        </div>

        {listado === undefined || cargando ? (
          <p className="empty" aria-live="polite">
            {t(LOCALE, 'downloads.picker.loading')}
          </p>
        ) : listado.dirs.length === 0 ? (
          <p className="empty">{t(LOCALE, 'downloads.picker.empty')}</p>
        ) : (
          <ul className="picker__list">
            {listado.dirs.map((entrada) => (
              <li key={entrada.path}>
                <button
                  type="button"
                  className="picker__item"
                  disabled={ocupado}
                  onClick={() => void cargar(entrada.path)}
                >
                  {entrada.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="notice__foot">
        <button
          type="button"
          className="button button--primary"
          disabled={!listo || ocupado}
          onClick={() => void elegir()}
        >
          {t(LOCALE, 'downloads.picker.choose')}
        </button>
      </footer>
    </dialog>
  )
}
