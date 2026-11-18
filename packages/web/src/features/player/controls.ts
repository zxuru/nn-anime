/**
 * Atajos de teclado del reproductor, como funciones puras.
 *
 * Están aquí y no dentro del componente porque son la parte que más fácil se
 * rompe y la única que se puede probar sin un navegador: qué tecla hace qué, y
 * —más importante— **cuándo no se debe hacer nada**.
 *
 * La regla que más se olvida: si el foco está en un campo de texto, las teclas
 * son para escribir. Un reproductor que se queda con la barra espaciadora cuando
 * alguien escribe en el buscador es un reproductor que rompe la página entera.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { t } from '../../i18n'

export type PlayerAction =
  | 'toggle'
  | 'forward'
  | 'back'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'fullscreen'
  /**
   * Saltar el intervalo que se está reproduciendo —intro, ending o resumen—.
   *
   * La acción no sabe a dónde se salta: el destino lo decide la pantalla, que es
   * la que tiene el margen elegido y los intervalos del episodio. Aquí sólo se
   * reconoce la tecla; quien la recibe es `Player`, que llama al mismo salto que
   * el botón.
   */
  | 'skip'
  /**
   * Llena la ventana sin pedir la pantalla completa del sistema.
   *
   * Es una acción de la pantalla y no del elemento `<video>`: no toca ni el
   * medio ni `hls.js`, sólo la clase del contenedor. Se declara aquí, con las
   * demás, para que el atajo y su ayuda se prueben con las mismas funciones
   * puras que el resto.
   */
  | 'extended'

/** Segundos que salta cada flecha. */
export const SEEK_STEP_S = 10

/** Cuánto sube o baja el volumen con cada pulsación. */
export const VOLUME_STEP = 0.1

/**
 * Lo que se espera para saber si un clic sobre la imagen es un clic solo.
 *
 * El navegador manda `click`, `click` y sólo entonces `dblclick`, así que el
 * primer clic no se puede distinguir del segundo cuando llega. Con esta espera,
 * el clic sencillo se ejecuta si no viene otro detrás y el doble hace lo suyo.
 *
 * Tiene que caber dentro de la ventana del doble clic del navegador —unos 500 ms,
 * según el sistema—: una espera más larga haría que el clic sencillo saltara
 * antes de que llegara el `dblclick`, y un doble clic pausaría **además** de
 * poner la pantalla completa.
 */
export const CLICK_DELAY_MS = 250

/**
 * Lo que se espera antes de pasar solo al episodio siguiente.
 *
 * La cuenta atrás existe para poder pararla: ocho segundos es lo que se tarda en
 * leer qué viene y decidir, y lo bastante corto para que encadenar capítulos no
 * se sienta como una espera. Vivía en cinco y la tarjeta que la ofrece nacía
 * fuera de la ventana; el margen extra es el que deja verla. Vive aquí y no en
 * una pantalla porque las dos —la reproducción y la biblioteca— encadenan igual.
 */
export const SEGUNDOS_DEL_SIGUIENTE = 8

export interface KeyLike {
  readonly key: string
  /** `tagName` del elemento con el foco, en mayúsculas. */
  readonly tagName?: string | undefined
  readonly isContentEditable?: boolean | undefined
  /**
   * Si el foco está dentro de algo que ya se activa solo.
   *
   * Un `button`, un enlace, un `summary` o un `[role="button"]` tienen su propia
   * respuesta a `Enter` y a `Espacio`. El reproductor escucha en la ventana, así
   * que sin este dato se comía esas dos teclas y ningún mando se podía activar
   * con el teclado: ni «Ajustes», ni «Reproducir ahora», ni la lista.
   */
  readonly interactive?: boolean | undefined
  readonly ctrlKey?: boolean | undefined
  readonly metaKey?: boolean | undefined
  readonly altKey?: boolean | undefined
}

/**
 * ¿El foco está en algo donde se escribe?
 *
 * Se mira el `tagName` y `isContentEditable`, que es lo que un `input` de
 * verdad tiene: comprobar el tipo de un `input` por su `type` deja fuera los
 * campos de contraseña y los `textarea`.
 */
export function isTypingTarget(target: KeyLike | undefined): boolean {
  if (target === undefined) return false
  if (target.isContentEditable === true) return true

  const etiqueta = target.tagName?.toUpperCase() ?? ''

  return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT'
}

/**
 * La acción que corresponde a una tecla, o nada.
 *
 * Con `Ctrl`, `Meta` o `Alt` pulsados no se hace nada: esos son atajos del
 * navegador o del sistema, y quitarle a alguien `Ctrl+R` es una forma de
 * ganarse un enemigo.
 */
