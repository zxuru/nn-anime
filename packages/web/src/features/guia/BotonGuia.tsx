/**
 * El botón de la guía en la cabecera.
 *
 * Un «?» pequeño, no un destino más: la guía se abre encima de lo que se está
 * mirando y se cierra sin cambiar de pantalla. Por eso es un botón y no un
 * enlace, y por eso lleva el nombre accesible escrito: el signo solo no se lee.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { useRoute } from '../../router'
import { abrirBienvenida } from './useGuia'

export function BotonGuia(): ReactNode {
  const ruta = useRoute().name
  const etiqueta = t(DEFAULT_LOCALE, 'guia.abrir')

  return (
    <button
      type="button"
      className="shell__guia"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={() => abrirBienvenida(ruta)}
    >
      <span aria-hidden="true">?</span>
    </button>
  )
}
