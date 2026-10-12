/**
 * El escaneo estático: qué ofrece un repositorio, leído sin ejecutarlo.
 *
 * Las pruebas escriben árboles de verdad en un directorio temporal porque lo que
 * se mide es el recorrido —qué se mira y qué se salta—, y un árbol de mentira no
 * probaría ni el orden ni los filtros.
 */

import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { candidateHints, declaresProvider, scanProviderSources } from './scan'

async function withTree<T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'nn-anime-scan-'))

  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(root, name)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content)
    }
    return await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function paths(result: Awaited<ReturnType<typeof scanProviderSources>>): readonly string[] {
  return result.candidates.map((candidate) => candidate.path)
}

describe('declaresProvider: las formas de exportar del contrato', () => {
  test('acepta las cuatro que el cargador sabe importar', () => {
    const formas = [
      'export default provider',
      'export const providers = [a]',
      'export function providers() {}',
      'const a = {}; export { a as default }',
      'const a = {}; export { providers }',
      'module.exports = provider',
    ]

    for (const forma of formas) {
      expect(declaresProvider(forma)).toBe(true)
    }
  })

  test('un archivo sin export reconocible no declara nada', () => {
    expect(declaresProvider('const x = 1\nconsole.log(x)')).toBe(false)
  })

  test('el límite: se mira texto, no sintaxis', () => {
    // Una línea comentada no cuenta —la declaración tiene que empezar la línea—
    // y un bloque de comentario sí: ofrecerlo de más lo descarta el loader al
    // ejecutarlo, y ese es el error que el usuario ve con motivo. Se deja
    // escrito para que nadie crea que esto es un analizador de TypeScript.
    expect(declaresProvider('// export default provider')).toBe(false)
    expect(declaresProvider('/*\nexport default provider\n*/')).toBe(true)
    expect(declaresProvider("import { providers } from './x'")).toBe(false)
  })
})

describe('candidateHints: el id y el nombre, como pista', () => {
  test('lee los literales', () => {
    expect(candidateHints("const p = { id: 'jkanime', name: 'JKanime' }")).toEqual({
      id: 'jkanime',
      name: 'JKanime',
    })
  })

  test('el respaldo de las constantes: así los escribe el generador de Ajustes', () => {
    expect(
      candidateHints("const ID = 'animeav1'\nconst NAME = 'AnimeAV1'\nconst p = { id: ID }"),
    ).toEqual({ id: 'animeav1', name: 'AnimeAV1' })
  })

  test('un id que no es kebab-case no se ofrece como id', () => {
    expect(candidateHints("const p = { id: 'JK Anime' }").id).toBeUndefined()
  })

  test('sin literales no hay pistas, y eso no es un error', () => {
    expect(candidateHints('export default otro')).toEqual({})
  })
})

