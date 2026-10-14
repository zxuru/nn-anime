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
import { HomePage } from './features/home/HomePage'
import { WatchPage } from './features/player/WatchPage'
import { SearchPage } from './features/search/SearchPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useAppTheme } from './features/settings/useSettings'
import { t } from './i18n'
import { routeTitleParts, useDocumentTitle } from './lib/document-title'
import { Link, type RouteMatch, usePath, useRoute } from './router'

const LOCALE: Locale = DEFAULT_LOCALE

function Shell(props: { readonly children: ReactNode }): ReactNode {
  // La pantalla actual la dice `aria-current` y no un color suelto: es lo que
  // lee quien no ve la pantalla, y lo que la hoja de estilos mira para pintar la
  // pastilla. La ficha y el reproductor no marcan nada —ninguna de las tres
  // entradas del menú es «la que estás viendo»— y por eso se compara por nombre
  // de ruta y no por prefijo del camino.
  const ruta = useRoute()

  return (
    <div className="shell">
      <header className="shell__header">
        <Link to="/" className="shell__brand">
          {t(LOCALE, 'app.name')}
        </Link>
        <nav className="shell__nav">
          <Link to="/" ariaCurrent={ruta.name === 'home' ? 'page' : undefined}>
            {t(LOCALE, 'nav.home')}
          </Link>
          <Link to="/search" ariaCurrent={ruta.name === 'search' ? 'page' : undefined}>
            {t(LOCALE, 'nav.search')}
          </Link>
          <Link to="/settings" ariaCurrent={ruta.name === 'settings' ? 'page' : undefined}>
            {t(LOCALE, 'nav.settings')}
          </Link>
        </nav>
      </header>
      <main className="shell__main">{props.children}</main>
    </div>
  )
}

function _Pending(props: { readonly title: string; readonly body: string }): ReactNode {
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
      return <HomePage />
    case 'search':
      return <SearchPage />
    case 'detail':
      return <DetailPage providerId={route.params.providerId ?? ''} ref={route.params.ref ?? ''} />
    case 'watch':
      return (
        // La clave remonta la pantalla al cambiar de episodio. Sin ella, React
        // reutiliza el componente y se queda con la posición del anterior: al
        // pasar al episodio de al lado, el video arrancaba donde iba el de
        // antes, y el visionado se seguía registrando contra el episodio viejo.
        <WatchPage
          key={`${route.params.providerId ?? ''}:${route.params.ref ?? ''}`}
          providerId={route.params.providerId ?? ''}
          ref={route.params.ref ?? ''}
        />
      )
    case 'settings':
      return <SettingsPage />
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
  // El tema se aplica aquí: es de la aplicación entera, no de una pantalla.
  useAppTheme()

  const route = useRoute()
  const path = usePath()

  // El título de la pestaña de las pantallas que no traen datos propios. La ficha
  // y el reproductor lo ponen ellos, con el nombre del título: si lo escribiera
  // este efecto, correría después del suyo —los efectos van de dentro hacia
  // fuera— y lo borraría.
  useDocumentTitle(routeTitleParts(route.name, path))

  return <Shell>{screenFor(route, path)}</Shell>
}
