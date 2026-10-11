/**
 * La lista de proveedores, incluidos los rechazados.
 *
 * Enseñar los rechazados con su motivo es lo que convierte un misterio en un
 * problema con solución: el usuario copió un archivo, no pasa nada, y sin el
 * motivo no tiene por dónde empezar.
 */

import type { SettingsResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface ProviderListProps {
  readonly providers: SettingsResponse['providers']
}

/** Las capacidades, en texto. */
function capabilitiesOf(provider: SettingsResponse['providers'][number]): string {
  const activas: string[] = []
  if (provider.capabilities.search) activas.push(t(DEFAULT_LOCALE, 'settings.cap.search'))
  if (provider.capabilities.sub) activas.push(t(DEFAULT_LOCALE, 'settings.cap.sub'))
  if (provider.capabilities.dub) activas.push(t(DEFAULT_LOCALE, 'settings.cap.dub'))
  if (provider.capabilities.trending) activas.push(t(DEFAULT_LOCALE, 'settings.cap.trending'))
  if (provider.capabilities.feed) activas.push(t(DEFAULT_LOCALE, 'settings.cap.feed'))

  return activas.length === 0 ? t(DEFAULT_LOCALE, 'settings.cap.none') : activas.join(' · ')
}

export function ProviderList(props: ProviderListProps): ReactNode {
  if (props.providers.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'settings.providers.empty')}</p>
  }

  return (
    <ul className="settings__providers">
      {props.providers.map((provider) => (
        <li key={`${provider.status}:${provider.id}`} className="episode">
          <span className="episode__title">{provider.name}</span>
          <span className="badge">
            {provider.status === 'active'
              ? t(DEFAULT_LOCALE, 'settings.provider.active')
              : t(DEFAULT_LOCALE, 'settings.provider.rejected')}
          </span>
          <span className="card__meta">{capabilitiesOf(provider)}</span>
          {provider.reason === undefined ? null : (
            <span className="search__error">{provider.reason}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
