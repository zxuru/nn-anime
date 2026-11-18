/**
 * El índice de Ajustes.
 *
 * Un enlace por sección de la página. En escritorio es una
 * columna a la izquierda que se queda pegada al desplazar; en una ventana
 * estrecha, una fila que se desplaza en horizontal. No es una segunda navegación
 * de la aplicación —no cambia de pantalla—, es el mapa de la que ya está abierta.
 *
 * La sección marcada sale de un `IntersectionObserver` y no del `:target`: quien
 * baja leyendo no ha pulsado ningún enlace y aun así tiene que saber dónde está.
 * Sin observador —un navegador viejo, o la prueba de servidor— el índice sigue
 * navegando; sólo deja de marcar.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { IDS_SECCIONES, type IdSeccion, SECCIONES_AJUSTES } from './secciones'

/**
 * La primera sección visible en el orden del documento.
 *
 * Es una función pura porque es la decisión que se puede equivocar: con dos
 * secciones a la vez en pantalla —la que termina y la que empieza— manda la de
 * arriba, que es la que se está leyendo. Se prueba sin navegador.
 */
export function primeraVisible(
  ids: readonly IdSeccion[],
  visibles: ReadonlySet<string>,
): IdSeccion | undefined {
  return ids.find((id) => visibles.has(id))
}

/**
 * La sección que se está viendo.
 *
 * `listo` es la página con datos ya pintados: mientras carga sólo hay un aviso y
 * ninguna sección que observar. Sin esa dependencia el efecto corría con el
 * esqueleto, no encontraba ningún `id` y el índice se quedaba sin marca para
 * siempre.
 *
 * El margen del observador recorta la banda de arriba y la de abajo: la cabecera
 * es pegajosa y sin recortarla una sección recién pasada por debajo seguiría
 * contando como visible. Lo que queda es una franja a media pantalla, que es
 * donde mira quien lee.
 */
export function useSeccionActiva(listo: boolean): IdSeccion | undefined {
  const [activa, setActiva] = useState<IdSeccion | undefined>(undefined)

  useEffect(() => {
    if (!listo || typeof IntersectionObserver === 'undefined') return

    const visibles = new Set<string>()
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (entrada.isIntersecting) visibles.add(entrada.target.id)
          else visibles.delete(entrada.target.id)
        }

        setActiva(primeraVisible(IDS_SECCIONES, visibles))
      },
      { rootMargin: '-20% 0px -20% 0px' },
    )

    for (const id of IDS_SECCIONES) {
      const seccion = document.getElementById(id)
      if (seccion !== null) observador.observe(seccion)
    }

    return () => {
      observador.disconnect()
    }
  }, [listo])

  return activa
}

export interface IndiceAjustesProps {
  /**
   * La sección marcada.
   *
   * Se pasa desde la página para poder probar el índice sin navegador; el que
   * sabe qué se está viendo es `useSeccionActiva`.
   */
  readonly activa?: IdSeccion | undefined
}

export function IndiceAjustes({ activa }: IndiceAjustesProps = {}): ReactNode {
  return (
    <nav className="settings__indice" aria-label={t(DEFAULT_LOCALE, 'settings.index')}>
      <p className="settings__indice-titulo">{t(DEFAULT_LOCALE, 'settings.index.title')}</p>

      <ul className="settings__indice-lista">
        {SECCIONES_AJUSTES.map((seccion) => (
          <li key={seccion.id}>
            <a
              className="settings__indice-enlace"
              href={`#${seccion.id}`}
              aria-current={activa === seccion.id ? 'location' : undefined}
            >
              {t(DEFAULT_LOCALE, seccion.titulo)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
