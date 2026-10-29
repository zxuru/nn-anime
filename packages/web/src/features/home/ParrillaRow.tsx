/**
 * La parrilla: lo que se emite estos días.
 *
 * Es la fila que el diseño traía y el repositorio no podía pintar: los proveedores
 * no publican la fecha de emisión de cada capítulo, sólo la de publicación del
 * título. AniList sí, y de ahí sale esta sección —agrupada por día, «Hoy»,
 * «Mañana», el día de la semana— con el episodio y la hora de cada uno.
 *
 * **La fila no decide a dónde va una pieza.** Eso lo resolvió el servidor: una
 * obra que la base ya conoce enlaza a su ficha —y ahí se ve y se reproduce— y una
 * que no, a la búsqueda de su título. Por eso el pie de cada pieza puede decir
 * «Ep. 5» y enlazar a la ficha, o llevar sólo el título y enlazar a buscar.
 *
 * Si no hay nada que anunciar se explica en vez de esconderse: puede ser que no
 * haya estrenos, y también que AniList no haya contestado.
 */

import type { AiringItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import { anioDe, type DiaDeParrilla, desdeEmision, episodioDe, horaDe } from './descubrir'
import { SeccionCargando } from './SeccionCargando'
import { cuentaDeTitulos } from './tramo'

export interface ParrillaRowProps {
  readonly dias: readonly DiaDeParrilla[]
  /** Lo que se dice cuando no hay nada. Cambia de mitad: las películas no tienen parrilla. */
  readonly vacio?: string | undefined
  /** Si la lectura de esta fila sigue en vuelo. */
  readonly cargando?: boolean | undefined
}

/** Cuántos capítulos enseña la parrilla entera. */
export const PARRILLA_LIMITE = 24

/**
 * La línea de datos de un capítulo: el episodio y su hora.
 *
 * Una película no tiene episodio y se queda con la hora, que es cuándo se estrena.
 */
export function metaDeEmision(item: AiringItem): string {
  const partes: string[] = []
  const episodio = episodioDe(item)
  if (episodio !== undefined) partes.push(episodio)

  const hora = horaDe(item.airingAt)
  if (hora !== '') partes.push(hora)

  // Sin día que enseñar —un estreno con precisión de año— la línea es el año, que
  // es lo único que la API sabe.
  if (partes.length === 0) {
    const anio = anioDe(item)
    if (anio !== undefined) partes.push(anio)
  }

  return partes.join(' · ')
}

export function ParrillaRow(props: ParrillaRowProps): ReactNode {
  if (props.cargando === true) {
    return (
      <SeccionCargando
        title={t(DEFAULT_LOCALE, 'home.parrilla')}
        meta={t(DEFAULT_LOCALE, 'home.parrilla.meta')}
      />
    )
  }

  const total = props.dias.reduce((suma, dia) => suma + dia.items.length, 0)
  let restantes = PARRILLA_LIMITE

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.parrilla')}
        meta={t(DEFAULT_LOCALE, 'home.parrilla.meta')}
        {...(total === 0 ? {} : { cuenta: cuentaDeTitulos(total) })}
      />

      <div className="seccion__cuerpo">
        {total === 0 ? (
          <Mosaico>
            <TramoVacio texto={props.vacio ?? t(DEFAULT_LOCALE, 'home.parrilla.empty')} />
          </Mosaico>
        ) : (
          props.dias.map((dia) => {
            // El tope es de la fila entera y no de cada día: una semana cargada
            // no puede convertir la parrilla en una pantalla infinita.
            const visibles = dia.items.slice(0, Math.max(0, restantes))
            restantes -= visibles.length
            if (visibles.length === 0) return null

            return (
              <div className="parrilla" key={dia.dia}>
                <h3 className="parrilla__dia">{dia.etiqueta}</h3>
                <Mosaico>
                  {visibles.map((item, indice) => {
                    const vista = desdeEmision(item)

                    return (
                      <Pieza
                        key={vista.clave}
                        {...(vista.providerId === undefined
                          ? {}
                          : { providerId: vista.providerId })}
                        {...(vista.ref === undefined ? {} : { ref: vista.ref })}
                        {...(vista.portada === undefined ? {} : { portada: vista.portada })}
                        title={vista.title}
                        to={vista.to}
                        recurso={recursoDe(indice)}
                        meta={metaDeEmision(item)}
                      />
                    )
                  })}
                </Mosaico>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
