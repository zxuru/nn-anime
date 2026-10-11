/**
 * El aviso de seguridad, dentro de la aplicación.
 *
 * El documento vive en la raíz del repo y `/settings` lo enlazaba: el usuario
 * salía de la aplicación para leer lo que tiene que leer **antes** de copiar un
 * plugin. Peor: apuntaba a un archivo que no estaba en el build, así que el
 * enlace caía al `index.html` y parecía recargar la página.
 *
 * Aquí el mismo documento se lee en un diálogo, sin salir de la aplicación y sin
 * duplicar el texto: el markdown llega de `/SECURITY.md`, que es el archivo del
 * repo. El enlace al documento original se queda, al pie, para quien lo quiera
 * entero o quiera citarlo.
 *
 * El diálogo es el `<dialog>` nativo: el navegador se encarga del foco, de `Esc`
 * y de que lo de detrás no sea tabulable. Reproducir eso a mano con un `div` es
 * justo el camino por el que se cuelan los modales inaccesibles.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { Fragment, type ReactNode, useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { type Block, type Inline, parseNotice } from './notice-markdown'

/** El texto de unos tramos, sin marcas. Es lo que sirve de clave estable. */
function plain(spans: readonly Inline[]): string {
  return spans.map((span) => span.value).join('')
}

/**
 * Claves sin recurrir al índice de la lista.
 *
 * El documento no se reordena, pero una clave por posición es la clase de
 * detalle que se pudre solo: el día que un bloque se reutilice en otro sitio, el
 * índice deja de identificar nada. El texto, con su repetición contada, sí.
 */
function keyer(): (value: string) => string {
  const seen = new Map<string, number>()

  return (value) => {
    const count = (seen.get(value) ?? 0) + 1
    seen.set(value, count)

    return `${value}#${count}`
  }
}

function spans(spans: readonly Inline[], keyFor: (value: string) => string): ReactNode {
  return spans.map((span) => {
    const key = keyFor(`${span.kind}:${span.value}`)

    if (span.kind === 'strong') return <strong key={key}>{span.value}</strong>
    if (span.kind === 'code') return <code key={key}>{span.value}</code>

    return <Fragment key={key}>{span.value}</Fragment>
  })
}

/** El nivel del documento, bajado dos: el diálogo ya tiene su propio título. */
function headingFor(level: number, content: ReactNode, key: string): ReactNode {
  if (level <= 1) return <h3 key={key}>{content}</h3>
  if (level === 2) return <h4 key={key}>{content}</h4>

  return <h5 key={key}>{content}</h5>
}

function blockFor(node: Block, keyFor: (value: string) => string): ReactNode {
  const key = keyFor(node.kind)

  if (node.kind === 'heading') return headingFor(node.level, spans(node.spans, keyFor), key)

  if (node.kind === 'paragraph') return <p key={key}>{spans(node.spans, keyFor)}</p>

  if (node.kind === 'list') {
    const items = node.items.map((item) => <li key={keyFor(plain(item))}>{spans(item, keyFor)}</li>)

    return node.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
  }

  // La tabla del modelo de amenaza es ancha: el texto se envuelve dentro de sus
  // celdas, así que no hace falta un contenedor con desplazamiento propio —y un
  // contenedor con `tabindex` habría que hacerlo alcanzable con el teclado—.
  return (
    <table className="notice__table" key={key}>
      <thead>
        <tr>
          {node.head.map((cell) => (
            <th key={keyFor(plain(cell))} scope="col">
              {spans(cell, keyFor)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {node.rows.map((row) => (
          <tr key={keyFor(row.map(plain).join('|'))}>
            {row.map((cell) => (
              <td key={keyFor(plain(cell))}>{spans(cell, keyFor)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** El documento, ya en elementos. Sin `dangerouslySetInnerHTML` en ningún sitio. */
export function SecurityNotice({ markdown }: { readonly markdown: string }): ReactNode {
  const keyFor = keyer()

  return parseNotice(markdown).map((node) => blockFor(node, keyFor))
}

export interface SecurityNoticeDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  /** El documento ya descargado, o `undefined` mientras se pide. */
  readonly markdown?: string | undefined
  /** El motivo por el que no llegó, si no llegó. */
  readonly error?: string | undefined
}

export function SecurityNoticeDialog({
  open,
  onClose,
  markdown,
  error,
}: SecurityNoticeDialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null)

  // `showModal` y no el atributo `open`: el atributo pinta el diálogo pero no lo
  // hace modal —ni foco atrapado, ni `Esc`, ni fondo inerte—.
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // El clic en el fondo llega con el propio diálogo como destino: dentro, el
  // destino es siempre un hijo. Se escucha aquí y no con `onClick` en el JSX
  // porque el fondo no es un elemento interactivo y no tiene equivalente de
  // teclado que declarar: cerrar con el teclado ya es `Esc`, que es del navegador.
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return

    const enFondo = (event: MouseEvent): void => {
      if (event.target === dialog) onClose()
    }

    dialog.addEventListener('click', enFondo)
    return () => dialog.removeEventListener('click', enFondo)
  }, [onClose])

  return (
    <dialog ref={ref} className="notice" aria-labelledby="security-notice-title" onClose={onClose}>
      <header className="notice__head">
        <h2 id="security-notice-title" className="notice__title">
          {t(DEFAULT_LOCALE, 'settings.security.title')}
        </h2>
        <button type="button" className="notice__close" onClick={onClose}>
          {t(DEFAULT_LOCALE, 'settings.security.close')}
        </button>
      </header>

      <div className="notice__body">
        {error !== undefined ? (
          <p className="search__error">
            {t(DEFAULT_LOCALE, 'settings.security.error', { message: error })}
          </p>
        ) : markdown === undefined ? (
          <p className="empty" aria-live="polite">
            {t(DEFAULT_LOCALE, 'settings.security.loading')}
          </p>
        ) : (
          <SecurityNotice markdown={markdown} />
        )}
      </div>

      <footer className="notice__foot">
        <a href="/SECURITY.md">{t(DEFAULT_LOCALE, 'settings.security.raw')}</a>
      </footer>
    </dialog>
  )
}
