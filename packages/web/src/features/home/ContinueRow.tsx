/**
 * Fila «continuar viendo».
 *
 * Cada pieza lleva su barra de progreso y, en el pie, el episodio y los minutos
 * que quedan: es la información que hace falta para decidir si se retoma ahora o
 * no. El enlace va a la pantalla de reproducción **sin reanudar sola**: quien
 * decide seguir donde lo dejó es el reproductor, y sólo cuando se le da a
 * reproducir. Reanudar al entrar es lo que hace que alguien vea el final de un
 * episodio sin querer.
 *
 * Es la fila que abre la home, y no es casualidad: es la única que pide una acción
 * concreta, retomar lo que se dejó a medias. Su pieza mide lo mismo que las demás
 * —un cartel de una columna— y quien dice «retoma esto» es el orden y la barra de
 * progreso, no el tamaño.
 */

import type { ContinueWatchingItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import { ANCLAS } from '../guia/guia'
import { continuePath, progressPercent, remainingLabel, resumeLabel } from './rows'
import { SeccionCargando } from './SeccionCargando'
import { cuentaDeTitulos } from './tramo'

export interface ContinueRowProps {
  readonly items: readonly ContinueWatchingItem[]
  /** Si la lectura de esta fila sigue en vuelo. */
  readonly cargando?: boolean | undefined
}

export function ContinueRow(props: ContinueRowProps): ReactNode {
  if (props.cargando === true) {
    return (
      <SeccionCargando
        title={t(DEFAULT_LOCALE, 'home.continue')}
        meta={t(DEFAULT_LOCALE, 'home.continue.meta')}
      />
    )
  }

  return (
    <section className="seccion" data-tour={ANCLAS.continuar}>
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.continue')}
        meta={t(DEFAULT_LOCALE, 'home.continue.meta')}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <TramoVacio texto={t(DEFAULT_LOCALE, 'home.continue.empty')} />
          ) : (
            props.items.map((item, indice) => {
              const restante = remainingLabel(item)

              return (
                <Pieza
                  key={`${item.animeRef.providerId}:${item.episodeRef.value}`}
                  providerId={item.animeRef.providerId}
                  ref={item.animeRef.value}
                  title={item.title}
                  to={continuePath(item)}
                  recurso={recursoDe(indice)}
                  episodio={t(DEFAULT_LOCALE, 'home.episode', { number: item.episodeNumber })}
                  resto={
                    restante === undefined
                      ? resumeLabel(item)
                      : t(DEFAULT_LOCALE, 'home.remaining', { time: restante })
                  }
                  progreso={progressPercent(item)}
                  progresoEtiqueta={t(DEFAULT_LOCALE, 'home.resume', { time: resumeLabel(item) })}
                />
              )
            })
          )}
        </Mosaico>
      </div>
    </section>
  )
}
