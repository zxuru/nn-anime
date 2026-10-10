import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { ProviderList } from './ProviderList'
import { SettingsPage } from './SettingsPage'
import { resolvedTheme, ThemeToggle, themeAttribute } from './ThemeToggle'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/settings')}>{node}</HistoryProvider>,
  )
}

const CAPACIDADES = { search: true, sub: true, dub: false, trending: false }

describe('tema', () => {
  test('`system` se resuelve con lo que prefiere el sistema', () => {
    expect(resolvedTheme('system', true)).toBe('light')
    expect(resolvedTheme('system', false)).toBe('dark')
  })

  test('un tema explícito no se deja cambiar por el sistema', () => {
    expect(resolvedTheme('dark', true)).toBe('dark')
    expect(resolvedTheme('light', false)).toBe('light')
  })

  test('el atributo es el que entiende la hoja de estilos', () => {
    expect(themeAttribute('dark', true)).toBe('dark')
    expect(themeAttribute('system', false)).toBe('dark')
  })

  test('el selector marca el tema activo y ofrece los tres', () => {
    const html = render(<ThemeToggle value="light" onChange={() => {}} />)

    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Oscuro')
    expect(html).toContain('Claro')
    expect(html).toContain('El del sistema')
  })
})

describe('lista de proveedores', () => {
  test('un activo enseña sus capacidades', () => {
    const html = render(
      <ProviderList
        providers={[{ id: 'mio', name: 'Mi fuente', capabilities: CAPACIDADES, status: 'active' }]}
      />,
    )

    expect(html).toContain('Mi fuente')
    expect(html).toContain('activo')
    expect(html).toContain('búsqueda')
    expect(html).not.toContain('doblado')
  })

  test('un rechazado enseña su motivo', () => {
    const html = render(
      <ProviderList
        providers={[
          {
            id: 'roto.ts',
            name: 'roto.ts',
            capabilities: { search: false, sub: false, dub: false, trending: false },
            status: 'rejected',
            reason: 'no exporta un proveedor válido',
          },
        ]}
      />,
    )

    expect(html).toContain('rechazado')
    expect(html).toContain('no exporta un proveedor válido')
    expect(html).toContain('sin capacidades')
  })

  test('sin proveedores lo dice', () => {
    expect(render(<ProviderList providers={[]} />)).toContain('No hay ningún proveedor instalado')
  })
})

describe('la página', () => {
  test('arranca cargando y no depende de la red en el primer render', () => {
    const html = render(<SettingsPage />)

    expect(html).toContain('Cargando los ajustes')
    expect(html).toContain('aria-busy="true"')
  })

  test('el aviso de seguridad está en la página y enlaza al documento', async () => {
    const fuente = await readFile(`${ROOT}SettingsPage.tsx`, 'utf8')

    expect(fuente).toContain('settings.security.body')
    expect(fuente).toContain('href="/SECURITY.md"')
  })

  test('el aviso dice que no hay sandbox, con esas palabras', async () => {
    const catalogo = await readFile(
      fileURLToPath(new URL('../../i18n/es.ts', import.meta.url)),
      'utf8',
    )

    expect(catalogo).toContain('sin sandbox')
    expect(catalogo).toContain('con tus permisos')
  })
})
