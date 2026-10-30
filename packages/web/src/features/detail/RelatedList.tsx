/**
 * Las filas del rail de la saga.
 *
 * La lista la compone `filasDeSaga`, que ya juntó lo de la base con lo de AniList:
 * aquí sólo se pinta. Por eso la fila es un tipo propio y no un `AnimeSummary`: la
 * mitad de lo que se enseña —la película que ninguna fuente tiene, o la temporada
 * que sólo AniList declara— **no está en la base** y no tiene referencia que
 * abrir. Esa fila lleva a la búsqueda de su título, que es la salida honesta, y su
 * portada viene de AniList en vez del proxy.
 *
 * Cada fila es un enlace de verdad —`<a href>`, con la navegación sin recarga
 * encima—, así que se abre en otra pestaña y se recorre con el teclado. La portada
 * se pide al proxy, y si no llega el componente dibuja el hueco en lugar de dejar
 * el icono de imagen rota.
 *
 * **La fila lleva el título arriba y los datos debajo, y eso es una decisión de
 * lectura, no de adorno.** La lista vive en la barra lateral, que es estrecha: con
 * el título, el año y las insignias en un mismo flujo, «Año 2025» se parte por el
 * espacio —queda un «AÑO» colgando— y el recuadro de «Temporada 2» se abre en dos
 * renglones. Los títulos de estos catálogos son largos —«Sono Bisque Doll wa Koi
 * wo Suru Season 2»—, así que el renglón compartido no es un caso raro: es el
 * normal.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { navStateDeTarjeta } from './nav-state'
import type { FilaDeSaga } from './saga'

export interface RelatedListProps {
  readonly items: readonly FilaDeSaga[]
}

/** La portada de la fila: la de AniList, la del proxy, o el hueco. */
function portada(item: FilaDeSaga): ReactNode {
  if (item.portada !== undefined) {
    return <Cover src={item.portada} className="related__cover" />
  }

  if (item.providerId !== undefined && item.ref !== undefined) {
    return <Cover providerId={item.providerId} ref={item.ref} className="related__cover" />
  }

  // La fila sin portada posible se pinta con el hueco del diseño y no pide nada:
  // una imagen que no existe es un 404 por fila.
  return <span className="related__cover" aria-hidden="true" />
}

/**
 * El grupo de los datos.
 *
 * No se pinta vacío: la columna lleva `gap`, y un grupo sin nada dentro es un
 * renglón de aire entre el título y el borde.
 */
function datos(item: FilaDeSaga): ReactNode {
  const año =
    item.year === undefined
      ? undefined
      : t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
  const temporada =
    item.temporada === undefined
      ? undefined
      : t(DEFAULT_LOCALE, 'detail.season', { number: item.temporada })

  if (
    año === undefined &&
    temporada === undefined &&
    item.motivo === undefined &&
    item.actual !== true
  ) {
    return null
  }

  return (
    <span className="related__chips">
      {año === undefined ? null : <span className="related__meta">{año}</span>}
      {temporada === undefined ? null : <span className="badge">{temporada}</span>}
      {/* El motivo es de AniList y lo dice la fila: es la atribución del dato, y
          explica por qué esa entrega está aquí cuando el catálogo no la tiene. */}
      {item.motivo === undefined ? null : <span className="badge">{item.motivo}</span>}
      {item.actual === true ? (
        // La palabra, no sólo el color: el estado tiene que leerse también sin
        // distinguir colores.
        <span className="badge badge--visto">{t(DEFAULT_LOCALE, 'detail.related.current')}</span>
      ) : null}
    </span>
  )
}

export function RelatedList(props: RelatedListProps): ReactNode {
  return (
    <ul className="related">
      {props.items.map((item) => {
        // El contenido es el mismo para la fila actual y para las demás: lo único
        // que cambia es si va dentro de un enlace.
        const contenido = (
          <>
            {portada(item)}
            <span className="related__body">
              <span className="related__title">{item.title}</span>
              {datos(item)}
            </span>
          </>
        )
        /*
          La fila ya sabe el título —y la portada, cuando la tiene—: la ficha de
          destino lo pinta antes de que llegue el servidor. La fila que no está en
          la base lleva a la búsqueda de su título, y ese estado es el mismo que
          necesita la ficha si alguien la añade después.
        */
        const estado = navStateDeTarjeta({
          title: item.title,
          providerId: item.providerId,
          ref: item.ref,
          poster: item.portada,
          year: item.year,
        })

        return (
          <li key={item.clave}>
            {item.actual === true ? (
              // Un enlace a la ficha que ya se está leyendo no lleva a ninguna
              // parte: la fila actual se marca y se queda sin enlace. Se pinta el
              // mismo contenido y el mismo hueco de portada, para que la columna no
              // baile.
              <span className="related__item related__item--actual" aria-current="page">
                {contenido}
              </span>
            ) : (
              <Link className="related__item" to={item.to} state={estado} title={item.title}>
                {contenido}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
