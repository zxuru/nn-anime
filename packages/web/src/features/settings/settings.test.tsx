import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { t } from '../../i18n'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { DownloadsSummary } from './DownloadsSettings'
import { IndiceAjustes, primeraVisible } from './IndiceAjustes'
import {
  moved,
  ProbeStatus,
  ProviderList,
  probeProvider,
  probeStatusText,
  providersByPriority,
} from './ProviderList'
import { QualitySettings } from './QualitySettings'
import { RegisterProvider } from './RegisterProvider'
import { SettingsPage } from './SettingsPage'
import { SECCIONES_AJUSTES } from './secciones'
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
    // Y no se le inventa lo que sirve: un plugin que no cargó no declaró nada.
    expect(html).not.toContain('Anime')
  })

  /**
   * El sello del tipo.
   *
   * Es lo único que distingue, de un vistazo, una fuente de anime de una de
   * películas: sin él hay que abrir el plugin para saber en qué pestaña aparece cada
   * una, que es justo lo que el conmutador necesita saber.
   */
  test('un activo dice qué sirve, y el que no lo declara es de anime', () => {
    const html = render(
      <ProviderList
        providers={[
          {
            id: 'pelis',
            name: 'Fuente de películas',
            capabilities: { ...CAPACIDADES, media: 'movies' },
            status: 'active',
          },
          {
            id: 'mixta',
            name: 'Fuente mixta',
            capabilities: { ...CAPACIDADES, media: 'both' },
            status: 'active',
          },
          { id: 'clasica', name: 'Fuente clásica', capabilities: CAPACIDADES, status: 'active' },
        ]}
      />,
    )

    expect(html).toContain('Películas')
    expect(html).toContain('Anime y películas')
    expect(html).toContain('Anime')
  })

  test('sin proveedores lo dice', () => {
    expect(render(<ProviderList providers={[]} />)).toContain('No hay ningún proveedor instalado')
  })

  test('un activo que busca ofrece probarlo y su resultado tiene región viva', () => {
    const html = render(
      <ProviderList
        providers={[{ id: 'mio', name: 'Mi fuente', capabilities: CAPACIDADES, status: 'active' }]}
        onProbe={async () => ({ ok: true, latencyMs: 12 })}
      />,
    )

    expect(html).toContain('Probar')
    expect(html).toContain('aria-label="Probar Mi fuente"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  test('un rechazado no ofrece probarlo: no hay con qué', () => {
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

    expect(html).not.toContain('Probar')
  })

  test('el último error de carga se enseña bajo el estado', () => {
    const html = render(
      <ProviderList
        providers={[
          {
            id: 'mio',
            name: 'Mi fuente',
            capabilities: CAPACIDADES,
            status: 'active',
            lastError: 'no se pudo importar …: falta la carátula',
          },
        ]}
      />,
    )

    expect(html).toContain('Último error:')
    expect(html).toContain('falta la carátula')
  })
})

