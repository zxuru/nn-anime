/**
 * Datos de la pantalla de detalle.
 *
 * Las lecturas de la ficha viven ahora en `load-detail.ts`, porque las comparten
 * la pantalla y la precarga de la tarjeta. Van en **dos tandas**: primero el
 * núcleo —detalle, relacionados, franquicia, fuentes, vistos, proveedores— y
 * después los adornos de terceros —enriquecimiento, metadatos y relaciones de
 * AniList—. El núcleo va en paralelo porque ninguna de sus lecturas necesita a
 * las otras; los adornos van después de él porque las tres rutas leen la fila
 * local que escribe el detalle, y pedirlos a la vez dejaba la ficha fría sin
 * banner ni relacionados hasta recargar.
 *
 * Lo que este hook decide —y por eso sigue aquí— es **cuándo** pedir la ficha y
 * **qué hacer con lo que llega**: la caché pinta al instante lo que ya se sabía y
 * el refresco va por detrás, la precarga de la tarjeta de origen se aprovecha si
 * está en vuelo, y un reloj duro de veinte segundos convierte una espera eterna
 * en un fallo que se puede contar. La pantalla pasa a `ready` con el núcleo y los
 * adornos se colocan cuando llegan, sin que la ficha dependa de un tercero.
 *
 * **Los episodios no están aquí.** La lista se pide por páginas desde el selector
 * (`EpisodeList`), que es quien sabe en qué página va y cuál se está mirando: con
 * la lectura aquí, la ficha pedía una lista que ya no puede recortar y el selector
 * pedía la suya, con dos claves de caché para el mismo dato. Aquí quedan las rutas
 * y los cargadores, para que las dos pantallas que abren un episodio suelto —el
 * selector y el reproductor— los compartan.
 *
 * Las fuentes son las otras que tienen **esta misma obra**, de la base local: es
 * lo que el «También en» de la ficha necesita para ofrecer elegir dónde verla.
 *
 * La franquicia es la misma lectura de relacionados con otro alcance. Van las dos
 * en la misma tanda porque el rail las pinta juntas y en el mismo orden; y son dos
 * peticiones y no una con las dos listas porque cada alcance tiene su propio
 * límite en el servidor.
 *
 * Las capacidades vienen de `/api/providers` y no del detalle: son del proveedor,
 * no del título, y el selector sub/dub se deshabilita según lo que ese proveedor
 * diga saber hacer. Un plugin que no dobla no debe ofrecer un botón de doblaje
 * que va a fallar.
 *
 * La interfaz valida cada respuesta con el schema compartido de `core`: si el
 * server cambia una forma, falla aquí y no tres componentes más abajo con un
 * campo en `undefined`.
 */

import type {
  AniListRelatedItem,
  Enrichment,
  EpisodesResponse,
  TmdbMetadata,
  WatchedEpisodePayload,
} from '@nn-anime/core/api'
import {
  episodeResponseSchema,
  episodesResponseSchema,
  favoritesResponseSchema,
  planToWatchResponseSchema,
  watchedTitlesResponseSchema,
} from '@nn-anime/core/api'
import type {
  AnimeDetail,
  AnimeSummary,
  Episode,
  ProviderCapabilities,
  ProviderRef,
} from '@nn-anime/core/models'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { ApiError, apiGet, apiPost, type RequestDeps } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'
import { PLAY_MODES, type PlayMode } from '../player/watch-route'
import {
  type CargaDeFicha,
  cargarFicha,
  claveDeFicha,
  DETAIL_TIMEOUT_MS,
  type DetailBundle,
  type DetailCore,
  detailCache,
} from './load-detail'
import { cargaEnVuelo } from './prefetch'

export type DetailState = 'loading' | 'ready' | 'error'

/**
 * Las rutas de la ficha viven en `paths.ts` y se reexportan desde aquí.
 *
 * Hay consumidores que las importan de este módulo desde antes de que existiera
 * `paths.ts` —el reproductor, el selector de episodios y sus pruebas—; mantener
 * la puerta evita que dos sitios pidan rutas distintas para la misma ficha.
 */
export { anilistRelatedPath, relatedPath, sourcesPath } from './paths'

/**
 * Las lecturas de episodios, con lo que un test puede sustituir.
 *
 * El `fetch` entra por aquí y no por variable global para que una prueba mida
 * **qué rutas se piden** sin levantar un navegador: es la única forma de
 * comprobar que la pantalla de reproducción no pide la lista entera cuando sólo
 * necesita los vecinos.
 */
