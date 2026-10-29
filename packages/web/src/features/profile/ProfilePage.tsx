/**
 * El Perfil: lo que el usuario ha tocado, en un solo sitio.
 *
 * Cuatro secciones —favoritos, ya vistos, quiero ver e historial— y las cuatro se
 * leen de la base, sin una sola llamada a un proveedor. Es la pantalla que responde
 * «¿qué he hecho yo aquí?», y por eso no enseña nada que el usuario no haya marcado
 * o reproducido: el catálogo tiene la vitrina y la búsqueda.
 *
 * **Cada sección vacía se explica, no se esconde.** Esconderla deja al usuario con
 * una página que cambia de forma sin motivo y sin saber que existe una función que
 * no está usando; el vacío dice **dónde** se marca, que es lo que un botón de
 * «no hay nada» nunca cuenta.
 *
 * El historial va **recortado** y con un enlace a su pantalla: aquí es un resumen y
 * quien pagina es `HistoryPage`. El enlace sólo se pinta cuando queda algo detrás
 * —lo dice `hasMore`— o cuando ya hay algo que ver.
 */

import type { WatchHistoryItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import { Link } from '../../router'
import { ANCLAS } from '../guia/guia'
import { continuePath, progressPercent, remainingLabel, resumeLabel } from '../home/rows'
import { cuentaDeTitulos } from '../home/tramo'
import { useProfile } from './useProfile'

/** La ruta de una ficha, con la referencia codificada. */
function fichaDe(summary: AnimeSummary): string {
  return `/anime/${encodeURIComponent(summary.ref.providerId)}/${encodeURIComponent(summary.ref.value)}`
}

/**
 * Una sección de tarjetas.
 *
 * Las tres marcas del usuario se pintan igual —título, cuenta, rejilla y su vacío—,
 * así que la mecánica vive una sola vez y lo que cambia es el texto. Con tres copias,
 * la tercera se olvidaría de la cuenta o del estado vacío.
 */
function Seccion(props: {
  readonly titulo: string
  readonly meta: string
  readonly vacio: string
  readonly items: readonly AnimeSummary[]
  readonly dataTour?: string
}): ReactNode {
  return (
    <section className="seccion" data-tour={props.dataTour}>
      <SectionHeader
        title={props.titulo}
        meta={props.meta}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <TramoVacio texto={props.vacio} />
          ) : (
            props.items.map((item, indice) => (
              <Pieza
                key={`${item.ref.providerId}:${item.ref.value}`}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={fichaDe(item)}
                recurso={recursoDe(indice)}
                meta={
                  item.year === undefined
                    ? undefined
                    : t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
                }
                apagada
              />
            ))
          )}
        </Mosaico>
      </div>
    </section>
  )
}

/**
 * Un visionado del historial, como pieza.
 *
 * Lleva su barra de progreso y, en el pie, el episodio: es lo que hace falta para
 * saber qué se dejó a medias. Y el terminado lo dice con una palabra, no sólo con la
 * barra llena: un 100 % y un «terminado» no se distinguen por el color cuando no se
 * ve el color.
 */
export function PiezaDeHistorial(props: {
  readonly item: WatchHistoryItem
  readonly indice: number
}): ReactNode {
  const { item } = props
  const restante = remainingLabel(item)

  return (
    <Pieza
      providerId={item.animeRef.providerId}
      ref={item.animeRef.value}
      title={item.title}
      to={continuePath(item)}
      recurso={recursoDe(props.indice)}
      episodio={t(DEFAULT_LOCALE, 'home.episode', { number: item.episodeNumber })}
      resto={
        item.finished
          ? t(DEFAULT_LOCALE, 'history.finished')
          : restante === undefined
            ? resumeLabel(item)
            : t(DEFAULT_LOCALE, 'home.remaining', { time: restante })
      }
      progreso={progressPercent(item)}
      progresoEtiqueta={t(DEFAULT_LOCALE, 'history.watched', {
        percent: progressPercent(item),
      })}
    />
  )
}

function Esqueleto(): ReactNode {
  return (
    <section aria-busy="true">
      <p className="empty">{t(DEFAULT_LOCALE, 'profile.loading')}</p>
      <span className="skeleton" aria-hidden="true" />
    </section>
  )
}

export function ProfilePage(): ReactNode {
  const { state, data, error, reload } = useProfile()

  if (state === 'loading') return <Esqueleto />

  if (state === 'error') {
    return <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={reload} />
  }

  if (data === undefined) return null

  const historial = data.history

  return (
    <article className="perfil">
      <h1>{t(DEFAULT_LOCALE, 'profile.title')}</h1>

      <Seccion
        titulo={t(DEFAULT_LOCALE, 'profile.favorites')}
        meta={t(DEFAULT_LOCALE, 'profile.favorites.meta')}
        vacio={t(DEFAULT_LOCALE, 'profile.favorites.empty')}
        items={data.favorites}
        dataTour={ANCLAS.perfilListas}
      />

      <Seccion
        titulo={t(DEFAULT_LOCALE, 'profile.watched')}
        meta={t(DEFAULT_LOCALE, 'profile.watched.meta')}
        vacio={t(DEFAULT_LOCALE, 'profile.watched.empty')}
        items={data.watched}
      />

      <Seccion
        titulo={t(DEFAULT_LOCALE, 'profile.planToWatch')}
        meta={t(DEFAULT_LOCALE, 'profile.planToWatch.meta')}
        vacio={t(DEFAULT_LOCALE, 'profile.planToWatch.empty')}
        items={data.planToWatch}
      />

      <section className="seccion" data-tour={ANCLAS.perfilHistorial}>
        <SectionHeader
          title={t(DEFAULT_LOCALE, 'profile.history')}
          meta={t(DEFAULT_LOCALE, 'profile.history.meta')}
          {...(historial.items.length === 0
            ? {}
            : { cuenta: cuentaDeTitulos(historial.items.length) })}
        />

        <div className="seccion__cuerpo">
          <Mosaico>
            {historial.items.length === 0 ? (
              // El vacío del historial no lleva enlace: sin nada reproducido no hay
              // nada que ver «todo», y ofrecerlo llevaría a una pantalla vacía.
              <TramoVacio texto={t(DEFAULT_LOCALE, 'profile.history.empty')} />
            ) : (
              historial.items.map((item, indice) => (
                // La clave es la fila del visionado y no la referencia: el mismo
                // episodio puede salir dos veces, porque el historial no agrupa.
                <PiezaDeHistorial key={item.id} item={item} indice={indice} />
              ))
            )}
          </Mosaico>
        </div>

        {historial.items.length === 0 ? null : (
          <p className="perfil__enlace">
            <Link to="/history">{t(DEFAULT_LOCALE, 'profile.history.all')}</Link>
          </p>
        )}
      </section>
    </article>
  )
}
