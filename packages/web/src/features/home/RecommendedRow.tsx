/**
 * El tramo que el motor elige: «Recomendado para ti».
 *
 * Va segundo, justo detrás de lo que se retoma, porque es la única fila que
 * **no** está en el catálogo por lo que ha publicado la fuente ni por lo que el
 * usuario guardó: está porque el motor cree que va con él. Y se enseña entera:
 * puntuación y motivo viajan en la pieza —en el asomo y en la hoja—, así que la
 * razón de cada recomendación se lee sin abrir nada.
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
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { cuentaDeTitulos } from './tramo'

export interface RecommendedRowProps {
  readonly items: readonly RecommendationResponse[]
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
  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.recommended')}
        meta={t(DEFAULT_LOCALE, 'home.recommended.meta')}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.map((item, indice) => (
            <Pieza
              key={`${item.ref.providerId}:${item.ref.value}`}
              providerId={item.ref.providerId}
              ref={item.ref.value}
              title={item.title}
              to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
              recurso={recursoDe(indice)}
              year={item.year}
              meta={metaDeRecomendacion(item)}
              puntuacion={item.score}
              motivo={item.reason.text}
            />
          ))}
        </Mosaico>
      </div>
    </section>
  )
}