export interface EpisodeReads {
  readonly deps?: RequestDeps
  readonly signal?: AbortSignal
}

function opciones(reads: EpisodeReads): { readonly signal?: AbortSignal } {
  return reads.signal === undefined ? {} : { signal: reads.signal }
}

/**
 * La ruta de una página de episodios.
 *
 * `page` va **siempre**, también la primera: el servidor trata la ausencia como
 * la 1, pero una lectura sin página y otra con `?page=1` son dos claves distintas
 * en la caché del cliente, y la pantalla que trocea en páginas nunca debería
 * pedir una lista sin decir cuál.
 *
 * `season` sólo va cuando se pidió una: la lista entera y una temporada suya son
 * dos cosas distintas, y la ausencia del parámetro es «todas». Escribirlo en la
 * lista entera daría dos claves de caché para la misma lectura, como con la
 * página.
 */
export interface EpisodesQuery {
  readonly page: number
  readonly season?: number
}

export function episodesPath(providerId: string, ref: string, query: EpisodesQuery): string {
  const base = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/episodes`
  const temporada = query.season === undefined ? '' : `&season=${query.season}`

  return `${base}?page=${query.page}${temporada}`
}

/** La ruta de un episodio por su número. Admite decimales. */
export function episodeNumberPath(
  providerId: string,
  ref: string,
  number: number,
  season?: number,
): string {
  const base = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/episodes`
  const temporada = season === undefined ? '' : `?season=${season}`

  return `${base}/number/${number}${temporada}`
}

