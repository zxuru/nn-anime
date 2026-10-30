/**
 * La tarjeta de error de la ficha.
 *
 * Sustituye al esqueleto cuando la ficha no se pudo traer. Dice tres cosas, y en
 * este orden: qué pasó, de quién es la culpa —el proveedor, por su nombre— y qué
 * se puede hacer. El mensaje crudo del cliente no se enseña: «GET
 * /api/anime/jkanime/mashle respondió 502» es un mensaje para quien lee
 * registros, no para quien está mirando la pantalla.
 *
 * **El 404 no se reintenta.** Si el proveedor no conoce esa referencia, volver a
 * pedirla va a dar el mismo 404: el único mando que tiene sentido es volver
 * atrás. El resto de fallos —red, reloj, servidor— sí se reintentan, porque el
 * siguiente intento puede salir bien.
 *
 * El foco entra por el mando que resuelve el fallo: quien llega con el teclado o
 * con un lector de pantalla no tiene que buscar el botón en una pantalla que
 * acaba de cambiar debajo de él.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { ChevronLeft, RefreshCw, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import type { Fallo } from '../../api/fallo'
import { t } from '../../i18n'
import { CARGA } from './carga-textos'

export interface DetailErrorProps {
  readonly fallo: Fallo
  /** El nombre con el que el proveedor se anuncia; sin él, su id. */
  readonly providerName: string
  /** Sin reintento, el fallo es de los que no se arreglan repitiendo la lectura. */
  readonly onRetry?: (() => void) | undefined
  readonly onBack: () => void
}

export function DetailError(props: DetailErrorProps): ReactNode {
  const { fallo, providerName, onRetry } = props
  const es404 = fallo.clase === 'noExiste'

  /**
   * El botón que recibe el foco al montar: Reintentar si lo hay, Volver si no.
   *
   * Es el mando que saca a la persona del error, así que es también por donde
   * debe entrar el foco: la pantalla cambia entera bajo sus pies y buscar el
   * botón es trabajo que no le corresponde.
   */
  const primerBoton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primerBoton.current?.focus()
  }, [])

  return (
    // `role="alert"`: el aviso sustituye a un contenido que no llegó, y quien no
    // ve la pantalla tiene que enterarse sin ir a buscarlo.
    <article className="detail__estado">
      <section className="detalle-fallo" role="alert">
        <div className="detalle-fallo__cabecera">
          <TriangleAlert
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
            className="detalle-fallo__icono"
          />
          <h1 className="detalle-fallo__titulo">
            {t(DEFAULT_LOCALE, es404 ? CARGA.notFoundTitle : CARGA.errorTitle)}
          </h1>
        </div>

        <p className="detalle-fallo__cuerpo">
          {/* El 404 tiene su frase de siempre, la que el catálogo ya usaba para
              decir que la referencia no está en el proveedor. */}
          {t(DEFAULT_LOCALE, es404 ? 'detail.notFound' : CARGA.errorBody)}
        </p>

        <p className="detalle-fallo__proveedor">
          {t(DEFAULT_LOCALE, CARGA.provider, { provider: providerName })}
        </p>

        {/*
          TODO(T210): el botón «Probar con {proveedor}», cuando la obra está en
          otra fuente, no se pinta. El fallo sólo trae su clase y el mensaje del
          error: las fuentes de la obra son parte del bundle de la ficha, que es
          justo lo que aquí no llegó. Ofrecerlas exigiría una lectura aparte que
          hoy nadie tiene, así que se deja para cuando el hook exponga las fuentes
          conocidas de una ficha fallida.
        */}
        <div className="detalle-fallo__acciones">
          {onRetry === undefined ? null : (
            <button
              type="button"
              className="button button--primary"
              onClick={onRetry}
              ref={primerBoton}
            >
              <RefreshCw size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
              {t(DEFAULT_LOCALE, CARGA.retry)}
            </button>
          )}

          <button
            type="button"
            className="button"
            onClick={props.onBack}
            // Sin reintento, el foco entra por aquí: es el único mando.
            ref={onRetry === undefined ? primerBoton : undefined}
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
            {t(DEFAULT_LOCALE, CARGA.back)}
          </button>
        </div>
      </section>
    </article>
  )
}
