/**
 * El buscador de la home.
 *
 * Es un formulario GET de verdad: sin JavaScript, el navegador compone
 * `/search?q=…` y la pantalla de Buscar hace el resto. Así el verbo que el
 * producto declara primero —buscar— está en la primera pantalla y no sólo como
 * una palabra en la cabecera.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export function HomeSearch(): ReactNode {
  return (
    <form className="home__buscador" action="/search" method="get">
      <label className="solo-lectores" htmlFor="home-buscador">
        {t(DEFAULT_LOCALE, 'search.field')}
      </label>
      <input
        id="home-buscador"
        className="search__input home__buscador-campo"
        type="search"
        name="q"
        placeholder={t(DEFAULT_LOCALE, 'search.placeholder')}
        autoComplete="off"
      />
      <button type="submit" className="button button--primary">
        {t(DEFAULT_LOCALE, 'nav.search')}
      </button>
    </form>
  )
}
