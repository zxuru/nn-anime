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
import type { ProviderRepoCandidate, ProviderRepoView } from '@rona/core/api'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import type { RequestDeps } from '../../api/client'
import {
  candidateLabel,
  changed,
  messageOf,
  ProviderRepos,
  repoState,
  selectionOf,
  toggled,
} from './ProviderRepos'
import { createProviderReposStore, type ProviderReposStore } from './useProviderRepos'

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
    // La sugerencia es un botón que rellena el campo, no un texto que hay que
    // copiar a mano: el nombre del botón y la dirección que escribe.
    expect(html).toContain('Usar proveedor predeterminado')
    expect(html).toContain('settings__sugerencia-url')
  })

  test('con un repositorio, el campo no se rellena solo', () => {
    const html = pintar()

    expect(html).not.toContain('value="https://github.com/zxuru/nn-anime-plugins"')
  })

  /**
   * El aviso del campo se anuncia al llegar a él.
   *
   * Estaba al lado, sin `aria-describedby`: la etiqueta se oía y el formato —lo
   * que hay que escribir— no. El `id` citado tiene que existir.
   */
  test('el aviso de la dirección va asociado con `aria-describedby`', () => {
    const html = pintar()

    expect(html).toContain('aria-describedby="repo-url-hint"')
    expect(html).toContain('id="repo-url-hint"')
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

const URL_REPO = 'https://github.com/zxuru/nn-anime-plugins'

interface Peticion {
  readonly metodo: string
  readonly ruta: string
  readonly cuerpo: unknown
}

interface ServidorDeRepos {
  readonly deps: RequestDeps
  readonly peticiones: readonly Peticion[]
  /** Las peticiones de un método, en orden. */
  readonly de: (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE') => readonly Peticion[]
}

/**
 * Un servidor de mentira que apunta lo que le piden.
 *
 * `responder` decide qué contesta cada ruta; ningún caso toca la red. Así se
 * mide la secuencia —mutación y después relectura— sin navegador ni DOM.
 */
function servidor(
  responder: (peticion: Peticion) => Response | Promise<Response>,
): ServidorDeRepos {
  const peticiones: Peticion[] = []

  const deps: RequestDeps = {
    fetch: async (input, init) => {
      const cuerpo: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      const peticion = { metodo: init.method ?? 'GET', ruta: input, cuerpo }

      peticiones.push(peticion)

      return await responder(peticion)
    },
  }

  return {
    deps,
    peticiones,
    de: (metodo) => peticiones.filter((peticion) => peticion.metodo === metodo),
  }
}

/** Una lista de repositorios como la sirve `GET /api/provider-repos`. */
function lista(...repos: ProviderRepoView[]): Response {
  return Response.json({ repos })
}

/**
 * Las mutaciones, con su recarga.
 *
 * Lo que se mide no es que la petición salga: es que lo que queda en pantalla
 * sea lo que el servidor contestó después del cambio. Por eso el servidor de
 * mentira devuelve una lista distinta en la segunda lectura: si el gancho no
 * relee, la diferencia se ve. Y lo que se conserva cuando falla también es una
 * decisión, no un accidente.
 */
describe('las mutaciones de repositorios', () => {
  test('instalar hace POST y relee: la lista que queda es la del servidor', async () => {
    const antes = repo({ enabled: [] })
    const despues = repo({ enabled: ['jkanime.ts'], files: 7 })
    let lecturas = 0
    const cambios: number[] = []
    const servidorDePrueba = servidor((peticion) => {
      if (peticion.metodo === 'GET') {
        lecturas += 1

        return lecturas === 1 ? lista(antes) : lista(despues)
      }

      return Response.json({ repo: despues })
    })
    const store = createProviderReposStore(() => cambios.push(1), servidorDePrueba.deps)

    await store.load()
    await store.install(URL_REPO)

    expect(servidorDePrueba.peticiones.map((peticion) => peticion.metodo)).toEqual([
      'GET',
      'POST',
      'GET',
    ])
    expect(servidorDePrueba.de('POST')[0]?.cuerpo).toEqual({ url: URL_REPO })
    expect(store.snapshot().state).toBe('ready')
    expect(store.snapshot().repos).toEqual([despues])
    // Activar o quitar carga proveedores: la lista de arriba tiene que enterarse.
    expect(cambios).toHaveLength(1)
  })

  test('guardar la selección hace PATCH con lo marcado y relee', async () => {
    const antes = repo({ enabled: [] })
    const despues = repo({ enabled: ['jkanime.ts'] })
    let lecturas = 0
    const servidorDePrueba = servidor((peticion) => {
      if (peticion.metodo === 'GET') {
        lecturas += 1

        return lecturas === 1 ? lista(antes) : lista(despues)
      }

      return Response.json({ repo: despues })
    })
    const store = createProviderReposStore(() => {}, servidorDePrueba.deps)

    await store.load()
    await store.select(URL_REPO, ['jkanime.ts'])

    expect(servidorDePrueba.de('PATCH')[0]?.cuerpo).toEqual({
      url: URL_REPO,
      enabled: ['jkanime.ts'],
    })
    expect(store.snapshot().repos).toEqual([despues])
  })

  test('quitar hace DELETE con la dirección codificada y relee sin ella', async () => {
    let lecturas = 0
    const servidorDePrueba = servidor((peticion) => {
      if (peticion.metodo === 'GET') {
        lecturas += 1

        return lecturas === 1 ? lista(repo()) : lista()
      }

      return new Response(null, { status: 204 })
    })
    const store = createProviderReposStore(() => {}, servidorDePrueba.deps)

    await store.load()
    await store.remove(URL_REPO)

    expect(servidorDePrueba.de('DELETE')[0]?.ruta).toBe(
      '/api/provider-repos?url=https%3A%2F%2Fgithub.com%2Fzxuru%2Fnn-anime-plugins',
    )
    expect(store.snapshot().state).toBe('ready')
    expect(store.snapshot().repos).toEqual([])
  })

  test('un fallo de red en cualquier mutación llega al aviso y conserva la lista', async () => {
    const intentos: ReadonlyArray<readonly [string, (store: ProviderReposStore) => Promise<void>]> =
      [
        ['instalar', (store) => store.install(URL_REPO)],
        ['guardar la selección', (store) => store.select(URL_REPO, ['jkanime.ts'])],
        ['quitar', (store) => store.remove(URL_REPO)],
      ]

    for (const [nombre, ejecutar] of intentos) {
      const anterior = repo()
      const servidorDePrueba = servidor((peticion) => {
        if (peticion.metodo === 'GET') return lista(anterior)

        throw new TypeError('Unable to connect. Is the computer able to access the url?')
      })
      const cambios: number[] = []
      const store = createProviderReposStore(() => cambios.push(1), servidorDePrueba.deps)

      await store.load()
      const antes = store.snapshot()

      const causa: unknown = await ejecutar(store).then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(causa, nombre).toBeInstanceOf(TypeError)
      // Es el mismo texto que pinta `ProviderRepos` en su aviso.
      expect(messageOf(causa), nombre).toContain('sin conexión con el servidor')
      // La misma referencia: no se publicó nada, ni una lista vacía ni a medias.
      expect(store.snapshot(), nombre).toBe(antes)
      expect(store.snapshot().repos, nombre).toEqual([anterior])
      // Sin recarga y sin avisar de un cambio que el servidor no hizo.
      expect(servidorDePrueba.de('GET'), nombre).toHaveLength(1)
      expect(cambios, nombre).toHaveLength(0)
    }
  })

  test('una relectura que no cumple el schema no se traga', async () => {
    const anterior = repo()
    let lecturas = 0
    const servidorDePrueba = servidor((peticion) => {
      if (peticion.metodo === 'GET') {
        lecturas += 1

        return lecturas === 1 ? lista(anterior) : Response.json({ repos: 'ninguno' })
      }

      return Response.json({ repo: anterior })
    })
    const store = createProviderReposStore(() => {}, servidorDePrueba.deps)

    await store.load()
    await store.install(URL_REPO)

    const despues = store.snapshot()
    // Un cuerpo con la forma equivocada es un fallo, no una lista vacía.
    expect(despues.state).toBe('error')
    expect(despues.error?.clase).toBe('forma')
    // Y no se lleva por delante lo último que el servidor dijo bien.
    expect(despues.repos).toEqual([anterior])
    expect(servidorDePrueba.de('GET')).toHaveLength(2)
  })

  test('no adelanta la lista antes de que el servidor conteste', async () => {
    const anterior = repo({ enabled: [] })
    const despues = repo({ enabled: ['jkanime.ts'] })
    let lecturas = 0
    let liberar: (() => void) | undefined
    const bloqueo = new Promise<void>((resolver) => {
      liberar = () => resolver()
    })
    const servidorDePrueba = servidor(async (peticion) => {
      if (peticion.metodo === 'GET') {
        lecturas += 1

        return lecturas === 1 ? lista(anterior) : lista(despues)
      }

      await bloqueo

      return Response.json({ repo: despues })
    })
    const store = createProviderReposStore(() => {}, servidorDePrueba.deps)

    await store.load()
    const antesDePedir = store.snapshot()
    const enCurso = store.install(URL_REPO)

    // El POST está en vuelo y nadie contestó todavía: no hay nada nuevo que
    // enseñar. Publicar aquí una lista optimista deja esta prueba en rojo.
    expect(store.snapshot()).toBe(antesDePedir)
    expect(servidorDePrueba.de('GET')).toHaveLength(1)
    expect(servidorDePrueba.de('POST')).toHaveLength(1)

    liberar?.()
    await enCurso

    expect(store.snapshot().repos).toEqual([despues])
    expect(servidorDePrueba.de('GET')).toHaveLength(2)
  })
})
