/**
 * La dirección de reproducción, en un solo sitio.
 *
 * Aquí también viven los vecinos de un episodio —el de antes y el de después—
 * porque son de la misma materia: referencias de episodio y los límites del
 * título. La pantalla los pinta y la lista de episodios los decide.
 *
 * La ficha construye el enlace al reproductor y el reproductor lee de esa misma
 * dirección el modo, el segundo donde se dejó, la referencia del título y **el
 * número del episodio**. El número viaja porque quien lo conoce —el selector de la
 * ficha— lo tiene en la mano: deducirlo de la referencia es lo que hacía
 * `animeRefOf` con el título, y con jkanime acertaba por casualidad. Sin número, la
 * pantalla se comporta como si el título no tuviera vecinos, en vez de inventarse
 * un `n-1` sobre una referencia que puede no numerar nada.
 *
 * La ficha construye el enlace al reproductor y el reproductor lee de esa misma
 * dirección el modo, el segundo donde se dejó y la referencia del título. Con las
 * dos mitades escritas por separado, el día que una cambie la otra sigue
 * escribiendo el parámetro viejo y nadie se entera hasta que un episodio se
 * reproduce en el modo equivocado.
 *
 * El modo viaja en la consulta y no en la ruta porque el enrutador empareja por
 * segmentos: `?mode=dub` no cambia la ruta, y un parámetro que no está no rompe
 * nada.
 */

/** Los modos que la interfaz sabe pedir. */
export const PLAY_MODES = ['sub', 'dub'] as const

export type PlayMode = (typeof PLAY_MODES)[number]

/**
 * ¿Es uno de los modos que esta pantalla sabe pedir?
 *
 * El modelo conoce más modos que los que el selector ofrece, así que quien traiga
 * un modo de fuera —la fila de «continuar viendo», por ejemplo— tiene que
 * comprobarlo antes de escribir una dirección con él.
 */
export function isPlayMode(value: string | null): value is PlayMode {
  return value !== null && (PLAY_MODES as readonly string[]).includes(value)
}

/** Lo que una dirección de reproducción lleva además de la referencia. */
export interface WatchPathOptions {
  readonly mode?: PlayMode
  /** El segundo donde se dejó, si se reanuda. */
  readonly at?: number
  /**
   * La referencia del **título**, cuando quien escribe la dirección la conoce.
   *
   * Va en la consulta porque el título no ocupa ningún segmento de la ruta —el
   * único que hay es el del episodio, que es lo que el proveedor necesita para
   * resolver el stream— y porque deducirlo por convención es lo que escribió en la
   * base la ficha del episodio `dandadan/12` como si fuera un título.
   */
  readonly anime?: string
  /**
   * El número del episodio, cuando quien escribe la dirección lo conoce.
   *
   * Es lo que permite pedir los vecinos con dos lecturas puntuales
   * —`number/(n-1)` y `number/(n+1)`— en vez de la lista entera del título. Sin
   * él no se supone nada: una dirección escrita a mano no inventa un número.
   */
  readonly n?: number
  /**
   * La temporada del episodio, cuando quien escribe la dirección la conoce.
   *
   * El número por sí solo no identifica un episodio en una serie que numera por
   * temporada: `?s=2&n=1` es el primero de la segunda, y sin `s` los vecinos y el
   * salto buscan en la temporada equivocada.
   */
  readonly s?: number
}

/**
 * La ruta del reproductor para un episodio.
 *
 * La referencia se codifica: puede llevar barras y almohadillas —el fixture usa
 * `aurora-nocturna#3`, jkanime `dandadan/12`— y sin escapar, la ruta se parte en
 * trozos.
 *
 * La consulta se compone aquí y no en quien llama: el modo, el segundo donde se
 * dejó y el título son la misma dirección, y con cada mitad escrita por su lado el
 * día que una cambie la otra sigue escribiendo la vieja.
 */
