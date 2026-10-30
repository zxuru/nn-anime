/**
 * La guía, con driver.js.
 *
 * driver.js pinta fuera de React —el foco, el recorte y el popover son suyos—,
 * así que aquí sólo se le dan los pasos, el tema y los textos. El estado de lo
 * visto no vive en este archivo: `estado.ts` lo guarda y avisa.
 *
 * Cada pantalla tiene su recorrido y sale sola la primera vez que se entra. El
 * «?» de la cabecera repite el de la pantalla en la que estás. Los avisos de
 * novedad son faros de la misma librería (`hints`): un punto que late sobre la
 * función nueva y un diálogo que se descarta.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type Driver, type DriveStep, driver } from 'driver.js'
import { type Hints, hints } from 'driver.js/hints'
import { useEffect, useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { type RouteName, useRoute } from '../../router'
import { descartarAviso, estadoActual, marcarRecorrido, suscribir } from './estado'
import {
  avisosPendientes,
  type PasoGuia,
  RECORRIDOS,
  recorridoPendiente,
  selectorDeAncla,
} from './guia'

/** El recorrido vivo, si hay uno. driver.js sólo admite uno a la vez. */
let tour: Driver | undefined
/** Los faros de la pantalla actual. */
let faros: Hints | undefined

function prefiereQuieto(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * El elemento de un ancla que de verdad se está viendo.
 *
 * La navegación se pinta dos veces —la cabecera y la barra del móvil— y una de
 * las dos está escondida por la hoja. driver.js busca la primera del documento y
 * en un teléfono ésa es la que no se ve, así que el paso señalaba al vacío. Se
 * recorre la lista y se devuelve la primera visible; si no hay ninguna, la
 * primera, que es lo que hacía antes.
 */
function elementoDeAncla(ancla: string): Element {
  const selector = selectorDeAncla(ancla)
  const candidatos = document.querySelectorAll(selector)

  for (const candidato of candidatos) {
    if (candidato instanceof HTMLElement && candidato.offsetParent !== null) return candidato
  }

  return candidatos[0] ?? document.body
}

function pasoDeDriver(paso: PasoGuia): DriveStep {
  const ancla = paso.ancla

  return {
    ...(ancla === undefined ? {} : { element: () => elementoDeAncla(ancla) }),
    popover: {
      title: t(DEFAULT_LOCALE, paso.titulo),
      description: t(DEFAULT_LOCALE, paso.cuerpo),
      ...(paso.lado === undefined ? {} : { side: paso.lado }),
      ...(paso.alineacion === undefined ? {} : { align: paso.alineacion }),
    },
  }
}

/**
 * Abre el recorrido `id` desde el principio.
 *
 * Cerrarlo —con la ✕, con Escape o pasando el último paso— lo da por visto: se
 * puede repetir desde Ajustes o con el «?», y no vuelve a salir solo.
 */
export function abrirRecorrido(id: string): void {
  if (typeof document === 'undefined') return

  const recorrido = RECORRIDOS.find((candidato) => candidato.id === id)
  if (recorrido === undefined) return

  tour?.destroy()
  const quieto = prefiereQuieto()

  tour = driver({
    steps: recorrido.pasos.map(pasoDeDriver),
    // El velo de la casa, sin animación cuando el sistema pide quietud. La
    // duración corta es la de `--transition-normal`: un tutorial no es un
    // espectáculo.
    animate: !quieto,
    duration: quieto ? 0 : 200,
    overlayColor: '#000',
    overlayOpacity: 0.62,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'nn-guia',
    smoothScroll: true,
    // Un clic fuera no cierra el tutorial: se cierra con la ✕ o con Escape, que
    // son acciones deliberadas. Perder el hilo por rozar el fondo no enseña.
    allowClose: true,
    overlayClickBehavior: 'none',
    showProgress: true,
    progressText: t(DEFAULT_LOCALE, 'guia.progreso'),
    nextBtnText: t(DEFAULT_LOCALE, 'guia.siguiente'),
    prevBtnText: t(DEFAULT_LOCALE, 'guia.anterior'),
    doneBtnText: t(DEFAULT_LOCALE, 'guia.listo'),
    closeBtnLabel: t(DEFAULT_LOCALE, 'guia.cerrar'),
    // Un paso cuyo ancla no llegó a tiempo no se queda centrado hablando de algo
    // que no está: se salta. La espera cubre la carga de la pantalla.
    skipMissingElement: true,
    waitForElement: 2500,
    onPopoverRender: (popover) => {
      // El popover ya es `role="dialog"`; `aria-modal` lo completa: el foco no
      // sale de él mientras el recorrido está abierto (driver.js lo atrapa).
      popover.wrapper.setAttribute('aria-modal', 'true')

      /*
        driver.js enfoca el primer mando —la ✕— al abrir cada paso. En un
        recorrido que arranca solo, ese foco no lo pidió el teclado y el anillo
        del acento dejaba la ✕ como un botón coral en la esquina. El foco va a
        la caja: es lo que anuncia el diálogo, y el primer tabulador entra ya en
        los mandos. La microtarea corre después del foco de la librería.
      */
      popover.wrapper.tabIndex = -1
      queueMicrotask(() => {
        popover.wrapper.focus({ preventScroll: true })
      })
    },
    onDestroyed: () => {
      marcarRecorrido(recorrido.id)
    },
  })

  tour.drive()
}

/**
 * La guía de la aplicación: el recorrido de la pantalla y los faros de lo
 * nuevo. Se llama una sola vez, en la raíz.
 */
export function useGuia(): void {
  const estado = useSyncExternalStore(suscribir, estadoActual, estadoActual)
  const ruta = useRoute().name

  /*
    El recorrido de la pantalla sale solo la primera vez, con la pantalla ya
    pintada. Sin el retardo el popover se abre sobre esqueletos y los pasos que
    apuntan al contenido no encuentran su ancla; con él, la pantalla ya está.
  */
  useEffect(() => {
    const pendiente = recorridoPendiente(estado, ruta)
    if (pendiente === undefined) return

    const id = window.setTimeout(() => {
      // Un diálogo abierto —el aviso de seguridad— manda: la guía espera a la
      // siguiente visita en vez de taparlo.
      if (document.querySelector('dialog[open]') !== null) return
      if (document.body.classList.contains('driver-active')) return

      abrirRecorrido(pendiente.id)
    }, 900)

    return () => {
      window.clearTimeout(id)
    }
  }, [estado, ruta])

  /*
    Los faros de lo nuevo. Se montan un poco después que la pantalla para no
    competir con el recorrido ni con la carga, y se rehacen al cambiar de ruta:
    un aviso del inicio no tiene por qué latir en Ajustes.
  */
  useEffect(() => {
    const pendientes = avisosPendientes(estado, ruta)
    if (pendientes.length === 0) return

    const id = window.setTimeout(() => {
      faros?.hide()
      faros = hints({
        buttonText: t(DEFAULT_LOCALE, 'guia.entendido'),
        popoverClass: 'nn-guia-aviso',
        // El faro es pequeño: con el aire de diez píxeles que trae la librería,
        // la flecha se quedaba flotando lejos del punto.
        popoverOffset: 4,
        hints: pendientes.map((aviso) => ({
          id: aviso.id,
          element: selectorDeAncla(aviso.ancla),
          // Seis píxeles por debajo del borde del elemento: el faro cae entero
          // fuera de la cabecera, en vez de quedarse a caballo de su filete.
          beacon: { side: 'bottom', align: 'center', offsetY: 6 },
          popover: {
            title: t(DEFAULT_LOCALE, aviso.titulo),
            description: t(DEFAULT_LOCALE, aviso.cuerpo),
            side: aviso.lado ?? 'bottom',
            align: aviso.alineacion ?? 'center',
          },
          onDismiss: (_element, faro) => {
            if (faro.id !== undefined) descartarAviso(faro.id)
          },
        })),
      })
      faros.show()
    }, 1500)

    return () => {
      window.clearTimeout(id)
      faros?.hide()
      faros = undefined
    }
  }, [estado, ruta])
}
