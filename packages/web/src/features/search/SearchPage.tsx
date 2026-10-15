/**
 * Página de búsqueda.
 *
 * Cuatro decisiones que se ven en el código:
 *
 * 1. **La consulta y el filtro viven en la dirección** (`?q=` y `?provider=`).
 *    Así se puede recargar, compartir o volver atrás, y el filtro que
 *    `--provider` pone en la dirección de arranque tiene por dónde llegar.
 * 2. **Se escribe con `replace`**, no con `push`: una entrada de historial por
 *    pulsación convertiría el botón «atrás» en un borrado letra a letra.
 * 3. **El retardo es de 400 ms** del spec: sin él, cada tecla sería una petición
 *    a cada proveedor, que son sitios de terceros.
 * 4. **Los resultados se pintan según llegan**, con un esqueleto por proveedor
 *    pendiente. Esperar a que respondan todos para pintar el primero es lo que
 *    el spec prohíbe, y es lo que hace sentir lenta una búsqueda.
 *
 * La región de resultados es `aria-live="polite"`: quien no ve la pantalla se
 * entera del recuento cuando el flujo cierra, en lugar de quedarse sin saber si
 * la búsqueda terminó.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { resumenDeFallo } from '../../components/ErrorNotice'
import { Grid, GridItem } from '../../components/Grid'
import { t } from '../../i18n'
import { useNavigate, usePath } from '../../router'
import {
  enElTipo,
  fuenteDeResumen,
  pathConTipo,
  sinFuenteQueSirva,
  tipoFromPath,
  useMedias,
} from '../tipo/tipo'
import { ResultGrid } from './ResultGrid'
import {
  createDefaultPrefetcher,
  groupResults,
  type Prefetcher,
  type SearchState,
  useProviderPriority,
  useSearchStream,
} from './useSearchStream'

/** Retardo del spec entre la última tecla y la petición. */
export const SEARCH_DEBOUNCE_MS = 400

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

/** El filtro de proveedores de la ruta: `?provider=a&provider=b`. */
export function providersFromPath(path: string): readonly string[] {
  const consulta = path.split('?')[1] ?? ''

  return new URLSearchParams(consulta).getAll('provider')
}

/** La ruta de búsqueda de un término, conservando el filtro de proveedor. */
export function searchPath(term: string, providers: readonly string[] = []): string {
  const partes: string[] = []
  const limpio = term.trim()
  if (limpio !== '') partes.push(`q=${encodeURIComponent(limpio)}`)
  for (const provider of providers) partes.push(`provider=${encodeURIComponent(provider)}`)

  // Se compone a mano y no con `URLSearchParams` porque ése escribe los espacios
  // como `+`, y la dirección de arranque del CLI los escribe como `%20`. Dos
  // convenciones para lo mismo dan dos claves de caché para la misma búsqueda.
  return partes.length === 0 ? '/search' : `/search?${partes.join('&')}`
}

/**
 * Anuncio para la región `aria-live`.
 *
 * Sólo habla cuando el flujo cierra: anunciar cada proveedor según llega
 * convertiría la búsqueda en una locución interminable. Y si no hay ninguno
 * activo lo dice, porque el silencio no distingue «todavía no» de «no hay nada».
 *
 * El recuento es de **obras**, no de respuestas: con cuatro tarjetas en pantalla,
 * decir «trece resultados» porque dos proveedores devolvieron lo mismo es
 * contar lo que no se ve.
 */
export function announce(
  state: SearchState,
  active: readonly string[],
  providersLoaded = true,
): string {
  if (state.failed !== undefined) {
    // El resumen y no el mensaje crudo: esto lo lee un lector de pantalla, y
    // «GET /api/search?q=a respondió 500» no informa de nada.
    return t(DEFAULT_LOCALE, 'search.failed', { message: resumenDeFallo(state.failed) })
  }

  if (!state.done) {
    // Sin saber todavía qué proveedores hay, decir «no hay ninguno» sería
    // afirmar algo que aún no se sabe.
    if (!providersLoaded) return t(DEFAULT_LOCALE, 'search.loading')

    return active.length === 0
      ? t(DEFAULT_LOCALE, 'search.noProviders')
      : t(DEFAULT_LOCALE, 'search.loading')
  }

  const obras = groupResults(state.results).length
  const clave = obras === 1 ? 'search.resultsCountOne' : 'search.resultsCount'

  return t(DEFAULT_LOCALE, clave, {
    count: obras,
    providers: new Set(state.results.map((result) => result.ref.providerId)).size,
  })
}