/** La ruta del último episodio del título, o de una temporada suya. */
export function latestEpisodePath(providerId: string, ref: string, season?: number): string {
  const base = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/episodes`
  const temporada = season === undefined ? '' : `?season=${season}`

  return `${base}/latest${temporada}`
}

/** Una página de episodios, tal y como la sirve el servidor. */
export async function loadEpisodesPage(
  providerId: string,
  ref: string,
  query: EpisodesQuery,
  reads: EpisodeReads = {},
): Promise<EpisodesResponse> {
  return apiGet(
    episodesPath(providerId, ref, query),
    episodesResponseSchema,
    opciones(reads),
    reads.deps,
  )
}

/**
 * Lo que se encontró al pedir un episodio suelto.
 *
 * Son tres y no dos porque «no está» y «no se pudo» se cuentan distinto: el
 * primero es una respuesta del proveedor y el segundo trae su motivo. Y la razón
 * de separarlos está medida: el plugin de jkanime **no puede** construir un error
 * con estado 404 —vive fuera del repositorio y no resuelve el paquete—, así que un
 * episodio que no tiene llega como 502 con el mensaje «no tiene el episodio 999 de
 * kimetsu-no-yaiba: la ficha dice 26». Tratar ese 502 como «el proveedor está
 * caído» esconde lo único que explica lo que pasó.
 */
export type EpisodeLookup =
  | { readonly kind: 'found'; readonly episode: Episode }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly message: string }

/** Lo que el servidor contó del fallo, o el del error corriente si no contó nada. */
function mensajeDe(cause: unknown): string {
  if (cause instanceof ApiError) return cause.detail ?? cause.message

  return cause instanceof Error ? cause.message : String(cause)
}

async function loadSingleEpisode(path: string, reads: EpisodeReads): Promise<EpisodeLookup> {
  try {
    const respuesta = await apiGet(path, episodeResponseSchema, opciones(reads), reads.deps)

    return { kind: 'found', episode: respuesta.episode }
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { kind: 'missing' }

    return { kind: 'failed', message: mensajeDe(cause) }
  }
}

/** El episodio con ese número, o por qué no se pudo dar. */
export function loadEpisodeByNumber(
  providerId: string,
  ref: string,
  number: number,
  reads: EpisodeReads = {},
  season?: number,
): Promise<EpisodeLookup> {
  return loadSingleEpisode(episodeNumberPath(providerId, ref, number, season), reads)
}

/** El último episodio del título, o de una temporada suya. */
export function loadLatestEpisode(
  providerId: string,
  ref: string,
  reads: EpisodeReads = {},
  season?: number,
): Promise<EpisodeLookup> {
  return loadSingleEpisode(latestEpisodePath(providerId, ref, season), reads)
}

/**
 * El número escrito en el campo de salto, o nada si no es un número.
 *
 * Admite decimales —hay fuentes que numeran `7.5`— y rechaza el vacío, el cero,
 * lo negativo y lo que no sea finito: `Number('')` es 0 y `Number('x')` es `NaN`,
 * así que sin esta comprobación un campo vacío pedía el episodio 0.
 */
export function parseJump(raw: string): number | undefined {
  const texto = raw.trim()
  if (texto === '') return undefined

  const numero = Number(texto)

  return Number.isFinite(numero) && numero > 0 ? numero : undefined
}

export interface DetailData {
  readonly detail: AnimeDetail | undefined
  /**
   * Los hermanos de saga, de lo que la base ya conoce.
   *
   * Es una lista y no un resultado: la petición sólo puede fallar si falla el
   * servidor entero, y en ese caso la ficha ya está en estado de error. Sin
   * relacionados la lista viene vacía y la sección se explica.
   */
  readonly related: readonly AnimeSummary[]
  /**
   * Los hermanos de **franquicia**: la misma lectura con la clave de la secuela.
   *
   * Contiene a los de saga, así que el rail quita de aquí lo que ya pinta arriba.
   */
  readonly franchise: readonly AnimeSummary[]
  /**
   * Las otras fuentes que tienen esta misma obra.
   *
   * Lista vacía cuando no hay ninguna: la sección no se pinta, que es distinto de
   * pintarla diciendo que no hay nada que elegir.
   */
  readonly sources: readonly AnimeSummary[]
  /**
   * Qué episodios ya se vieron y por dónde iba cada uno.
   *
   * Es por número de episodio, no por par episodio y modo: verlo en subtitulado
   * es haberlo visto, y marcarlo dos veces partiría en dos la misma fila.
   */
  readonly watched: readonly WatchedEpisodePayload[]
  readonly capabilities: ProviderCapabilities | undefined
  /**
   * Lo que AniList sabe de esta obra, si está emparejada.
   *
   * `undefined` es «no se pudo preguntar» y `null` es «no hay equivalente»: las
   * dos cosas se pintan igual —la ficha sin nada nuevo—, pero sólo la segunda se
   * guarda como respuesta.
   */
  readonly enrichment: Enrichment | null | undefined
  /**
   * Lo que TMDB sabe de una película o serie, si hay clave configurada.
   *
   * `null` y `undefined` se pintan igual —la ficha sin nada nuevo—, y la ficha
   * nunca depende de esta lectura: un tercero sin clave o caído no la tumba.
   */
  readonly metadata: TmdbMetadata | null | undefined
  /**
   * Lo que AniList relaciona con esta obra: secuelas, precuelas, películas.
   *
   * Llega con los adornos, **después** del núcleo y sin bloquearlo; también se
   * guarda en la caché de la ficha, así que una segunda visita la pinta al
   * instante. Lista vacía significa «no hay nada que enseñar» —sin
   * emparejamiento, sin relaciones o sin respuesta del tercero— y la sección no se
   * pinta: una fila vacía sobre un dato que no es de la aplicación sólo dice que
   * algo falló.
   */
  readonly anilistRelated: readonly AniListRelatedItem[]
  /** El nombre declarado por cada proveedor cargado, por su id. */
  readonly providerNames: ReadonlyMap<string, string>
  readonly state: DetailState
  /**
   * El fallo, ya clasificado.
   *
   * Se guarda la clase y no el mensaje: la pantalla tiene que decir qué pasó —el
   * proveedor no responde, la sesión no vale— y el mensaje del cliente no lo dice.
   */
  readonly error: Fallo | undefined
  readonly reload: () => void
}

/** Los modos que el proveedor dice poder servir, en el orden en que se ofrecen. */
export function modesFor(capabilities: ProviderCapabilities | undefined): readonly PlayMode[] {
  if (capabilities === undefined) return []

  return PLAY_MODES.filter((modo) => capabilities[modo])
}

/**
 * El modo con el que se abre el reproductor.
 *
 * Manda el elegido a mano, siempre que el proveedor lo ofrezca; si no —o si aún
 * no se ha elegido— el primero disponible. Sin la comprobación, una preferencia
 * guardada de un proveedor que dejó de doblar abriría el reproductor en un modo
 * que va a fallar.
 */
export function chosenMode(
  available: readonly PlayMode[],
  preferred: PlayMode | undefined,
): PlayMode | undefined {
  if (preferred !== undefined && available.includes(preferred)) return preferred

  return available[0]
}

/** Duración legible, o nada si el proveedor no la dice. */
export function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined

  const minutos = Math.round(seconds / 60)

  return minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`
}

