/**
 * La marquesina: el destacado.
 *
 * Es la primera pieza de la vitrina y la que dice de qué va la aplicación: un
 * campo de degradado a sangre, el título en cuerpo de cartel a la izquierda y el
 * cartel —la portada, con marco— a la derecha. Debajo cuelga la cinta, que la
 * pone la home.
 *
 * El botón principal **reproduce el primer episodio** y el secundario guarda el
 * título en favoritos. El botón de reproducir sólo aparece si se conoce la
 * referencia del primer episodio: sin ella llevaría a una pantalla de error, y es
 * mejor no ofrecerlo.
 *
 * El cartel no lleva pie: el titular ya está enfrente, en cuerpo de cartel, y
 * repetirlo dentro del marco es decir dos veces lo mismo.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { FavoriteButton } from '../detail/FavoriteButton'
import { useFavorite } from '../detail/useDetail'
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
}

/** La línea de datos: géneros, año y número de episodios, con lo que haya. */
export function featuredMeta(item: FeaturedItem, episodeCount: number | undefined): string {
  const partes: string[] = [...item.tags]
  if (item.year !== undefined) partes.push(String(item.year))
  if (episodeCount !== undefined) partes.push(`${episodeCount} ep.`)

  return partes.join(' / ')
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
      <span className="marquesina__velo" aria-hidden="true" />

      <div className="marquesina__cuerpo">
        <div className="marquesina__texto">
          <span className="marquesina__etiqueta">{t(DEFAULT_LOCALE, 'home.featured.tag')}</span>

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

          <div className="marquesina__acciones">
            {firstEpisode === undefined ? null : (
              <Link
                to={`/watch/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(firstEpisode.ref.value)}`}
                className="button button--primary"
              >
                {t(DEFAULT_LOCALE, 'home.featured.play', { number: firstEpisode.number })}
              </Link>
            )}

            <FavoriteButton
              value={favorite.value}
              busy={favorite.busy}
              onToggle={favorite.toggle}
            />
          </div>
        </div>

        <Link
          to={`/anime/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(props.item.ref.value)}`}
          className="marquesina__cartel"
          title={props.item.title}
        >
          <Cover
            providerId={props.item.ref.providerId}
            ref={props.item.ref.value}
            className="marquesina__cover"
          />
        </Link>
      </div>
    </section>
  )
}