describe('scanProviderSources: el árbol', () => {
  test('devuelve las rutas relativas con `/`, ordenadas', async () => {
    await withTree(
      {
        'zeta.ts': 'export default z',
        'src/alfa.ts': 'export default a',
        'notas.md': 'no es un proveedor',
      },
      async (root) => {
        const result = await scanProviderSources(root)

        expect(paths(result)).toEqual(['src/alfa.ts', 'zeta.ts'])
        expect(result.truncated).toBe(false)
        expect(result.ignored).toEqual([])
      },
    )
  })

  test('no ejecuta nada: un archivo que lanza al importarse se sigue ofreciendo', async () => {
    await withTree(
      { 'roto.ts': 'throw new Error("no me ejecutes")\nexport default {}' },
      async (root) => {
        const result = await scanProviderSources(root)

        expect(paths(result)).toEqual(['roto.ts'])
      },
    )
  })

  test('los archivos de prueba no son la oferta del repositorio', async () => {
    await withTree(
      {
        'bueno.ts': 'export default p',
        'bueno.test.ts': 'export default p',
        'bueno.spec.ts': 'export default p',
        'e2e/navegador.e2e.ts': 'export default p',
        'test/ayuda.ts': 'export default p',
        'tests/ayuda.ts': 'export default p',
        '__tests__/ayuda.ts': 'export default p',
        '__fixtures__/falso.ts': 'export default p',
      },
      async (root) => {
        expect(paths(await scanProviderSources(root))).toEqual(['bueno.ts'])
      },
    )
  })

  test('una declaración de tipos no es un proveedor: se lee, pero no se ejecuta', async () => {
    await withTree(
      {
        'index.ts': 'export default p',
        'index.d.ts': 'declare const p: unknown\nexport default p',
      },
      async (root) => {
        // `index.d.ts` termina en `.ts` y contiene `export default`: sin este
        // filtro se ofrece como candidato, y marcarlo sólo puede acabar en un
        // rechazo que quien lo marcó no puede entender.
        expect(paths(await scanProviderSources(root))).toEqual(['index.ts'])
      },
    )
  })

  test('los directorios de trabajo no son la oferta', async () => {
    await withTree(
      {
        'bueno.ts': 'export default p',
        'node_modules/paquete/index.ts': 'export default p',
        'dist/index.js': 'export default p',
        'build/index.js': 'export default p',
        'coverage/index.js': 'export default p',
      },
      async (root) => {
        expect(paths(await scanProviderSources(root))).toEqual(['bueno.ts'])
      },
    )
  })

  test('lo oculto no es la oferta', async () => {
    await withTree(
      {
        'bueno.ts': 'export default p',
        '.github/x.ts': 'export default p',
        '.oculto.ts': 'export default p',
      },
      async (root) => {
        expect(paths(await scanProviderSources(root))).toEqual(['bueno.ts'])
      },
    )
  })

  test('un archivo con extensión de plugin que no declara nada se enumera aparte', async () => {
    await withTree(
      { 'bueno.ts': 'export default p', 'ayuda.ts': 'export const x = 1' },
      async (root) => {
        const result = await scanProviderSources(root)

        expect(paths(result)).toEqual(['bueno.ts'])
        expect(result.ignored).toEqual(['ayuda.ts'])
      },
    )
  })

  test('las extensiones que se miran son las tres del contrato', async () => {
    await withTree(
      {
        'a.ts': 'export default p',
        'b.js': 'module.exports = p',
        'c.mjs': 'export default p',
        'd.tsx': 'export default p',
      },
      async (root) => {
        expect(paths(await scanProviderSources(root))).toEqual(['a.ts', 'b.js', 'c.mjs'])
      },
    )
  })

  test('un archivo por encima del tope de lectura se descarta, no se lee a medias', async () => {
    await withTree({ 'grande.ts': 'export default p' }, async (root) => {
      const result = await scanProviderSources(root, { maxBytesPerFile: 4 })

      expect(result.candidates).toEqual([])
      expect(result.ignored).toEqual(['grande.ts'])
    })
  })

  test('el tope de archivos se declara con `truncated`, no se aplica en silencio', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 5; i++) files[`p${i}.ts`] = 'export default p'

    await withTree(files, async (root) => {
      const result = await scanProviderSources(root, { maxFiles: 2 })

      expect(result.candidates).toHaveLength(2)
      expect(result.truncated).toBe(true)
    })
  })

  test('el tope de candidatos también se declara', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 4; i++) files[`p${i}.ts`] = 'export default p'

    await withTree(files, async (root) => {
      const result = await scanProviderSources(root, { maxCandidates: 3 })

      expect(result.candidates).toHaveLength(3)
      expect(result.truncated).toBe(true)
    })
  })

  test('sin topes alcanzados no se declara nada truncado', async () => {
    await withTree({ 'a.ts': 'export default p' }, async (root) => {
      expect((await scanProviderSources(root)).truncated).toBe(false)
    })
  })

  test('un directorio que no existe devuelve una oferta vacía, no un error', async () => {
    const result = await scanProviderSources(join(tmpdir(), 'nn-anime-no-existe-jamas-scan'))

    expect(result.candidates).toEqual([])
    expect(result.ignored).toEqual([])
    expect(result.truncated).toBe(false)
  })
})
