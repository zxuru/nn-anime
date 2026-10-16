/**
 * La lista de AniList pintada como los resultados de la página.
 *
 * Una búsqueda con género —`#aventura`— no la entiende ninguna fuente: buscan el texto
 * literal y devuelven lo que se les parezca. Esa búsqueda la contesta el catálogo, y esta
 * rejilla es su resultado, **con las tarjetas de siempre**: la misma `card`, la misma
 * portada, el mismo pie. Lo que cambia es de dónde sale el dato, no cómo se lee.
 *
 * La tarjeta **no lleva sello**: el enlace ya dice lo que hay. Una obra que la base conoce
 * abre su ficha —con sus episodios y su reproductor— y una que no, la búsqueda de su
 * título, que es la salida honesta. Eso lo decide `destinoDe`, la misma regla que usan las
 * filas de la vitrina.
 *
 * La portada es una **ruta local** (`/api/anilist/image/cover/<id>`): el navegador sigue
 * sin conocer ningún origen remoto y la CSP no cambia.
 */

import type { DiscoverItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { Grid, GridItem } from '../../components/Grid'
import { t } from '../../i18n'
import { Link } from '../../router'
import { destinoDe, metaDeDescubrir } from '../home/descubrir'

export interface AniListCardProps {
  readonly item: DiscoverItem
}

export function AniListCard(props: AniListCardProps): ReactNode {
  const { item } = props
  const meta = metaDeDescubrir(item)

  return (
    <Link to={destinoDe(item)} className="card" title={item.title}>
      <Cover src={item.cover} className="card__cover" />
      <span className="card__title">{item.title}</span>
      {meta === undefined ? null : <span className="card__meta">{meta}</span>}
    </Link>
  )
}

export interface AniListCardsProps {
  readonly items: readonly DiscoverItem[]
  /** Si la búsqueda ya cerró: sin esto, un vacío no es una conclusión. */
  readonly done: boolean
  readonly query: string
}

export function AniListCards(props: AniListCardsProps): ReactNode {
  if (props.items.length === 0) {
    // Mientras busca no se afirma nada: el renglón de estado ya dice que está buscando.
    if (!props.done) return null

    return (
      <p className="empty">{t(DEFAULT_LOCALE, 'search.catalogue.empty', { query: props.query })}</p>
    )
  }

  return (
    <Grid label={t(DEFAULT_LOCALE, 'search.results')}>
      {props.items.map((item) => (
        <GridItem key={`anilist:${item.anilistId}`}>
          <AniListCard item={item} />
        </GridItem>
      ))}
    </Grid>
  )
}
