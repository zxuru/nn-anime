/**
 * Pantalla de detalle.
 *
 * Tres estados y ninguno se disimula: mientras carga se ve un esqueleto con la
 * forma de la ficha —no un «cargando» que salta cuando llega el contenido—, si
 * falla se dice qué falló y se ofrece reintentar, y si el título no está se dice
 * eso y no «error». Un reintento que no existe obliga a recargar la página, que
 * es justo lo que el spec prohíbe.
 *
 * **Ningún dato del proveedor se inserta como HTML.** La sinopsis es texto de
 * fuera y se pinta como texto: `dangerouslySetInnerHTML` con datos de un
 * proveedor es la única línea que convierte un sitio ajeno en un XSS en el
 * navegador del usuario, y el contrato de la interfaz lo prohíbe.
 *
 * El selector de modo **elige de verdad**: el modo marcado es el que viaja con
 * cada episodio hasta el reproductor. Antes eran dos botones que sólo decían qué
 * sabe hacer el proveedor y la lista de episodios no llevaba a ninguna parte, así
 * que la ficha entera era un callejón sin salida.
 */

import { anilistGenre } from '@nn-anime/core/anilist'
import type { Enrichment } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeDetail } from '@nn-anime/core/models'
import { Fragment, type ReactNode, useState } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { Cover } from '../../components/Cover'
import { ErrorNotice } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import { detailTitleParts, useDocumentTitle } from '../../lib/document-title'
import { isSafeUrl } from '../../lib/safe-url'
import { Link } from '../../router'
import { PLAY_MODES, type PlayMode } from '../player/watch-route'
import { searchPath } from '../search/SearchPage'
import { EpisodeList } from './EpisodeList'
import { FavoriteButton } from './FavoriteButton'
import { SagaRail } from './SagaRail'
import { SourcePicker } from './SourcePicker'
import { chosenMode, modesFor, useDetail, useFavorite, useWatchedTitle } from './useDetail'
import { WatchedButton } from './WatchedButton'

/** La clave de traducción del estado, escrita una a una. */
const STATUS_KEYS = {
  airing: 'detail.status.airing',
  finished: 'detail.status.finished',
  upcoming: 'detail.status.upcoming',
  unknown: 'detail.status.unknown',
} as const

export interface DetailPageProps {
  readonly providerId: string
  readonly ref: string
}

function Meta(props: { readonly detail: AnimeDetail }): ReactNode {
  const { detail } = props
  const estado = STATUS_KEYS[detail.status ?? 'unknown']

  return (
    <p className="detail__meta">
      {t(DEFAULT_LOCALE, 'detail.meta', {
        year: detail.year ?? '—',
        status: t(DEFAULT_LOCALE, estado),
      })}
    </p>
  )
}

/**
 * La ruta del banner, sólo si es la que compone el servidor.
 *
 * No pasa por `isSafeUrl`, que sólo admite direcciones absolutas: la del banner
 * es una ruta local —el navegador no conoce ninguna dirección de AniList— y
 * `isSafeUrl` la rechazaría dejando la ficha sin fondo. Lo que se comprueba es
 * el contrato entero: la forma exacta que produce `anilistImagePath` para un
 * banner. Cualquier otra cosa —un esquema, comillas, otra ruta— no se pinta.
 */
export function fondoDe(enrichment: Enrichment | null | undefined): string | undefined {
  const banner = enrichment?.banner
  if (banner === undefined || !BANNER_PATH.test(banner)) return undefined

  return banner
}

/** La ruta que el servidor compone para el banner de una obra de AniList. */
const BANNER_PATH = /^\/api\/anilist\/image\/banner\/[1-9]\d*$/

/**
 * La cabecera de la ficha: el título, el otro nombre y el año, sobre el banner.
 *
 * La imagen va **de fondo**, en una capa decorativa —`aria-hidden` y sin texto—
 * y nunca como un `<img>` del flujo: un banner que no llegaba dejaba el icono de
 * imagen rota del navegador entre la sinopsis y los episodios, que es lo que se
 * veía en la ficha. Como fondo, una imagen que no carga simplemente no se pinta,
 * y la ficha se lee igual.
 *
 * La banda se pinta **con o sin** banner: es la cabecera de la ficha, así que la
 * pantalla no cambia de forma cuando el emparejamiento con AniList llega tarde o
 * no llega.
 *
 * El contenido va en su propia caja porque la banda cruza la ventana entera: sin
 * ella, en una pantalla de 2560 px el nombre quedaría a 32 px del borde y la
 * sinopsis, que sí conserva la medida del sitio, a 680. La caja es lo que alinea
 * el titular con el resto de la ficha.
 */
