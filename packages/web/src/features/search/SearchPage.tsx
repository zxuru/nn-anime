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

import { hasGenreToken } from '@nn-anime/core/anilist-search'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { resumenDeFallo } from '../../components/ErrorNotice'
import { Grid, GridItem } from '../../components/Grid'
import { Skeleton } from '../../components/Skeleton'
import { t } from '../../i18n'
import { useNavigate, usePath } from '../../router'
import { ANCLAS } from '../guia/guia'
import {
  enElTipo,
  fuenteDeResumen,
  pathConTipo,
  sinFuenteQueSirva,
  tipoFromPath,
  useMedias,
} from '../tipo/tipo'
import { AniListCards } from './AniListCards'
import { AniListResults } from './AniListResults'
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

/**
 * Cuántos esqueletos se ven mientras no se sabe qué proveedores hay.
 *
 * Es lo que tapa el hueco entre «Buscando…» y la primera respuesta: hasta que
 * `/api/providers` no llega, no hay un `pending` por proveedor del que colgar la
 * rejilla. Cuatro es una primera pantalla; cuando la lista llega, los sustituye
 * un esqueleto por proveedor de verdad.
 *
 * Las claves son fijas y no el índice del bucle: un índice como `key` es lo que
 * rechaza el linter y aquí no hay estado que conservar por celda.
 */
const ESPERA_KEYS = ['espera-1', 'espera-2', 'espera-3', 'espera-4'] as const

export const ESQUELETOS_SIN_PROVEEDORES = ESPERA_KEYS.length

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
 *
 * Las piezas de AniList se cuentan **aparte y también**: una búsqueda por género o
 * por estudio suele no tener nada de los proveedores y sí veinte piezas de AniList
 * en pantalla, y callarlas dejaría al lector de pantalla con un «0 resultados» que
 * no es lo que hay.
 *
 * Con un género en la casilla no hay dos listas: la del catálogo **es** el resultado, y el
 * anuncio lo dice así en vez de contar unos proveedores a los que no se ha preguntado.
 */
export function announce(
  state: SearchState,
  active: readonly string[],
  providersLoaded = true,
  soloCatalogo = false,
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

    return active.length === 0 && !soloCatalogo
      ? t(DEFAULT_LOCALE, 'search.noProviders')
      : t(DEFAULT_LOCALE, 'search.loading')
  }

  if (soloCatalogo) {
    const clave =
      state.anilist.length === 1 ? 'search.catalogue.countOne' : 'search.catalogue.count'

    return t(DEFAULT_LOCALE, clave, { count: state.anilist.length })
  }

  const obras = groupResults(state.results).length
  const clave = obras === 1 ? 'search.resultsCountOne' : 'search.resultsCount'
  const proveedores = t(DEFAULT_LOCALE, clave, {
    count: obras,
    providers: new Set(state.results.map((result) => result.ref.providerId)).size,
  })

  if (state.anilist.length === 0) return proveedores

  return `${proveedores} ${t(DEFAULT_LOCALE, 'search.anilist.announce', {
    count: state.anilist.length,
  })}`
}

/**
 * Si lo que hay en la pantalla permite concluir que no hay nada.
 *
 * Son dos «todavía no»: la búsqueda en vuelo —la respuesta puede estar a punto
 * de llegar— y la búsqueda que no llegó a abrirse, que ya dice su propio
 * anuncio. En los dos, un estado vacío estaría culpando a la consulta del
 * usuario de algo que no es culpa suya. Es la medición del caso que se reportó:
 * abrir `/search?q=<título>` desde otra pantalla decía «Nada coincide» en el
 * mismo instante en que decía «Buscando…».
 */
export function resuelta(state: Pick<SearchState, 'done' | 'failed'>): boolean {
  return state.done && state.failed === undefined
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
  /*
    La consulta aplicada viaja en la precarga: es lo que deja el rastro de la
    búsqueda cuando el puntero se para sobre una tarjeta, antes de abrirla. Al
    cambiar de consulta se rehace el precargador —y con él su tope de precargas—,
    que es lo que se quiere: lo que cuenta es lo que se está buscando ahora.
  */
  const prefetch = useMemo(
    () => props.prefetcher ?? createDefaultPrefetcher(aplicado),
    [props.prefetcher, aplicado],
  )
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

  /*
    Con un género escrito, la búsqueda es del catálogo: a los proveedores no se les
    pregunta y la lista que se pinta es la de AniList, con las tarjetas de la página. La
    regla es la misma que usa el servidor para decidirlo, y vive en `core` por eso: si cada
    lado tuviera la suya, la pantalla pediría una cosa y pintaría otra.
  */
  const soloCatalogo = hasGenreToken(aplicado)
  // Sin la lista de proveedores todavía, no hay pendientes por proveedor: la
  // rejilla de esqueletos se pinta igual, para no dejar la pantalla en una frase.
  const esperandoProveedores = !providersLoaded && aplicado !== '' && !soloCatalogo

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

      <div className="search__field" data-tour={ANCLAS.buscadorCampo}>
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

      <p className="search__status" aria-live="polite" data-tour={ANCLAS.buscadorEstado}>
        {announce(visibles, active, providersLoaded, soloCatalogo)}
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

      {/*
        Con un género en la casilla, la lista del catálogo **es** el resultado: se pinta
        con las tarjetas de siempre, donde estaban las de los proveedores, y a los
        proveedores no se les ha preguntado —buscarían el texto literal—. Sin género, la
        página es la de siempre y la lista del catálogo va debajo, aparte.
      */}
      {soloCatalogo ? (
        <AniListCards items={visibles.anilist} query={aplicado} done={resuelta(visibles)} />
      ) : (
        <>
          {state.pending.length > 0 || esperandoProveedores ? (
            <Grid label={t(DEFAULT_LOCALE, 'search.results')}>
              {state.pending.length > 0
                ? state.pending.map((providerId) => (
                    <GridItem key={providerId}>
                      {/* Un esqueleto por proveedor pendiente: lo que falta se ve,
                          en lugar de aparecer de golpe cuando responda el último. */}
                      <Skeleton h="var(--skeleton-height)" />
                    </GridItem>
                  ))
                : ESPERA_KEYS.slice(0, ESQUELETOS_SIN_PROVEEDORES).map((clave) => (
                    <GridItem key={clave}>
                      {/* Todavía no se sabe a quién se le pregunta: la rejilla
                          existe para que la espera se vea. */}
                      <Skeleton h="var(--skeleton-height)" />
                    </GridItem>
                  ))}
            </Grid>
          ) : null}

          <ResultGrid
            results={visibles.results}
            query={aplicado}
            done={resuelta(visibles)}
            hayAniList={visibles.anilist.length > 0}
            providerPriority={prioridad}
            providerLabels={labels}
            onPreview={(result) => prefetch.hover(result.ref.providerId, result.ref.value)}
            onPreviewEnd={() => prefetch.leave()}
          />

          {/*
            La búsqueda cruzada, debajo de lo de los proveedores. Va aparte y no
            mezclada porque sus piezas no son la respuesta de un proveedor: son lo que
            AniList tiene de ese estudio o de ese género, y cada una dice si está en tus
            fuentes. Es lo que responde cuando lo local se queda corto, que es justo el
            caso de una búsqueda por género o por estudio.
          */}
          <AniListResults items={visibles.anilist} query={aplicado} />
        </>
      )}
    </section>
  )
}
