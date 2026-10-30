/**
 * La barra de navegación inferior del móvil.
 *
 * En una pantalla estrecha, los cinco destinos de la cabecera no caben: se
 * esconden allí y aparecen aquí, al alcance del pulgar. Son **los mismos**
 * `NAV_ITEMS` que la cabecera, con el mismo `aria-current`, para que la pestaña
 * encendida sea la misma en las dos formas y no puedan discrepar.
 *
 * Cada destino lleva su dibujo y su etiqueta diminuta debajo: el dibujo solo no
 * dice «Biblioteca» ni «Perfil» a quien no lo ha visto antes, y la etiqueta de
 * once píxeles cabe en una quinta parte de cualquier teléfono. El icono activo
 * engorda el trazo en vez de cambiar de color a secas, para que el estado no
 * dependa sólo del tono.
 *
 * La barra va **fija** y el contenido reserva su alto: sin esa reserva, lo
 * último de cada pantalla queda debajo y no hay forma de leerlo ni de pulsarlo.
 * La reserva incluye el recorte del aparato, que es lo que separa la barra del
 * borde de un teléfono con gestos.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { tipoFromPath } from '../features/tipo/tipo'
import { t } from '../i18n'
import { destinoDeNav, esNavActual, NAV_ITEMS } from '../nav'
import { Link, usePath, useRoute } from '../router'

export function BarraInferior(): ReactNode {
  const ruta = useRoute()
  const tipo = tipoFromPath(usePath())

  return (
    <nav className="barra" aria-label={t(DEFAULT_LOCALE, 'nav.primary')}>
      {NAV_ITEMS.map((item) => {
        const actual = esNavActual(item, ruta.name)
        const etiqueta = t(DEFAULT_LOCALE, item.label)
        const Icono = item.icon

        return (
          <Link
            key={item.to}
            to={destinoDeNav(item, tipo)}
            className="barra__item"
            ariaCurrent={actual ? 'page' : undefined}
            {...(item.tour === undefined ? {} : { dataTour: item.tour })}
          >
            <Icono size={22} strokeWidth={actual ? 2.5 : 2} aria-hidden="true" focusable="false" />
            <span className="barra__texto">{etiqueta}</span>
          </Link>
        )
      })}
    </nav>
  )
}
