/**
 * El aviso del primer arranque.
 *
 * Una instalación nueva no tiene ninguna fuente: nn-anime no incluye scrapers y
 * el usuario tiene que añadir un repositorio. Sin este aviso, la vitrina vacía se
 * lee como una aplicación rota; con él, dice qué falta, cuál es el repositorio
 * recomendado y dónde se añade.
 *
 * **No instala nada.** El repositorio no se descarga ni se activa solo: el flujo
 * de dos pasos de Ajustes —descargar y mirar, marcar y guardar— es el que decide
 * qué código se ejecuta. El aviso lo dice con las mismas palabras del resto de la
 * aplicación, y la advertencia de que un plugin corre sin sandbox va aquí, que es
 * donde se lee antes de decidir.
 *
 * `esPrimerArranque` es una función pura y separada del componente para poder
 * probar la decisión sin DOM: la lista vacía sólo significa «no hay proveedores»
 * cuando la lectura terminó **y no falló**.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { RECOMMENDED_PROVIDER_REPO } from '@nn-anime/core/repos'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'

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
  return (
    <aside className="primer-arranque" aria-labelledby="primer-arranque-title">
      <h2 className="primer-arranque__titulo" id="primer-arranque-title">
        {t(DEFAULT_LOCALE, 'home.firstRun.title')}
      </h2>

      <p>{t(DEFAULT_LOCALE, 'home.firstRun.body')}</p>

      <p>
        {t(DEFAULT_LOCALE, 'home.firstRun.repo')}{' '}
        <a
          className="primer-arranque__url"
          href={RECOMMENDED_PROVIDER_REPO}
          target="_blank"
          rel="noreferrer noopener"
        >
          {RECOMMENDED_PROVIDER_REPO}
        </a>
      </p>

      <p className="field__hint">{t(DEFAULT_LOCALE, 'home.firstRun.warning')}</p>

      <Link to="/settings" className="button button--primary">
        {t(DEFAULT_LOCALE, 'home.firstRun.action')}
      </Link>
    </aside>
  )
}
