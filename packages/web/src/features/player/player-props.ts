/**
 * Lo que el reproductor recibe de quien lo monta.
 *
 * Está fuera de `Player.tsx` porque es su contrato, no su dibujo: la pantalla de
 * reproducción decide la fuente, el modo de audio, la posición y los avisos, y el
 * reproductor sólo los usa. Con el contrato en un archivo propio, el componente
 * queda para componer el marcado, que es lo que cuesta leer cuando se mezcla con
 * setenta líneas de documentación de propiedades.
 */

import type { SkipInterval } from '@nn-anime/core/schema'
import type { SafeTrack } from './usePlayer'
import type { PlayMode } from './watch-route'

/**
 * El salto que se ofrece ahora mismo.
 *
 * La pantalla decide **cuál** y **a dónde**: es la que tiene los intervalos del
 * episodio, la posición y el margen elegido. El reproductor sólo pinta el botón
 * dentro del marco, lo dispara con la tecla y avisa cuando se salta.
 */
export interface PlayerSkip {
  /** La clave del intervalo, que es como la pantalla recuerda que ya se saltó. */
  readonly key: string
  /** La clave i18n de la etiqueta: «Saltar intro», «Saltar ending»… */
  readonly labelKey: string
  /** El segundo al que se salta. */
  readonly destinoS: number
}

export interface PlayerProps {
  /** URL del proxy: el ticket, nunca la del upstream. */
  readonly url: string
  readonly kind: string
  readonly title?: string | undefined
  /** Pistas que el navegador puede pintar, ya filtradas. */
  readonly tracks?: readonly SafeTrack[] | undefined
  /**
   * La imagen que se ve antes del primer fotograma.
   *
   * Es la portada del título servida por el proxy —`/api/cover/...`—, y sólo se
   * pasa cuando el proveedor dio una: sin portada, el `<video>` se queda con su
   * fondo, que es lo que había antes de esto. Inventar una dirección aquí sería
   * pedirle una imagen a un sitio que no dijo tenerla.
   */
  readonly poster?: string | undefined
  /**
   * El modo de audio con el que se está viendo, si quien monta el reproductor lo
   * sabe.
   *
   * Va aquí y no dentro del reproductor porque el estado es de la pantalla: el
   * mismo valor decide qué stream se pide al servidor («doblado», «subtitulado»)
   * y la fila de mandos de debajo del video lo pinta. El menú de ajustes lo
   * repite porque es donde se busca cuando no se ve, y las dos copias escriben en
   * el mismo sitio.
   */
  readonly mode?: PlayMode | undefined
  readonly onMode?: ((mode: PlayMode) => void) | undefined
  /** Abrir el episodio en el reproductor externo. Sin esto no se ofrece. */
  readonly onMpv?: (() => void) | undefined
  /**
   * Si el episodio siguiente empieza solo, y cómo cambiarlo.
   *
   * La preferencia la guarda la pantalla —es suya, porque es ella la que sabe
   * cuál es el episodio siguiente— y aquí sólo se pinta el interruptor, que vive
   * con los demás ajustes.
   */
  readonly autoplay?: boolean | undefined
  readonly onAutoplay?: ((valor: boolean) => void) | undefined
  /** Se llama al empezar a reproducir de verdad, no al cargar la página. */
  readonly onPlay?: (() => void) | undefined
  readonly onPause?: (() => void) | undefined
  readonly onProgress?: ((positionS: number, durationS: number) => void) | undefined
  /**
   * La duración del medio, cuando el elemento la conoce.
   *
   * Se reenvía tal cual a `usePlayer`, que la saca de `loadedmetadata`. La
   * pantalla la necesita para pedir los intervalos saltables sin bloquear la
   * reproducción.
   */
  readonly onDuration?: ((durationS: number) => void) | undefined
  /**
   * El intervalo saltable que se ofrece ahora.
   *
   * Sin esto —o con los ajustes por defecto, que no saltan solos— no hay botón:
   * la pantalla lo deja vacío cuando no hay intervalo, cuando el usuario ya salió
   * de él tras saltar o cuando no hay datos del episodio.
   */
  readonly skip?: PlayerSkip | undefined
  /** Se salta: manual con el botón o con `S`, o automático si el ajuste está activo. */
  readonly onSkip?: ((destinoS: number, clave: string) => void) | undefined
  /**
   * ¿Se salta solo? Es una preferencia de la pantalla; aquí sólo se ejecuta.
   *
   * El salto automático ocurre **una sola vez por intervalo y episodio**: la
   * clave del intervalo lleva las dos cosas, así que volver a entrar en él a
   * mano no dispara otro salto.
   */
  readonly autoSkip?: boolean | undefined
  /**
   * Los intervalos del episodio, para marcarlos en la barra de progreso.
   *
   * Es información de contexto —dónde está el opening en el capítulo— y sólo se
   * pinta cuando hay datos: sin ellos la barra queda exactamente como estaba.
   */
  readonly intervals?: readonly SkipInterval[] | undefined
  /**
   * El episodio llegó al final.
   *
   * Sale del evento del elemento y no de la posición: una pausa en el último
   * segundo y el final se parecen, y de aquí sale la tarjeta del siguiente.
   */
  readonly onEnded?: (() => void) | undefined
  /**
   * El `<video>` montado, o `null` al desmontarlo.
   *
   * Lo pide la sala: para sincronizar hace falta el elemento de verdad —su
   * `currentTime`, su `paused` y su `playbackRate`— y la pantalla no tiene otra
   * forma de llegar a él. No sustituye a `videoRef`: el reproductor sigue siendo
   * su dueño y esto sólo se lo presta a quien lo monta.
   */
  readonly onVideoElement?: ((elemento: HTMLVideoElement | null) => void) | undefined
  /** Segundo en el que empezar, al reanudar o al cambiar de modo. */
  readonly startAtS?: number | undefined
  /**
   * Pide una fuente nueva para el mismo episodio y devuelve su URL.
   *
   * La pantalla es quien sabe resolver el stream —y saltarse su caché—; el
   * reproductor sólo la llama cuando la URL que tiene dejó de valer. Sin esto,
   * un 403 de la firma caducada se queda en un aviso y una reproducción parada.
   */
  readonly renovarFuente?: (() => Promise<string | undefined>) | undefined
  /** El ancla de la guía: el reproductor es una parada del recorrido. */
  readonly dataTour?: string | undefined
}
