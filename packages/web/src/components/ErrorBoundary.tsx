/**
 * La red de render.
 *
 * Un `throw` dentro de un componente dejaba la aplicación en blanco: React
 * desmonta el árbol y no hay nada que lo recoja. Esta clase es el único tipo de
 * componente que puede hacerlo, así que vive aparte y envuelve la aplicación
 * entera en `main.tsx`.
 *
 * El fallback ofrece **recargar** —lo único que reconstruye el estado desde
 * cero— y deja el mensaje dentro de un `<details>`: quien no programa no
 * necesita el texto del error delante, y quien lo reporta lo abre. El detalle no
 * se pinta abierto por defecto para que la pantalla no parezca un volcado.
 *
 * Esto es la mitad del criterio de la oleada que se puede hacer aquí: el
 * `onError` del servidor —un 500 con el schema de error y el registro con
 * redacción— es de otro cambio.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'

export interface FalloDeRenderProps {
  readonly error: Error
  /**
   * Qué hace el botón de recarga.
   *
   * Se inyecta en las pruebas para no tocar `window`; en producción es recargar
   * la página, que es lo único que descarta el estado roto.
   */
  readonly onReload?: () => void
}

/** Lo que se pinta cuando el árbol lanzó. */
export function FalloDeRender({ error, onReload }: FalloDeRenderProps): ReactNode {
  return (
    // Las clases del aviso de un fallo —el mismo borde, el mismo título— y una
    // propia para colocarse: la red envuelve la aplicación entera y este aviso
    // no vive dentro de la caja del `main`, que es la que pone el relleno.
    <section className="fallo fallo-render" role="alert">
      <h1 className="fallo__title">{t(DEFAULT_LOCALE, 'renderError.title')}</h1>
      <p className="fallo__body">{t(DEFAULT_LOCALE, 'renderError.body')}</p>
      <p className="fallo__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onReload ?? recargarLaPagina}
        >
          {t(DEFAULT_LOCALE, 'renderError.reload')}
        </button>
      </p>
      {/* Plegado: el mensaje es para quien lo va a reportar, no la primera línea. */}
      <details className="fallo__technical">
        <summary>{t(DEFAULT_LOCALE, 'renderError.details')}</summary>
        <code className="fallo__code">{error.message}</code>
      </details>
    </section>
  )
}

/** Reconstruye la aplicación desde cero: el estado en memoria no se puede arreglar. */
function recargarLaPagina(): void {
  window.location.reload()
}

export interface ErrorBoundaryState {
  readonly fallo: Error | undefined
}

/**
 * La frontera.
 *
 * `getDerivedStateFromError` es lo que convierte el error en estado; el método es
 * estático y se prueba sin montar el árbol. `componentDidCatch` deja el rastro en
 * la consola: sin él, un fallo de render sólo se ve en la cara de quien lo sufre.
 */
export class ErrorBoundary extends Component<{ readonly children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { fallo: undefined }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { fallo: error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // El registro del servidor es otro cambio; aquí queda al menos la consola,
    // que es donde mira quien depura una interfaz.
    console.error('fallo de render', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.fallo !== undefined) return <FalloDeRender error={this.state.fallo} />

    return this.props.children
  }
}
