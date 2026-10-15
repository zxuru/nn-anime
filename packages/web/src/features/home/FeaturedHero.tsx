/**
 * La marquesina: el destacado.
 *
 * Es la primera pieza de la vitrina y la que dice de qué va la aplicación: un
 * campo de degradado a sangre, el título en cuerpo de cartel a la izquierda —con su
 * etiqueta, su línea de datos, la sinopsis y el motivo— y el cartel a la derecha:
 * la portada dibujada, con marco propio y algo girada, con su pie. Debajo, pegada
 * al borde inferior, corre la cinta de lo más visto. En la esquina, la marca que
 * dice cuándo se releyó.
 *
 * El botón principal **reproduce el primer episodio** y el secundario guarda el
 * título en favoritos. El botón de reproducir sólo aparece si se conoce la
 * referencia del primer episodio: sin ella llevaría a una pantalla de error, y es
 * mejor no ofrecerlo.
 *
 * El arte del cartel es el de reserva —el campo y la inicial—: si la portada llega,
 * manda la portada. La letra se mide con el contenedor del cartel (104 cqi) porque
 * es un campo grande: a tamaño de pieza pequeña se comería el marco.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary, ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { FavoriteButton } from '../detail/FavoriteButton'
import { useFavorite } from '../detail/useDetail'
import { Ticker } from './Ticker'
import { useFeatured } from './useFeatured'

/**
 * Lo que el cartel necesita de verdad.
 *
 * No es `RecommendationResponse` porque el destacado puede **no** venir del motor:
 * cuando no hay nada que recomendar, el cartel se llena con lo primero del feed o
 * con lo último que la aplicación conoce. Esos no tienen `score` ni motivo, y
 * pedírselos obligaría a inventárselos, que es justo lo que el motor existe para
 * no hacer. Una recomendación de verdad encaja en esta forma tal cual.
 */
export interface FeaturedItem {
  readonly ref: ProviderRef
  readonly title: string
  readonly year?: number | undefined
  readonly tags: readonly string[]
  /** El motivo, si viene del motor. Un destacado de reserva no lo tiene. */
  readonly reason?: { readonly text: string } | undefined
}

export interface FeaturedHeroProps {
  readonly item: FeaturedItem
  /** Cuándo se releyó la home, si ya se releyó. */
  readonly refresco?: string | undefined
  /** Lo que corre por la cinta, pegada al borde inferior. */
  readonly tendencias?: readonly AnimeSummary[] | undefined
}

/** La línea de datos: géneros, año y número de episodios, con lo que haya. */
export function featuredMeta(item: FeaturedItem, episodeCount: number | undefined): string {
  const partes: string[] = [...item.tags]
  if (item.year !== undefined) partes.push(String(item.year))
  if (episodeCount !== undefined) partes.push(`${episodeCount} ep.`)

  return partes.join(' · ')
}

/** El pie del cartel: el título y el año, como en la vitrina impresa. */
export function pieDelCartel(item: FeaturedItem): string {
  return item.year === undefined ? item.title : `${item.title} · ${item.year}`
}

export function FeaturedHero(props: FeaturedHeroProps): ReactNode {
  const { detail, firstEpisode } = useFeatured(props.item.ref)
  const favorite = useFavorite(props.item.ref)
  // Los géneros del detalle son el respaldo de un destacado sin tags: una entrada
  // del feed no trae vector, pero su ficha sí trae géneros, y la línea de datos no
  // tiene por qué quedarse vacía por eso.
  const tags = props.item.tags.length > 0 ? props.item.tags : (detail?.genres ?? [])
  const meta = featuredMeta({ ...props.item, tags }, detail?.episodeCount)

  return (
    <section className="marquesina" aria-labelledby="hero-title">
      <span className="marquesina__campo" aria-hidden="true" />
      <span className="marquesina__capa" aria-hidden="true" />

      {props.refresco === undefined ? null : (
        <p className="marca-refresco" role="status">
          {props.refresco}
        </p>
      )}

      <div className="marquesina__texto">
        <p className="etiqueta">{t(DEFAULT_LOCALE, 'home.featured.tag')}</p>

        <h1 className="marquesina__titulo" id="hero-title">
          {props.item.title}
        </h1>

        {meta === '' ? null : <p className="marquesina__meta">{meta}</p>}

        {detail?.synopsis === undefined ? null : (
          <p className="marquesina__sinopsis">{detail.synopsis}</p>
        )}

        {props.item.reason === undefined ? null : (
          <p className="marquesina__motivo">{props.item.reason.text}</p>
        )}

        <div className="acciones">
          {firstEpisode === undefined ? null : (
            <Link
              to={`/watch/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(firstEpisode.ref.value)}`}
              className="button button--primary"
            >
              {t(DEFAULT_LOCALE, 'home.featured.play', { number: firstEpisode.number })}
            </Link>
          )}

          <FavoriteButton value={favorite.value} busy={favorite.busy} onToggle={favorite.toggle} />
        </div>
      </div>

      <Link
        to={`/anime/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(props.item.ref.value)}`}
        className="cartel"
        title={props.item.title}
      >
        <span className="pz__arte" aria-hidden="true">
          <Cover
            providerId={props.item.ref.providerId}
            ref={props.item.ref.value}
            className="pz__campo"
          >
            <span className="pz__letra" aria-hidden="true">
              {props.item.title.slice(0, 1)}
            </span>
          </Cover>
          <span className="pz__velo" />
        </span>

        <span className="cartel__pie">{pieDelCartel(props.item)}</span>
      </Link>

      {props.tendencias === undefined ? null : <Ticker items={props.tendencias} />}
    </section>
  )
}
