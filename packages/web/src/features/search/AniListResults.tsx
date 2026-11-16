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
 * **Es una lista con dos maneras de pintarse**, y la diferencia es de diseño, no
 * de datos. Lo dice `presentacion`:
 *
 * - `seccion`: va debajo de los resultados, aparte, con el mosaico de la vitrina
 *   y el sello de lo que ya está en tus fuentes. Es lo que AniList tiene del
 *   estudio o del género cuando los proveedores ya han contestado.
 * - `rejilla`: la lista **es** el resultado —la búsqueda con género, donde a los
 *   proveedores no se les pregunta— y ocupa su sitio con las tarjetas de la
 *   página, sin sello.
 *
 * Lo que cambia entre las dos es el modo de pintar, **nunca la regla de a dónde
 * lleva cada obra**: ésa sale de `desdeDescubrir` para las dos, que es lo que
 * evita tenerla escrita dos veces y verla divergir sin que nadie se entere.
 *
 * No se pinta vacía. Una sección sin piezas aparece y desaparece según lo que
 * conteste un tercero, y el hueco que deja no explica nada; la lista de proveedores
 * y su estado vacío ya dicen lo que hay que decir de la búsqueda. La rejilla, en
 * cambio, **es** la respuesta entera de esa búsqueda: ahí el vacío se dice, y sólo
 * cuando la búsqueda ha cerrado —antes, un vacío no es una conclusión—.
 */

import type { DiscoverItem } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { Grid, GridItem } from '../../components/Grid'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { Link } from '../../router'
import { conLaConsulta } from '../detail/direccion'
import { desdeDescubrir, type PiezaVista } from '../home/descubrir'
import { cuentaDeTitulos } from '../home/tramo'

/** Cómo se pinta la lista del catálogo. */
export type PresentacionCatalogo = 'seccion' | 'rejilla'

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
  /** Con qué diseño se pinta la lista. */
  readonly presentacion: PresentacionCatalogo
  /**
   * Si la búsqueda ya cerró: sin esto, un vacío no es una conclusión.
   *
   * Sólo lo cuenta la rejilla, que es la que puede estar contestando la búsqueda
   * entera: la sección de debajo no afirma nada cuando no hay piezas.
   */
  readonly done?: boolean
}

/**
 * La tarjeta de una obra del catálogo, como la de los resultados.
 *
 * Es la misma `card` de la rejilla de la página —portada, título, pie— y no la
 * pieza del mosaico: en la búsqueda por género la lista del catálogo ocupa el
 * sitio de los resultados y tiene que hablar el mismo idioma visual.
 *
 * **No lleva sello**: el enlace ya dice lo que hay. Una obra que la base conoce
 * abre su ficha —con sus episodios y su reproductor— y una que no, la búsqueda de
 * su título, que es la salida honesta. Eso lo decide `destinoDe`, la misma regla
 * que usan las filas de la vitrina.
 *
 * La portada es una **ruta local** (`/api/anilist/image/cover/<id>`): el navegador
 * sigue sin conocer ningún origen remoto y la CSP no cambia.
 */
function AniListCard(props: { readonly vista: PiezaVista; readonly consulta: string }): ReactNode {
  const { vista } = props

  return (
    <Link to={conLaConsulta(vista.to, props.consulta)} className="card" title={vista.title}>
      <Cover src={vista.portada} className="card__cover" />
      <span className="card__title">{vista.title}</span>
      {vista.meta === undefined ? null : <span className="card__meta">{vista.meta}</span>}
    </Link>
  )
}

export function AniListResults(props: AniListResultsProps): ReactNode {
  /*
    La lista se lee una vez y las dos presentaciones se sirven de la misma: el
    destino, la portada, el pie y la clave salen de `desdeDescubrir`, que es la
    regla que usan las filas de la vitrina. Escribirla dos veces era el modo de
    que una de las dos se quedara vieja.
  */
  const vistas = props.items.map((item) => desdeDescubrir(item))

  if (vistas.length === 0) {
    // Mientras busca no se afirma nada: el renglón de estado ya dice que está
    // buscando, y decir que no hay nada sería culpar a la consulta de lo que no
    // es culpa suya.
    if (props.presentacion !== 'rejilla' || props.done !== true) return null

    return (
      <p className="empty">{t(DEFAULT_LOCALE, 'search.catalogue.empty', { query: props.query })}</p>
    )
  }

  if (props.presentacion === 'rejilla') {
    // La lista es la respuesta de la búsqueda: va en la rejilla de la página, con
    // las tarjetas de siempre y sin la sección del mosaico.
    return (
      <Grid label={t(DEFAULT_LOCALE, 'search.results')}>
        {vistas.map((vista) => (
          <GridItem key={vista.clave}>
            <AniListCard vista={vista} consulta={props.query} />
          </GridItem>
        ))}
      </Grid>
    )
  }

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'search.anilist')}
        meta={t(DEFAULT_LOCALE, 'search.anilist.meta', { query: props.query })}
        cuenta={cuentaDeTitulos(vistas.length)}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {vistas.map((vista, indice) => (
            <Pieza
              key={vista.clave}
              {...(vista.providerId === undefined ? {} : { providerId: vista.providerId })}
              {...(vista.ref === undefined ? {} : { ref: vista.ref })}
              {...(vista.portada === undefined ? {} : { portada: vista.portada })}
              title={vista.title}
              to={conLaConsulta(vista.to, props.query)}
              consulta={props.query}
              {...(vista.year === undefined ? {} : { year: vista.year })}
              {...(vista.meta === undefined ? {} : { meta: vista.meta })}
              recurso={recursoDe(indice)}
              // El sello es la otra mitad del cruce: dice que esa obra de AniList
              // ya está en una fuente, que es lo que la hace abrible aquí.
              {...(vista.providerId === undefined
                ? {}
                : { sello: [t(DEFAULT_LOCALE, 'search.anilist.inSources')] })}
            />
          ))}
        </Mosaico>
      </div>
    </section>
  )
}