/**
 * La proporción vista, en tanto por ciento entero.
 *
 * Redondea y no trunca: al 99,6 % la barra debe verse llena, y truncar dejaría
 * un hueco de un píxel que parece un fallo de pintado.
 */
export function watchedPercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0

  return Math.min(Math.round(ratio * 100), 100)
}

/**
 * La vista de una ficha: todo lo que pinta la pantalla, en un solo objeto.
 *
 * Va junta y no en un `useState` por campo porque una ficha se pinta entera de
 * golpe: con estados sueltos, la respuesta vieja de una ficha podía mezclar su
 * título con los episodios de la siguiente al navegar rápido entre las dos.
 */
type VistaDetalle = Omit<DetailData, 'reload'>

/**
 * Lo que se pinta mientras no hay nada que enseñar.
 *
 * Es una constante de módulo y no un objeto por render: la identidad estable es
 * lo que permite reutilizarla como estado inicial sin provocar un render de más.
 */
const VISTA_VACIA: VistaDetalle = {
  detail: undefined,
  related: [],
  franchise: [],
  sources: [],
  watched: [],
  capabilities: undefined,
  enrichment: undefined,
  metadata: undefined,
  anilistRelated: [],
  providerNames: new Map(),
  state: 'loading',
  error: undefined,
}

/**
 * La vista de una ficha ya leída: todos sus campos a la vez, en `ready`.
 *
 * Vale tanto para la entrada de la caché completa como para el núcleo recién
 * leído —al que todavía le faltan los adornos—. Un adorno que no está (`undefined`)
 * se pinta igual que «no hay nada nuevo», que es lo que hacía antes: la banda del
 * banner existe con o sin imagen y la sección de AniList no se pinta.
 */
function vistaDeBundle(bundle: DetailBundle): VistaDetalle {
  return {
    detail: bundle.detail,
    related: bundle.related,
    franchise: bundle.franchise,
    sources: bundle.sources,
    watched: bundle.watched,
    capabilities: bundle.capabilities,
    enrichment: bundle.enrichment,
    metadata: bundle.metadata,
    anilistRelated: bundle.anilistRelated ?? [],
    providerNames: bundle.providerNames,
    state: 'ready',
    error: undefined,
  }
}

/**
 * Con qué se arranca una ficha: lo que la caché ya sepa, o el estado de carga.
 *
 * `peek` devuelve también lo caducado, y eso es deliberado: enseñar la ficha de
 * hace seis minutos mientras se revalida es mejor que un esqueleto, que es lo
 * que hace el stale-while-revalidate.
 */
function vistaInicial(clave: string): VistaDetalle {
  const cacheado = detailCache.peek(clave)

  return cacheado === undefined ? VISTA_VACIA : vistaDeBundle(cacheado.value)
}

/**
 * Los datos de la ficha, con caché, precarga y un reloj.
 *
 * Cuatro decisiones que se ven en la pantalla:
 *
 * 1. **La caché pinta primero.** Con dato —aunque esté caducado— la pantalla
 *    entra en `ready` desde el primer render y el refresco va por detrás: una
 *    segunda visita enseña el contenido al instante y se revalida sin que se
 *    note. Si el refresco falla, se queda lo que ya se veía y no aparece un
 *    error: no hay nada que el usuario haya provocado.
 * 2. **Un reloj duro de veinte segundos.** Con señal propia, el cliente no pone
 *    su propio tiempo límite (`signalFor` la sustituye), así que el temporizador
 *    vive aquí y aborta el controlador. El fallo llega como `AbortError` y
 *    `describirFallo` lo cuenta como `lento`; el 404 del servidor, en cambio,
 *    llega como `ApiError` y se cuenta como `noExiste`.
 * 3. **La ficha no espera a los terceros.** El núcleo —detalle y lecturas
 *    locales— es lo único que hace falta para pintarla; el enriquecimiento, los
 *    metadatos y las relaciones de AniList llegan después y se colocan cuando
 *    llegan. Además de ser más rápido, es lo que hace que la ficha fría tenga
 *    banner y relacionados: esas lecturas leen la fila local que escribe el
 *    detalle, así que pedirlas a la vez que él las dejaba sin fila y la sección
 *    no aparecía hasta recargar.
 * 4. **La precarga se aprovecha.** Si la tarjeta de origen ya lanzó la carga, se
 *    espera esa en vez de pedir la ficha otra vez; si falló, se pide como
 *    siempre.
 *
 * La carga en sí vive en `load-detail.ts` porque la comparten la pantalla y la
 * precarga: aquí sólo se decide cuándo pedirla y qué hacer con lo que llega.
 *
 * **La búsqueda viaja con la petición.** `consulta` es la búsqueda de la que viene
 * la ficha, si viene de una: la lectura del detalle la lleva porque es lo que el
 * servidor anota en `search_history`, la señal con la que el motor recomienda lo
 * que el usuario está buscando. Reutilizar una precarga que salió sin ella dejaría
 * esa búsqueda sin anotar, así que `cargaEnVuelo` sólo devuelve la que salió con
 * la misma consulta.
 */
