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
import { ConmutadorTipo } from './features/tipo/ConmutadorTipo'
import { t } from './i18n'
import { routeTitleParts, useDocumentTitle } from './lib/document-title'
import { Link, type RouteMatch, usePath, useRoute } from './router'

const LOCALE: Locale = DEFAULT_LOCALE

/** La caja de la pantalla, con lo que cada una pide de ella. */
function Shell(props: {
  readonly children: ReactNode
  /**
   * La vitrina va **a sangre**: su marquesina ocupa el ancho entero y el mosaico
   * reparte seis columnas, así que la caja del contenido —con su tope de ancho y
   * su relleno— la dejaría en una columna central.
   */
  readonly ancha?: boolean
  /**
   * La pantalla de reproducción, sin tope de ancho.
   *
   * El reproductor se mide contra la ventana —el video crece hasta el alto
   * disponible— y un tope de 1200 px le dejaría a los lados un margen que crece
   * con la pantalla. Conserva el relleno, que es su margen.
   */
  readonly sinTope?: boolean
  /**
   * Si la cabecera lleva el conmutador de tipo.
   *
   * No lo lleva siempre: la mitad que se mira sólo significa algo donde hay algo
   * que partir en dos —la vitrina y la búsqueda—. En una ficha o en el
   * reproductor el mando no cambiaría nada de lo que se está viendo.
   */
  readonly tipo?: boolean
}): ReactNode {
  const caja = ['shell__main']
  if (props.ancha === true) caja.push('shell__main--ancha')
  if (props.sinTope === true) caja.push('shell__main--sin-tope')
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
        {props.tipo === true ? <ConmutadorTipo /> : null}
      </header>
      <main className={caja.join(' ')}>{props.children}</main>
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

  return (
    <Shell
      ancha={route.name === 'home'}
      sinTope={route.name === 'watch'}
      tipo={route.name === 'home' || route.name === 'search'}
    >
      {screenFor(route, path)}
    </Shell>
  )
}
