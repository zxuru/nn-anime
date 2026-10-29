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
import { LibraryPage } from './features/downloads/LibraryPage'
import { LibraryPlayerPage } from './features/downloads/LibraryPlayerPage'
import { HomePage } from './features/home/HomePage'
import { WatchPage } from './features/player/WatchPage'
import { HistoryPage } from './features/profile/HistoryPage'
import { ProfilePage } from './features/profile/ProfilePage'
import { SearchPage } from './features/search/SearchPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useAppTheme } from './features/settings/useSettings'
import { ConmutadorTipo } from './features/tipo/ConmutadorTipo'
import { pathConTipo, tipoFromPath } from './features/tipo/tipo'
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
   * La ficha, a sangre y sin relleno.
   *
   * Su banda cruza la ventana y va pegada al borde inferior de la cabecera, así
   * que la caja no puede tener ni tope ni aire: la medida del sitio la recuperan
   * las dos cajas de dentro —la de la banda y la del cuerpo—, que es lo que deja
   * el titular alineado con las columnas.
   */
  readonly ficha?: boolean
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
  if (props.ficha === true) caja.push('shell__main--ficha')

  /*
    Los destinos de la navegación conservan la mitad que se está mirando: al pasar
    de la vitrina a la búsqueda y vuelta, `?tipo=movies` viaja en el enlace y el
    conmutador no vuelve solo a anime. La marca no lo hace —volver a la casa en
    anime es el punto de referencia— y Ajustes tampoco, porque ahí no hay dos
    mitades que partir.
  */
  const path = usePath()
  const route = useRoute()
  const tipo = tipoFromPath(path)

  return (
    <div className="shell">
      <header className="shell__header">
        {/*
          La primera parada del tabulador. Sin ella, cada pantalla empieza con
          los cinco destinos de la cabecera antes del contenido; con ella, quien
          navega con teclado salta al `main` con una pulsación.
        */}
        <a className="shell__saltar" href="#contenido">
          {t(LOCALE, 'nav.skip')}
        </a>
        <Link to="/" className="shell__brand">
          {t(LOCALE, 'app.name')}
        </Link>
        <nav className="shell__nav">
          <Link
            to={pathConTipo('/', tipo)}
            ariaCurrent={route.name === 'home' ? 'page' : undefined}
          >
            {t(LOCALE, 'nav.home')}
          </Link>
          <Link
            to={pathConTipo('/search', tipo)}
            ariaCurrent={route.name === 'search' ? 'page' : undefined}
          >
            {t(LOCALE, 'nav.search')}
          </Link>
          {/* El Perfil tampoco conserva la mitad que se mira: es el estado del
              usuario, y ahí no hay dos mitades que partir —como en Ajustes—. Lo que
              sí enseña es lo de las dos, porque sus listas son de las dos. */}
          <Link to="/profile" ariaCurrent={route.name === 'profile' ? 'page' : undefined}>
            {t(LOCALE, 'nav.profile')}
          </Link>
          <Link
            to="/library"
            ariaCurrent={
              route.name === 'library' || route.name === 'downloads' ? 'page' : undefined
            }
          >
            {t(LOCALE, 'nav.library')}
          </Link>
          <Link to="/settings" ariaCurrent={route.name === 'settings' ? 'page' : undefined}>
            {t(LOCALE, 'nav.settings')}
          </Link>
        </nav>
        {props.tipo === true ? <ConmutadorTipo /> : null}
      </header>
      <main className={caja.join(' ')} id="contenido" tabIndex={-1}>
        {props.children}
      </main>
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
    case 'profile':
      return <ProfilePage />
    case 'history':
      return <HistoryPage />
    case 'library':
    // La dirección vieja sigue abriendo la misma pantalla: un marcador de la
    // versión anterior no tiene por qué dejar de funcionar.
    case 'downloads':
      return <LibraryPage />
    case 'library-player':
      return <LibraryPlayerPage key={route.params.id ?? ''} id={route.params.id ?? ''} />
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
      ficha={route.name === 'detail'}
      tipo={route.name === 'home' || route.name === 'search'}
    >
      {screenFor(route, path)}
    </Shell>
  )
}
