/**
 * El top.
 *
 * Con AniList delante, es **su** ranking —el de todo el catálogo, no el de una
 * fuente— en su orden y con su puesto; sin él, el que publica el proveedor. Las
 * dos formas llegan ya convertidas a `PiezaVista` por quien compone la home, así
 * que esta fila no sabe de dónde salen: la pieza de AniList trae su portada y su
 * destino —la ficha si la base conoce la obra, la búsqueda si no—, y la del
 * proveedor trae su referencia.
 *
 * En la vitrina el puesto se pinta **dentro de la pieza** —enorme, entero y con su
 * velo debajo, porque debajo hay una portada cualquiera—, y todas las piezas pesan
 * lo mismo —un cartel de una columna—: es la fila que sostiene la home y la única
 * que numera lo que enseña.
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
import { type ReactNode, useState } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import type { PiezaVista } from './descubrir'
import { SeccionCargando } from './SeccionCargando'
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
  items: readonly PiezaVista[],
  todas: boolean,
): readonly PiezaVista[] {
  return todas ? items : items.slice(0, TOP_VISIBLES)
}

/** Si queda algún puesto por desplegar. */
export function quedanPuestos(total: number, todas: boolean): boolean {
  return !todas && total > TOP_VISIBLES
}

export interface TopRowProps {
  readonly items: readonly PiezaVista[]
  /** La nota del tramo: de quién es el ranking que se está viendo. */
  readonly meta?: string | undefined
  /** Si la lectura de esta fila sigue en vuelo. */
  readonly cargando?: boolean | undefined
}

export function TopRow(props: TopRowProps): ReactNode {
  const [todas, setTodas] = useState(false)

  // Los hooks van siempre antes del retorno: si el orden cambiara al pasar de
  // cargando a listo, React lo lee como un componente distinto.
  if (props.cargando === true) {
    return (
      <SeccionCargando
        title={t(DEFAULT_LOCALE, 'home.top')}
        meta={props.meta ?? t(DEFAULT_LOCALE, 'home.top.meta')}
      />
    )
  }

  const visibles = puestosVisibles(props.items, todas)

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.top')}
        meta={props.meta ?? t(DEFAULT_LOCALE, 'home.top.meta')}
        {...(props.items.length === 0
          ? {}
          : { cuenta: cuentaDelTop(props.items.length, visibles.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <TramoVacio texto={t(DEFAULT_LOCALE, 'home.top.empty')} />
          ) : (
            visibles.map((item, indice) => (
              <Pieza
                key={item.clave}
                {...(item.providerId === undefined ? {} : { providerId: item.providerId })}
                {...(item.ref === undefined ? {} : { ref: item.ref })}
                {...(item.portada === undefined ? {} : { portada: item.portada })}
                title={item.title}
                to={item.to}
                recurso={recursoDe(indice)}
                {...(item.meta === undefined ? {} : { meta: item.meta })}
                // El puesto del ranking, no el de la lista recortada: el 11
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
