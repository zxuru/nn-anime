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

export type RouteName =
  | 'home'
  | 'search'
  | 'detail'
  | 'watch'
  | 'settings'
  | 'profile'
  | 'history'
  | 'library'
  | 'library-player'
  /**
   * La dirección vieja de la biblioteca. Se conserva como alias para que un
   * marcador o un enlace de una versión anterior no acabe en «esa ruta no
   * existe»; la navegación ya no la usa.
   */
  | 'downloads'
  | 'not-found'

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
  // El Perfil y su Historial son pantallas propias: el Perfil reúne las listas del
  // usuario y el Historial es la que pagina. Van antes de `settings` sólo por orden
  // de lectura; el emparejamiento es por número de segmentos y nombre exacto, así
  // que el orden entre patrones de distinta longitud no decide nada.
  { name: 'profile', segments: ['profile'] },
  { name: 'history', segments: ['history'] },
  { name: 'library', segments: ['library'] },
  { name: 'library-player', segments: ['library', ':id'] },
  // Alias de la dirección vieja: misma pantalla, otra ruta. Va después de
  // `library` para que construir la ruta nueva no devuelva la vieja.
  { name: 'downloads', segments: ['downloads'] },
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
  /**
   * Lo que viaja con la entrada actual, si algo viaja.
   *
   * Es lo que permite pintar la ficha antes de pedirla: la tarjeta de origen ya
   * conoce el título y la portada, y los deja aquí al navegar. Es `unknown` a
   * propósito —una entrada de historial es un sitio donde cualquiera puede haber
   * escrito cualquier cosa— y quien la use la valida antes de pintarla.
   */
  readonly state: unknown
  push(to: string, state?: unknown): void
  replace(to: string, state?: unknown): void
  /** Vuelve a la entrada anterior. Sin historial detrás, no hace nada. */
  back(): void
  subscribe(listener: () => void): () => void
}

interface Entrada {
  readonly path: string
  readonly state: unknown
}

export function createMemoryHistory(initial = '/', initialState?: unknown): History {
  const entradas: Entrada[] = [{ path: initial, state: initialState }]
  let actual = 0
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  return {
    get path(): string {
      return entradas[actual]?.path ?? initial
    },
    get state(): unknown {
      return entradas[actual]?.state
    },
    push(to: string, state?: unknown): void {
      // Lo que quedaba delante deja de existir: empujar después de ir atrás
      // descarta la rama, como el historial del navegador.
      entradas.splice(actual + 1)
      entradas.push({ path: to, state })
      actual = entradas.length - 1
      notify()
    },
    replace(to: string, state?: unknown): void {
      entradas[actual] = { path: to, state }
      notify()
    },
    back(): void {
      if (actual === 0) return

      actual -= 1
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
    get state(): unknown {
      return window.history.state
    },
    push(to: string, state?: unknown): void {
      window.history.pushState(state ?? null, '', to)
      notify()
    },
    replace(to: string, state?: unknown): void {
      window.history.replaceState(state ?? null, '', to)
      notify()
    },
    back(): void {
      window.history.back()
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
  push(to: string, state?: unknown): void
  replace(to: string, state?: unknown): void
  back(): void
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
      push: (to: string, state?: unknown) => history.push(to, state),
      replace: (to: string, state?: unknown) => history.replace(to, state),
      back: () => history.back(),
    }),
    [history],
  )
}

/**
 * Los datos que viajan con la entrada actual.
 *
 * Se leen del historial y se validan en el componente que los usa: aquí no se
 * sabe qué forma tiene la ficha, y quien navega puede haber dejado cualquier
 * cosa. Es reactivo porque la entrada cambia con el botón de atrás.
 */
export function useNavigationState(): unknown {
  const history = useHistory()
  const readState = useCallback(() => history.state, [history])

  return useSyncExternalStore(
    useCallback((listener: () => void) => history.subscribe(listener), [history]),
    readState,
    readState,
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
  /**
   * Qué elemento es el actual de un conjunto, cuando lo es.
   *
   * Es lo que marca el episodio que se está viendo en la lista: un enlace al que
   * ya estás no se distingue de los demás por el texto, y para quien no ve la
   * pantalla el color no existe.
   */
  readonly ariaCurrent?: 'page' | undefined
  readonly onNavigate?: () => void
  /**
   * Lo que viaja con la entrada al navegar.
   *
   * La tarjeta de origen deja aquí lo que ya sabe de la ficha —título y portada—
   * para que la pantalla de destino la pinte antes de pedirla. No sustituye a
   * los datos del servidor: es un adelanto. Va como `unknown` y lo valida quien
   * lo lee.
   */
  readonly state?: unknown
  /**
   * Sucesos del puntero.
   *
   * Existen para la precarga del detalle: al pasar por encima de una tarjeta se
   * pide su ficha, y al salir se cancela. La navegación por teclado no los
   * necesita, y por eso no se usa el foco para lo mismo. Los `onPointer*` son los
   * que usa la precarga nueva —también cubren el dedo en el móvil—; los de ratón
   * se conservan porque la búsqueda ya los usaba con su propio precargador.
   */
  readonly onMouseEnter?: () => void
  readonly onMouseLeave?: () => void
  readonly onPointerEnter?: () => void
  readonly onPointerLeave?: () => void
  readonly onPointerDown?: () => void
  /**
   * El ancla de la guía.
   *
   * Un paso de driver.js busca `[data-tour="…"]`, y este enlace es el destino
   * que la bienvenida señala. Va como prop y no como atributo suelto porque
   * `LinkProps` no declara atributos arbitrarios y TypeScript los rechazaría.
   */
  readonly dataTour?: string
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
      aria-current={props.ariaCurrent}
      data-tour={props.dataTour}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onPointerDown={props.onPointerDown}
      onClick={(event) => {
        if (event.defaultPrevented) return
        if (event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

        event.preventDefault()
        history.push(props.to, props.state)
        props.onNavigate?.()
      }}
    >
      {props.children}
    </a>
  )
}
