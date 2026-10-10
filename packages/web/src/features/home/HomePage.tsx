/**
 * Pantalla de inicio.
 *
 * Dos cosas: las recomendaciones y nada más. La fila de «continuar viendo» es de
 * T40, y aquí no se adelanta a medias.
 *
 * La consulta del buscador entra al panel para que la home reaccione a lo que se
 * está buscando: si alguien escribe «mecha» en la barra, lo que le interesa ahora
 * mismo tiene que ver con eso.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Panel } from '../recommendations/Panel'

export interface HomePageProps {
  readonly query?: string | undefined
}

export function HomePage(props: HomePageProps): ReactNode {
  return (
    <section className="home">
      <h1>{t(DEFAULT_LOCALE, 'home.title')}</h1>
      <Panel {...(props.query === undefined ? {} : { query: props.query })} />
    </section>
  )
}
