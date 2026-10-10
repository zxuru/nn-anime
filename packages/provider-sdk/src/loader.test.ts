import { describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProviders, PLUGIN_EXTENSIONS, pluginNames } from './loader'

const FIXTURES = join(import.meta.dir, '__fixtures__')

/**
 * Un directorio de plugins de verdad, con los fixtures que pida la prueba.
 *
 * Se copian a un directorio temporal en vez de leerlos en su sitio: así el
 * orden alfabético y la mezcla de casos los controla la prueba, y ningún test
 * depende de lo que haya en el repositorio.
 */
async function withPlugins<T>(
  names: readonly string[],
  body: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'nn-anime-plugins-'))

  try {
    for (const name of names) {
      await copyFile(join(FIXTURES, name), join(directory, name))
    }
    return await body(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function ids(report: Awaited<ReturnType<typeof loadProviders>>): readonly string[] {
  return report.active.map((entry) => entry.provider.id)
}

function reasons(report: Awaited<ReturnType<typeof loadProviders>>): string {
  return report.rejected.map((entry) => entry.reason.message).join(' | ')
}

describe('carga de plugins', () => {
  test('carga un plugin válido y lo reporta como activo', async () => {
    await withPlugins(['bueno.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(ids(report)).toEqual(['bueno'])
      expect(report.rejected).toEqual([])
      expect(report.active[0]?.file).toBe(join(directory, 'bueno.ts'))
      expect(report.directoryError).toBeUndefined()
    })
  })

  test('un archivo con `providers` aporta varios', async () => {
    await withPlugins(['varios.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(ids(report)).toEqual(['agrupado-uno', 'agrupado-dos'])
    })
  })

  test('escanea en orden alfabético, y por eso el duplicado pierde', async () => {
    await withPlugins(['varios.ts', 'duplicado.ts', 'bueno.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(ids(report)).toEqual(['bueno', 'agrupado-uno', 'agrupado-dos'])
      expect(report.rejected).toHaveLength(1)
      expect(reasons(report)).toContain('duplicado.ts')
    })
  })

  test('el duplicado no desplaza al primero aunque llegue antes en el nombre', async () => {
    await withPlugins(['duplicado.ts', 'bueno.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      // `bueno.ts` va antes alfabéticamente, así que gana él aunque el otro se
      // llame distinto.
      expect(report.active[0]?.provider.name).toBe('Proveedor bueno')
    })
  })
})

describe('aislamiento de fallos', () => {
  test('un plugin que lanza al importarse se omite y los demás cargan', async () => {
    await withPlugins(['bueno.ts', 'roto.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(ids(report)).toEqual(['bueno'])
      expect(report.rejected).toHaveLength(1)
      expect(reasons(report)).toContain('se rompe al cargarse')
      expect(reasons(report)).toContain('roto.ts')
    })
  })

  test('un plugin de otra versión se rechaza nombrando la esperada', async () => {
    await withPlugins(['invalido.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(report.active).toEqual([])
      expect(reasons(report)).toContain("'2'")
      expect(reasons(report)).toContain("'1'")
    })
  })

  test('exportar `default` y `providers` a la vez se rechaza nombrando el archivo', async () => {
    await withPlugins(['ambos.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(report.active).toEqual([])
      expect(reasons(report)).toContain('ambos.ts')
      expect(reasons(report)).toContain('`default` y `providers`')
    })
  })

  test('un archivo sin export reconocible se rechaza con ese motivo', async () => {
    await withPlugins(['sin-export.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(reasons(report)).toContain('no exporta ni `default` ni `providers`')
    })
  })

  test('`providers` que no es una lista se rechaza con ese motivo', async () => {
    await withPlugins(['lista-rota.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(reasons(report)).toContain('no es una lista')
    })
  })

  test('un directorio con uno bueno, uno roto y uno inválido da 1 activo y 2 rechazos', async () => {
    await withPlugins(['bueno.ts', 'roto.ts', 'invalido.ts'], async (directory) => {
      const report = await loadProviders({ directory })

      expect(ids(report)).toEqual(['bueno'])
      expect(report.rejected).toHaveLength(2)
      for (const entry of report.rejected) {
        expect(entry.reason.message.length).toBeGreaterThan(0)
        expect(entry.reason.code).toBe('provider')
      }
    })
  })
})

describe('el directorio', () => {
  test('uno que no existe no es un error: es un arranque sin plugins', async () => {
    const missing = join(tmpdir(), 'nn-anime-no-existe-jamas')
    const report = await loadProviders({ directory: missing })

    expect(report.active).toEqual([])
    expect(report.rejected).toEqual([])
    expect(report.directoryError).toBeUndefined()
  })

  test('uno que no se puede leer sí se reporta, y aparte de los plugins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nn-anime-plugins-'))
    const asFile = join(directory, 'no-soy-un-directorio.ts')

    try {
      await writeFile(asFile, '// nada')
      const report = await loadProviders({ directory: asFile })

      expect(report.active).toEqual([])
      expect(report.directoryError).toBeDefined()
      expect(report.directoryError?.message).toContain(asFile)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('sólo se miran las extensiones del contrato', async () => {
    await withPlugins(['bueno.ts'], async (directory) => {
      await writeFile(join(directory, 'notas.txt'), 'esto no es un plugin')
      await writeFile(join(directory, 'plugin.tsx'), 'export default {}')
      await mkdir(join(directory, 'otro'), { recursive: true })
      await copyFile(join(FIXTURES, 'bueno.ts'), join(directory, 'otro', 'anidado.ts'))

      const report = await loadProviders({ directory })

      expect(ids(report)).toEqual(['bueno'])
      // Sin este `toEqual([])`, la prueba pasaría aunque el loader intentara
      // cargar `notas.txt` y `plugin.tsx`: fallarían y el activo seguiría siendo
      // el mismo. Lo que se comprueba es que **no se intentó**.
      expect(report.rejected).toEqual([])
    })
  })

  test('las extensiones escaneadas son las tres del contrato', () => {
    expect(PLUGIN_EXTENSIONS).toEqual(['.ts', '.js', '.mjs'])
  })

  test('los nombres se filtran por extensión y se ordenan', () => {
    const names = ['zeta.ts', 'alfa.ts', 'notas.txt', 'plugin.tsx', 'beta.mjs', 'orden.js']

    expect(pluginNames(names)).toEqual(['alfa.ts', 'beta.mjs', 'orden.js', 'zeta.ts'])
  })

  test('se lee el directorio que se pasa, no el del usuario', async () => {
    // Si el loader tuviera un directorio por defecto, éste aparecería.
    const ajeno = await mkdtemp(join(tmpdir(), 'nn-anime-xdg-'))
    await copyFile(join(FIXTURES, 'bueno.ts'), join(ajeno, 'bueno.ts'))

    try {
      await withPlugins(['varios.ts'], async (directory) => {
        const previous = process.env.XDG_CONFIG_HOME
        process.env.XDG_CONFIG_HOME = ajeno

        try {
          const report = await loadProviders({ directory })

          expect(ids(report)).toEqual(['agrupado-uno', 'agrupado-dos'])
        } finally {
          if (previous === undefined) delete process.env.XDG_CONFIG_HOME
          else process.env.XDG_CONFIG_HOME = previous
        }
      })
    } finally {
      await rm(ajeno, { recursive: true, force: true })
    }
  })
})

describe('importación inyectada', () => {
  test('un import que lanza se reporta como rechazo, no se traga', async () => {
    await withPlugins(['bueno.ts'], async (directory) => {
      const report = await loadProviders({
        directory,
        importModule: () => Promise.reject(new Error('no existe el módulo')),
      })

      expect(report.active).toEqual([])
      expect(report.rejected).toHaveLength(1)
      expect(reasons(report)).toContain('no existe el módulo')
    })
  })

  test('el módulo inyectado puede declarar un plugin válido', async () => {
    await withPlugins(['bueno.ts'], async (directory) => {
      const report = await loadProviders({
        directory,
        importModule: async () => ({
          default: {
            id: 'inyectado',
            name: 'Inyectado',
            apiVersion: '1',
            capabilities: { search: true, sub: true, dub: false, trending: false },
            search: async () => [],
            getAnime: async () => ({
              ref: { providerId: 'inyectado', value: 'a' },
              title: 'A',
              genres: [],
              studios: [],
            }),
            getEpisodes: async () => [],
            resolveStream: async () => [],
          },
        }),
      })

      expect(ids(report)).toEqual(['inyectado'])
    })
  })
})
