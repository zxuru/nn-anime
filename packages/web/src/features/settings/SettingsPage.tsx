/**
 * Página de ajustes.
 *
 * Existe para que el usuario pueda ver qué está pasando: qué proveedores hay y
 * cuáles se rechazaron, dónde vive cada cosa y si hay reproductor externo. Sin
 * esta página, un plugin roto es un misterio y una ruta de datos es un dato que
 * nadie encuentra.
 *
 * El aviso de seguridad no es decorativo y va **en la página**, no sólo en el
 * documento: un plugin se ejecuta sin sandbox con los permisos del usuario, y eso
 * hay que decirlo donde se instalan plugins, no a un clic de distancia. El
 * documento entero se abre en un diálogo, servido desde el propio `SECURITY.md`:
 * una sola fuente para lo que se lee en el repo y lo que se lee en la pantalla.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useState } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import { ProviderList } from './ProviderList'
import { ProviderRepos } from './ProviderRepos'
import { RegisterProvider } from './RegisterProvider'
import { SecurityNoticeDialog } from './SecurityNotice'
import { ThemeToggle } from './ThemeToggle'
import { useProviderRepos } from './useProviderRepos'
import { useSecurityNotice } from './useSecurityNotice'
import { useSettings } from './useSettings'

export function SettingsPage(): ReactNode {
  const { state, data, error, setTheme, setProviderPriority, setAdultContent, register, refresh } =
    useSettings()
  const repos = useProviderRepos(refresh)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const notice = useSecurityNotice(noticeOpen)

  const aviso = (
    <SecurityNoticeDialog
      open={noticeOpen}
      onClose={() => setNoticeOpen(false)}
      markdown={notice.markdown}
      error={notice.error}
    />
  )

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
        <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} />
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
          <button
            type="button"
            className="settings__link"
            aria-haspopup="dialog"
            onClick={() => setNoticeOpen(true)}
          >
            {t(DEFAULT_LOCALE, 'settings.security.open')}
          </button>
        </p>
      </aside>

      {aviso}

      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.providers')}</h2>
        <ProviderList
          providers={data.providers}
          priority={data.providerPriority}
          onReorder={setProviderPriority}
        />
      </section>

      {/* Los repositorios van justo debajo de la lista de proveedores: es otra
          forma de llenarla, y la lista de arriba es donde se ve el resultado. */}
      <ProviderRepos {...repos} />

      {/* El alta va después de la lista: primero se ve qué hay, y el formulario
          está justo debajo de lo que va a cambiar. */}
      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.register.title')}</h2>
        <RegisterProvider register={register} />
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

      {/*
        El interruptor del contenido para adultos.

        Reutiliza el contenedor de botones del tema: es una fila de botones con estado
        —`aria-pressed`— y nada de la regla habla del tema. Una clase nueva sería la
        misma regla de CSS escrita dos veces para el mismo dibujo.
      */}
      <section>
        <h2>{t(DEFAULT_LOCALE, 'settings.adult')}</h2>
        <fieldset className="settings__theme" aria-label={t(DEFAULT_LOCALE, 'settings.adult')}>
          <button
            type="button"
            className="button"
            aria-pressed={!data.adultContent}
            onClick={() => setAdultContent(false)}
          >
            {t(DEFAULT_LOCALE, 'settings.adult.hide')}
          </button>
          <button
            type="button"
            className="button"
            aria-pressed={data.adultContent}
            onClick={() => setAdultContent(true)}
          >
            {t(DEFAULT_LOCALE, 'settings.adult.show')}
          </button>
        </fieldset>
        <p>{t(DEFAULT_LOCALE, 'settings.adult.help')}</p>
      </section>
    </section>
  )
}