export function watchPath(providerId: string, ref: string, options: WatchPathOptions = {}): string {
  const base = `/watch/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`
  const consulta = new URLSearchParams()

  if (options.mode !== undefined) consulta.set('mode', options.mode)
  if (options.at !== undefined && Number.isInteger(options.at) && options.at > 0) {
    consulta.set('at', String(options.at))
  }
  if (options.anime !== undefined && options.anime !== '') consulta.set('anime', options.anime)
  // Un número que no sea finito y positivo no se escribe: `?n=0` o `?n=NaN` haría
  // que el reproductor pidiera el episodio -1, que es una petición que se sabe
  // mala antes de mandarla.
  if (options.n !== undefined && Number.isFinite(options.n) && options.n > 0) {
    consulta.set('n', String(options.n))
  }
  if (options.s !== undefined && Number.isInteger(options.s) && options.s > 0) {
    consulta.set('s', String(options.s))
  }

  const query = consulta.toString()

  return query === '' ? base : `${base}?${query}`
}

/**
 * La referencia del título que la dirección trae escrita.
 *
 * Es la vía preferente: la escribió la ficha, que tiene el `animeRef` del episodio
 * en la mano. Sin ella —una dirección escrita a mano o un enlace viejo— queda
 * `animeRefOf`, que adivina.
 */
export function animeRefFromPath(path: string): string | undefined {
  const consulta = path.split('?')[1] ?? ''
  const crudo = new URLSearchParams(consulta).get('anime')

  return crudo === null || crudo === '' ? undefined : crudo
}

/** El modo pedido en una dirección, o nada si no pide ninguno de los conocidos. */
export function modeFromPath(path: string): PlayMode | undefined {
  const consulta = path.split('?')[1] ?? ''
  const modo = new URLSearchParams(consulta).get('mode')

  return isPlayMode(modo) ? modo : undefined
}

/**
 * El segundo desde el que seguir, si la dirección lo trae.
 *
 * La fila de «continuar viendo» sabe dónde se dejó y lo pone en el enlace, así
 * que la pantalla de reproducción no tiene que volver a preguntárselo a nadie:
 * el dato viaja con el enlace y sigue ahí si se comparte. Sin esto, darle a
 * reproducir empezaba en el segundo cero y la posición registrada no servía para
 * nada, que es justo lo que hace inútil la fila.
 *
 * Un valor que no sea un entero positivo no se interpreta: una dirección escrita
 * a mano no puede dejar el reproductor en un segundo imposible.
 */
export function startAtFromPath(path: string): number | undefined {
  const consulta = path.split('?')[1] ?? ''
  const crudo = new URLSearchParams(consulta).get('at')
  if (crudo === null) return undefined

  const segundos = Number(crudo)

  return Number.isInteger(segundos) && segundos > 0 ? segundos : undefined
}

/**
 * El número de episodio que la dirección trae escrito, si lo trae.
 *
 * Admite decimales —una fuente numera `7.5`— y exige que sea finito y positivo:
 * `?n=0` no es un episodio y `?n=1e999` es infinito, así que ninguna de las dos
 * se interpreta. Una dirección escrita a mano no puede inventar un número, y por
 * eso la ausencia de `?n=` **no** se sustituye por el número que se pueda deducir
 * de la referencia: sin él, la pantalla se comporta como si no hubiera vecinos.
 */
/**
 * La temporada que la dirección trae escrita, si la trae.
 *
 * Un entero positivo o nada: una dirección escrita a mano no puede pedir la
 * temporada `0` ni `1.5`, y sin temporada la pantalla se comporta como antes.
 */
export function seasonFromPath(path: string): number | undefined {
  const consulta = path.split('?')[1] ?? ''
  const crudo = new URLSearchParams(consulta).get('s')
  if (crudo === null || crudo.trim() === '') return undefined

  const temporada = Number(crudo)

  return Number.isInteger(temporada) && temporada > 0 ? temporada : undefined
}

export function numberFromPath(path: string): number | undefined {
  const consulta = path.split('?')[1] ?? ''
  const crudo = new URLSearchParams(consulta).get('n')
  if (crudo === null || crudo.trim() === '') return undefined

  const numero = Number(crudo)

  return Number.isFinite(numero) && numero > 0 ? numero : undefined
}

/**
 * La referencia del título a partir de la del episodio.
 *
 * **Último recurso**: la dirección debería traer el título en `?anime=`, que es un
 * dato que la ficha ya tiene. Esto adivina por convención, y las convenciones son
 * dos: la almohadilla del fixture y de animeav1 (`aurora-nocturna#3`) y la barra de
 * jkanime (`dandadan/12`).
 *
 * Adivinar de menos es lo caro: con sólo la almohadilla, el reproductor pedía el
 * detalle de `dandadan/12`, el proveedor devolvía la página del episodio con su
 * `<title>`, y esa ficha —«Dandadan 12 Sub Español Online gratis — JkAnime»—
 * quedaba escrita en la base y en la fila de «Último añadido».
 *
 * Una referencia sin ninguno de los dos cortes es su propio título: los
 * proveedores que no numeran episodios usan la misma referencia para los dos.
 */
