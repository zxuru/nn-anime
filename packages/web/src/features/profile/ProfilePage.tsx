/**
 * El Perfil: lo que el usuario ha tocado, en un solo sitio.
 *
 * Cuatro secciones —favoritos, ya vistos, quiero ver e historial— y las cuatro se
 * leen de la base, sin una sola llamada a un proveedor. Es la pantalla que responde
 * «¿qué he hecho yo aquí?», y por eso no enseña nada que el usuario no haya marcado
 * o reproducido: el catálogo tiene la vitrina y la búsqueda.
 *
 * **La página es una lista de secciones, no un tramo de la vitrina.** Antes usaba
 * la rejilla de la home —titular al margen, cuerpo desplazado—, y de ahí salían
 * las dos cosas que se veían mal: el título de la página no caía en el mismo eje
 * que las secciones y el enlace al historial se quedaba en una columna estrecha,
 * partido en una palabra por línea. Aquí todas las secciones comparten el mismo
 * contenedor y la misma cabecera: título y dibujo a la izquierda, cuenta y enlace
 * a la derecha.
 *
 * **Cada sección vacía se explica en una tarjeta, no se esconde.** Esconderla deja
 * al usuario con una página que cambia de forma sin motivo y sin saber que existe
 * una función que no está usando; el vacío dice **dónde** se marca, que es lo que
 * un botón de «no hay nada» nunca cuenta.
 *
 * El historial va **recortado** y con un enlace a su pantalla: aquí es un resumen y
 * quien pagina es `HistoryPage`. Sus tarjetas son las mismas que las de la home
 * —`Pieza`, con barra de progreso y episodio—, no una miniatura aparte.
 */

import type { WatchHistoryItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import { ArrowRight, Bookmark, CircleCheck, History, type LucideIcon, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { EstadoVacio } from '../../components/EstadoVacio'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SeccionPagina } from '../../components/SeccionPagina'
import { Skeleton } from '../../components/Skeleton'
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
 * Las tres marcas del usuario se pintan igual —título, cuenta, rejilla y su
 * vacío—, así que la mecánica vive una sola vez y lo que cambia es el texto. Con
 * tres copias, la tercera se olvidaría de la cuenta o del estado vacío.
 */
function SeccionResumen(props: {
  readonly titulo: string
  readonly icono: LucideIcon
  readonly meta: string
  readonly vacioTitulo: string
  readonly vacioAyuda: string
  readonly items: readonly AnimeSummary[]
  readonly dataTour?: string
}): ReactNode {
  const vacia = props.items.length === 0

  return (
    <SeccionPagina
      titulo={props.titulo}
      icono={props.icono}
      meta={props.meta}
      cuenta={cuentaDeTitulos(props.items.length)}
      {...(props.dataTour === undefined ? {} : { dataTour: props.dataTour })}
    >
      {vacia ? (
        <EstadoVacio icono={props.icono} titulo={props.vacioTitulo} ayuda={props.vacioAyuda} />
      ) : (
        <Mosaico className="mosaico--carrusel">
          {props.items.map((item, indice) => (
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
          ))}
        </Mosaico>
      )}
    </SeccionPagina>
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

/** El enlace al historial: texto que se acorta y la flecha al final. */
function VerTodo(): ReactNode {
  const largo = t(DEFAULT_LOCALE, 'profile.history.all')

  return (
    <Link className="pagina__ver" to="/history" ariaLabel={largo}>
      <span className="pagina__ver-largo">{largo}</span>
      <span className="pagina__ver-corto">{t(DEFAULT_LOCALE, 'profile.history.allShort')}</span>
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
    </Link>
  )
}

function Esqueleto(): ReactNode {
  return (
    <section aria-busy="true">
      <p className="empty">{t(DEFAULT_LOCALE, 'profile.loading')}</p>
      <Skeleton h="var(--skeleton-height)" />
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
    <article className="pagina perfil">
      <h1>{t(DEFAULT_LOCALE, 'profile.title')}</h1>

      <SeccionResumen
        titulo={t(DEFAULT_LOCALE, 'profile.favorites')}
        icono={Star}
        meta={t(DEFAULT_LOCALE, 'profile.favorites.meta')}
        vacioTitulo={t(DEFAULT_LOCALE, 'profile.favorites.empty.title')}
        vacioAyuda={t(DEFAULT_LOCALE, 'profile.favorites.empty')}
        items={data.favorites}
        dataTour={ANCLAS.perfilListas}
      />

      <SeccionResumen
        titulo={t(DEFAULT_LOCALE, 'profile.watched')}
        icono={CircleCheck}
        meta={t(DEFAULT_LOCALE, 'profile.watched.meta')}
        vacioTitulo={t(DEFAULT_LOCALE, 'profile.watched.empty.title')}
        vacioAyuda={t(DEFAULT_LOCALE, 'profile.watched.empty')}
        items={data.watched}
      />

      <SeccionResumen
        titulo={t(DEFAULT_LOCALE, 'profile.planToWatch')}
        icono={Bookmark}
        meta={t(DEFAULT_LOCALE, 'profile.planToWatch.meta')}
        vacioTitulo={t(DEFAULT_LOCALE, 'profile.planToWatch.empty.title')}
        vacioAyuda={t(DEFAULT_LOCALE, 'profile.planToWatch.empty')}
        items={data.planToWatch}
      />

      <SeccionPagina
        titulo={t(DEFAULT_LOCALE, 'profile.history')}
        icono={History}
        meta={t(DEFAULT_LOCALE, 'profile.history.meta')}
        cuenta={cuentaDeTitulos(historial.items.length)}
        {...(historial.items.length === 0 ? {} : { accion: <VerTodo /> })}
        dataTour={ANCLAS.perfilHistorial}
      >
        {historial.items.length === 0 ? (
          // El vacío del historial no lleva enlace: sin nada reproducido no hay
          // nada que ver «todo», y ofrecerlo llevaría a una pantalla vacía.
          <EstadoVacio
            icono={History}
            titulo={t(DEFAULT_LOCALE, 'profile.history.empty.title')}
            ayuda={t(DEFAULT_LOCALE, 'profile.history.empty')}
          />
        ) : (
          <Mosaico className="mosaico--carrusel">
            {historial.items.map((item, indice) => (
              // La clave es la fila del visionado y no la referencia: el mismo
              // episodio puede salir dos veces, porque el historial no agrupa.
              <PiezaDeHistorial key={item.id} item={item} indice={indice} />
            ))}
          </Mosaico>
        )}
      </SeccionPagina>
    </article>
  )
}