export function BandaBanner(props: {
  readonly detail: AnimeDetail
  readonly fondo?: string | undefined
}): ReactNode {
  const { detail, fondo } = props

  return (
    <header className="detail__banner">
      {/* El `url()` se compone con `JSON.stringify` para que la ruta quede entre
          comillas y no pueda cerrar el valor: el estilo entra por CSSOM —esto no
          es HTML—, pero tampoco es un sitio donde dejar pasar texto ajeno. */}
      {fondo === undefined ? null : (
        <span
          className="detail__banner-fondo"
          style={{ backgroundImage: `url(${JSON.stringify(fondo)})` }}
          aria-hidden="true"
        />
      )}
      <div className="detail__banner-caja">
        <h1>{detail.title}</h1>
        {detail.titleAlt === undefined ? null : <p className="card__meta">{detail.titleAlt}</p>}
        <Meta detail={detail} />
      </div>
    </header>
  )
}

/** La sinopsis: la del proveedor y, si no la trae, la de AniList. */
export function sinopsis(
  detail: AnimeDetail,
  enrichment: Enrichment | null | undefined,
): string | undefined {
  return detail.synopsis ?? enrichment?.synopsis
}

/** Los géneros: los de la fuente mandan; AniList sólo llena el vacío. */
export function generos(
  detail: AnimeDetail,
  enrichment: Enrichment | null | undefined,
): readonly string[] {
  return detail.genres.length > 0 ? detail.genres : (enrichment?.genres ?? [])
}

/** Los estudios, con la misma regla que los géneros. */
export function estudios(
  detail: AnimeDetail,
  enrichment: Enrichment | null | undefined,
): readonly string[] {
  return detail.studios.length > 0 ? detail.studios : (enrichment?.studios ?? [])
}

/**
 * Lo que añade AniList a la ficha.
 *
 * Tres decisiones, y las tres se ven aquí:
 *
 * 1. **La sinopsis de AniList es la reserva.** Si el proveedor trae la suya, manda
 *    la suya —es el dato de la fuente que el usuario eligió—; cuando no la trae,
 *    ésta la llena.
 * 2. **Los géneros y los estudios se prefieren de la ficha local** y AniList sólo
 *    los completa cuando están vacíos: son los de la fuente, que es de quien es el
 *    título.
 * 3. **Nada de esto es HTML.** La sinopsis llega en texto plano desde el servidor
 *    —el saneado está en `core`— y se pinta como texto, igual que la del proveedor.
 */
export function seccionesDe(enriquecido: Enrichment | null | undefined): ReactNode {
  if (enriquecido === null || enriquecido === undefined) return null

  const siguiente = enriquecido.nextEpisode

  return (
    <section className="enriquecido">
      <h2>{t(DEFAULT_LOCALE, 'detail.enrichment')}</h2>
      <p className="enriquecido__fuente">
        {t(DEFAULT_LOCALE, 'detail.enrichment.score', { score: enriquecido.score ?? '—' })}
        {enriquecido.year === undefined ? '' : ` · ${enriquecido.year}`}
        {enriquecido.status === undefined
          ? ''
          : ` · ${t(DEFAULT_LOCALE, STATUS_KEYS[enriquecido.status])}`}
        {/* La marca del contenido para adultos, en la misma línea de datos: es texto y
            no un adorno, así que la lee también un lector de pantalla. */}
        {enriquecido.adult ? ` · ${t(DEFAULT_LOCALE, 'adult.mark')}` : ''}
      </p>
      {siguiente === undefined ? null : (
        <p className="card__meta">
          {t(DEFAULT_LOCALE, 'detail.enrichment.next', {
            episode: siguiente.number,
            when: new Intl.DateTimeFormat(DEFAULT_LOCALE, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(siguiente.airingAt)),
          })}
        </p>
      )}
      {/* La ficha de AniList se abre en otra pestaña y con `noreferrer`: es un
          enlace saliente y no tiene por qué saber de dónde vino. */}
      <a
        className="enriquecido__enlace"
        href={enriquecido.siteUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t(DEFAULT_LOCALE, 'detail.enrichment.site')}
      </a>
    </section>
  )
}

