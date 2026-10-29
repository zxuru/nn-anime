/**
 * Las novedades: lo que acaba de salir.
 *
 * Dos procedencias y una fila. Con AniList, son los **capítulos recién emitidos**
 * —con su episodio—; sin él, lo que publica la fuente en su feed, que es lo que
 * había. La pieza no distingue: llega ya convertida a `PiezaVista` por quien
 * compone la home, con su portada y su destino.
 *
 * El orden lo decide el servidor y la fila **no reordena**: una sola fuente de
 * verdad para las dos pantallas, y ordenar dos veces acaba en dos órdenes.
 *
 * Si no hay nada se explica en vez de esconderse: una fila que desaparece deja al
 * usuario sin saber si la función existe.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import type { PiezaVista } from './descubrir'
import { SeccionCargando } from './SeccionCargando'
import { cuentaDeTitulos } from './tramo'

export interface FeedRowProps {
  readonly items: readonly PiezaVista[]
  /** La nota del tramo: de dónde salen las novedades que se están viendo. */
  readonly meta?: string | undefined
  /** Lo que se dice cuando no hay nada. Cambia con la procedencia. */
  readonly vacio?: string | undefined
  /** Si la lectura de esta fila sigue en vuelo. */
  readonly cargando?: boolean | undefined
}

export function FeedRow(props: FeedRowProps): ReactNode {
  if (props.cargando === true) {
    return (
      <SeccionCargando
        title={t(DEFAULT_LOCALE, 'home.feed')}
        meta={props.meta ?? t(DEFAULT_LOCALE, 'home.feed.meta')}
      />
    )
  }

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.feed')}
        meta={props.meta ?? t(DEFAULT_LOCALE, 'home.feed.meta')}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <TramoVacio texto={props.vacio ?? t(DEFAULT_LOCALE, 'home.feed.empty')} />
          ) : (
            props.items.map((item, indice) => (
              <Pieza
                key={item.clave}
                {...(item.providerId === undefined ? {} : { providerId: item.providerId })}
                {...(item.ref === undefined ? {} : { ref: item.ref })}
                {...(item.portada === undefined ? {} : { portada: item.portada })}
                title={item.title}
                to={item.to}
                recurso={recursoDe(indice)}
                year={item.year}
                meta={item.meta}
              />
            ))
          )}
        </Mosaico>
      </div>
    </section>
  )
}
