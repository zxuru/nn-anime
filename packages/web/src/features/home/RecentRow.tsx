/**
 * Fila «último añadido»: lo que la aplicación ya conoce.
 *
 * Son los títulos que están en la base —abiertos o encontrados por una búsqueda—
 * del más nuevo al más viejo. Existe porque la home no puede depender de que el
 * proveedor ofrezca tendencias ni de que alguien haya buscado: en una instalación
 * nueva con un proveedor sin `feed`, esta fila es lo primero que se llena.
 *
 * El orden lo decide el servidor. La fila no reordena ni filtra.
 */

import type { RecentResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { PosterCard } from '../../components/PosterCard'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface RecentRowProps {
  readonly items: RecentResponse['items']
}

export function RecentRow(props: RecentRowProps): ReactNode {
  return (
    <section className="section">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.recent')}
        meta={t(DEFAULT_LOCALE, 'home.recent.meta')}
      />

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.recent.empty')}</p>
      ) : (
        <ul className="row__list">
          {props.items.map((item) => (
            <li key={`${item.ref.providerId}:${item.ref.value}`}>
              <PosterCard
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                caption={item.year === undefined ? undefined : String(item.year)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
