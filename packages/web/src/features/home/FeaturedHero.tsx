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
 * **La composición no depende de lo que tarde la ficha.** El titular se acota a tres
 * renglones, y la línea de datos y la sinopsis ocupan su hueco desde el primer
 * fotograma —con un esqueleto mientras no hay nada que decir—, así que la columna
 * mide lo mismo antes y después de que llegue la respuesta. Antes no: la sinopsis
 * aparecía tarde, la marquesina centra su texto y el titular subía de golpe al
 * cargar, que es el salto que se veía.
 *
 * El arte del cartel es el de reserva —el campo y la inicial—: si la portada llega,
 * manda la portada. La letra se mide con el contenedor del cartel (104 cqi) porque
 * es un campo grande: a tamaño de pieza pequeña se comería el marco.
 *
 * **El campo es el banner de la obra cuando lo hay**, y con él cambia la tinta:
 * una imagen clara pide letra oscura y una oscura, letra crema. El par —tinta y
 * velo— lo elige `tinta.ts` midiendo la imagen, y el banner no se pinta hasta que
 * la medida está: así el campo no enseña nunca la letra del color equivocado.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary, ProviderRef } from '@nn-anime/core/models'
import { Layers, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { IconLabel } from '../../components/IconLabel'
import { t } from '../../i18n'
import { Link } from '../../router'
import { FavoriteButton } from '../detail/FavoriteButton'
import { navStateDeTarjeta } from '../detail/nav-state'
import { useDetailPrefetch } from '../detail/prefetch'
import { useFavorite } from '../detail/useDetail'
import { ANCLAS } from '../guia/guia'
import { Ticker } from './Ticker'
import { useBannerDeLaMarquesina } from './tinta'
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

/** La línea de datos: los géneros y el año, con lo que haya. */
export function featuredMeta(item: FeaturedItem): string {
  const partes: string[] = [...item.tags]
  if (item.year !== undefined) partes.push(String(item.year))

  return partes.join(' · ')
}

/** El pie del cartel: el título y el año, como en la vitrina impresa. */
export function pieDelCartel(item: FeaturedItem): string {
  return item.year === undefined ? item.title : `${item.title} · ${item.year}`
}

export function FeaturedHero(props: FeaturedHeroProps): ReactNode {
  const { loading, detail, firstEpisode, banner } = useFeatured(props.item.ref)
  // El banner no se pinta hasta que se conoce su tono: la tinta se elige con él, y
  // enseñarlo antes sería enseñar el texto del color equivocado durante un
  // fotograma. Sin medida no hay banner y el campo se queda con su degradado.
  const bannerMedido = useBannerDeLaMarquesina(banner)
  const favorite = useFavorite(props.item.ref)
  // Los géneros del detalle son el respaldo de un destacado sin tags: una entrada
  // del feed no trae vector, pero su ficha sí trae géneros, y la línea de datos no
  // tiene por qué quedarse vacía por eso.
  const tags = props.item.tags.length > 0 ? props.item.tags : (detail?.genres ?? [])
  const meta = featuredMeta({ ...props.item, tags })
  const episodios = detail?.episodeCount

  /*
    El cartel ya conoce el título, el año y los géneros, así que la ficha puede
    pintarlos antes de pedir nada. La portada no hace falta pasarla: el estado la
    deriva de la referencia, que es la misma que pinta el `Cover` de al lado.
  */
  const estadoCartel = navStateDeTarjeta({
    title: props.item.title,
    providerId: props.item.ref.providerId,
    ref: props.item.ref.value,
    year: props.item.year,
    genres: tags,
    episodes: episodios,
  })
  /*
    Pasar el puntero por el cartel es la intención más clara que hay en la home:
    se precarga su ficha con el mismo gancho que las tarjetas, y el toque del móvil
    la pide al instante.
  */
  const prefetch = useDetailPrefetch(props.item.ref.providerId, props.item.ref.value)

  return (
    <section
      className="marquesina"
      aria-labelledby="hero-title"
      data-tinta={bannerMedido?.tinta}
      data-tour={ANCLAS.destacado}
    >
      <span className="marquesina__campo" aria-hidden="true">
        {/* La dirección sale del gancho ya comprobada —es una ruta local de AniList
            y no una de fuera—: aquí sólo se pinta lo que él devuelve. */}
        {bannerMedido === undefined ? null : (
          // El banner es el fondo de la primera pantalla: se pide con prioridad
          // alta y se decodifica fuera del hilo de la pintura, como el cartel.
          <img
            className="marquesina__banner"
            src={bannerMedido.src}
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        )}
      </span>
      <span className="marquesina__capa" aria-hidden="true" />

      {props.refresco === undefined ? null : (
        <p className="marca-refresco" role="status">
          {props.refresco}
        </p>
      )}

      <div className="marquesina__texto" aria-busy={loading}>
        <p className="etiqueta">{t(DEFAULT_LOCALE, 'home.featured.tag')}</p>

        {/*
          El titular se acota a tres renglones. Un nombre largo —«… 3rd Season Part
          2», con el subtítulo pegado— a cuerpo de cartel ocupaba media pantalla y
          empujaba los mandos fuera de ella. El texto entero sigue en el documento:
          quien lo lea con un lector de pantalla lo oye completo.
        */}
        <h1 className="marquesina__titulo" id="hero-title">
          {props.item.title}
        </h1>

        {/*
          La línea de datos y la sinopsis se pintan **siempre**, aunque estén
          vacías: su hueco está reservado en la hoja y el titular de al lado no se
          mueve cuando la ficha llega. Antes la sinopsis aparecía tarde y empujaba
          la columna entera hacia arriba —la marquesina centra su texto—, así que
          la página daba un salto al cargar.
        */}
        <p className="marquesina__meta">
          {meta}
          {episodios === undefined ? null : (
            <>
              {meta === '' ? null : ' · '}
              {/*
                La cifra lleva su dibujo porque «12 ep.» y «12» no se distinguen
                a la primera: la capa dice «esto son episodios» sin una palabra
                más, y el nombre completo sigue en el texto para el lector.
              */}
              <span className="marquesina__episodios">
                <Layers size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
                {t(DEFAULT_LOCALE, 'home.featured.episodes', { count: episodios })}
              </span>
            </>
          )}
        </p>

        {loading ? (
          <p className="marquesina__esqueleto" aria-hidden="true">
            <span className="marquesina__hueso" />
            <span className="marquesina__hueso marquesina__hueso--corto" />
          </p>
        ) : (
          <p className="marquesina__sinopsis">{detail?.synopsis}</p>
        )}

        {/*
          El motivo se pinta siempre por el mismo motivo que la línea de datos:
          llega con la recomendación, y un destacado de reserva —el del feed, que no
          puntúa en el motor— no lo tiene hasta que el motor responde. Sin su hueco,
          el cambio de destacado movía todo lo que hay debajo de la marquesina.
        */}
        <p className="marquesina__motivo">{props.item.reason?.text}</p>

        <div className="acciones">
          {firstEpisode === undefined ? null : (
            <Link
              to={`/watch/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(firstEpisode.ref.value)}`}
              className="button button--primary"
            >
              {/*
                En escritorio se lee el mandato entero; en un teléfono, «Ep. 1».
                Las dos versiones van en el documento y la hoja elige: así el
                nombre accesible no cambia con el ancho de la ventana.
              */}
              <IconLabel
                icon={Play}
                label={t(DEFAULT_LOCALE, 'home.featured.play', { number: firstEpisode.number })}
                short={t(DEFAULT_LOCALE, 'home.featured.playShort', {
                  number: firstEpisode.number,
                })}
              />
            </Link>
          )}

          <FavoriteButton value={favorite.value} busy={favorite.busy} onToggle={favorite.toggle} />
        </div>
      </div>

      <Link
        to={`/anime/${encodeURIComponent(props.item.ref.providerId)}/${encodeURIComponent(props.item.ref.value)}`}
        className="cartel"
        title={props.item.title}
        state={estadoCartel}
        onPointerEnter={prefetch.onPointerEnter}
        onPointerLeave={prefetch.onPointerLeave}
        onPointerDown={prefetch.onPointerDown}
      >
        <span className="pz__arte" aria-hidden="true">
          <Cover
            providerId={props.item.ref.providerId}
            ref={props.item.ref.value}
            className="pz__campo"
            prioridad
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
