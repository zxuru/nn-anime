/**
 * La franquicia según AniList, en la ficha.
 *
 * Es la respuesta a un hueco que la sección local no puede llenar: los hermanos de
 * saga los calcula el servidor con lo que **la base ya conoce**, y de una saga
 * como «Danmachi» la base suele conocer una sola entrega —la que se acaba de
 * abrir—. AniList sí declara las relaciones, y de ahí salen las temporadas que
 * faltan, la película y el spin-off.
 *
 * Tres decisiones que se ven en pantalla:
 *
 * 1. **Es otra sección, no la de los relacionados.** La de la barra lateral sigue
 *    siendo local y sigue diciendo lo que la base sabe; ésta está atribuida a
 *    AniList, que es de quien es el dato, y por eso no se mezclan: un dato de
 *    tercero no se disfraza de lectura local.
 * 2. **El motivo se lee en la pieza.** «Secuela», «Precuela», «Obra madre»,
 *    «Historia paralela»… es lo que dice de qué va la relación, y es la mitad de
 *    la utilidad: saber que a la temporada 2 se llega desde aquí es lo que permite
 *    encadenar las entregas. Va delante del año y del formato, en la línea de datos
 *    de la pieza.
 * 3. **La pieza lleva a donde se pueda.** La que la base conoce en alguna fuente
 *    abre su ficha, con sus episodios; la que no, la búsqueda de su título —que es
 *    la salida honesta y la que ya usa la vitrina—. Sin relaciones no se pinta
 *    nada: una fila vacía sobre un dato ajeno sólo diría que algo falló.
 */

import type { AniListRelatedItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { t } from '../../i18n'
import type { PiezaVista } from '../home/descubrir'
import { desdeDescubrir } from '../home/descubrir'
import { claveDeRelacion } from './relacion'

/** La pieza de la vitrina con el motivo de AniList delante de sus datos. */
export function piezaDeRelacion(item: AniListRelatedItem): PiezaVista {
  const pieza = desdeDescubrir(item)
  const motivo = t(DEFAULT_LOCALE, claveDeRelacion(item.relation))

  return {
    ...pieza,
    meta: pieza.meta === undefined ? motivo : `${motivo} · ${pieza.meta}`,
  }
}

export interface AniListRelatedProps {
  /** Las relaciones que devolvió el servidor, en el orden en que las sirvió. */
  readonly items: readonly AniListRelatedItem[]
}

export function AniListRelated(props: AniListRelatedProps): ReactNode {
  if (props.items.length === 0) return null

  return (
    <section className="detail__anilist">
      <h2>{t(DEFAULT_LOCALE, 'detail.anilistRelated')}</h2>
      <p className="nota__meta">{t(DEFAULT_LOCALE, 'detail.anilistRelated.meta')}</p>

      <Mosaico>
        {props.items.map((item, indice) => {
          const pieza = piezaDeRelacion(item)

          return (
            <Pieza
              key={pieza.clave}
              {...(pieza.providerId === undefined ? {} : { providerId: pieza.providerId })}
              {...(pieza.ref === undefined ? {} : { ref: pieza.ref })}
              {...(pieza.portada === undefined ? {} : { portada: pieza.portada })}
              title={pieza.title}
              to={pieza.to}
              recurso={recursoDe(indice)}
              {...(pieza.meta === undefined ? {} : { meta: pieza.meta })}
            />
          )
        })}
      </Mosaico>
    </section>
  )
}
