/**
 * El Historial: todo lo que se reprodujo, por páginas.
 *
 * Es la pantalla a la que lleva el Perfil, y existe separada de él por una razón de
 * tamaño, no de concepto: el historial crece con cada reproducción —una tarde de
 * episodios son veinte filas— y el Perfil es un resumen. Aquí se pagina; allí se
 * enseña el principio.
 *
 * **La página vive en la dirección** (`?page=N`), no en un estado del componente: así
 * se puede recargar y compartir, y el botón de atrás del navegador vuelve a la página
 * anterior en lugar de salir de la pantalla. Es lo mismo que hace la búsqueda con
 * `?q=`.
 *
 * Los mandos se apagan en los extremos —no hay «anterior» en la primera página ni
 * «siguiente» cuando `hasMore` es falso— y el número de página se lee, porque un
 * mando apagado sin decir en qué página se está deja al usuario sin saber dónde anda.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { EsqueletoMosaico } from '../../components/EsqueletoMosaico'
import { Mosaico } from '../../components/Mosaico'
import { claveDeEpisodio, useQuitadosDelHistorial } from '../../components/QuitarDelHistorial'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { Link, useNavigate, usePath } from '../../router'
import { ANCLAS } from '../guia/guia'
import { cuentaDeTitulos } from '../home/tramo'
import { PiezaDeHistorial } from './ProfilePage'
import { pageOfPath, useHistoryPage } from './useProfile'

export interface HistoryPageProps {
  /**
   * Se inyecta para poder probar la pantalla sin un historial de navegador real.
   * En producción la lee del enrutador.
   */
  readonly path?: string
}

/**
 * El destino de una página, conservando la ruta.
 *
 * La primera página se escribe sin parámetro —`/history` a secas—: `?page=1` y la
 * ausencia del parámetro son la misma página, y dos direcciones para lo mismo hacen
 * que el botón de atrás tenga dos entradas donde sólo hubo un movimiento.
 */
export function historyPagePath(page: number): string {
  return page <= 1 ? '/history' : `/history?page=${page}`
}

export function HistoryPage(props: HistoryPageProps): ReactNode {
  const ruta = usePath()
  const path = props.path ?? ruta
  const page = pageOfPath(path)
  const { state, data, error, reload } = useHistoryPage(page)
  /*
    Las tarjetas quitadas en esta visita. Va antes de los retornos tempranos: el
    gancho tiene que llamarse siempre, y este orden es el mismo en cada render.
  */
  const { quitados, quitar } = useQuitadosDelHistorial()
  const navigate = useNavigate()

  if (state === 'loading') {
    /*
     * La espera con la forma de la página:
     *
     * Antes eran una barra y «Cargando el historial.» sobre una página que luego
     * traía un titular, un mosaico de carteles y la paginación. Lo único que no se
     * puede adelantar es el contenido —las filas y la cuenta—; el resto se sabe sin
     * preguntar, así que se pinta de verdad y el esqueleto ocupa su hueco exacto.
     */
    return (
      <article className="historial" aria-busy="true">
        <p className="solo-lectores" role="status">
          {t(DEFAULT_LOCALE, 'history.loading')}
        </p>
        <h1>{t(DEFAULT_LOCALE, 'history.title')}</h1>

        <p className="historial__volver">
          <Link to="/profile">{t(DEFAULT_LOCALE, 'history.back')}</Link>
        </p>

        <section className="seccion">
          <SectionHeader
            title={t(DEFAULT_LOCALE, 'history.section')}
            meta={t(DEFAULT_LOCALE, 'history.meta')}
          />
          <div className="seccion__cuerpo">
            <EsqueletoMosaico />
          </div>
        </section>

        <nav className="historial__pagina" aria-label={t(DEFAULT_LOCALE, 'history.pages')}>
          <button type="button" className="button" disabled>
            {t(DEFAULT_LOCALE, 'history.previous')}
          </button>
          <span>{t(DEFAULT_LOCALE, 'history.page', { page })}</span>
          <button type="button" className="button" disabled>
            {t(DEFAULT_LOCALE, 'history.next')}
          </button>
        </nav>
      </article>
    )
  }

  if (state === 'error') {
    return <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={reload} />
  }

  if (data === undefined) return null

  const items = data.items.filter((item) => !quitados.has(claveDeEpisodio(item.episodeRef)))
  const vacio = items.length === 0
  // Una página sin filas **y** sin nada detrás es que no hay historial; si hay algo
  // detrás, es que se pidió una página más allá del final y eso se dice distinto.
  const sinNada = vacio && page === 1

  return (
    <article className="historial">
      <h1>{t(DEFAULT_LOCALE, 'history.title')}</h1>

      <p className="historial__volver">
        <Link to="/profile">{t(DEFAULT_LOCALE, 'history.back')}</Link>
      </p>

      <section className="seccion" data-tour={ANCLAS.historialLista}>
        <SectionHeader
          title={t(DEFAULT_LOCALE, 'history.section')}
          meta={t(DEFAULT_LOCALE, 'history.meta')}
          {...(vacio ? {} : { cuenta: cuentaDeTitulos(items.length) })}
        />

        <div className="seccion__cuerpo">
          {vacio ? (
            <p className="empty">
              {t(DEFAULT_LOCALE, sinNada ? 'history.empty' : 'history.emptyPage')}
            </p>
          ) : (
            <Mosaico>
              {items.map((item, indice) => (
                // Un renglón por episodio: el servidor ya se ha quedado con la
                // reproducción más reciente de cada uno.
                <PiezaDeHistorial
                  key={item.id}
                  item={item}
                  indice={indice}
                  onQuitado={() => quitar(item.episodeRef)}
                />
              ))}
            </Mosaico>
          )}
        </div>
      </section>

      {/* Sin una sola fila no hay nada que paginar: los mandos dirían «página 1 de 1»
          sobre un historial que no existe. */}
      {sinNada ? null : (
        <nav
          className="historial__pagina"
          aria-label={t(DEFAULT_LOCALE, 'history.pages')}
          data-tour={ANCLAS.historialPaginas}
        >
          <button
            type="button"
            className="button"
            disabled={page <= 1}
            onClick={() => navigate.push(historyPagePath(page - 1))}
          >
            {t(DEFAULT_LOCALE, 'history.previous')}
          </button>

          <span aria-live="polite">{t(DEFAULT_LOCALE, 'history.page', { page })}</span>

          <button
            type="button"
            className="button"
            disabled={!data.hasMore}
            onClick={() => navigate.push(historyPagePath(page + 1))}
          >
            {t(DEFAULT_LOCALE, 'history.next')}
          </button>
        </nav>
      )}
    </article>
  )
}
