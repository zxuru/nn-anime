/**
 * La guía, en Ajustes.
 *
 * Es el índice de los recorridos: cada sección con su botón, que lleva a esa
 * pantalla y abre su tutorial. La ficha y el reproductor no están: dependen de
 * un título concreto y su «?» vive en su propia pantalla.
 *
 * Debajo vive lo que decide sobre todos a la vez: el interruptor que los apaga
 * sin marcar nada, «Omitir todos» —que sí los da por vistos— y «Reiniciar», que
 * los devuelve a pendientes. Y al final el botón que devuelve a la lista los
 * avisos descartados, que son otra cosa y por eso tienen el suyo.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { type RouteName, useNavigate } from '../../router'
import {
  estadoActual,
  mostrarTutoriales,
  ocultarTutoriales,
  omitirTodosLosTutoriales,
  reiniciarTutoriales,
  restablecerAvisos,
  suscribir,
} from './estado'
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
  // El interruptor y los botones escriben en el estado de módulo; aquí se lee
  // con `useSyncExternalStore` para que la pantalla refleje el cambio en el acto,
  // sin recargar ni guardar copia local de lo que ya vive en `estado.ts`.
  const estado = useSyncExternalStore(suscribir, estadoActual, estadoActual)
  const repetibles = RECORRIDOS.filter((recorrido) => rutaDe(recorrido) !== undefined)
  const encendidos = !estado.tutorialsDisabled

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

      {/*
        El interruptor global, con la misma fila de botones con estado que el
        tema y el contenido para adultos: `aria-pressed` dice cuál está activo y
        el teclado no necesita nada más. Dos botones y no una casilla porque el
        resto de la página ya se lee así.

        Apagado no es «omitido»: los tutoriales no vistos siguen pendientes y
        vuelven cuando se enciende. Para devolverlos todos está «Reiniciar».
      */}
      <fieldset
        className="guia__acciones"
        aria-label={t(DEFAULT_LOCALE, 'guia.ajustes.interruptor')}
      >
        <button
          type="button"
          className="button"
          aria-pressed={encendidos}
          onClick={mostrarTutoriales}
        >
          {t(DEFAULT_LOCALE, 'guia.ajustes.mostrar')}
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={!encendidos}
          onClick={ocultarTutoriales}
        >
          {t(DEFAULT_LOCALE, 'guia.ajustes.ocultar')}
        </button>
      </fieldset>
      <p>{t(DEFAULT_LOCALE, 'guia.ajustes.interruptor.ayuda')}</p>

      {/*
        Omitir todos no pide confirmación: no borra nada —los recorridos se
        pueden repetir desde la lista de arriba— y una confirmación sobre algo
        reversible es un clic extra para quien ya decidió. Reiniciar hace lo
        contrario y tampoco la pide por lo mismo.
      */}
      <div className="guia__acciones">
        <button type="button" className="button" onClick={omitirTodosLosTutoriales}>
          {t(DEFAULT_LOCALE, 'guia.ajustes.omitirTodos')}
        </button>
        <button type="button" className="button" onClick={reiniciarTutoriales}>
          {t(DEFAULT_LOCALE, 'guia.ajustes.reiniciar')}
        </button>
      </div>
      <p>{t(DEFAULT_LOCALE, 'guia.ajustes.omitir.ayuda')}</p>
      <p>{t(DEFAULT_LOCALE, 'guia.ajustes.reiniciar.ayuda')}</p>

      <p>
        <button type="button" className="button" onClick={restablecerAvisos}>
          {t(DEFAULT_LOCALE, 'guia.ajustes.avisos')}
        </button>
      </p>
    </section>
  )
}
