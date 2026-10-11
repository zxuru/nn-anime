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

export type PlayerAction =
  | 'toggle'
  | 'forward'
  | 'back'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'fullscreen'

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

export interface KeyLike {
  readonly key: string
  /** `tagName` del elemento con el foco, en mayúsculas. */
  readonly tagName?: string | undefined
  readonly isContentEditable?: boolean | undefined
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

/** Lo que se anuncia por `aria-live`. Una frase corta, sin números raros. */
export function announcement(state: {
  readonly playing: boolean
  readonly positionS: number
  readonly durationS: number
  readonly error?: string | undefined
}): string {
  if (state.error !== undefined && state.error !== '') return `Error: ${state.error}`

  const base = state.playing ? 'Reproduciendo' : 'En pausa'
  if (state.durationS <= 0) return base

  return `${base}, ${formatTime(state.positionS)} de ${formatTime(state.durationS)}`
}

/** ¿Hay que usar `hls.js` o basta con el `<video>`? */
export function needsHls(kind: 'hls' | 'file' | string): boolean {
  return kind === 'hls'
}
