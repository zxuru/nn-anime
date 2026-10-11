/**
 * El cartel de destacado.
 *
 * Es el primero del ranking y ocupa el ancho entero: portada, etiquetas de
 * género, la línea de datos, la sinopsis en dos líneas y los dos botones. El
 * botón principal **reproduce el primer episodio** y el secundario guarda el
 * título en favoritos, que es lo que hace el diseño de referencia con «play» y
 * «my list».
 *
 * El botón de reproducir sólo aparece si se conoce la referencia del primer
 * episodio: sin ella llevaría a una pantalla de error, y es mejor no ofrecerlo.
 */

import type { RecommendationResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { FavoriteButton } from '../detail/FavoriteButton'
import { useFavorite } from '../detail/useDetail'
import { useFeatured } from './useFeatured'

export interface FeaturedHeroProps {
  readonly item: RecommendationResponse
}

/** La línea de datos: géneros, año y número de episodios, con lo que haya. */
export function featuredMeta(
  item: RecommendationResponse,
  episodeCount: number | undefined,
): string {
  const partes: string[] = [...item.tags]
  if (item.year !== undefined) partes.push(String(item.year))
  if (episodeCount !== undefined) partes.push(`${episodeCount} ep.`)

  return partes.join(' / ')
}

export function FeaturedHero(props: FeaturedHeroProps): ReactNode {
  const { detail, firstEpisode } = useFeatured(props.item.ref)
  const favorite = useFavorite(props.item.ref, false)
  const meta = featuredMeta(props.item, detail?.episodeCount)

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__body">
        <span className="tag tag--hot">{t(DEFAULT_LOCALE, 'home.featured.tag')}</span>

        <h1 className="hero__title" id="hero-title">
          {props.item.title}
        </h1>

        {meta === '' ? null : <p className="hero__meta">{meta}</p>}

        {detail?.synopsis === undefined ? null : (
          <p className="hero__synopsis">{detail.synopsis}</p>
        )}

        <div className="hero__actions">
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

      {/*
        La pila de portadas: la del título y dos copias giradas detrás. Es del
        diseño de referencia y se hace con CSS, sin imágenes de más.
      */}
      <div className="hero__stack" aria-hidden="true">
        <span className="hero__back hero__back--left" />
        <span className="hero__back hero__back--right" />
        <Link
          to={`/anime/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(props.item.ref.value)}`}
          className="hero__poster"
        >
          <Cover
            providerId={props.item.ref.providerId}
            ref={props.item.ref.value}
            className="hero__cover"
          />
          <span className="poster__caption">
            <span className="poster__title">{props.item.title}</span>
            <span className="poster__meta">{props.item.reason.text}</span>
          </span>
        </Link>
      </div>
    </section>
  )
}
