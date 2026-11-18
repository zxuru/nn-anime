import { describe, expect, test } from 'bun:test'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { t } from '../../i18n'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { IndiceAjustes } from './IndiceAjustes'
import {
  PROFILE_EXPORT_PATH,
  PROFILE_IMPORT_PATH,
  ProfileImportSummary,
  ProfileSettings,
} from './ProfileSettings'

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/settings')}>{node}</HistoryProvider>,
  )
}

describe('la copia del perfil en Ajustes', () => {
  test('exportar es un enlace de descarga y no un botón que lee el JSON', () => {
    const html = render(<ProfileSettings />)

    expect(html).toContain(`href="${PROFILE_EXPORT_PATH}"`)
    expect(html).toContain('download')
    expect(html).toContain(t(DEFAULT_LOCALE, 'settings.profile.export'))
  })

  test('importar es un campo de archivo que acepta JSON', () => {
    const html = render(<ProfileSettings />)

    expect(PROFILE_IMPORT_PATH).toBe('/api/profile/import')
    expect(html).toContain('type="file"')
    expect(html).toContain('accept="application/json,.json"')
    expect(html).toContain(t(DEFAULT_LOCALE, 'settings.profile.import'))
  })

  test('el resumen dice cuántas marcas se añadieron y cuántas quedaron fuera', () => {
    const html = render(
      <ProfileImportSummary result={{ favorites: 2, watched: 1, planToWatch: 0, skipped: 3 }} />,
    )

    expect(html).toContain('Favoritos añadidos: 2')
    expect(html).toContain('Vistos añadidos: 1')
    expect(html).toContain('Pendientes añadidos: 0')
    expect(html).toContain('Sin ficha local: 3')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  test('el índice lleva a la sección «Perfil»', () => {
    const html = render(<IndiceAjustes />)

    expect(html).toContain('href="#perfil"')
    expect(html).toContain(t(DEFAULT_LOCALE, 'settings.section.perfil'))
  })
})
