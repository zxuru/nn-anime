/**
 * Lo que AniList tiene de este término, en la página de búsqueda.
 *
 * Es la mitad que ninguna fuente puede contestar: los proveedores buscan por
 * título, así que una consulta por **estudio** o por **género** sólo podía
 * devolver los títulos que ya estuvieran en la base, y ahí se acababa la lista.
 * AniList sí sabe qué obras tiene un estudio y qué obras son de un género, y esto
 * es esa lista.
 *
 * **El cruce con lo que hay en los proveedores se ve en cada pieza**: la que la
 * base ya conoce abre su ficha —con sus episodios y su reproductor— y lleva el
 * sello que lo dice; la que no, lleva a la búsqueda de su título, que es la salida
 * honesta. La decisión del destino la toma `desdeDescubrir`, que es la misma que
 * usan las filas de la home: aquí sólo se pinta.
 *
 * No se pinta vacía. Una sección sin piezas aparece y desaparece según lo que
 * conteste un tercero, y el hueco que deja no explica nada; la lista de proveedores
 * y su estado vacío ya dicen lo que hay que decir de la búsqueda.
 */

import type { DiscoverItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { conLaConsulta } from '../detail/direccion'
import { desdeDescubrir } from '../home/descubrir'
import { cuentaDeTitulos } from '../home/tramo'

export interface AniListResultsProps {
  readonly items: readonly DiscoverItem[]
  /**
   * La consulta que produjo la lista.
   *
   * Va en la nota del tramo y, además, en la dirección de las piezas que abren una
   * ficha: es el rastro que el servidor anota para que el motor recomiende lo que
   * se busca. Las que no están en ninguna fuente llevan a la búsqueda de su título
   * y ya traen su propia consulta.
   */
  readonly query: string
}

export function AniListResults(props: AniListResultsProps): ReactNode {
  if (props.items.length === 0) return null

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'search.anilist')}
        meta={t(DEFAULT_LOCALE, 'search.anilist.meta', { query: props.query })}
        cuenta={cuentaDeTitulos(props.items.length)}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.map((item, indice) => {
            const pieza = desdeDescubrir(item)

            return (
              <Pieza
                key={pieza.clave}
                {...(pieza.providerId === undefined ? {} : { providerId: pieza.providerId })}
                {...(pieza.ref === undefined ? {} : { ref: pieza.ref })}
                {...(pieza.portada === undefined ? {} : { portada: pieza.portada })}
                title={pieza.title}
                to={conLaConsulta(pieza.to, props.query)}
                consulta={props.query}
                {...(pieza.year === undefined ? {} : { year: pieza.year })}
                {...(pieza.meta === undefined ? {} : { meta: pieza.meta })}
                recurso={recursoDe(indice)}
                // El sello es la otra mitad del cruce: dice que esa obra de AniList
                // ya está en una fuente, que es lo que la hace abrible aquí.
                {...(pieza.providerId === undefined
                  ? {}
                  : { sello: [t(DEFAULT_LOCALE, 'search.anilist.inSources')] })}
              />
            )
          })}
        </Mosaico>
      </div>
    </section>
  )
}