export function useDetail(providerId: string, ref: string, consulta?: string): DetailData {
  const clave = claveDeFicha(providerId, ref)
  const [guardado, setGuardado] = useState<{
    readonly clave: string
    readonly vista: VistaDetalle
  }>(() => ({ clave, vista: vistaInicial(clave) }))
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /**
   * El número de intento.
   *
   * Cada carga se queda con el suyo y sólo pinta si sigue siendo el vigente. Sin
   * esto, una respuesta lenta de la ficha anterior podía llegar después de la
   * nueva y pisarla: es el estado cruzado que se ve al navegar rápido.
   */
  const intentoRef = useRef(0)

  /**
   * La vista que toca pintar.
   *
   * Si la clave no es la guardada —la pantalla cambió de ficha y el efecto aún no
   * ha corrido— se deriva de la caché en vez de heredar la vista anterior: así no
   * se ve ni un fotograma con el título de la ficha que se acaba de dejar. Leer
   * la caché aquí es intencionado; su `peek` no pide nada a la red.
   */
  const vista = guardado.clave === clave ? guardado.vista : vistaInicial(clave)

  const abortar = useCallback(() => {
    // Invalida lo que esté en vuelo: cualquier respuesta que llegue después de
    // este punto es de una ficha o de un intento que ya no se está mirando.
    intentoRef.current += 1

    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }

    controllerRef.current?.abort()
    controllerRef.current = undefined
  }, [])

  const cargar = useCallback(() => {
    abortar()

    const intento = intentoRef.current
    const controller = new AbortController()
    controllerRef.current = controller

    // El reloj del intento. `vencido` es lo que distingue «tardó demasiado» de
    // «se desmontó o cambió la ficha»: en el primer caso hay que enseñar el
    // error, en el segundo no se pinta nada.
    let vencido = false
    const timer = setTimeout(() => {
      vencido = true
      controller.abort()
    }, DETAIL_TIMEOUT_MS)
    timerRef.current = timer

    const sigue = () => intentoRef.current === intento && (!controller.signal.aborted || vencido)

    /**
     * Apaga el reloj de la ficha.
     *
     * El reloj es del **núcleo**, no de la pantalla: cuando la ficha ya se puede
     * pintar —o falló— deja de tener sentido, y los adornos que llegan después
     * llevan su propio límite por petición. Sin esto, la consulta espaciada a
     * AniList podía agotar el reloj de una ficha ya pintada y abortar adornos que
     * estaban en camino.
     */
    const pararReloj = () => {
      if (timerRef.current !== timer) return

      clearTimeout(timer)
      timerRef.current = undefined
    }

    const fijar = (siguiente: VistaDetalle) => {
      setGuardado({ clave, vista: siguiente })
    }

    const cacheado = detailCache.peek(clave)
    // Con caché se pinta al instante; sin ella, la pantalla entra en `loading` y
    // el esqueleto de la ficha ocupa el sitio.
    fijar(cacheado === undefined ? VISTA_VACIA : vistaDeBundle(cacheado.value))

    // La carga de la tarjeta de origen, si está en vuelo, es esta misma: se
    // reutiliza para no pedir el detalle dos veces.
    const propia = (): CargaDeFicha =>
      cargarFicha(providerId, ref, {
        signal: controller.signal,
        ...(consulta === undefined ? {} : { consulta }),
      })

    const precargada = cargaEnVuelo(providerId, ref, consulta)
    let carga = precargada ?? propia()

    void (async () => {
      let nucleo: DetailCore

      try {
        nucleo = await carga.nucleo
      } catch (cause) {
        if (!sigue()) {
          pararReloj()

          return
        }

        /*
          Una precarga que falló no es el fallo de la ficha: se pide la propia,
          igual que si no hubiera habido precarga. Sólo cuando la precarga falló,
          queda tiempo y la petición no está abortada; con el reloj vencido,
          reintentar sería alargar la espera que el reloj existe para cortar.
        */
        const reintentable = precargada !== undefined && !vencido && !controller.signal.aborted
        if (!reintentable) {
          pararReloj()
          // Con dato viejo en pantalla, un fallo no se cuenta: no hay nada que el
          // usuario haya provocado. Sin dato, es la tarjeta de error, y el 404 y
          // el reloj agotado se cuentan distinto porque son dos pantallas
          // distintas: «no existe, no reintentes» frente a «no respondió, prueba
          // otra vez».
          if (cacheado === undefined) {
            fijar({ ...VISTA_VACIA, state: 'error', error: describirFallo(cause) })
          }

          return
        }

        carga = propia()

        try {
          nucleo = await carga.nucleo
        } catch (segundo) {
          pararReloj()
          if (!sigue()) return

          if (cacheado === undefined) {
            fijar({ ...VISTA_VACIA, state: 'error', error: describirFallo(segundo) })
          }

          return
        }
      }

      pararReloj()
      if (!sigue()) return

      // El núcleo sobre lo que ya se sabía: si la caché tenía adornos, siguen en
      // pantalla hasta que lleguen los nuevos, en vez de desaparecer y volver. Se
      // relee la caché al escribir y no se usa la copia de antes del `await`: en
      // medio pudo completarla la precarga, y pisarla con la foto vieja dejaría la
      // ficha sin banner aunque ya estuviera en la caché.
      const conNucleo: DetailBundle = { ...detailCache.peek(clave)?.value, ...nucleo }
      detailCache.set(clave, conNucleo)
      fijar(vistaDeBundle(conNucleo))

      // Los adornos, ya con la fila local escrita en el servidor. La cadena la
      // arma `cargarFicha`, así que la precarga y la pantalla comparten la misma
      // lectura y no se piden dos veces.
      const adornos = await carga.adornos
      if (adornos === undefined || !sigue()) return

      const completa: DetailBundle = { ...conNucleo, ...adornos }
      detailCache.set(clave, completa)
      fijar(vistaDeBundle(completa))
    })()
  }, [abortar, clave, providerId, ref, consulta])

  useEffect(() => {
    cargar()

    // Al desmontar o cambiar de ficha se aborta y se limpia el temporizador: no
    // queda ninguna respuesta ni ningún reloj apuntando a una pantalla que ya no
    // está.
    return abortar
  }, [cargar, abortar])

  return {
    detail: vista.detail,
    related: vista.related,
    franchise: vista.franchise,
    sources: vista.sources,
    watched: vista.watched,
    capabilities: vista.capabilities,
    enrichment: vista.enrichment,
    metadata: vista.metadata,
    anilistRelated: vista.anilistRelated,
    providerNames: vista.providerNames,
    state: vista.state,
    error: vista.error,
    reload: cargar,
  }
}