export function keyAction(event: KeyLike): PlayerAction | undefined {
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return undefined
  if (isTypingTarget(event)) return undefined

  // `Enter` y `Espacio` son la activación de un mando o un enlace. Si el foco
  // está en uno, la tecla es suya y el reproductor no la toca: en `/watch` eso
  // dejaba sin teclado «Ajustes», «Reproducir ahora», la vuelta a la ficha y los
  // doce renglones de la lista. El resto de atajos —`k`, flechas, `m`, `f`— no
  // activan nada por sí solos y siguen llegando al reproductor.
  if ((event.key === ' ' || event.key === 'Enter') && event.interactive === true) return undefined

  switch (event.key) {
    case ' ':
    case 'Enter':
    case 'k':
      return 'toggle'
    case 'ArrowRight':
      return 'forward'
    case 'ArrowLeft':
      return 'back'
    case 'ArrowUp':
      return 'volume-up'
    case 'ArrowDown':
      return 'volume-down'
    case 'm':
      return 'mute'
    case 'f':
      return 'fullscreen'
    // `s` de «saltar». No choca con ninguna de las anteriores —espacio, enter,
    // `k`, `m`, `f` y las flechas— y es la inicial de la acción en las dos
    // lenguas que importan aquí, así que no hay que memorizar una tecla rara.
    case 's':
      return 'skip'
    // `T` de «todo el ancho», elegida porque no choca con ningún atajo del
    // reproductor —espacio, enter, k, flechas, m, f, s y ?— ni con los del
    // navegador que se usan a diario. Mayúscula y minúscula son la misma tecla
    // con y sin Bloq Mayús, y las dos tienen que funcionar.
    case 't':
    case 'T':
      return 'extended'
    default:
      return undefined
  }
}

/** La nueva posición, sin salirse de la duración ni bajar de cero. */
export function seekBy(current: number, delta: number, duration: number): number {
  const destino = current + delta

  if (Number.isFinite(duration) && duration > 0) {
    return Math.min(Math.max(destino, 0), duration)
  }

  return Math.max(destino, 0)
}

/**
 * Deja un volumen dentro de lo que el elemento admite: de cero a uno.
 *
 * El guardián del no-número no es adorno: `video.volume = NaN` lanza, y lo que
 * llega aquí viene de un `<input type="range">`, que no promete un número. Un
 * valor que no es número cae al máximo, que es el que el elemento trae de
 * fábrica.
 */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1

  return Math.min(Math.max(volume, 0), 1)
}

/**
 * La velocidad como se lee en el menú: `0,75`, `1`, `1,25`.
 *
 * `String(0.75)` produce un punto, que en español separa millares y no
 * decimales. La `×` la pone el catálogo, no esta función: así el signo se puede
 * cambiar sin tocar el número.
 */
export function etiquetaVelocidad(rate: number): string {
  return String(rate).replace('.', ',')
}

/** El volumen, entre 0 y 1. */
export function volumeBy(current: number, delta: number): number {
  return clampVolume(current + delta)
}

/**
 * El porcentaje que enseña la barra de volumen.
 *
 * La barra va de 0 a 100 y no de 0 a 1: el elemento lee un número, pero quien no
 * ve la pantalla oye lo que anuncia el mando, y «0,5» no es un volumen. «50» sí.
 */
export function volumePercent(volume: number): number {
  return Math.round(clampVolume(volume) * 100)
}

/** El volumen que corresponde a la posición de la barra. */
export function volumeFromPercent(percent: number): number {
  return clampVolume(percent / 100)
}

/** Segundos en `m:ss` o `h:mm:ss`. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'

  const total = Math.floor(seconds)
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = total % 60
  const dosDigitos = (valor: number): string => String(valor).padStart(2, '0')

  return horas > 0
    ? `${horas}:${dosDigitos(minutos)}:${dosDigitos(segundos)}`
    : `${minutos}:${dosDigitos(segundos)}`
}

/**
 * El tiempo, dicho como se dice.
 *
 * Es lo que anuncia el `aria-valuetext` de la barra de progreso: `0:31 / 24:55`
 * es lo que se lee en la pantalla, no lo que se oye. Se redondea hacia abajo y no
 * se dicen unidades vacías —«2 minutos 44 segundos», no «0 horas 2 minutos»—,
 * porque el nombre de un mando se oye entero cada vez que se toca.
 */
export function spokenTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return t(DEFAULT_LOCALE, 'player.spoken.seconds', { count: 0 })
  }

  const total = Math.floor(seconds)
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = total % 60
  const partes: string[] = []

  if (horas > 0) {
    partes.push(
      t(DEFAULT_LOCALE, horas === 1 ? 'player.spoken.hour' : 'player.spoken.hours', {
        count: horas,
      }),
    )
  }
  if (minutos > 0) {
    partes.push(
      t(DEFAULT_LOCALE, minutos === 1 ? 'player.spoken.minute' : 'player.spoken.minutes', {
        count: minutos,
      }),
    )
  }
  // Los segundos van siempre: sin ellos, «2 minutos» para 2:05 se queda corto y
  // el reloj que está al lado diría otra cosa.
  partes.push(
    t(DEFAULT_LOCALE, segundos === 1 ? 'player.spoken.second' : 'player.spoken.seconds', {
      count: segundos,
    }),
  )

  return partes.join(' ')
}

/** Lo que se anuncia por `aria-live`. Una frase corta, sin números raros. */
export function announcement(state: {
  readonly playing: boolean
  readonly positionS: number
  readonly durationS: number
  readonly error?: string | undefined
}): string {
  if (state.error !== undefined && state.error !== '') {
    return t(DEFAULT_LOCALE, 'player.announce.error', { message: state.error })
  }

  const base = t(
    DEFAULT_LOCALE,
    state.playing ? 'player.announce.playing' : 'player.announce.paused',
  )
  if (state.durationS <= 0) return base

  return t(DEFAULT_LOCALE, 'player.announce.time', {
    state: base,
    position: formatTime(state.positionS),
    duration: formatTime(state.durationS),
  })
}

/** ¿Hay que usar `hls.js` o basta con el `<video>`? */
export function needsHls(kind: 'hls' | 'file' | string): boolean {
  return kind === 'hls'
}
