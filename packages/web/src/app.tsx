/**
 * Composición de la interfaz.
 *
 * En este punto del plan las pantallas son marcadores: cada una dice qué irá
 * ahí. Lo que ya es real es el enrutado sin recarga, los enlaces y los textos
 * desde el catálogo.
 */

import { DEFAULT_LOCALE, type Locale } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { DetailPage } from './features/detail/DetailPage'
import { SearchPage } from './features/search/SearchPage'
import { t } from './i18n'
import { Link, type RouteMatch, usePath, useRoute } from './router'

const LOCALE: Locale = DEFAULT_LOCALE

function Shell(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="shell">
      <header className="shell__header">
        <Link to="/" className="shell__brand">
          {t(LOCALE, 'app.name')}
        </Link>
        <nav className="shell__nav">
          <Link to="/">{t(LOCALE, 'nav.home')}</Link>
          <Link to="/search">{t(LOCALE, 'nav.search')}</Link>
          <Link to="/settings">{t(LOCALE, 'nav.settings')}</Link>
        </nav>
      </header>
      <main className="shell__main">{props.children}</main>
    </div>
  )
}

function Pending(props: { readonly title: string; readonly body: string }): ReactNode {
  return (
    <section>
      <h1>{props.title}</h1>
      <p>{props.body}</p>
    </section>
  )
}

function screenFor(route: RouteMatch, path: string): ReactNode {
  switch (route.name) {
    case 'home':
      return <Pending title={t(LOCALE, 'home.title')} body={t(LOCALE, 'home.pending')} />
    case 'search':
      return <SearchPage />
    case 'detail':
      return <DetailPage providerId={route.params.providerId ?? ''} ref={route.params.ref ?? ''} />
    case 'watch':
      return <Pending title={route.params.ref ?? ''} body={t(LOCALE, 'watch.pending')} />
    case 'settings':
      return <Pending title={t(LOCALE, 'nav.settings')} body={t(LOCALE, 'settings.pending')} />
    case 'not-found':
      return (
        <section>
          <h1>{t(LOCALE, 'notFound.title')}</h1>
          <p>{t(LOCALE, 'notFound.body', { path })}</p>
          <Link to="/">{t(LOCALE, 'notFound.back')}</Link>
        </section>
      )
  }
}

export function App(): ReactNode {
  const route = useRoute()
  const path = usePath()

  return <Shell>{screenFor(route, path)}</Shell>
}
