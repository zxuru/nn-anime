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

import type { MediaFormat } from '@rona/core/models'
import { Home, Library, type LucideIcon, Search, Settings, User } from 'lucide-react'
import { ANCLAS } from './features/guia/guia'
import { pathConVista } from './features/tipo/tipo'
import type { RouteName } from './router'

export interface NavItem {
  /** La dirección base. La mitad que se mira la añade `destinoDeNav`. */
  readonly to: string
  readonly icon: LucideIcon
  /** La clave de i18n de la etiqueta. */
  readonly label: string
  /** Las rutas que marcan este destino como el actual. */
  readonly routes: readonly RouteName[]
  /** Si el destino arrastra la vista —el formato—: la home y la búsqueda. */
  readonly conservaVista?: boolean
  /** El ancla de la guía, cuando el recorrido la señala. */
  readonly tour?: string
  /**
   * Si el destino se pinta aparte, al final de la cabecera.
   *
   * El Perfil es una pantalla de cuenta y no un destino del día a día: va en el
   * extremo derecho, detrás de los mandos. La lista sigue siendo esta y la barra
   * inferior la recibe entera; lo que cambia es dónde lo coloca la cabecera.
   */
  readonly separado?: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', icon: Home, label: 'nav.home', routes: ['home'], conservaVista: true },
  {
    to: '/search',
    icon: Search,
    label: 'nav.search',
    routes: ['search'],
    conservaVista: true,
    tour: ANCLAS.buscar,
  },
  {
    to: '/profile',
    icon: User,
    label: 'nav.profile',
    routes: ['profile'],
    separado: true,
  },
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

/**
 * La dirección de un destino, con la vista que se está mirando cuando la lleva.
 *
 * Sólo la home y la búsqueda la conservan: son las pantallas que listan. Una
 * ficha o el reproductor no tienen formato que partir, así que su destino no lo
 * arrastra.
 */
export function destinoDeNav(item: NavItem, formato: MediaFormat | undefined): string {
  return item.conservaVista === true ? pathConVista(item.to, formato) : item.to
}

/** Si la pantalla en la que se está es la de este destino. */
export function esNavActual(item: NavItem, name: RouteName): boolean {
  return item.routes.includes(name)
}
