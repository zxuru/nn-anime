/**
 * Enrutado del lado del cliente, sin dependencias.
 *
 * El enrutador se apoya en una abstracción de historial en lugar de `window`
 * directo. En el navegador se usa el historial real; en los tests, uno en
 * memoria. Así la lógica de rutas se verifica sin un DOM.
 *
 * Cambiar de ruta no recarga la página: es un requisito del spec, no un detalle.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'

export type RouteName = 'home' | 'search' | 'detail' | 'watch' | 'settings' | 'not-found'

export interface RouteMatch {
  readonly name: RouteName
  readonly params: Readonly<Record<string, string>>
}

interface RoutePattern {
  readonly name: RouteName
  readonly segments: readonly string[]
}

const PATTERNS: readonly RoutePattern[] = [
  { name: 'home', segments: [] },
  { name: 'search', segments: ['search'] },
  { name: 'detail', segments: ['anime', ':providerId', ':ref'] },
  { name: 'watch', segments: ['watch', ':providerId', ':ref'] },
  { name: 'settings', segments: ['settings'] },
]

function split(path: string): readonly string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
}

/** Empareja una ruta con su patrón. Lo desconocido es `not-found`, no un error. */
export function matchRoute(rawPath: string): RouteMatch {
  const segments = split(rawPath.split('?')[0] ?? '')

  for (const pattern of PATTERNS) {
    if (pattern.segments.length !== segments.length) continue

    const params: Record<string, string> = {}
    let matched = true

    for (const [index, expected] of pattern.segments.entries()) {
      const actual = segments[index] ?? ''

      if (expected.startsWith(':')) {
        if (actual === '') {
          matched = false
          break
        }
        params[expected.slice(1)] = decodeURIComponent(actual)
        continue
      }

      if (expected !== actual) {
        matched = false
        break
      }
    }

    if (matched) return { name: pattern.name, params }
  }

  return { name: 'not-found', params: {} }
}

/** Construye la ruta de un nombre y sus parámetros, con codificación de URL. */
export function buildPath(name: RouteName, params: Readonly<Record<string, string>> = {}): string {
  const pattern = PATTERNS.find((candidate) => candidate.name === name)
  if (pattern === undefined || pattern.segments.length === 0) return '/'

  const built = pattern.segments.map((segment) =>
    segment.startsWith(':') ? encodeURIComponent(params[segment.slice(1)] ?? '') : segment,
  )

  return `/${built.join('/')}`
}

export interface History {
  /** Ruta actual, con la consulta incluida. */
  readonly path: string
  push(to: string): void
  replace(to: string): void
  subscribe(listener: () => void): () => void
}

export function createMemoryHistory(initial = '/'): History {
  let current = initial
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  return {
    get path(): string {
      return current
    },
    push(to: string): void {
      current = to
      notify()
    },
    replace(to: string): void {
      current = to
      notify()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function createBrowserHistory(): History {
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  // El botón de atrás del navegador también mueve la aplicación.
  window.addEventListener('popstate', notify)

  return {
    get path(): string {
      return `${window.location.pathname}${window.location.search}`
    },
    push(to: string): void {
      window.history.pushState(null, '', to)
      notify()
    },
    replace(to: string): void {
      window.history.replaceState(null, '', to)
      notify()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const HistoryContext = createContext<History | undefined>(undefined)

export function HistoryProvider(props: {
  readonly history: History
  readonly children: ReactNode
}): ReactNode {
  return <HistoryContext.Provider value={props.history}>{props.children}</HistoryContext.Provider>
}

function useHistory(): History {
  const history = useContext(HistoryContext)
  if (history === undefined) throw new Error('falta HistoryProvider')
  return history
}

/**
 * Ruta actual, reactiva a los cambios del historial.
 *
 * El tercer argumento de `useSyncExternalStore` es el que permite renderizar en
 * servidor, y es lo que hace que los componentes se puedan comprobar con
 * `renderToString` sin necesidad de un DOM. Para el historial en memoria, la
 * ruta es la misma en servidor y en cliente.
 */
export function usePath(): string {
  const history = useHistory()
  const readPath = useCallback(() => history.path, [history])

  return useSyncExternalStore(
    useCallback((listener: () => void) => history.subscribe(listener), [history]),
    readPath,
    readPath,
  )
}

export interface Navigate {
  push(to: string): void
  replace(to: string): void
}

/**
 * Navegación programática.
 *
 * Una página que cambia la dirección sin cambiar de pantalla —la búsqueda, que
 * escribe `?q=` mientras el usuario teclea— no puede usar un `Link`: necesita
 * `replace`, para no llenar el historial con una entrada por pulsación.
 */
export function useNavigate(): Navigate {
  const history = useHistory()

  return useMemo(
    () => ({
      push: (to: string) => history.push(to),
      replace: (to: string) => history.replace(to),
    }),
    [history],
  )
}

export function useRoute(): RouteMatch {
  const path = usePath()

  return useMemo(() => matchRoute(path), [path])
}

export interface LinkProps {
  readonly to: string
  readonly children: ReactNode
  readonly className?: string
  readonly title?: string
  /**
   * El nombre accesible, cuando el texto visible no basta.
   *
   * El enlace de episodio dice «Anterior» para que la fila sea compacta, y quien
   * no ve la pantalla necesita oír «Episodio anterior»: el rótulo corto depende
   * del contexto que el ojo tiene delante y un lector de pantalla no da.
   */
  readonly ariaLabel?: string
  readonly onNavigate?: () => void
  /**
   * Sucesos del puntero.
   *
   * Existen para la precarga del detalle: al pasar por encima de una tarjeta se
   * pide su ficha, y al salir se cancela. La navegación por teclado no los
   * necesita, y por eso no se usa el foco para lo mismo.
   */
  readonly onMouseEnter?: () => void
  readonly onMouseLeave?: () => void
}

/**
 * Enlace de la aplicación.
 *
 * Es un `<a href>` de verdad: funciona con el botón central, con «abrir en una
 * pestaña nueva» y sin JavaScript. La navegación sin recarga se añade encima.
 */
export function Link(props: LinkProps): ReactNode {
  const history = useHistory()

  return (
    <a
      href={props.to}
      className={props.className}
      title={props.title}
      aria-label={props.ariaLabel}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onClick={(event) => {
        if (event.defaultPrevented) return
        if (event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

        event.preventDefault()
        history.push(props.to)
        props.onNavigate?.()
      }}
    >
      {props.children}
    </a>
  )
}
