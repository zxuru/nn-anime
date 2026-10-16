/**
 * La pantalla de la búsqueda de una casilla.
 *
 * Una casilla y una rejilla. El texto lleva el título y los géneros: lo que empieza por `#`
 * es un género —`#slice-of-life`— y lo demás es el título, así que una búsqueda se escribe
 * entera en un sitio: `frieren #fantasy #drama`.
 *
 * Tres decisiones que se ven en el código:
 *
 * 1. **El retardo vive aquí**, no en el gancho: quien tiene la casilla es quien sabe cuándo
 *    el usuario ha dejado de escribir, y el gancho recibe el texto ya quieto.
 * 2. **Los géneros que no existen se dicen**, en un aviso que no bloquea: el servidor los
 *    devuelve porque no los envió, y callarlos sería contestar a otra pregunta sin avisar.
 * 3. **Mientras se busca no se dice que no haya nada.** El estado vacío necesita la
 *    respuesta delante; afirmarlo antes es culpa de la consulta por algo que no se sabe.
 */

import type { AniListSearchItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { t } from '../../i18n'
import { desdeDescubrir, type PiezaVista } from '../home/descubrir'
import { cuentaDeTitulos } from '../home/tramo'
import {
  type AniListFetcher,
  type AniListSearchFailure,
  DEBOUNCE_MS,
  useAniListSearch,
} from './useAniListSearch'

/**
 * La pieza que se pinta: la del descubrimiento más lo que esta búsqueda sabe.
 *
 * El título secundario —el romaji, cuando el que se enseña es el inglés— y los géneros van
 * en la línea de datos: son lo que deja reconocer la obra que la casilla ha encontrado, y
 * sin ellos una búsqueda por género no enseñaría por qué salió cada cosa.
 */
export function piezaDeBusqueda(item: AniListSearchItem): PiezaVista {
  const base = desdeDescubrir(item)
  const partes = [base.meta, item.secondaryTitle, item.genres.join(' · ')].filter(
    (parte): parte is string => parte !== undefined && parte !== '',
  )

  return partes.length === 0 ? base : { ...base, meta: partes.join(' · ') }
}

/** La clave de traducción de un fallo, con lo que haga falta para contarlo. */
export function claveDeFallo(failure: AniListSearchFailure): string {
  switch (failure.kind) {
    case 'network':
      return 'anilist.failed.network'
    case 'timeout':
      return 'anilist.failed.timeout'
    case 'throttled':
      return 'anilist.failed.throttled'
    case 'server':
      return 'anilist.failed.server'
    case 'shape':
      return 'anilist.failed.shape'
  }
}

export interface AniListSearchPageProps {
  /** Se inyecta en las pruebas; en producción, el `fetch` del navegador. */
  readonly fetcher?: AniListFetcher
}

export function AniListSearchPage(props: AniListSearchPageProps): ReactNode {
  const [texto, setTexto] = useState('')
  const [aplicado, setAplicado] = useState('')

  // El retardo: `aplicado` sólo cambia cuando el usuario deja de teclear.
  useEffect(() => {
    const temporizador = setTimeout(() => setAplicado(texto), DEBOUNCE_MS)

    return () => clearTimeout(temporizador)
  }, [texto])

  const { state, mas, reintentar } = useAniListSearch(aplicado, {
    ...(props.fetcher === undefined ? {} : { fetcher: props.fetcher }),
  })
  const piezas = useMemo(() => state.items.map(piezaDeBusqueda), [state.items])
  const vacio = state.loading === 'none' && state.failure === undefined && piezas.length === 0

  return (
    <section className="anilist-page">
      <h1>{t(DEFAULT_LOCALE, 'anilist.title')}</h1>
      <p className="anilist-page__description">{t(DEFAULT_LOCALE, 'anilist.description')}</p>

      <div className="search__field anilist-page__field">
        <label className="search__label" htmlFor="anilist-term">
          {t(DEFAULT_LOCALE, 'anilist.field')}
        </label>
        <input
          id="anilist-term"
          className="search__input"
          type="search"
          value={texto}
          placeholder={t(DEFAULT_LOCALE, 'anilist.placeholder')}
          autoComplete="off"
          onChange={(event) => setTexto(event.target.value)}
        />
        <p className="nota__meta">{t(DEFAULT_LOCALE, 'anilist.hint')}</p>
      </div>

      <p className="search__status anilist-page__status" aria-live="polite">
        {state.loading !== 'none'
          ? t(DEFAULT_LOCALE, 'anilist.loading')
          : state.failure !== undefined
            ? t(DEFAULT_LOCALE, 'anilist.failed')
            : t(DEFAULT_LOCALE, 'anilist.count', { count: piezas.length })}
      </p>

      {/*
        El aviso de los géneros que no existen no bloquea: la búsqueda se hizo con lo que
        sí valía, y esto dice qué se quedó fuera. El servidor los devuelve porque no los
        envió a la API.
      */}
      {state.unknownGenres.length === 0 ? null : (
        <p className="aviso-tipo" role="status">
          {t(DEFAULT_LOCALE, 'anilist.unknown', { genres: state.unknownGenres.join(', ') })}
        </p>
      )}

      {state.failure === undefined ? null : (
        <p className="search__error anilist-page__error">
          {t(DEFAULT_LOCALE, claveDeFallo(state.failure), {
            status: state.failure.kind === 'server' ? state.failure.status : 0,
            wait: state.failure.kind === 'throttled' ? state.failure.waitS : 0,
          })}{' '}
          <button type="button" className="button" onClick={reintentar}>
            {t(DEFAULT_LOCALE, 'anilist.retry')}
          </button>
        </p>
      )}

      {state.loading === 'first' ? (
        <Mosaico className="anilist-page__mosaic">
          <span className="skeleton" aria-hidden="true" />
        </Mosaico>
      ) : null}

      {vacio ? (
        <p className="empty anilist-page__empty">
          {t(DEFAULT_LOCALE, 'anilist.empty', { query: aplicado })}
        </p>
      ) : null}

      {piezas.length === 0 ? null : (
        <>
          <Mosaico className="anilist-page__mosaic">
            {piezas.map((pieza, indice) => (
              <Pieza
                key={pieza.clave}
                {...(pieza.providerId === undefined ? {} : { providerId: pieza.providerId })}
                {...(pieza.ref === undefined ? {} : { ref: pieza.ref })}
                {...(pieza.portada === undefined ? {} : { portada: pieza.portada })}
                title={pieza.title}
                to={pieza.to}
                {...(pieza.year === undefined ? {} : { year: pieza.year })}
                {...(pieza.meta === undefined ? {} : { meta: pieza.meta })}
                recurso={recursoDe(indice)}
              />
            ))}
          </Mosaico>

          <p className="nota__cuenta">
            {state.total === undefined
              ? cuentaDeTitulos(piezas.length)
              : t(DEFAULT_LOCALE, 'anilist.total', { total: state.total })}
          </p>

          {state.hasNextPage ? (
            <button
              type="button"
              className="button"
              disabled={state.loading !== 'none'}
              onClick={mas}
            >
              {state.loading === 'more'
                ? t(DEFAULT_LOCALE, 'anilist.loading')
                : t(DEFAULT_LOCALE, 'anilist.more')}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}
