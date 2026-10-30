/**
 * El tramo que el motor elige: «Recomendado para ti».
 *
 * Va segundo, justo detrás de lo que se retoma, porque es la única fila que
 * **no** está en el catálogo por lo que ha publicado la fuente ni por lo que el
 * usuario guardó: está porque el motor cree que va con él. Y se enseña entera: el
 * motivo viaja en la pieza —en el asomo y en la hoja—, así que la razón de cada
 * recomendación se lee sin abrir nada.
 *
 * La **puntuación** se retiró de la pieza: era el número con el que el motor
 * ordena, no algo con lo que el usuario decida qué ver, y tres decimales sin escala
 * («0.300», y hasta «0.000» recomendado) decían más del motor que de la obra. El
 * detalle del motor sigue en `features/recommendations/Panel.tsx`, con sus pruebas,
 * a la espera del sitio donde vuelva a leerse.
 *
 * El tramo abría con la **franja de motivos** —el titular «Lo que el motor ha
 * elegido» y, dentro, el desplegable del detalle del score—. Se retiró: repetía lo
 * que ya dice la nota del tramo y metía una caja dentro del mosaico. El panel del
 * motor sigue en `features/recommendations/Panel.tsx`, con sus pruebas, a la espera
 * del sitio donde vuelva a leerse.
 *
 * Todas las piezas pesan lo mismo —un cartel de una columna—: en un tramo de tres
 * títulos nadie es más importante que nadie, y hacer uno grande sería inventarse una
 * jerarquía que el motor no ha dado. El mismo tamaño para todos es, además, lo que
 * deja la rejilla sin huecos.
 */

import type { RecommendationResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Fallo } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import { ANCLAS } from '../guia/guia'
import { SeccionCargando } from './SeccionCargando'
import { cuentaDeTitulos } from './tramo'

export interface RecommendedRowProps {
  readonly items: readonly RecommendationResponse[]
  /**
   * La portada de AniList por referencia, cuando la hay.
   *
   * Es un adorno opcional: sin ella la pieza enseña la del proveedor, que es lo
   * que hacía antes de esta entrega.
   */
  readonly portadas?: ReadonlyMap<string, string> | undefined
  /** Si el motor sigue buscando qué recomendar. */
  readonly cargando?: boolean | undefined
  /**
   * El fallo del motor, si lo hubo.
   *
   * Sin él, una fila vacía diría «todavía no hay nada que recomendar», que es una
   * afirmación sobre el catálogo y no sobre una petición que no llegó.
   */
  readonly fallo?: Fallo | undefined
  readonly onRetry?: (() => void) | undefined
}

/** La clave con la que esta recomendación busca su portada de AniList. */
export function claveDeRecomendacion(item: RecommendationResponse): string {
  return `${item.ref.providerId}:${item.ref.value}`
}

/**
 * La línea de datos de una pieza del motor.
 *
 * Los géneros del vector y el año, en el orden del artefacto: primero lo que
 * describe el título, después cuándo es. Un título sin tags ni año —el motor puede
 * devolver uno del feed— se queda sin línea en vez de con una línea vacía.
 */
export function metaDeRecomendacion(item: RecommendationResponse): string | undefined {
  const partes: string[] = item.tags.length === 0 ? [] : [item.tags.join(', ')]

  if (item.year !== undefined) {
    partes.push(t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year }))
  }

  return partes.length === 0 ? undefined : partes.join(' · ')
}

export function RecommendedRow(props: RecommendedRowProps): ReactNode {
  if (props.cargando === true) {
    return (
      <SeccionCargando
        title={t(DEFAULT_LOCALE, 'home.recommended')}
        meta={t(DEFAULT_LOCALE, 'home.recommended.meta')}
        icon={Sparkles}
      />
    )
  }

  return (
    <section className="seccion" data-tour={ANCLAS.recomendado}>
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.recommended')}
        meta={t(DEFAULT_LOCALE, 'home.recommended.meta')}
        icon={Sparkles}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        {props.items.length === 0 ? (
          props.fallo === undefined ? (
            <TramoVacio texto={t(DEFAULT_LOCALE, 'reco.empty')} />
          ) : (
            <ErrorNotice fallo={props.fallo} onRetry={props.onRetry} />
          )
        ) : (
          <Mosaico>
            {props.items.map((item, indice) => (
              <Pieza
                key={claveDeRecomendacion(item)}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                {...(props.portadas?.get(claveDeRecomendacion(item)) === undefined
                  ? {}
                  : { portada: props.portadas.get(claveDeRecomendacion(item)) })}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                recurso={recursoDe(indice)}
                year={item.year}
                /* Los tags del motor son los géneros: viajan al estado de la ficha
                   para que el adelanto los pinte sin pedir el detalle. */
                genres={item.tags}
                meta={metaDeRecomendacion(item)}
                motivo={item.reason.text}
              />
            ))}
          </Mosaico>
        )}
      </div>
    </section>
  )
}