function Skeletons(): ReactNode {
  return (
    <section aria-busy="true">
      <p className="empty">{t(DEFAULT_LOCALE, 'detail.loading')}</p>
      <span className="skeleton" aria-hidden="true" />
    </section>
  )
}

/**
 * Lo que se lee arriba de la ficha: la sinopsis y, al lado, los datos.
 *
 * Son **dos pistas** porque la sinopsis no quiere el ancho entero —una línea de
 * 120 caracteres no se lee— y lo que sobraba a su derecha era negro durante todo
 * lo alto del texto. La pista de datos ocupa ese hueco con la nota, los géneros y
 * los estudios, que antes vivían apretados en la barra lateral, estrecha y ya
 * llena de mandos.
 *
 * La marca `--dos` sólo se pone cuando están las dos cosas: con una sola, la pista
 * única se lee entera en vez de dejar la otra mitad en negro.
 *
 * **Una sección sin datos no se pinta.** El titular «Estudios» con un párrafo
 * vacío debajo es un renglón que no dice nada, y era el que cerraba la barra
 * lateral con un hueco. Y sin nada que leer —ni sinopsis ni datos— no hay bloque:
 * un hueco vacío entre la cabecera y los episodios no dice nada tampoco.
 */
export function Lectura(props: {
  readonly detail: AnimeDetail
  readonly enrichment: Enrichment | null | undefined
}): ReactNode {
  const { detail, enrichment } = props
  const texto = sinopsis(detail, enrichment)
  const listaGeneros = generos(detail, enrichment)
  const listaEstudios = estudios(detail, enrichment)
  const hayDatos = enrichment != null || listaGeneros.length > 0 || listaEstudios.length > 0

  if (texto === undefined && !hayDatos) return null

  return (
    <div
      className={
        texto !== undefined && hayDatos ? 'detail__lectura detail__lectura--dos' : 'detail__lectura'
      }
    >
      {texto === undefined ? null : (
        <div className="detail__prosa">
          <section>
            <h2>{t(DEFAULT_LOCALE, 'detail.synopsis')}</h2>
            {/* Texto, nunca HTML: la sinopsis viene de fuera. Y con su medida de
                lectura, que es lo único de la ficha que quiere ser estrecho. */}
            <p className="detail__synopsis">{texto}</p>
          </section>
        </div>
      )}

      {hayDatos ? (
        <div className="detail__datos">
          {seccionesDe(enrichment)}

          {listaGeneros.length === 0 ? null : (
            <section>
              <h2>{t(DEFAULT_LOCALE, 'detail.genres')}</h2>
              <Etiquetas valores={listaGeneros} clave="detail.genreLink" />
            </section>
          )}

          {listaEstudios.length === 0 ? null : (
            <section>
              <h2>{t(DEFAULT_LOCALE, 'detail.studios')}</h2>
              <Etiquetas valores={listaEstudios} clave="detail.studioLink" />
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Las etiquetas de la ficha —los géneros y los estudios—, cada una un enlace.
 *
 * Pulsarlas lleva a la búsqueda por ese término, que es lo que ya hace la banda de
 * géneros de la vitrina: los proveedores buscan por título y ninguno entiende
 * «acción» ni el nombre de un estudio, así que lo que responde sale del **catálogo
 * local** —los títulos que la base ya conoce—. El reparto entre anime y películas
 * lo hace el conmutador de la cabecera, el mismo de todas las pantallas.
 *
 * El separador va como texto y no como estilo: es la misma línea de antes
 * —«Fantasía · Romance»—, con las palabras convertidas en enlaces. El `title`
 * dice a dónde lleva cada uno, que es lo que el nombre solo no cuenta.
 *
 * **El `#` del género, sólo cuando AniList lo conoce.** El `#` es lo que manda la
 * consulta a su catálogo, y con él un género que AniList no tiene —«Isekai» no
 * está entre sus dieciocho— dejaría la búsqueda pidiendo estudios por el texto
 * «#Isekai», que no devuelve nada: se perdería lo que ese enlace ya enseñaba. La
 * condición se resuelve con `anilistGenre`, que es la misma tabla con la que el
 * servidor decide si puede preguntarle por ese género. El estudio no la lleva
 * nunca: no es un género y con `#` su búsqueda se quedaría en cero.
 */
function Etiquetas(props: {
  readonly valores: readonly string[]
  readonly clave: 'detail.genreLink' | 'detail.studioLink'
}): ReactNode {
  return (
    <p className="detail__etiquetas">
      {props.valores.map((valor, indice) => {
        const ensanchado = props.clave === 'detail.genreLink' && anilistGenre(valor) !== undefined

        return (
          <Fragment key={valor}>
            {indice === 0 ? null : ' · '}
            <Link
              className="detail__etiqueta"
              to={searchPath(ensanchado ? `#${valor}` : valor)}
              title={t(DEFAULT_LOCALE, ensanchado ? 'detail.genreLinkAnilist' : props.clave, {
                name: valor,
              })}
            >
              {valor}
            </Link>
          </Fragment>
        )
      })}
    </p>
  )
}

export function DetailPage(props: DetailPageProps): ReactNode {
  const {
    detail,
    related,
    franchise,
    sources,
    watched,
    capabilities,
    enrichment,
    anilistRelated,
    providerNames,
    state,
    error,
    reload,
  } = useDetail(props.providerId, props.ref)
  const favorite = useFavorite({ providerId: props.providerId, value: props.ref })
  /**
   * La marca de «ya visto», hermana del favorito.
   *
   * Sale en todas las fichas, película o serie: lo que cambia con `kind ===
   * 'movie'` es el titular de la lista de episodios, no lo que se puede marcar.
   */
  const visto = useWatchedTitle({ providerId: props.providerId, value: props.ref })
  /**
   * El modo elegido a mano.
   *
   * Empieza sin elegir porque las capacidades llegan por red: en el primer render
   * no se sabe cuáles hay. Sin elección manda el primero disponible, y una
   * elección que el proveedor no ofrece —porque cambió de plugin a mitad de la
   * visita— se ignora en vez de abrir el reproductor en un modo que va a fallar.
   */
  const [preferido, setPreferido] = useState<PlayMode | undefined>(undefined)

  // Cuatro fichas abiertas a la vez eran cuatro pestañas con el mismo nombre. El
  // título de la pestaña se pone antes de los estados tempranos, que si no la
  // pantalla cargando y la que falló compartirían el nombre de la aplicación.
  useDocumentTitle(detailTitleParts(state, detail))

  if (state === 'loading') return <Skeletons />

  if (state === 'error') {
    return <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={reload} />
  }

  if (detail === undefined) {
    return (
      <section>
        <p className="empty">{t(DEFAULT_LOCALE, 'detail.notFound')}</p>
      </section>
    )
  }

  const modos = modesFor(capabilities)
  const modo = chosenMode(modos, preferido)

  /**
   * El título es una película.
   *
   * Una película no tiene capítulos, así que su bloque no se titula «Episodios» ni
   * numera nada: ofrece verla. El tipo lo declara el proveedor y el que no lo
   * declare sigue con la lista de siempre —deducir «película» de tener un solo
   * episodio llamaría película a un OVA de uno—.
   */
  const esPelicula = detail.kind === 'movie'

  return (
    <article className="detail">
      {/* La cabecera de la ficha, con el banner de AniList de fondo. Cruza la
          pantalla entera y abre la ficha: la banda va a sangre y su contenido
          —el titular— se alinea con las columnas de abajo. */}
      <BandaBanner detail={detail} fondo={fondoDe(enrichment)} />

      {/*
        Dos columnas: lo que se **hace** con la obra a la izquierda —portada,
        acciones, modos, fuentes y saga— y lo que se lee a la derecha. Antes todo
        iba en una columna con `max-width: var(--measure)` dentro de media
        pantalla, y la mitad derecha quedaba muerta. Los datos se mudaron de aquí
        a la columna de lectura: la barra mide 17rem y ya iba llena de mandos.

        La rejilla vive en su propia caja y no en `.detail`: la banda cruza la
        ventana, así que la medida del sitio —y su relleno— se recuperan aquí.
      */}
      <div className="detail__cuerpo">
        <aside className="detail__aside">
          {/* La portada sale del proxy, y sólo si el proveedor declaró una
            dirección que se puede usar: un `javascript:` ahí no se convierte en
            atributo. */}
          {enrichment === null || enrichment === undefined ? (
            detail.coverUrl !== undefined && !isSafeUrl(detail.coverUrl) ? (
              <span className="detail__cover card__cover--vacia" aria-hidden="true" />
            ) : (
              <Cover providerId={props.providerId} ref={props.ref} className="detail__cover" />
            )
          ) : (
            // La de AniList es más grande y es la misma con la que la vitrina pinta
            // sus piezas: una ficha con otra carátula que su tarjeta se lee como dos
            // obras.
            <Cover src={enrichment.cover} className="detail__cover" />
          )}

          {/* Las dos marcas del usuario, juntas: lo que se guarda y lo que ya se
              vio. Son dos botones con el mismo contrato —`aria-pressed`, estado
              inmediato y vuelta atrás si el servidor falla— y se leen como pareja. */}
          <div className="detail__actions">
            <FavoriteButton
              value={favorite.value}
              busy={favorite.busy}
              onToggle={favorite.toggle}
            />
            <WatchedButton value={visto.value} busy={visto.busy} onToggle={visto.toggle} />
          </div>

          <section>
            <h2>{t(DEFAULT_LOCALE, 'detail.modes')}</h2>
            <ul className="modes">
              {PLAY_MODES.map((candidato) => {
                const disponible = modos.includes(candidato)
                const clave = candidato === 'sub' ? 'detail.mode.sub' : 'detail.mode.dub'

                return (
                  <li className="mode" key={candidato}>
                    <button
                      type="button"
                      className="button"
                      // El marcado es el modo que se va a reproducir, y se dice con
                      // `aria-pressed` —lo que ya lee el resto de la interfaz— y no
                      // sólo con el color.
                      aria-pressed={modo === candidato}
                      disabled={!disponible}
                      onClick={() => setPreferido(candidato)}
                    >
                      {t(DEFAULT_LOCALE, clave)}
                    </button>
                    {disponible ? null : (
                      <span className="card__meta">
                        {t(DEFAULT_LOCALE, 'detail.modeUnavailable', {
                          mode: t(DEFAULT_LOCALE, clave),
                        })}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Dónde verlo, al lado de cómo: son las dos preguntas que se contestan
            antes de darle a reproducir. Sin otras fuentes no pinta nada. */}
          <SourcePicker items={sources} current={props.providerId} providerLabels={providerNames} />

          <section>
            {/*
            La entrega actual entra en la lista del rail, y por eso se construye
            aquí con lo que la ficha ya sabe: el servidor no la devuelve entre sus
            hermanos —excluirla es lo que evita el contenido repetido—, y sin ella
            no se sabría en qué temporada se está.
          */}
            <SagaRail
              current={{
                ref: { providerId: props.providerId, value: props.ref },
                title: detail.title,
                ...(detail.coverUrl === undefined ? {} : { coverUrl: detail.coverUrl }),
                ...(detail.year === undefined ? {} : { year: detail.year }),
                ...(detail.kind === undefined ? {} : { kind: detail.kind }),
              }}
              siblings={related}
              franchise={franchise}
              anilistRelated={anilistRelated}
            />
          </section>
        </aside>

        <div className="detail__body">
          {/* La sinopsis y los datos, en las dos pistas de la lectura; debajo, los
            episodios a lo ancho de las dos, que es donde la lista se lee mejor. */}
          <Lectura detail={detail} enrichment={enrichment} />

          <section>
            {/* Una película se titula por lo que es. Dejarle «Episodios» encima del
              botón que la abre era el mismo error que numerar su única parte. */}
            <h2>{t(DEFAULT_LOCALE, esPelicula ? 'detail.movie' : 'detail.episodes')}</h2>
            {/* El selector pide sus propias páginas: la ficha le da con qué
              pedirlas —el proveedor y la referencia del título— y no una lista
              ya descargada que no podría trocear. Con la marca de película, la
              misma lectura se pinta como una acción en vez de como una lista. */}
            <EpisodeList
              providerId={props.providerId}
              ref={props.ref}
              mode={modo}
              watched={watched}
              movie={esPelicula}
            />
          </section>
        </div>
      </div>
    </article>
  )
}
