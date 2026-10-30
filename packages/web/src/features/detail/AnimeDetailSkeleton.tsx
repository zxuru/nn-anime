/**
 * El esqueleto de la ficha.
 *
 * Mientras la ficha carga se reserva **su misma forma**: la banda, las dos
 * columnas, la portada, los mandos, la sinopsis y seis filas de episodios. No es
 * un «cargando» centrado en la pantalla porque ese texto desaparece cuando llega
 * el contenido y el salto se lee como un fallo; con la forma de la ficha, lo que
 * llega ocupa el sitio que ya estaba esperando.
 *
 * Tres detalles que se ven en pantalla:
 *
 * 1. **Lo que la tarjeta de origen ya sabía se pinta de verdad.** El título, la
 *    línea de metadatos y la portada llegan en el estado de navegación; pintarlos
 *    desde el primer fotograma es la diferencia entre «abrió» y «está abriendo».
 *    Se pintan con el markup real, no con huecos: son datos, no reservas.
 * 2. **Antes de 150 ms no se ve ningún bloque.** `visible` llega tarde a
 *    propósito (`useDelayedFlag`); el CSS deja transparentes los esqueletos
 *    mientras tanto, así que una respuesta rápida o cacheada no parpadea.
 * 3. **Ningún texto visible de carga.** Lo único que se anuncia es el estado por
 *    un lector de pantalla, y el aviso de lentitud aparece a los ocho segundos,
 *    cuando ya hay algo que contar.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { Skeleton } from '../../components/Skeleton'
import { t } from '../../i18n'
import { CARGA } from './carga-textos'
import type { DetailNavState } from './nav-state'

export interface AnimeDetailSkeletonProps {
  /** Lo que la tarjeta de origen sabía de la ficha: título, portada, metadatos. */
  readonly optimistic?: DetailNavState | undefined
  /** Si ya pasó el umbral de los 150 ms: antes de eso no se pinta ningún bloque. */
  readonly visible: boolean
  /** Si la espera pasa de ocho segundos: se añade el aviso de lentitud. */
  readonly lento: boolean
}

/**
 * Las seis filas que se reservan, con su número como clave.
 *
 * Son decorativas y fijas —la lista siempre mide lo mismo—, pero React necesita
 * una clave que no sea la posición: con el índice, cualquier reordenación futura
 * reutilizaría el nodo equivocado. El número escrito es la clave estable.
 */
const FILAS_ESQUELETO = [1, 2, 3, 4, 5, 6] as const

/**
 * La línea de metadatos que ya se sabe, o nada si no hay nada que decir.
 *
 * Es la misma línea que la ficha cargada —datos separados por «·»—, sólo que con
 * lo que trajo la tarjeta. Los géneros no llevan enlace aquí: el adelanto es
 * texto mientras el resto de la ficha todavía no sabe de qué título habla.
 */
function metadatosOptimistas(optimistic: DetailNavState): string | undefined {
  const partes: string[] = []

  if (optimistic.genres !== undefined && optimistic.genres.length > 0) {
    partes.push(optimistic.genres.join(', '))
  }

  if (optimistic.episodes !== undefined) {
    partes.push(t(DEFAULT_LOCALE, 'detail.season.count', { count: optimistic.episodes }))
  }

  if (optimistic.year !== undefined) partes.push(String(optimistic.year))

  return partes.length === 0 ? undefined : partes.join(' · ')
}

export function AnimeDetailSkeleton(props: AnimeDetailSkeletonProps): ReactNode {
  const { optimistic, visible, lento } = props
  const metadatos = optimistic === undefined ? undefined : metadatosOptimistas(optimistic)

  return (
    <article
      className="detail detalle-esqueleto"
      data-visible={visible ? 'true' : 'false'}
      aria-busy="true"
    >
      {/* El estado de la carga sólo se anuncia: no se ve, porque un texto de
          «cargando» que desaparece hace saltar el contenido al llegar. */}
      <p className="solo-lectores sr-only" role="status">
        {t(DEFAULT_LOCALE, CARGA.status)}
      </p>

      <header className="detail__banner">
        <div className="detail__banner-caja">
          {optimistic === undefined ? (
            <Skeleton h="var(--text-2xl)" w="62%" className="detalle-esqueleto__titulo" />
          ) : (
            <h1>{optimistic.title}</h1>
          )}

          {metadatos === undefined ? (
            <Skeleton h="var(--text-sm)" w="28%" className="detalle-esqueleto__meta" />
          ) : (
            <p className="detail__meta">{metadatos}</p>
          )}
        </div>
      </header>

      {/* Las mismas dos cajas que la ficha cargada: la banda cruza la ventana y
          la medida del sitio se recupera en el cuerpo, así que la rejilla mide
          lo mismo antes y después de los datos. */}
      <div className="detail__cuerpo">
        <aside className="detail__aside">
          {optimistic?.poster === undefined ? (
            <div className="skeleton detalle-esqueleto__portada" aria-hidden="true" />
          ) : (
            <Cover src={optimistic.poster} className="detalle-esqueleto__portada" />
          )}

          {/* Un botón principal y un icono: la forma del grupo de marcas, no tres
              huecos iguales. */}
          <div className="detail__actions detalle-esqueleto__acciones">
            <Skeleton h="var(--header-height)" />
            <Skeleton w="var(--control-size)" h="var(--header-height)" />
          </div>
        </aside>

        <div className="detail__body">
          {/* Tres renglones con medidas distintas: la sinopsis no es un bloque
              macizo y un solo hueco no reserva su alto. */}
          <div className="detalle-esqueleto__sinopsis">
            <Skeleton h="var(--renglon)" />
            <Skeleton h="var(--renglon)" w="92%" />
            <Skeleton h="var(--renglon)" w="68%" />
          </div>

          {/* El titular de la sección y seis filas: el alto de una fila real está
              en `--episode-row-height`, así que la lista no cambia de tamaño. */}
          <section className="detalle-esqueleto__episodios">
            <Skeleton h="var(--text-xs)" w="18%" />
            <ul className="episodes">
              {FILAS_ESQUELETO.map((fila) => (
                <li className="detalle-esqueleto__episodio" key={fila}>
                  <Skeleton h="var(--episode-row-height)" />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {lento ? (
        <p className="detalle-esqueleto__aviso" role="status">
          <Clock
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
            className="detalle-esqueleto__aviso-icono"
          />
          {t(DEFAULT_LOCALE, CARGA.slow)}
        </p>
      ) : null}
    </article>
  )
}