describe('el resultado de probar un proveedor', () => {
  test('una respuesta enseña la latencia', () => {
    const html = render(
      <ProbeStatus state={{ kind: 'done', result: { ok: true, latencyMs: 123 } }} />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('123 ms')
  })

  test('un fallo del proveedor enseña el motivo con la marca de error', () => {
    const html = render(
      <ProbeStatus
        state={{
          kind: 'done',
          result: { ok: false, latencyMs: 40, error: 'el sitio respondió 500' },
        }}
      />,
    )

    expect(html).toContain('el sitio respondió 500')
    expect(html).toContain('search__error')
  })

  test('un fallo al hablar con la ruta también se cuenta', () => {
    expect(probeStatusText({ kind: 'unreachable', message: 'sin conexión' })).toContain(
      'sin conexión',
    )
  })

  test('`probeProvider` llama a la ruta del proveedor y valida la respuesta', async () => {
    const llamadas: { readonly input: string; readonly init: RequestInit }[] = []
    const resultado = await probeProvider('mi fuente', {
      fetch: async (input, init) => {
        llamadas.push({ input, init })
        return new Response(JSON.stringify({ ok: true, latencyMs: 7 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    expect(resultado).toEqual({ ok: true, latencyMs: 7 })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]?.input).toBe('/api/providers/mi%20fuente/probe')
    expect(llamadas[0]?.init.method).toBe('POST')
  })

  test('una respuesta con la forma cambiada no se acepta', async () => {
    await expect(
      probeProvider('mio', {
        fetch: async () =>
          new Response(JSON.stringify({ ok: true, latencyMs: '7' }), { status: 200 }),
      }),
    ).rejects.toThrow()
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

  /**
   * El aviso de un campo se anuncia al llegar a él.
   *
   * Estaba al lado, sin `aria-describedby`: quien usa un lector de pantalla oía
   * la etiqueta y no el formato, que es justo lo que hay que saber antes de
   * escribir. El `id` que cita cada `aria-describedby` tiene que existir.
   */
  test('el aviso del campo va asociado con `aria-describedby`', () => {
    const html = render(<RegisterProvider register={sinGuardar} />)

    expect(html).toContain('aria-describedby="provider-id-hint"')
    expect(html).toContain('id="provider-id-hint"')
    // Y el aviso del grupo de rutas describe al grupo entero.
    expect(html).toContain('aria-describedby="provider-endpoints-hint"')
    expect(html).toContain('id="provider-endpoints-hint"')
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

  test('qué sirve se elige de una lista cerrada, y arranca en anime', () => {
    const html = render(<RegisterProvider register={sinGuardar} />)

    expect(html).toContain('Qué sirve')
    expect(html).toContain('id="provider-media"')
    // Las tres opciones del contrato, con la de por defecto marcada: dos casillas
    // podrían marcarse juntas o ninguna, y eso no significa nada.
    expect(html).toContain('<option value="anime" selected')
    expect(html).toContain('<option value="movies"')
    expect(html).toContain('<option value="both"')
  })
})

/**
 * El índice y la decisión de qué sección está activa.
 *
 * El índice se dibuja sin datos del servidor, así que se puede medir entero con
 * `renderToString`. Lo que no se puede medir sin navegador es el observador: de él
 * se prueba la función pura —la que decide— y el e2e se encarga del resto.
 */
describe('el índice de Ajustes', () => {
  test('un enlace por sección, a su ancla y en el mismo orden', () => {
    const html = render(<IndiceAjustes />)

    expect(html).toContain('aria-label="Secciones de los ajustes"')
    expect(html).toContain('Secciones')

    // Los ids son únicos: dos secciones con el mismo `id` harían que el segundo
    // enlace llevara siempre a la primera.
    const ids = SECCIONES_AJUSTES.map((seccion) => seccion.id)
    expect(new Set(ids).size).toBe(ids.length)

    const posiciones = ids.map((id) => html.indexOf(`href="#${id}"`))
    expect(posiciones.every((posicion) => posicion >= 0)).toBe(true)
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b))
  })

  test('la sección activa se marca una sola vez, y la suya', () => {
    const html = render(<IndiceAjustes activa="reproduccion" />)

    expect((html.match(/aria-current="location"/g) ?? []).length).toBe(1)
    expect(html).toMatch(/aria-current="location"[^>]*>Reproducción/)
  })

  test('sin sección activa no se marca ninguna', () => {
    expect(render(<IndiceAjustes />)).not.toContain('aria-current')
  })
})

describe('la sección que se está viendo', () => {
  test('manda la primera en el orden del documento', () => {
    expect(primeraVisible(['fuentes', 'sistema'], new Set(['sistema']))).toBe('sistema')
    // Las dos a la vez: se está leyendo el final de una y el principio de la otra,
    // así que la de arriba es la que cuenta.
    expect(primeraVisible(['fuentes', 'sistema'], new Set(['fuentes', 'sistema']))).toBe('fuentes')
    expect(primeraVisible(['fuentes'], new Set())).toBeUndefined()
  })
})

/**
 * La jerarquía de títulos.
 *
 * Los tres bloques que llevan su propio título dentro de un grupo de Ajustes lo
 * declaran como `h3`: el `h2` es del grupo, y repetirlo dentro dejaba a los tres
 * hermanos del grupo en el árbol del lector de pantalla. Se mide sobre la fuente
 * porque los tres componentes se dibujan con datos y estado propios; lo que
 * importa aquí es el nivel, no su contenido.
 */
describe('los títulos de los bloques', () => {
  test('los que viven dentro de un grupo usan h3, no h2', async () => {
    for (const archivo of ['ProviderRepos.tsx', 'TmdbSettings.tsx', 'SkipSettings.tsx']) {
      const fuente = await readFile(`${ROOT}${archivo}`, 'utf8')

      expect(fuente, `${archivo} conserva un h2`).not.toContain('<h2>')
      expect(fuente, `${archivo} no declara su título como h3`).toContain('<h3>')
    }
  })
})

describe('las descargas en Ajustes', () => {
  /**
   * La sección dice dónde está la carpeta y cuánto queda, y lleva a la
   * Biblioteca, que es donde se cambia. No hay un segundo formulario: el mismo
   * dato en dos sitios es el defecto que esta separación evita.
   */
  test('enseña la carpeta, el espacio y el enlace a la Biblioteca', () => {
    const html = render(
      <DownloadsSummary
        space={{
          path: '/srv/descargas',
          freeBytes: 10 * 1024 ** 3,
          totalBytes: 20 * 1024 ** 3,
          downloadsBytes: 2 * 1024 ** 3,
        }}
      />,
    )

    expect(html).toContain('/srv/descargas')
    expect(html).toContain('Libre: 10,0 GiB de 20,0 GiB.')
    expect(html).toContain('Las descargas ocupan 2,0 GiB.')
    expect(html).toContain('href="/library"')
    expect(html).toContain('Abrir la Biblioteca')
  })

  test('sin lectura todavía lo dice, y el fallo también', () => {
    expect(render(<DownloadsSummary space={undefined} />)).toContain('Leyendo el espacio')
    expect(render(<DownloadsSummary space={undefined} failed />)).toContain(
      'No se pudo leer el espacio',
    )
  })
})

describe('la calidad preferida', () => {
  test('se elige de una lista cerrada y arranca en automático', () => {
    const html = render(<QualitySettings />)

    expect(html).toContain('Calidad preferida')
    expect(html).toContain('La que dé la fuente')
    for (const calidad of ['1080p', '720p', '480p', '360p']) {
      expect(html, calidad).toContain(`value="${calidad}"`)
    }
  })
})

describe('la página', () => {
  test('arranca cargando y no depende de la red en el primer render', () => {
    const html = render(<SettingsPage />)

    expect(html).toContain('Cargando los ajustes')
    expect(html).toContain('aria-busy="true"')
  })

  /**
   * La espera tiene la forma de la página.
   *
   * Eran el titular y una frase sobre una página que después trae el aviso de
   * seguridad, un índice pegajoso y seis secciones de campos: el índice aparecía de
   * la nada y todo lo de abajo bajaba. Ahora el aviso y los titulares de sección —lo
   * que se sabe sin preguntar— se pintan de verdad y los campos tienen su hueco.
   */
  test('el esqueleto de Ajustes tiene la forma de Ajustes', () => {
    const html = render(<SettingsPage />)

    expect(html).toContain('settings__cuerpo')
    expect(html).toContain('settings__indice')
    expect(html.match(/class="settings__seccion"/g)?.length).toBe(SECCIONES_AJUSTES.length)

    for (const seccion of SECCIONES_AJUSTES) {
      expect(html, seccion.id).toContain(t(DEFAULT_LOCALE, seccion.titulo))
    }

    expect(html).toContain('class="solo-lectores" role="status"')
  })

  /**
   * La lectura, en un solo sitio.
   *
   * Es el otro lado de la cuenta de peticiones de `almacen.test.ts`: aquella
   * prueba mide que el almacén no repita la lectura, y ésta que la página no
   * pueda volver a pedirla por su cuenta. Si alguien reañade un `useSettings`
   * con su propia lectura en la página —el defecto que T230 cierra—, las dos se
   * ponen rojas: la de allí porque el servidor ve dos peticiones, la de aquí
   * porque la página nombra la ruta.
   */
  test('los ajustes se leen de un solo sitio: el almacén', async () => {
    const pagina = await readFile(`${ROOT}SettingsPage.tsx`, 'utf8')
    const raiz = await readFile(fileURLToPath(new URL('../../app.tsx', import.meta.url)), 'utf8')
    const gancho = await readFile(`${ROOT}useSettings.ts`, 'utf8')
    const almacen = await readFile(`${ROOT}almacen.ts`, 'utf8')

    // La raíz, que aplica el tema, y la página consumen el mismo gancho.
    expect(raiz).toContain('useAppTheme')
    expect(pagina).toContain('useSettings')
    expect(gancho).toContain('useSyncExternalStore')

    // Y la lectura sólo existe en el almacén: ni la página ni el gancho
    // importan siquiera el cliente HTTP.
    expect(pagina).not.toContain('apiGet')
    expect(gancho).not.toContain('apiGet')
    expect(almacen).toContain("apiGet('/api/settings'")
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

  /**
   * El orden de los caminos para llenar Fuentes.
   *
   * La lista y el repositorio son el camino recomendado; el alta manual son
   * quince campos y vive plegada en un `<details>`. Si alguien vuelve a ponerla
   * abierta y por delante, esta prueba lo dice sin abrir un navegador.
   */
  test('el alta manual va plegada, después de la lista y del repositorio', async () => {
    const fuente = await readFile(`${ROOT}SettingsPage.tsx`, 'utf8')
    const lista = fuente.indexOf('<ProviderList')
    const repos = fuente.indexOf('<ProviderRepos')
    const manual = fuente.indexOf('<RegisterProvider')
    const detalles = fuente.indexOf('<details className="settings__advanced">')

    expect(lista).toBeGreaterThan(-1)
    expect(repos).toBeGreaterThan(lista)
    expect(manual).toBeGreaterThan(repos)
    expect(detalles).toBeGreaterThan(repos)
    expect(detalles).toBeLessThan(manual)
    expect(fuente).toContain('settings.register.manual')
  })

  /**
   * El interruptor del contenido para adultos.
   *
   * Se mide sobre la fuente, como el aviso de seguridad: la página se dibuja sin datos
   * en `renderToString` —los efectos no corren— y lo que importa aquí es que el estado
   * esté declarado y que el aviso diga qué hace y qué no.
   */
  test('el interruptor declara su estado y lleva su aviso', async () => {
    const fuente = await readFile(`${ROOT}SettingsPage.tsx`, 'utf8')
    const catalogo = await readFile(
      fileURLToPath(new URL('../../i18n/es.ts', import.meta.url)),
      'utf8',
    )

    // Una fila de botones con estado, como el tema: `aria-pressed` es lo que dice cuál
    // está activo, y funciona con teclado sin nada más.
    expect(fuente).toContain('settings.adult')
    expect(fuente).toContain('aria-pressed={data.adultContent}')
    expect(fuente).toContain('setAdultContent')

    // Y el aviso dice las dos cosas —qué hace y qué no—: un interruptor sin
    // consecuencia declarada se enciende por curiosidad y se queda encendido.
    expect(catalogo).toContain('No comprueba la edad de nadie')
    expect(catalogo).toContain('sólo alcanza a lo que las fuentes publican')
  })
})
