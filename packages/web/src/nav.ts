/**
 * Los destinos de la navegación, definidos una vez.
 *
 * La cabecera y la barra inferior del móvil pintan la misma lista: si cada una
 * tuviera la suya, añadir un destino sería acordarse de dos sitios y la mitad
 * que se olvidara dejaría una pantalla sin salida. Aquí vive también qué rutas
 * encienden cada destino —la biblioteca enciende el suyo en su ruta vieja y en
 * la nueva— y cuáles conservan la mitad que se está mirando.
 *
 * **Las etiquetas son claves del catálogo, no texto.** El texto se resuelve al
 * pintar: una cadena aquí no tendría traducción y se colaría en la interfaz.
 *
 * Los iconos se importan por nombre, nunca con `import *`: el empaquetador sólo
 * puede recortar lo que ve nombrado, y un espacio de nombres se lleva el juego
 * entero al paquete.
 */

import type { MediaFilter } from '@nn-anime/core/media'
import { Home, Library, type LucideIcon, Search, Settings, User } from 'lucide-react'
import { ANCLAS } from './features/guia/guia'
import { pathConTipo } from './features/tipo/tipo'
import type { RouteName } from './router'

export interface NavItem {
  /** La dirección base. La mitad que se mira la añade `destinoDeNav`. */
  readonly to: string
  readonly icon: LucideIcon
  /** La clave de i18n de la etiqueta. */
  readonly label: string
  /** Las rutas que marcan este destino como el actual. */
  readonly routes: readonly RouteName[]
  /** Si el destino arrastra `?tipo=` —la home y la búsqueda—. */
  readonly conservaTipo?: boolean
  /** El ancla de la guía, cuando el recorrido la señala. */
  readonly tour?: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', icon: Home, label: 'nav.home', routes: ['home'], conservaTipo: true },
  {
    to: '/search',
    icon: Search,
    label: 'nav.search',
    routes: ['search'],
    conservaTipo: true,
    tour: ANCLAS.buscar,
  },
  { to: '/profile', icon: User, label: 'nav.profile', routes: ['profile'] },
  {
    to: '/library',
    icon: Library,
    label: 'nav.library',
    // La dirección vieja sigue abriendo la biblioteca: el destino que lleva ahí
    // se enciende igual, o volver a la pantalla dejaría la barra apagada.
    routes: ['library', 'downloads'],
    tour: ANCLAS.biblioteca,
  },
  {
    to: '/settings',
    icon: Settings,
    label: 'nav.settings',
    routes: ['settings'],
    tour: ANCLAS.ajustes,
  },
]

/** La dirección de un destino, con la mitad que se está mirando cuando la lleva. */
export function destinoDeNav(item: NavItem, tipo: MediaFilter): string {
  return item.conservaTipo === true ? pathConTipo(item.to, tipo) : item.to
}

/** Si la pantalla en la que se está es la de este destino. */
export function esNavActual(item: NavItem, name: RouteName): boolean {
  return item.routes.includes(name)
}
