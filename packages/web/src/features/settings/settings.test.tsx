import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { moved, ProviderList, providersByPriority } from './ProviderList'
import { RegisterProvider } from './RegisterProvider'
import { SettingsPage } from './SettingsPage'
import { resolvedTheme, ThemeToggle, themeAttribute } from './ThemeToggle'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/settings')}>{node}</HistoryProvider>,
  )
}

const CAPACIDADES = { search: true, sub: true, dub: false, trending: false, feed: false }

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
    // El feed se enseña como cualquier otra capacidad: quien lo declara lo ve, y
    // quien no, no lo ve.
    expect(html).not.toContain('novedades')
  })

  test('un proveedor con feed lo declara en la lista', () => {
    const html = render(
      <ProviderList
        providers={[
          {
            id: 'mio',
            name: 'Mi fuente',
            capabilities: { ...CAPACIDADES, feed: true },
            status: 'active',
          },
        ]}
      />,
    )

    expect(html).toContain('novedades')
  })

  test('un rechazado enseña su motivo', () => {
    const html = render(
      <ProviderList
        providers={[
          {
            id: 'roto.ts',
            name: 'roto.ts',
            capabilities: { search: false, sub: false, dub: false, trending: false, feed: false },
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

describe('la prioridad de proveedor', () => {
  const UNO = { id: 'uno', name: 'Uno', capabilities: CAPACIDADES, status: 'active' as const }
  const DOS = { id: 'dos', name: 'Dos', capabilities: CAPACIDADES, status: 'active' as const }
  const ROTO = {
    id: 'roto',
    name: 'roto.ts',
    capabilities: { search: false, sub: false, dub: false, trending: false, feed: false },
    status: 'rejected' as const,
    reason: 'no exporta un proveedor válido',
  }

  test('el orden guardado manda sobre el orden en que cargaron', () => {
    // Mutar `providersByPriority` para devolver la lista tal cual deja esta prueba
    // en rojo: el preferido no sube.
    expect(providersByPriority([UNO, DOS], ['dos']).map((p) => p.id)).toEqual(['dos', 'uno'])
  })

  test('un proveedor que la lista no nombra no desaparece: va después', () => {
    // Un id que ya no existe no puede llevarse por delante a los que sí están.
    expect(providersByPriority([UNO, DOS], ['fantasma']).map((p) => p.id)).toEqual(['uno', 'dos'])
  })

  test('los rechazados van al final, aunque la lista los nombre', () => {
    expect(providersByPriority([ROTO, UNO], ['roto']).map((p) => p.id)).toEqual(['uno', 'roto'])
  })

  test('mover intercambia el puesto con el de al lado', () => {
    expect(moved(['uno', 'dos', 'tres'], 2, 1)).toEqual(['uno', 'tres', 'dos'])
  })

  test('el primero no sube y el último no baja', () => {
    // Los tres casos distinguen el guardián del rango de no tenerlo: sin él,
    // mover fuera de la lista reordena igual —`splice` recorta por su cuenta— y
    // la lista sale distinta de la que entró.
    expect(moved(['uno', 'dos', 'tres'], 0, -1)).toEqual(['uno', 'dos', 'tres'])
    expect(moved(['uno', 'dos', 'tres'], 1, -2)).toEqual(['uno', 'dos', 'tres'])
    expect(moved(['uno', 'dos', 'tres'], 1, 3)).toEqual(['uno', 'dos', 'tres'])
  })

  test('el preferido se marca y el suyo es el botón de subir deshabilitado', () => {
    const html = render(
      <ProviderList providers={[UNO, DOS]} priority={['dos']} onReorder={() => {}} />,
    )

    expect(html).toContain('preferido')
    // El de arriba no puede subir más; el de abajo sí puede bajar por su cuenta
    // hasta la última posición, así que su «Bajar» está deshabilitado.
    expect(html).toMatch(/disabled=""[^>]*aria-label="Subir Dos"/)
    expect(html).toMatch(/disabled=""[^>]*aria-label="Bajar Uno"/)
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="Subir Uno"/)
  })

  test('sin quien guarde el orden, no se ofrecen los botones', () => {
    const html = render(<ProviderList providers={[UNO, DOS]} priority={['dos']} />)

    expect(html).toContain('preferido')
    expect(html).not.toContain('Subir')
  })
})

describe('el alta de un proveedor', () => {
  const sinGuardar = async (): Promise<never> => {
    throw new Error('en este test nadie guarda')
  }

  test('enseña los tres datos que hacen falta y las rutas por defecto', () => {
    const html = render(<RegisterProvider register={sinGuardar} />)

    expect(html).toContain('Identificador')
    expect(html).toContain('Dirección base')
    expect(html).toContain('/search?q={query}')
    expect(html).toContain('/anime/{ref}')
  })

  test('cada campo tiene su etiqueta, y el identificador es obligatorio', () => {
    const html = render(<RegisterProvider register={sinGuardar} />)

    // Sin `htmlFor`/`id` la etiqueta no nombra nada, aunque se vea al lado.
    expect(html).toContain('for="provider-id"')
    expect(html).toContain('id="provider-id"')
    expect(html).toContain('required')
  })

  test('el botón dice qué hace y el resultado se anuncia', () => {
    const html = render(<RegisterProvider register={sinGuardar} />)

    expect(html).toContain('Guardar proveedor')
    expect(html).toContain('aria-live="polite"')
  })

  test('los campos avanzados empiezan plegados', () => {
    const html = render(<RegisterProvider register={sinGuardar} />)

    expect(html).toContain('<details')
    expect(html).not.toContain('open=""')
  })
})

describe('la página', () => {
  test('arranca cargando y no depende de la red en el primer render', () => {
    const html = render(<SettingsPage />)

    expect(html).toContain('Cargando los ajustes')
    expect(html).toContain('aria-busy="true"')
  })

  test('el aviso de seguridad está en la página y abre el documento', async () => {
    const fuente = await readFile(`${ROOT}SettingsPage.tsx`, 'utf8')

    expect(fuente).toContain('settings.security.body')
    expect(fuente).toContain('settings.security.open')
    // Un botón con `aria-haspopup`: no navega a ningún archivo, abre el diálogo.
    expect(fuente).toContain('aria-haspopup="dialog"')
    expect(fuente).toContain('<SecurityNoticeDialog')
    // El documento no se copia al bundle: se pide a la aplicación, que sirve el
    // mismo `SECURITY.md` del repo.
    expect(fuente).toContain('useSecurityNotice')
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
