/**
 * La sección de repositorios.
 *
 * Se renderiza con `renderToString`, así que lo que se mide es **lo que enseña**:
 * las casillas que ofrece, lo que dice de cada repositorio y el aviso que hay que
 * leer antes de marcar nada. Las decisiones que no se ven —marcar, desmarcar,
 * comparar con lo guardado— son funciones propias y se prueban aparte, que es la
 * única forma de medirlas sin un navegador.
 */

import { describe, expect, test } from 'bun:test'
import type { ProviderRepoCandidate, ProviderRepoView } from '@nn-anime/core/api'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import {
  candidateLabel,
  changed,
  ProviderRepos,
  repoState,
  selectionOf,
  toggled,
} from './ProviderRepos'

function render(node: ReactNode): string {
  return renderToString(node)
}

const CANDIDATO: ProviderRepoCandidate = { path: 'jkanime.ts', id: 'jkanime', name: 'JKanime' }

function repo(overrides: Partial<ProviderRepoView> = {}): ProviderRepoView {
  return {
    url: 'https://github.com/zxuru/nn-anime-plugins',
    owner: 'zxuru',
    repo: 'nn-anime-plugins',
    ref: 'main',
    fetchedAt: '2026-10-13T10:00:00.000Z',
    enabled: [],
    files: 3,
    candidates: [CANDIDATO, { path: 'src/otro.ts' }],
    present: true,
    ...overrides,
  }
}

/** Las casillas marcadas: `checked=""` es lo que pinta React en el HTML. */
function marcadas(html: string): number {
  return (html.match(/checked=""/g) ?? []).length
}

function pintar(
  overrides: Partial<ProviderRepoView> = {},
  seleccion: readonly string[] = [],
): string {
  return render(
    <ProviderRepos
      state="ready"
      repos={[repo({ ...overrides, enabled: [...seleccion] })]}
      error={undefined}
      install={async () => {}}
      select={async () => {}}
      remove={async () => {}}
    />,
  )
}

describe('candidateLabel: cómo se llama un candidato', () => {
  test('el nombre manda, después el id y después la ruta', () => {
    expect(candidateLabel(CANDIDATO)).toBe('JKanime')
    expect(candidateLabel({ path: 'a.ts', id: 'a' })).toBe('a')
    expect(candidateLabel({ path: 'a.ts' })).toBe('a.ts')
  })
})

describe('toggled: marcar y desmarcar', () => {
  test('marca al final y ordenado, para que dos selecciones iguales coincidan', () => {
    expect(toggled([], 'b.ts', true)).toEqual(['b.ts'])
    expect(toggled(['b.ts'], 'a.ts', true)).toEqual(['a.ts', 'b.ts'])
  })

  test('desmarcar quita la ruta', () => {
    expect(toggled(['a.ts', 'b.ts'], 'a.ts', false)).toEqual(['b.ts'])
  })

  test('marcar lo que ya estaba no lo duplica', () => {
    expect(toggled(['a.ts'], 'a.ts', true)).toEqual(['a.ts'])
  })

  test('no toca la lista que recibe', () => {
    const original = ['a.ts']
    toggled(original, 'b.ts', true)

    expect(original).toEqual(['a.ts'])
  })
})

describe('changed: ¿hay algo que guardar?', () => {
  test('la misma selección no es un cambio, aunque venga en otro orden', () => {
    expect(changed(['a.ts', 'b.ts'], ['b.ts', 'a.ts'])).toBe(false)
  })

  test('una ruta de más o de menos sí lo es', () => {
    expect(changed(['a.ts'], ['a.ts', 'b.ts'])).toBe(true)
    expect(changed(['a.ts', 'b.ts'], ['a.ts'])).toBe(true)
    expect(changed(['a.ts'], ['b.ts'])).toBe(true)
  })
})

describe('repoState: lo que hay que decir de un repositorio', () => {
  test('sin contenido descargado está ausente', () => {
    expect(repoState(repo({ present: false }))).toBe('missing')
  })

  test('con contenido y sin candidatos, el escáner no reconoció nada', () => {
    expect(repoState(repo({ candidates: [] }))).toBe('empty')
  })

  test('con candidatos está bien', () => {
    expect(repoState(repo())).toBe('ok')
  })
})

describe('selectionOf: lo que se está editando gana sobre lo guardado', () => {
  test('sin borrador se enseña lo guardado', () => {
    expect(selectionOf(repo({ enabled: ['jkanime.ts'] }), {})).toEqual(['jkanime.ts'])
  })

  test('con borrador se enseña el borrador', () => {
    expect(
      selectionOf(repo({ enabled: ['jkanime.ts'] }), {
        'https://github.com/zxuru/nn-anime-plugins': ['src/otro.ts'],
      }),
    ).toEqual(['src/otro.ts'])
  })
})