export interface FavoriteState {
  readonly value: boolean
  readonly busy: boolean
  readonly toggle: () => void
}

/** El estado de una marca del usuario: favorito o visto. */
export type MarkState = FavoriteState

/**
 * Si el título está en una de esas listas.
 *
 * Se compara la referencia entera —proveedor y valor— y no sólo el valor: dos
 * proveedores pueden usar el mismo identificador para títulos distintos, y
 * mirar sólo uno de los dos marcaría como guardado algo que no lo está.
 */
export function enLaLista(lista: readonly AnimeSummary[], ref: ProviderRef): boolean {
  return lista.some(
    (item) => item.ref.providerId === ref.providerId && item.ref.value === ref.value,
  )
}

/** Si el título está entre los favoritos. */
export function isFavorite(favorites: readonly AnimeSummary[], ref: ProviderRef): boolean {
  return enLaLista(favorites, ref)
}

/**
 * Una marca del usuario por HTTP: su ruta, su forma y de dónde sale la lista.
 *
 * Los dos endpoints —favoritos y vistos— tienen la misma forma por fuera y cambian
 * sólo en eso, así que la mecánica del botón vive una sola vez. Los tres campos
 * son constantes de módulo y no se arman en cada render: son dependencias del
 * efecto que lee la lista, y una identidad nueva en cada render lo dispararía en
 * bucle.
 */
