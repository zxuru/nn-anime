/**
 * La guía, en Ajustes.
 *
 * Es el índice de los recorridos: cada sección con su botón, que lleva a esa
 * pantalla y abre su tutorial. La ficha y el reproductor no están: dependen de
 * un título concreto y su «?» vive en su propia pantalla. Debajo, el botón que
 * devuelve a la lista los avisos descartados.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { type RouteName, useNavigate } from '../../router'
import { restablecerAvisos } from './estado'
import { ANCLAS, RECORRIDOS, type Recorrido } from './guia'
import { abrirRecorrido } from './useGuia'

/**
 * Las secciones a las que se puede llevar desde Ajustes sin más datos que la
 * ruta. La ficha y el reproductor piden un título y un episodio: ésos se repiten
 * con el «?» de su pantalla.
 */
const RUTA_FIJA: Partial<Record<RouteName, string>> = {
  home: '/',
  search: '/search',
  library: '/library',
  profile: '/profile',
  history: '/history',
  settings: '/settings',
}

function rutaDe(recorrido: Recorrido): string | undefined {
  const primera = recorrido.rutas[0]
  return primera === undefined ? undefined : RUTA_FIJA[primera]
}

export function SeccionGuia(): ReactNode {
  const navigate = useNavigate()
  const repetibles = RECORRIDOS.filter((recorrido) => rutaDe(recorrido) !== undefined)

  return (
    <section data-tour={ANCLAS.ajustesGuia}>
      <h2>{t(DEFAULT_LOCALE, 'guia.ajustes.titulo')}</h2>
      <p>{t(DEFAULT_LOCALE, 'guia.ajustes.cuerpo')}</p>

      {/*
        Un botón por sección y no un desplegable: son seis, caben en dos
        renglones y se ve de un vistazo qué tutoriales hay. Un `fieldset` porque
        agrupa controles; su marco se quita en la hoja.
      */}
      <fieldset className="guia__acciones" aria-label={t(DEFAULT_LOCALE, 'guia.ajustes.secciones')}>
        {repetibles.map((recorrido) => (
          <button
            key={recorrido.id}
            type="button"
            className="button"
            onClick={() => {
              const ruta = rutaDe(recorrido)
              if (ruta !== undefined) navigate.push(ruta)
              abrirRecorrido(recorrido.id)
            }}
          >
            {t(DEFAULT_LOCALE, recorrido.titulo)}
          </button>
        ))}
      </fieldset>

      <p>
        <button type="button" className="button" onClick={restablecerAvisos}>
          {t(DEFAULT_LOCALE, 'guia.ajustes.avisos')}
        </button>
      </p>
    </section>
  )
}
