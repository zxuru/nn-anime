/**
 * Página de búsqueda.
 *
 * Tres decisiones que se ven en el código:
 *
 * 1. **La consulta vive en la dirección** (`?q=`), no sólo en el estado del
 *    componente. Así se puede recargar, compartir o volver atrás, y el filtro
 *    que `--provider` pone en la dirección de arranque tiene por dónde llegar.
 * 2. **Se escribe con `replace`, no con `push`**: una entrada de historial por
 *    pulsación convertiría el botón «atrás» en un borrado letra a letra.
 * 3. **El retardo es de 400 ms** del spec: sin él, cada tecla sería una petición
 *    a cada proveedor, que son sitios de terceros.
 *
 * Los eventos del stream se validan con el schema compartido de `core`, no con
 * uno local: si el server cambia una forma, esto falla aquí y no tres pantallas
 * más adelante.
 */

import { searchEventSchema } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { SearchResult } from '@nn-anime/core/models'
import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { useNavigate, usePath } from '../../router'
import { ResultGrid } from './ResultGrid'

/** Retardo del spec entre la última tecla y la petición. */
export const SEARCH_DEBOUNCE_MS = 400

/** Firma de una búsqueda: se inyecta en los tests para no salir a la red. */
export type SearchFn = (query: string, signal: AbortSignal) => Promise<readonly SearchResult[]>

/** Programa algo y devuelve cómo cancelarlo, sustituyendo lo programado antes. */
export type Schedule = (run: () => void, ms: number) => () => void

/**
 * Programador con un solo temporizador vivo.
 *
 * Es la parte del retardo que se puede probar sin un DOM: que programar dos
 * veces seguidas cancele lo anterior es exactamente lo que hace que el retardo
 * sea un retardo y no una petición por tecla.
 */
export function createScheduler<Handle>(
  setTimer: (run: () => void, ms: number) => Handle,
  clearTimer: (handle: Handle) => void,
): Schedule {
  let cancelar: (() => void) | undefined

  return (run, ms) => {
    cancelar?.()
    const temporizador = setTimer(run, ms)
    cancelar = () => clearTimer(temporizador)

    return cancelar
  }
}

const PROGRAMAR = createScheduler(setTimeout, clearTimeout)

/** El término de búsqueda que hay en una ruta, si hay alguno. */
export function queryFromPath(path: string): string {
  const consulta = path.split('?')[1] ?? ''

  return new URLSearchParams(consulta).get('q') ?? ''
}

/** La ruta de búsqueda de un término. Sin término, la pantalla a secas. */
export function searchPath(term: string): string {
  const limpio = term.trim()

  return limpio === '' ? '/search' : `/search?q=${encodeURIComponent(limpio)}`
}

/**
 * Eventos de un cuerpo SSE.
 *
 * Se parte por doble salto de línea, como manda el formato, y se descarta lo que
 * no cumpla el schema: un evento ilegible no puede tumbar la lista entera.
 */
export function parseSearchStream(text: string): readonly SearchResult[] {
  const resultados: SearchResult[] = []

  for (const bloque of text.split('\n\n')) {
    const data = bloque
      .split('\n')
      .filter((linea) => linea.startsWith('data:'))
      .map((linea) => linea.slice(5).trim())
      .join('\n')

    if (data === '') continue

    let crudo: unknown
    try {
      crudo = JSON.parse(data)
    } catch {
      continue
    }

    const evento = searchEventSchema.safeParse(crudo)
    if (evento.success && evento.data.type === 'results') resultados.push(...evento.data.results)
  }

  return resultados
}

/** Búsqueda real: pide el stream y se queda con los resultados. */
export async function fetchSearch(
  query: string,
  signal: AbortSignal,
): Promise<readonly SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
    credentials: 'same-origin',
    headers: { accept: 'text/event-stream' },
    signal,
  })

  if (!response.ok) throw new Error(`la búsqueda respondió ${response.status}`)

  return parseSearchStream(await response.text())
}

export interface SearchPageProps {
  readonly search?: SearchFn
  readonly providerLabels?: ReadonlyMap<string, string>
}

export function SearchPage(props: SearchPageProps): ReactNode {
  const path = usePath()
  const navigate = useNavigate()
  const busqueda = props.search ?? fetchSearch

  const [term, setTerm] = useState(() => queryFromPath(path))
  const [aplicado, setAplicado] = useState(term)
  const [resultados, setResultados] = useState<readonly SearchResult[]>([])
  const [buscando, setBuscando] = useState(false)

  // El retardo: `aplicado` sólo cambia cuando el usuario deja de teclear.
  useEffect(() => {
    const cancelar = PROGRAMAR(() => setAplicado(term), SEARCH_DEBOUNCE_MS)

    return cancelar
  }, [term])

  // La consulta se refleja en la dirección, sin apilar historial.
  useEffect(() => {
    if (queryFromPath(path) === aplicado) return

    navigate.replace(searchPath(aplicado))
  }, [aplicado, path, navigate])

  useEffect(() => {
    const controlador = new AbortController()
    setBuscando(true)

    busqueda(aplicado, controlador.signal).then(
      (encontrados) => {
        if (controlador.signal.aborted) return
        setResultados(encontrados)
        setBuscando(false)
      },
      () => {
        if (controlador.signal.aborted) return
        setResultados([])
        setBuscando(false)
      },
    )

    // Cambiar la consulta cancela la petición anterior: sus eventos ya no valen.
    return () => controlador.abort()
  }, [aplicado, busqueda])

  return (
    <section>
      <h1>{t(DEFAULT_LOCALE, 'search.title')}</h1>
      <div className="search__field">
        <label className="search__label" htmlFor="search-term">
          {t(DEFAULT_LOCALE, 'search.field')}
        </label>
        <input
          id="search-term"
          className="search__input"
          type="search"
          value={term}
          placeholder={t(DEFAULT_LOCALE, 'search.placeholder')}
          autoComplete="off"
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      {buscando ? <p className="empty">{t(DEFAULT_LOCALE, 'search.loading')}</p> : null}

      <ResultGrid
        results={resultados}
        query={aplicado}
        {...(props.providerLabels === undefined ? {} : { providerLabels: props.providerLabels })}
      />
    </section>
  )
}