describe('lo que enseña la sección', () => {
  test('el formulario pide una dirección y ofrece añadir o actualizar', () => {
    const html = render(
      <ProviderRepos
        state="ready"
        repos={[]}
        error={undefined}
        install={async () => {}}
        select={async () => {}}
        remove={async () => {}}
      />,
    )

    expect(html).toContain('Dirección del repositorio')
    expect(html).toContain('github.com/usuario/repo')
    expect(html).toContain('Añadir o actualizar')
    expect(html).toContain('No hay ningún repositorio instalado.')
  })

  /**
   * El repositorio recomendado, escrito en el campo.
   *
   * La primera vez no hay ninguno, y la dirección se deriva de la lista vacía en
   * vez de esperar a un efecto: así el campo ya está escrito en el primer render
   * con los repositorios cargados y no se pisa lo que el usuario teclee después.
   */
  test('sin repositorios, el campo trae el recomendado', () => {
    const html = render(
      <ProviderRepos
        state="ready"
        repos={[]}
        error={undefined}
        install={async () => {}}
        select={async () => {}}
        remove={async () => {}}
      />,
    )

    expect(html).toContain('value="https://github.com/zxuru/nn-anime-plugins"')
    expect(html).toContain('El repositorio recomendado es')
  })

  test('con un repositorio, el campo no se rellena solo', () => {
    const html = pintar()

    expect(html).not.toContain('value="https://github.com/zxuru/nn-anime-plugins"')
  })

  test('el aviso de que activar ejecuta código está en la sección, no sólo arriba', () => {
    expect(pintar()).toContain('ejecuta el código del repositorio sin sandbox')
  })

  test('un repositorio enseña su rama, sus archivos y cuántos hay activos', () => {
    const html = pintar({}, ['jkanime.ts'])

    expect(html).toContain('rama main')
    expect(html).toContain('3 archivos descargados')
    expect(html).toContain('1 de 2 activos')
  })

  test('una casilla por candidato, y sólo la habilitada viene marcada', () => {
    const html = pintar({}, ['jkanime.ts'])

    expect(html).toContain('Activar jkanime.ts')
    expect(html).toContain('Activar src/otro.ts')
    expect(marcadas(html)).toBe(1)
    // La etiqueta del primero es su nombre, y la ruta se enseña al lado; el
    // segundo no tiene nombre, así que se llama por su ruta.
    expect(html).toContain('JKanime')
    expect(html).toContain('src/otro.ts')
  })

  test('sin nada habilitado no hay ninguna casilla marcada', () => {
    expect(marcadas(pintar())).toBe(0)
  })

  test('un repositorio sin contenido descargado lo dice', () => {
    const html = pintar({ present: false })

    expect(html).toContain('Falta el contenido descargado')
    expect(html).not.toContain('Activar jkanime.ts')
  })

  test('un repositorio sin candidatos lo dice, y no ofrece casillas', () => {
    const html = pintar({ candidates: [] })

    expect(html).toContain('no reconoció ningún proveedor')
    expect(html).not.toContain('type="checkbox"')
  })

  test('ofrece guardar, actualizar y quitar', () => {
    const html = pintar()

    expect(html).toContain('Guardar selección')
    expect(html).toContain('Actualizar')
    expect(html).toContain('Quitar')
    // Sin cambios, guardar está desactivado y lo explica.
    expect(html).toContain('No hay cambios que guardar.')
    expect(html).toContain('disabled=""')
  })

  test('mientras carga lo dice, y no dice que no hay repositorios', () => {
    const html = render(
      <ProviderRepos
        state="loading"
        repos={[]}
        error={undefined}
        install={async () => {}}
        select={async () => {}}
        remove={async () => {}}
      />,
    )

    expect(html).toContain('Mirando qué repositorios hay')
    expect(html).not.toContain('No hay ningún repositorio instalado.')
  })

  test('un fallo al leer la lista se cuenta con lo que dijo el servidor', () => {
    const html = render(
      <ProviderRepos
        state="error"
        repos={[]}
        error={{
          clase: 'servidor',
          estado: 500,
          detalle: 'la tabla no responde',
          tecnico: 'SQLITE',
        }}
        install={async () => {}}
        select={async () => {}}
        remove={async () => {}}
      />,
    )

    expect(html).toContain('No se pudo leer la lista')
    expect(html).toContain('la tabla no responde')
  })
})