export interface SearchPageProps {
  /** Se inyecta en los tests; en producción, la precarga real. */
  readonly prefetcher?: Prefetcher
}

export function SearchPage(props: SearchPageProps): ReactNode {
  const path = usePath()
  const navigate = useNavigate()
  const filtro = providersFromPath(path).join(',')
  const tipo = tipoFromPath(path)

  const [term, setTerm] = useState(() => queryFromPath(path))
  const [aplicado, setAplicado] = useState(term)

  const proveedores = useMemo(() => (filtro === '' ? [] : filtro.split(',')), [filtro])
  const { state, active, labels, providersLoaded } = useSearchStream(aplicado, proveedores, tipo)
  // La preferencia decide cuál de las fuentes da la tarjeta. Llega después que
  // los resultados —es otra petición— y la rejilla se vuelve a ordenar sola.
  const prioridad = useProviderPriority()
  const prefetch = useMemo(() => props.prefetcher ?? createDefaultPrefetcher(), [props.prefetcher])
  const medias = useMedias()

  /*
    Lo que llega de una fuente que sirve las dos cosas viene mezclado: el servidor
    filtra por proveedor, no por título. El reparto se hace aquí sobre el estado
    entero, para que el recuento que se anuncia y las tarjetas que se pintan cuenten
    lo mismo.
  */
  const visibles: SearchState = useMemo(
    () => ({
      ...state,
      results: enElTipo(state.results, tipo, medias, fuenteDeResumen),
    }),
    [state, tipo, medias],
  )

  // El retardo: `aplicado` sólo cambia cuando el usuario deja de teclear.
  useEffect(() => {
    const cancelar = PROGRAMAR(() => setAplicado(term), SEARCH_DEBOUNCE_MS)

    return cancelar
  }, [term])

  // La consulta se refleja en la dirección, sin apilar historial ni perder el filtro
  // ni el tipo.
  useEffect(() => {
    if (queryFromPath(path) === aplicado && providersFromPath(path).join(',') === filtro) return

    navigate.replace(pathConTipo(searchPath(aplicado, proveedores), tipo))
  }, [aplicado, filtro, path, navigate, proveedores, tipo])

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

      <p className="search__status" aria-live="polite">
        {announce(visibles, active, providersLoaded)}
      </p>

      {/*
        Ninguna fuente sirve esta mitad: es lo que convierte una búsqueda que no
        devuelve nada en un problema con solución. El conmutador de la cabecera es la
        otra salida, y con el mapa de fuentes vacío no se avisa —no se sabe todavía—:
        de eso se encarga `sinFuenteQueSirva`.
      */}
      {sinFuenteQueSirva(medias, tipo) ? (
        <p className="aviso-tipo" role="status">
          {t(DEFAULT_LOCALE, tipo === 'movies' ? 'media.empty.movies' : 'media.empty.anime')}{' '}
          {t(DEFAULT_LOCALE, 'media.empty.hint')}
        </p>
      ) : null}

      {state.errors.map((issue) => (
        <p className="search__error" key={issue.providerId}>
          {t(DEFAULT_LOCALE, 'search.providerFailed', {
            provider: labels.get(issue.providerId) ?? issue.providerId,
            message: issue.message,
          })}
        </p>
      ))}

      {state.pending.length > 0 ? (
        <Grid label={t(DEFAULT_LOCALE, 'search.results')}>
          {state.pending.map((providerId) => (
            <GridItem key={providerId}>
              {/* Un esqueleto por proveedor pendiente: lo que falta se ve, en
                  lugar de aparecer de golpe cuando responda el último. */}
              <span className="skeleton" aria-hidden="true" />
            </GridItem>
          ))}
        </Grid>
      ) : null}

      <ResultGrid
        results={visibles.results}
        query={aplicado}
        providerPriority={prioridad}
        providerLabels={labels}
        onPreview={(result) => prefetch.hover(result.ref.providerId, result.ref.value)}
        onPreviewEnd={() => prefetch.leave()}
      />
    </section>
  )
}
