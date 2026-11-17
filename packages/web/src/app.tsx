/**
 * Composición de la interfaz.
 *
 * En este punto del plan las pantallas son marcadores: cada una dice qué irá
 * ahí. Lo que ya es real es el enrutado sin recarga, los enlaces y los textos
 * desde el catálogo.
 */

import { DEFAULT_LOCALE, type Locale } from '@rona/core/i18n'
import { type ReactNode, useEffect, useRef } from 'react'
import { BarraInferior } from './components/BarraInferior'
import { IconLabel } from './components/IconLabel'
import { DetailPage } from './features/detail/DetailPage'
import { LibraryPage } from './features/downloads/LibraryPage'
import { LibraryPlayerPage } from './features/downloads/LibraryPlayerPage'
import { BotonGuia } from './features/guia/BotonGuia'
import { ANCLAS } from './features/guia/guia'
import { useGuia } from './features/guia/useGuia'
import { HomePage } from './features/home/HomePage'
import { WatchPage } from './features/player/WatchPage'
import { HistoryPage } from './features/profile/HistoryPage'
import { ProfilePage } from './features/profile/ProfilePage'
import { SearchPage } from './features/search/SearchPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useAppTheme } from './features/settings/useSettings'
import { ConmutadorTipo } from './features/tipo/ConmutadorTipo'
import { tipoFromPath } from './features/tipo/tipo'
import { t } from './i18n'
import { routeTitleParts, useDocumentTitle } from './lib/document-title'
import { destinoDeNav, esNavActual, NAV_ITEMS } from './nav'
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
   * Las pantallas que no llevan el pie.
   *
   * Son las dos de reproducción, y por la misma razón por la que van sin tope:
   * se miden contra la ventana. El pie va después de la caja de la pantalla y
   * ocupa su alto —65 px de nota, filete y relleno—, así que pintarlo aquí
   * metía la sala entera en un desplazamiento de esa altura aunque el video
   * cupiera. En las demás pantallas el contenido es una columna que ya se
   * desplaza sola y el pie es la última línea, no un presupuesto.
   */
  readonly sinPie?: boolean
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
  const contenido = useRef<HTMLElement>(null)
  /*
    La pantalla, no la consulta.

    Escribir en el buscador reemplaza `?q=` en cada pausa; si el foco se moviera
    con cada reemplazo, la casilla se vaciaría de foco a los 400 ms de teclear.
    Lo que cambia de pantalla es el camino, y sólo entonces el foco viaja al
    `main`: quien navega con el teclado sigue desde el contenido en vez de volver
    a recorrer la cabecera, y el lector de pantalla anuncia la pantalla nueva.
  */
  const camino = path.split('?')[0] ?? path
  const caminoAnterior = useRef(camino)

  useEffect(() => {
    if (caminoAnterior.current === camino) return

    caminoAnterior.current = camino
    /*
      La pantalla que ya se ha llevado el foco lo conserva. La búsqueda enfoca su
      campo al abrirse, y este efecto —que corre después, de dentro hacia
      fuera— le devolvía el foco al `main` y dejaba la casilla sin escribir. Un
      foco explícito de la pantalla dice más que el de cortesía del armazón.
    */
    if (contenido.current?.contains(document.activeElement) === true) return

    contenido.current?.focus({ preventScroll: true })
  }, [camino])

  return (
    <div className="shell">
      <header className="shell__header" data-tour={ANCLAS.cabecera}>
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
        <nav className="shell__nav" aria-label={t(LOCALE, 'nav.primary')}>
          {NAV_ITEMS.map((item) => {
            const actual = esNavActual(item, route.name)

            return (
              <Link
                key={item.to}
                to={destinoDeNav(item, tipo)}
                ariaCurrent={actual ? 'page' : undefined}
                {...(item.tour === undefined ? {} : { dataTour: item.tour })}
              >
                <IconLabel icon={item.icon} label={t(LOCALE, item.label)} />
              </Link>
            )
          })}
        </nav>
        {props.tipo === true ? <ConmutadorTipo /> : null}
        <BotonGuia />
      </header>
      <main className={caja.join(' ')} id="contenido" ref={contenido} tabIndex={-1}>
        {props.children}
      </main>
      {/*
        La barra del móvil se pinta siempre y la hoja decide si se ve: la consulta
        de ancho no existe en JavaScript y el conmutador de tipo sí —lo lee con
        `matchMedia`—, así que esconderla aquí obligaría a duplicar el punto de
        corte en los dos sitios.
      */}
      <BarraInferior />
      {/*
        El pie es de la aplicación y no de una pantalla: la promesa de que todo
        se queda en el equipo vale igual en la vitrina que en Ajustes, y una
        pantalla nueva lo hereda sin repetirlo. Las de reproducción son la
        excepción declarada en `sinPie`: se miden contra la ventana y el pie les
        roba el alto que el video necesita.
      */}
      {props.sinPie === true ? null : (
        <footer className="shell__footer">
          <p className="shell__footer-nota">{t(LOCALE, 'app.footer')}</p>
        </footer>
      )}
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
  // La guía también: el recorrido de la primera vez y los faros de lo nuevo.
  useGuia()

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
      // Las dos pantallas de reproducción se miden contra la ventana: el video
      // crece hasta el alto disponible y un tope de 1200 px le dejaría a los
      // lados un margen que no gasta nada. En la biblioteca era además el motivo
      // de que los mandos del reproductor cayeran por debajo del pliegue.
      sinTope={route.name === 'watch' || route.name === 'library-player'}
      // Las mismas dos pantallas van sin pie: se miden contra la ventana y el
      // pie, que va después de la caja, les metía un desplazamiento de su alto.
      sinPie={route.name === 'watch' || route.name === 'library-player'}
      ficha={route.name === 'detail'}
      tipo={route.name === 'home' || route.name === 'search'}
    >
      {screenFor(route, path)}
    </Shell>
  )
}
