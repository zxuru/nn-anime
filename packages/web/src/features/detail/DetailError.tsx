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
import type { AnimeSummary } from '@nn-anime/core/models'
import { ChevronLeft, RefreshCw, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import type { Fallo } from '../../api/fallo'
import { t } from '../../i18n'
import { Link } from '../../router'
import { CARGA } from './carga-textos'
import { rutaDeFicha } from './direccion'

export interface DetailErrorProps {
  readonly fallo: Fallo
  /** El nombre con el que el proveedor se anuncia; sin él, su id. */
  readonly providerName: string
  /**
   * Las fuentes donde esta obra **sí** está.
   *
   * Viene de una lectura aparte: el núcleo de la ficha falló, así que su lista de
   * fuentes no llegó. Con esta lista, el error puede ofrecer «Probar con
   * {proveedor}»; sin ella, no ofrece nada.
   */
  readonly alternativas?: readonly AnimeSummary[]
  /** El nombre con el que se anuncia cada proveedor, por su id. */
  readonly providerNames?: ReadonlyMap<string, string>
  /** Sin reintento, el fallo es de los que no se arreglan repitiendo la lectura. */
  readonly onRetry?: (() => void) | undefined
  readonly onBack: () => void
}

export function DetailError(props: DetailErrorProps): ReactNode {
  const { fallo, providerName, onRetry } = props
  const es404 = fallo.clase === 'noExiste'
  const alternativas = props.alternativas ?? []

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
          El botón «Probar con {proveedor}»: la obra no está en el proveedor que
          se pidió, pero puede estar en otro. Las fuentes de la obra son parte
          del bundle de la ficha, que es justo lo que aquí no llegó, así que se
          leen **aparte** cuando la carga falla —la base local, no el
          proveedor— y sólo se ofrece lo que se sabe: sin alternativas, no hay
          botón.

          Es un **enlace de verdad**, no un botón que navega por JavaScript: se
          puede abrir en otra pestaña, se puede copiar, y funciona sin la
          aplicación cargada. Lo que se pinta como un botón es el estilo.
        */}
        <div className="detalle-fallo__acciones">
          {/* Sin alternativas no se pinta nada: la lista vacía no deja hueco. */}
          {alternativas.map((alternativa) => {
            const nombre =
              props.providerNames?.get(alternativa.ref.providerId) ?? alternativa.ref.providerId

            return (
              <Link
                key={`${alternativa.ref.providerId}:${alternativa.ref.value}`}
                to={rutaDeFicha(alternativa.ref.providerId, alternativa.ref.value)}
                className="button"
              >
                {t(DEFAULT_LOCALE, 'detail.error.tryOther', { provider: nombre })}
              </Link>
            )
          })}

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
