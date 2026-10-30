/**
 * El conmutador entre anime y películas.
 *
 * Son **dos enlaces** y no dos botones: la mitad que se está mirando vive en la
 * dirección, así que cada opción es una dirección de verdad —se puede abrir en otra
 * pestaña, y con JavaScript apagado sigue funcionando— y la opción activa se marca
 * con `aria-current`, que es lo que un lector de pantalla anuncia.
 *
 * El conmutador viaja con la ruta: al cambiar de mitad desde la búsqueda se
 * conservan la consulta y el filtro de proveedores, y desde la home sólo cambia la
 * mitad. Lo pinta la cabecera, y sólo en las pantallas donde significa algo.
 *
 * El carril lleva la mitad activa también en `data-tipo`: la píldora que se desliza
 * es un `::before` de la hoja de estilos y necesita saber a qué mitad saltar. Sale
 * del mismo `actual` que marca el `aria-current`, así que los dos no pueden decir
 * cosas distintas.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { MediaFilter } from '@nn-anime/core/media'
import { Clapperboard, type LucideIcon, Tv } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconLabel } from '../../components/IconLabel'
import { t } from '../../i18n'
import { Link, usePath } from '../../router'
import { ANCLAS } from '../guia/guia'
import { pathConTipo, tipoFromPath } from './tipo'

/** Las dos mitades, en el orden en que se enseñan. Anime primero: es la casa. */
export const OPCIONES: readonly MediaFilter[] = ['anime', 'movies']

/**
 * El dibujo de cada mitad.
 *
 * La televisión para las series y la claqueta para las películas: son los dos
 * dibujos que el cine y la televisión llevan décadas usando para decirse, y en
 * una pantalla estrecha —donde el rótulo se recorta— son lo único que queda.
 */
const ICONO: Readonly<Record<MediaFilter, LucideIcon>> = { anime: Tv, movies: Clapperboard }

/** La clave de i18n de cada mitad. */
export function claveDeTipo(tipo: MediaFilter): 'media.anime' | 'media.movies' {
  return tipo === 'anime' ? 'media.anime' : 'media.movies'
}

export function ConmutadorTipo(): ReactNode {
  const path = usePath()
  const actual = tipoFromPath(path)

  return (
    <nav
      className="conmutador"
      data-tipo={actual}
      data-tour={ANCLAS.tipo}
      aria-label={t(DEFAULT_LOCALE, 'media.switch')}
    >
      {OPCIONES.map((opcion) => (
        <Link
          key={opcion}
          to={pathConTipo(path, opcion)}
          className="conmutador__opcion"
          ariaCurrent={opcion === actual ? 'page' : undefined}
        >
          {/*
            El rótulo no se pierde al recortarse: sigue en el documento y sigue
            siendo el nombre del enlace. El `title` lo deja leer con el puntero.
          */}
          <IconLabel
            icon={ICONO[opcion]}
            label={t(DEFAULT_LOCALE, claveDeTipo(opcion))}
            iconOnlyOnMobile
          />
        </Link>
      ))}
    </nav>
  )
}
