/**
 * Página de ajustes.
 *
 * Existe para que el usuario pueda ver qué está pasando: qué proveedores hay y
 * cuáles se rechazaron, dónde vive cada cosa y si hay reproductor externo. Sin
 * esta página, un plugin roto es un misterio y una ruta de datos es un dato que
 * nadie encuentra.
 *
 * El aviso de seguridad no es decorativo y va **en la página**, no sólo en el
 * documento enlazado: un plugin se ejecuta sin sandbox con los permisos del
 * usuario, y eso hay que decirlo donde se instalan plugins, no a un clic de
 * distancia.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { ProviderList } from './ProviderList'
import { ThemeToggle } from './ThemeToggle'
import { useSettings } from './useSettings'

export function SettingsPage(): ReactNode {
  const { state, data, error, setTheme } = useSettings()

  if (state === 'loading') {
    return (
      <section className="settings" aria-busy="true">
        <h1>{t(DEFAULT_LOCALE, 'settings.title')}</h1>
        <p className="empty">{t(DEFAULT_LOCALE, 'settings.loading')}</p>
      </section>
    )
  }

  if (state === 'error' || data === undefined) {
    return (
      <section className="settings">
        <h1>{t(DEFAULT_LOCALE, 'settings.title')}</h1>
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'settings.error', { message: error ?? '' })}
        </p>
      </section>
    )
  }

  return (
    <section className="settings">
      <h1>{t(DEFAULT_LOCALE, 'settings.title')}</h1>

      {/* El aviso va primero a propósito: es lo que hay que leer antes de copiar
          un plugin, no después. */}
      <aside className="settings__warning">
        <h2>{t(DEFAULT_LOCALE, 'settings.security.title')}</h2>
        <p>{t(DEFAULT_LOCALE, 'settings.security.body')}</p>
        <p>
          <a className="settings__link" href="/SECURITY.md">
            {t(DEFAULT_LOCALE, 'settings.security.link')}
          </a>
        </p>
      </aside>

      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.providers')}</h2>
        <ProviderList providers={data.providers} />
      </section>

      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.paths')}</h2>
        <dl className="settings__paths">
          <dt>{t(DEFAULT_LOCALE, 'settings.paths.data')}</dt>
          <dd>{data.paths.data}</dd>
          <dt>{t(DEFAULT_LOCALE, 'settings.paths.config')}</dt>
          <dd>{data.paths.config}</dd>
          <dt>{t(DEFAULT_LOCALE, 'settings.paths.cache')}</dt>
          <dd>{data.paths.cache}</dd>
        </dl>
      </section>

      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.mpv')}</h2>
        <p>
          {data.mpv.available
            ? t(DEFAULT_LOCALE, 'settings.mpv.yes', { version: data.mpv.version ?? '?' })
            : t(DEFAULT_LOCALE, 'settings.mpv.no')}
        </p>
      </section>

      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.theme')}</h2>
        <ThemeToggle value={data.theme} onChange={setTheme} />
      </section>
    </section>
  )
}
