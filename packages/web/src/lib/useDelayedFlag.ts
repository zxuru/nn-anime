/**
 * Un aviso que se enciende sólo si la espera dura.
 *
 * Cargar una ficha que responde en 40 ms no puede enseñar un esqueleto: se ve un
 * parpadeo, y el parpadeo se lee como «algo ha fallado» aunque no haya fallado
 * nada. La regla es la de siempre en las interfaces que se sienten rápidas: si la
 * respuesta llega antes del umbral, el estado intermedio no llega a existir.
 *
 * La mecánica vive en `DelayedFlag` para poder medirla con `bun test` sin un DOM:
 * el gancho sólo la envuelve y la ata al ciclo de vida de React. La clase
 * cancelar-y-reprogramar está aquí y no en el gancho porque es justo lo que se
 * rompe cuando se copia: dos esperas seguidas y el aviso de la primera enciende
 * el de la segunda.
 */

import { useEffect, useRef, useState } from 'react'

/** Umbral por defecto, en milisegundos: por debajo no se pinta nada intermedio. */
export const DELAY_ESQUELETO_MS = 150

export class DelayedFlag {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly onChange: (visible: boolean) => void,
    private readonly defaultMs: number = DELAY_ESQUELETO_MS,
  ) {}

  /**
   * Programa el encendido si `active` es verdadero y lo apaga si no.
   *
   * Cada llamada cancela la anterior: el aviso corresponde siempre al último
   * estado, no a una espera que ya no importa.
   */
  update(active: boolean, ms: number = this.defaultMs): void {
    this.cancel()

    if (!active) {
      this.onChange(false)
      return
    }

    this.timer = setTimeout(() => {
      this.timer = undefined
      this.onChange(true)
    }, ms)
  }

  /** Cancela la espera sin tocar el valor actual. */
  cancel(): void {
    if (this.timer === undefined) return

    clearTimeout(this.timer)
    this.timer = undefined
  }
}

/**
 * `true` cuando `active` lleva activo al menos `ms`.
 *
 * Con la respuesta rápida nunca llega a `true`; al desmontar se cancela la espera
 * y no queda un `setState` sobre un componente que ya no existe.
 */
export function useDelayedFlag(active: boolean, ms: number = DELAY_ESQUELETO_MS): boolean {
  const [visible, setVisible] = useState(false)
  const flag = useRef<DelayedFlag | undefined>(undefined)

  // El objeto se crea una vez por montaje: su temporizador es estado, no una
  // función derivada del render, y recrearlo en cada render perdería la espera.
  if (flag.current === undefined) flag.current = new DelayedFlag(setVisible)

  useEffect(() => {
    const actual = flag.current
    actual?.update(active, ms)

    return () => actual?.cancel()
  }, [active, ms])

  return visible
}
