/**
 * La cinta de la marquesina.
 *
 * Una línea que corre pegada al borde inferior de la marquesina, con lo que hay
 * ahora mismo. En el diseño de referencia son los estrenos del día; aquí es **lo
 * más visto**, porque los estrenos necesitan una fecha de emisión por episodio que
 * los proveedores no dan. Se pone lo que sí se sabe, y si no hay nada, la cinta no
 * se pinta.
 *
 * El rótulo va **fuera** del carro: es el que dice de qué va la línea y no puede
 * irse con ella. El carro corre dentro de una pista con recorte, para que la cinta
 * no ensanche la página.
 *
 * La lista va **dos veces**: la segunda copia cierra el bucle —el carro se
 * desplaza la mitad de su ancho y la segunda mitad ocupa el hueco de la primera—
 * y va fuera del orden de tabulación y del árbol de accesibilidad, porque es la
 * misma información otra vez. Sin esa copia, la cinta salta al empezar de nuevo.
 *
 * La vuelta **no** es un número fijo: se mide el carro y se le da el tiempo que
 * tarda en pasar a la velocidad del token (`--cinta-velocidad`). Con una vuelta
 * fija, el recorrido no cambia pero el ancho del carro sí, así que la cinta corría
 * el doble de rápido con la lista larga de un proveedor real que con una corta.
 *
 * Se detiene con el puntero encima o con el foco dentro, que es lo que deja
 * leerla; con movimiento reducido no se mueve nada.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import { Fragment, type ReactNode, type RefObject, useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'

export interface TickerProps {
  readonly items: readonly AnimeSummary[]
}

/**
 * Los píxeles por segundo de un valor de token como `60px/s`.
 *
 * La velocidad se lee del token en lugar de escribirse aquí: el número vive donde
 * vive el resto de la pintura, y así el que mueve la cinta y el que la mide no
 * pueden separarse. Un valor que no encaje —o que no sea positivo— devuelve
 * `undefined`, y entonces la cinta se queda con la vuelta lenta del token: peor
 * que lentos es que la cinta se pare o dé un salto.
 */
export function velocidadEnPxPorSegundo(valor: string): number | undefined {
  const coincidencia = /^\s*([\d.]+)px\s*\/\s*s\s*$/.exec(valor)
  const crudo = coincidencia?.[1]
  if (crudo === undefined) return undefined

  const velocidad = Number(crudo)

  return Number.isFinite(velocidad) && velocidad > 0 ? velocidad : undefined
}

/**
 * La vuelta: lo que tarda el carro en desplazarse la mitad de su ancho.
 *
 * La mitad y no el ancho entero, porque la lista va dos veces dentro del carro y
 * el bucle lo cierra la segunda copia. Es la cuenta que hace que la velocidad sea
 * la misma con cinco títulos que con cincuenta: con una vuelta fija, el tiempo no
 * cambia pero el recorrido sí, y la cinta corría el doble de rápido con la lista
 * larga —la de un proveedor real— que con la corta.
 */
export function vueltasDeLaCinta(anchoDelCarro: number, velocidad: number): number {
  if (velocidad <= 0 || anchoDelCarro <= 0) return 0

  return anchoDelCarro / 2 / velocidad
}

/**
 * La vuelta, medida sobre el carro ya pintado.
 *
 * Se mide y no se estima con el número de títulos: el ancho lo deciden el cuerpo
 * de la letra, la familia tipográfica y el texto de cada título. `ResizeObserver`
 * vuelve a medir cuando el carro cambia de ancho —al llegar la fuente, al girar el
 * móvil—, así que la velocidad no depende de cuándo se mida.
 *
 * En el servidor no hay nada que medir: la cinta sale con la vuelta del token y el
 * navegador la ajusta al montar.
 */
function useVueltasDelCarro(carro: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const elemento = carro.current
    if (elemento === null) return

    const medir = (): void => {
      const velocidad = velocidadEnPxPorSegundo(
        getComputedStyle(elemento).getPropertyValue('--cinta-velocidad'),
      )
      if (velocidad === undefined) return

      const vueltas = vueltasDeLaCinta(elemento.scrollWidth, velocidad)
      if (vueltas > 0) elemento.style.setProperty('--cinta-vuelta', `${vueltas}s`)
    }

    medir()

    const observador = new ResizeObserver(medir)
    observador.observe(elemento)

    return () => observador.disconnect()
  }, [carro])
}

export function Ticker(props: TickerProps): ReactNode {
  const carro = useRef<HTMLDivElement>(null)
  useVueltasDelCarro(carro)

  if (props.items.length === 0) return null

  return (
    <aside className="cinta" aria-label={t(DEFAULT_LOCALE, 'home.ticker')}>
      <p className="cinta__rotulo">{t(DEFAULT_LOCALE, 'home.ticker')}</p>

      <div className="cinta__pista">
        <div className="cinta__carro" ref={carro}>
          {props.items.map((entrada) => (
            <Fragment key={`${entrada.ref.providerId}:${entrada.ref.value}`}>
              <Link
                to={`/anime/${encodeURIComponent(entrada.ref.providerId)}/${encodeURIComponent(entrada.ref.value)}`}
                className="cinta__item"
              >
                {entrada.title}
              </Link>
              <span className="cinta__punto" aria-hidden="true" />
            </Fragment>
          ))}

          {/* La copia que cierra el bucle: no es un enlace ni se anuncia, porque
              es la misma información otra vez. */}
          {props.items.map((entrada) => (
            <Fragment key={`copia:${entrada.ref.providerId}:${entrada.ref.value}`}>
              <span className="cinta__item" aria-hidden="true">
                {entrada.title}
              </span>
              <span className="cinta__punto" aria-hidden="true" />
            </Fragment>
          ))}
        </div>
      </div>
    </aside>
  )
}