interface MarkEndpoint<Cuerpo> {
  readonly ruta: string
  readonly schema: z.ZodType<Cuerpo>
  readonly lista: (cuerpo: Cuerpo) => readonly AnimeSummary[]
}

const FAVORITOS: MarkEndpoint<{ readonly favorites: readonly AnimeSummary[] }> = {
  ruta: '/api/favorites',
  schema: favoritesResponseSchema,
  lista: (cuerpo) => cuerpo.favorites,
}

const VISTOS: MarkEndpoint<{ readonly items: readonly AnimeSummary[] }> = {
  ruta: '/api/watched-titles',
  schema: watchedTitlesResponseSchema,
  lista: (cuerpo) => cuerpo.items,
}

const QUIERO_VER: MarkEndpoint<{ readonly items: readonly AnimeSummary[] }> = {
  ruta: '/api/plan-to-watch',
  schema: planToWatchResponseSchema,
  lista: (cuerpo) => cuerpo.items,
}

/**
 * Una marca con estado inmediato.
 *
 * Se pinta el cambio antes de que el servidor conteste y se revierte si falla: un
 * botón que espera a la red para cambiar de color se siente roto. Si la petición
 * falla, el estado vuelve a lo que había, que es la verdad.
 *
 * **El estado inicial se lee del servidor.** Antes empezaba siempre en «no está»:
 * en el cartel de destacado y en la ficha, un título ya guardado salía sin marcar
 * y el botón mentía hasta que se pulsaba dos veces. La lista se pide **sin señal**
 * a propósito: el cliente deduplica las lecturas por ruta, y con una señal propia
 * cada botón montado pediría la suya.
 */
function useMark<Cuerpo>(endpoint: MarkEndpoint<Cuerpo>, ref: ProviderRef): MarkState {
  const { ruta, schema, lista } = endpoint
  const [value, setValue] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * Si la persona ya pulsó.
   *
   * Una lista que llegue después no puede pisar lo que se acaba de decidir, y la
   * que se leyó antes del alta es vieja por definición.
   */
  const tocado = useRef(false)
  const providerId = ref.providerId
  const referencia = ref.value

  useEffect(() => {
    let vivo = true

    void apiGet(ruta, schema).then(
      (cuerpo) => {
        if (!vivo || tocado.current) return

        setValue(enLaLista(lista(cuerpo), { providerId, value: referencia }))
      },
      // Sin la lista no se afirma nada: el botón se queda en «no está» y quien lo
      // pulse sigue pudiendo marcar el título. Una marca que no se pudo leer no es
      // motivo para dejar la pantalla sin botón.
      () => undefined,
    )

    return () => {
      vivo = false
    }
  }, [ruta, schema, lista, providerId, referencia])

  const toggle = useCallback(() => {
    tocado.current = true
    const siguiente = !value
    setValue(siguiente)
    setBusy(true)

    void apiPost(ruta, {
      ref: { providerId, value: referencia },
      value: siguiente,
    }).then(
      () => setBusy(false),
      () => {
        setValue(!siguiente)
        setBusy(false)
      },
    )
  }, [ruta, providerId, referencia, value])

  return { value, busy, toggle }
}

/** Favorito con estado inmediato. */
export function useFavorite(ref: ProviderRef): MarkState {
  return useMark(FAVORITOS, ref)
}

/**
 * La marca de «ya visto» de la obra, con el mismo contrato que el favorito.
 *
 * Es de la **obra** y no del episodio, así que vale igual para una película: el
 * botón sale en todas las fichas y no menciona capítulos.
 */
export function useWatchedTitle(ref: ProviderRef): MarkState {
  return useMark(VISTOS, ref)
}

/**
 * La marca de «quiero ver», con el mismo contrato que las otras dos.
 *
 * Es la tercera lista del usuario y es **independiente** de ellas: marcar aquí no
 * marca como vista ni como favorita. Por eso comparte la mecánica —el estado
 * inmediato, la lectura inicial del servidor y la reversión si falla— pero no el
 * endpoint, que es lo único que cambia.
 */
export function usePlanToWatch(ref: ProviderRef): MarkState {
  return useMark(QUIERO_VER, ref)
}
