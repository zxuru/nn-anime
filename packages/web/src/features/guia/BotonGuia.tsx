/**
 * El botón de la guía en la cabecera.
 *
 * Un «?» pequeño, no un destino más: abre el recorrido de la pantalla en la que
 * estás, encima de lo que se está mirando, y se cierra sin cambiar de pantalla.
 * Por eso es un botón y no un enlace, y por eso lleva el nombre accesible
 * escrito: el signo solo no se lee.
 *
 * El signo es el `CircleHelp` de lucide y no una «?» de la tipografía: un
 * carácter suelto cambiaba de forma y de peso con la familia —cada sistema
 * resolvía la suya— y al lado de los demás dibujos se leía como texto, no como
 * un mando.
 *
 * En una pantalla sin recorrido —la dirección que no existe— no se pinta: un
 * botón que no abre nada es peor que su ausencia.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { useRoute } from '../../router'
import { recorridoDeRuta } from './guia'
import { abrirRecorrido } from './useGuia'

export function BotonGuia(): ReactNode {
  const ruta = useRoute().name
  const recorrido = recorridoDeRuta(ruta)
  if (recorrido === undefined) return null

  const etiqueta = t(DEFAULT_LOCALE, 'guia.abrirPantalla', {
    pantalla: t(DEFAULT_LOCALE, recorrido.titulo),
  })

  return (
    <button
      type="button"
      className="shell__guia"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={() => abrirRecorrido(recorrido.id)}
    >
      <CircleHelp size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
    </button>
  )
}
