/**
 * El top de la fuente.
 *
 * Es el ranking que publica el proveedor —jkanime: los más votados de su página
 * `/top`— **en su orden y con su puesto**: el uno es el uno, y la fila no
 * reordena nada. Antes esta sección eran cinco recomendaciones con su motivo; el
 * motivo se mudó al panel, que es donde se explica el motor, y aquí queda lo que
 * el usuario reconoce de la fuente.
 *
 * En la vitrina el puesto se pinta **dentro de la pieza**, enorme y recortado por
 * el borde, y todas las piezas pesan lo mismo —un cartel de una columna—: es la
 * fila que sostiene la home y la única que numera lo que enseña.
 *
 * Se enseñan los primeros puestos y «Mostrar más» despliega el resto: la fuente
 * publica decenas de títulos y una home no puede abrir con cincuenta portadas.
 * El top real es la lista entera; lo que se recorta es lo que se pinta de golpe.
 * El mando ocupa su hueco del mosaico y no cuelga por debajo de la rejilla: es
 * una pieza más, la que dice que hay más.
 *
 * Sin proveedor que publique un top, la fila **se explica** en vez de esconderse:
 * una fila que desaparece deja al usuario sin saber si la función existe.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import { type ReactNode, useState } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { PiezaVacia } from '../../components/PiezaVacia'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { cuentaDelTop } from './tramo'

/** Cuántos puestos se ven antes de pulsar «Mostrar más». */
export const TOP_VISIBLES = 10

/**
 * Los puestos que se pintan.
 *
 * Es una función y no un `slice` dentro del componente porque el recorte es la
 * decisión que importa —el botón tiene que aparecer exactamente cuando queda
 * algo— y así se mide sin un navegador: un `renderToString` no pulsa botones.
 */
export function puestosVisibles(
  items: readonly AnimeSummary[],
  todas: boolean,
): readonly AnimeSummary[] {
  return todas ? items : items.slice(0, TOP_VISIBLES)
}

/** Si queda algún puesto por desplegar. */
export function quedanPuestos(total: number, todas: boolean): boolean {
  return !todas && total > TOP_VISIBLES
}

export interface TopRowProps {
  readonly items: readonly AnimeSummary[]
}

export function TopRow(props: TopRowProps): ReactNode {
  const [todas, setTodas] = useState(false)
  const visibles = puestosVisibles(props.items, todas)

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.top')}
        meta={t(DEFAULT_LOCALE, 'home.top.meta')}
        {...(props.items.length === 0
          ? {}
          : { cuenta: cuentaDelTop(props.items.length, visibles.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <PiezaVacia texto={t(DEFAULT_LOCALE, 'home.top.empty')} />
          ) : (
            visibles.map((item, indice) => (
              <Pieza
                key={`${item.ref.providerId}:${item.ref.value}`}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                recurso={recursoDe(indice)}
                // El puesto de la fuente, no el de la lista recortada: el 11
                // sigue siendo el 11 cuando se despliega el resto.
                posicion={indice + 1}
              />
            ))
          )}

          {quedanPuestos(props.items.length, todas) ? (
            <article className="pz pz--mando">
              <p className="nota__cuenta">
                {t(DEFAULT_LOCALE, 'home.more', { count: props.items.length - visibles.length })}
              </p>
              <button type="button" className="button" onClick={() => setTodas(true)}>
                {t(DEFAULT_LOCALE, 'home.top.more')}
              </button>
            </article>
          ) : null}
        </Mosaico>
      </div>
    </section>
  )
}
