/**
 * El conmutador de familia de contenido.
 *
 * Son **tres enlaces** y no tres botones: la familia que se está mirando vive en
 * la dirección (`?tipo=`), así que cada opción es una dirección de verdad —se
 * puede abrir en otra pestaña, y con JavaScript apagado sigue funcionando— y la
 * opción activa se marca con `aria-current`, que es lo que un lector de pantalla
 * anuncia.
 *
 * El conmutador viaja con la ruta: al cambiar de familia desde la búsqueda se
 * conservan la consulta, el filtro de proveedores y el formato; desde la home
 * sólo cambia la familia. Lo pinta la cabecera, y sólo en las pantallas donde
 * significa algo.
 *
 * El carril lleva la familia activa también en `data-tipo`: la píldora que se
 * desliza es un `::before` de la hoja de estilos y necesita saber a qué columna
 * saltar. Sale del mismo `actual` que marca el `aria-current`, así que los dos no
 * pueden decir cosas distintas.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { MediaFamily } from '@rona/core/models'
import { Clapperboard, type LucideIcon, Sparkles, Tv } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconLabel } from '../../components/IconLabel'
import { t } from '../../i18n'
import { Link, usePath } from '../../router'
import { ANCLAS } from '../guia/guia'
import { FAMILIAS, familiaFromPath, pathConFamilia } from './tipo'

/**
 * El dibujo de cada familia.
 *
 * La televisión para el anime —es el dibujo con el que se nombra—, las chispas
 * para la animación que no es anime —lo dibujado— y la claqueta para la imagen
 * real. En una pantalla estrecha el rótulo se recorta y son lo único que queda.
 */
const ICONO: Readonly<Record<MediaFamily, LucideIcon>> = {
  anime: Tv,
  animation: Sparkles,
  live: Clapperboard,
}

/** La clave de i18n de cada familia, escrita una por una: el catálogo se lee así. */
const CLAVE: Readonly<Record<MediaFamily, 'media.anime' | 'media.animation' | 'media.live'>> = {
  anime: 'media.anime',
  animation: 'media.animation',
  live: 'media.live',
}

/** Y su descripción, que es lo que distingue «Animación» de «Anime». */
const DESCRIPCION: Readonly<
  Record<MediaFamily, 'media.anime.desc' | 'media.animation.desc' | 'media.live.desc'>
> = {
  anime: 'media.anime.desc',
  animation: 'media.animation.desc',
  live: 'media.live.desc',
}

export function ConmutadorTipo(): ReactNode {
  const path = usePath()
  const actual = familiaFromPath(path)

  return (
    <nav
      className="conmutador"
      data-tipo={actual}
      data-tour={ANCLAS.tipo}
      aria-label={t(DEFAULT_LOCALE, 'media.switch')}
    >
      {FAMILIAS.map((familia) => (
        <Link
          key={familia}
          to={pathConFamilia(path, familia)}
          className="conmutador__opcion"
          ariaCurrent={familia === actual ? 'page' : undefined}
          title={t(DEFAULT_LOCALE, DESCRIPCION[familia])}
        >
          {/*
            El rótulo no se pierde al recortarse: sigue en el documento y sigue
            siendo el nombre del enlace. El `title` dice qué incluye la familia,
            que es lo que distingue «Animación» de «Anime».
          */}
          <IconLabel
            icon={ICONO[familia]}
            label={t(DEFAULT_LOCALE, CLAVE[familia])}
            iconOnlyOnMobile
          />
        </Link>
      ))}
    </nav>
  )
}