export function animeRefOf(episodeRef: string): string {
  const almohadilla = episodeRef.indexOf('#')
  if (almohadilla !== -1) return episodeRef.slice(0, almohadilla)

  const barra = episodeRef.lastIndexOf('/')
  if (barra > 0 && /^\d+$/.test(episodeRef.slice(barra + 1))) return episodeRef.slice(0, barra)

  return episodeRef
}

/** Una referencia de episodio, que es lo que basta para pedirle el stream. */
export interface EpisodeRef {
  readonly providerId: string
  readonly value: string
}

export interface EpisodeNeighbours {
  /** El episodio anterior, o nada si éste es el primero. */
  readonly previous: EpisodeRef | undefined
  /** El siguiente, o nada si éste es el último. */
  readonly next: EpisodeRef | undefined
}

/** El número que una referencia lleva detrás de la almohadilla, si lo lleva. */
function episodeNumberOf(ref: string): number | undefined {
  const corte = ref.indexOf('#')
  if (corte === -1) return undefined

  const numero = Number(ref.slice(corte + 1))

  return Number.isInteger(numero) && numero > 0 ? numero : undefined
}

/** Un episodio, con lo justo para reconocerlo y enseñarlo. */
interface ListedEpisode {
  readonly ref: EpisodeRef
  readonly number: number
}

/** Los episodios de ese proveedor, en el orden en que los sirvió la lista. */
function episodesOfProvider(
  episodes: readonly ListedEpisode[],
  providerId: string,
): readonly ListedEpisode[] {
  return episodes.filter((episode) => episode.ref.providerId === providerId)
}

/**
 * En qué lugar de la lista está el episodio que se ve.
 *
 * Se busca por la referencia y, si no está, por el número. Un proveedor puede
 * numerar sus episodios con una referencia distinta de la que sirvió la lista, y
 * perder las flechas por eso sería perder la función por un detalle de forma.
 */
function indexOfCurrent(episodes: readonly ListedEpisode[], currentRef: string): number {
  const numero = episodeNumberOf(currentRef)

  return episodes.findIndex(
    (episode) =>
      episode.ref.value === currentRef || (numero !== undefined && episode.number === numero),
  )
}

/**
 * Los vecinos del episodio que se está viendo.
 *
 * Los límites los pone la propia lista: el primero no tiene anterior y el último
 * no tiene siguiente, y eso se dice devolviendo nada en lugar de mandar a la
 * pantalla a inventarse un «episodio 0». Es la regla que el usuario pidió: no se
 * pasa del mínimo ni del máximo.
 */
export function neighbourEpisodes(
  episodes: readonly ListedEpisode[],
  providerId: string,
  currentRef: string,
): EpisodeNeighbours {
  const propios = episodesOfProvider(episodes, providerId)
  const indice = indexOfCurrent(propios, currentRef)

  if (indice === -1) return { previous: undefined, next: undefined }

  return {
    previous: propios[indice - 1]?.ref,
    next: propios[indice + 1]?.ref,
  }
}

export interface EpisodePosition {
  /** El número del episodio que se está viendo. */
  readonly number: number
  /** Cuántos tiene el título. */
  readonly total: number
}

/**
 * Qué episodio se está viendo, de cuántos.
 *
 * Es lo que se enseña en medio de las dos flechas: sin ello, dos botones en los
 * extremos de una fila vacía no dicen ni dónde se está ni cuánto queda, y la
 * flecha apagada del primer episodio parece un fallo en vez de un límite.
 */
export function episodePosition(
  episodes: readonly ListedEpisode[],
  providerId: string,
  currentRef: string,
): EpisodePosition | undefined {
  const propios = episodesOfProvider(episodes, providerId)
  const indice = indexOfCurrent(propios, currentRef)
  const actual = indice === -1 ? undefined : propios[indice]

  return actual === undefined ? undefined : { number: actual.number, total: propios.length }
}
