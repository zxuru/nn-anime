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

/** El volumen, entre 0 y 1. */
export function volumeBy(current: number, delta: number): number {
  return Math.min(Math.max(current + delta, 0), 1)
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
