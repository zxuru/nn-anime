/**
 * El aviso del primer arranque.
 *
 * Una instalación nueva no tiene ninguna fuente: rona no incluye scrapers y
 * el usuario tiene que añadir un repositorio. Sin este aviso, la vitrina vacía se
 * lee como una aplicación rota; con él, dice qué falta, cuál es el repositorio
 * recomendado y dónde se añade.
 *
 * La bienvenida es **la pantalla entera** cuando no hay proveedores: tres pasos
 * y un enlace directo a la sección de fuentes de Ajustes (`#fuentes`). Las filas
 * vacías no se pintan hasta que hay algo que enseñar; seis vacíos a la vez no
 * explican nada y hacen que la aplicación parezca rota.
 *
 * **No instala nada.** El repositorio no se descarga ni se activa solo: el flujo
 * de dos pasos de Ajustes —descargar y mirar, marcar y guardar— es el que decide
 * qué código se ejecuta. El aviso lo dice con las mismas palabras del resto de la
 * aplicación, y la advertencia de que un plugin corre sin sandbox va aquí, que es
 * donde se lee antes de decidir.
 *
 * Ofrece también la salida de los tutoriales: es la primera pantalla que ve una
 * instalación nueva y quien ya sabe usar RoNa no debería tener que esperar al
 * popover para decir que no. El mismo botón que el primer paso de cada recorrido.
 *
 * `esPrimerArranque` es una función pura y separada del componente para poder
 * probar la decisión sin DOM: la lista vacía sólo significa «no hay proveedores»
 * cuando la lectura terminó **y no falló**.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { RECOMMENDED_PROVIDER_REPO } from '@rona/core/repos'
import { type ReactNode, useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'
import { estadoActual, omitirTodosLosTutoriales, suscribir } from '../guia/estado'
import { SECCIONES } from '../settings/secciones'

export interface EstadoDeFuentes {
  /** La lectura de proveedores terminó. */
  readonly loaded: boolean
  /** La lectura falló: la lista vacía no dice nada entonces. */
  readonly failed: boolean
  /** Cuántos proveedores hay, incluidos los rechazados. */
  readonly total: number
}

export function esPrimerArranque(estado: EstadoDeFuentes): boolean {
  return estado.loaded && !estado.failed && estado.total === 0
}

export function PrimerArranque(): ReactNode {
  // El estado de la guía es del navegador y vive fuera de React: el botón de
  // omitir escribe ahí y este aviso se entera por la suscripción, sin copia local.
  const estado = useSyncExternalStore(suscribir, estadoActual, estadoActual)

  return (
    <aside className="primer-arranque" aria-labelledby="primer-arranque-title">
      <h2 className="primer-arranque__titulo" id="primer-arranque-title">
        {t(DEFAULT_LOCALE, 'home.firstRun.title')}
      </h2>

      <p>{t(DEFAULT_LOCALE, 'home.firstRun.body')}</p>

      {/*
        Los tres pasos, en orden y numerados porque son una secuencia: añadir el
        repositorio, revisar lo que trae y elegir qué se activa. Antes eran tres
        párrafos sueltos y el alta manual —el camino largo— parecía el único.
      */}
      <ol className="primer-arranque__pasos">
        <li>
          {t(DEFAULT_LOCALE, 'home.firstRun.repo')}{' '}
          <a
            className="primer-arranque__url"
            href={RECOMMENDED_PROVIDER_REPO}
            target="_blank"
            rel="noreferrer noopener"
          >
            {RECOMMENDED_PROVIDER_REPO}
          </a>
        </li>
        <li>{t(DEFAULT_LOCALE, 'home.firstRun.warning')}</li>
        <li>{t(DEFAULT_LOCALE, 'home.firstRun.step3')}</li>
      </ol>

      <div className="primer-arranque__acciones">
        <Link to={`/settings#${SECCIONES.fuentes.id}`} className="button button--primary">
          {t(DEFAULT_LOCALE, 'home.firstRun.action')}
        </Link>

        {/* La misma salida que el primer paso de los recorridos. Con los
            tutoriales ya apagados no se ofrece otra vez: se dice dónde se
            vuelven a encender. */}
        {estado.tutorialsDisabled ? null : (
          <button type="button" className="button" onClick={omitirTodosLosTutoriales}>
            {t(DEFAULT_LOCALE, 'guia.omitirTodos')}
          </button>
        )}
      </div>

      {estado.tutorialsDisabled ? (
        <p className="field__hint">{t(DEFAULT_LOCALE, 'home.firstRun.tutorialsOff')}</p>
      ) : null}
    </aside>
  )
}
