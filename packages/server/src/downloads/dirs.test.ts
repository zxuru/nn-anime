import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { listarCarpetas } from './dirs'

/**
 * El listado de carpetas del selector.
 *
 * Se mide con carpetas de verdad en un temporal y no con un `readdir` de mentira:
 * lo que puede romperse aquí es justo lo que hace el sistema —qué entra en la
 * lista, en qué orden y qué pasa cuando la ruta no existe—.
 */

async function conArbol<T>(body: (raiz: string) => Promise<T>): Promise<T> {
  const raiz = await mkdtemp(join(tmpdir(), 'nn-anime-dirs-'))

  try {
    return await body(raiz)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
}

function nombres(listado: { readonly dirs: readonly { readonly name: string }[] }): string[] {
  return listado.dirs.map((entrada) => entrada.name)
}

describe('el listado de carpetas', () => {
  test('lista las carpetas, no los archivos, en orden natural', async () => {
    await conArbol(async (raiz) => {
      await mkdir(join(raiz, 't10'))
      await mkdir(join(raiz, 't2'))
      await mkdir(join(raiz, 'beta'))
      await mkdir(join(raiz, 'alfa'))
      await writeFile(join(raiz, 'suelto.txt'), 'no soy una carpeta')

      const resultado = await listarCarpetas(raiz)

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) return

      // `t2` antes que `t10`: el orden es natural y no el del código de carácter.
      expect(nombres(resultado.listado)).toEqual(['alfa', 'beta', 't2', 't10'])
    })
  })

  test('cada entrada lleva su ruta completa, que es lo que se devuelve al elegir', async () => {
    await conArbol(async (raiz) => {
      await mkdir(join(raiz, 'Series'))

      const resultado = await listarCarpetas(raiz)
      if (!resultado.ok) throw new Error('debía listar')

      expect(resultado.listado.dirs[0]?.path).toBe(join(raiz, 'Series'))
      expect(resultado.listado.path).toBe(raiz)
    })
  })

  test('el padre es la carpeta de arriba y estando fuera de la raíz hay unidades que ofrecer', async () => {
    await conArbol(async (raiz) => {
      const resultado = await listarCarpetas(raiz, {
        platform: 'win32',
        unidades: async () => ['C:\\', 'D:\\'],
      })
      if (!resultado.ok) throw new Error('debía listar')

      expect(resultado.listado.parent).toBe(parse(raiz).dir)
      // Fuera de una raíz no hay a qué unidad saltar: se navega hacia arriba.
      expect(resultado.listado.volumes).toEqual([])
    })
  })

  test('en la raíz no hay padre y, en Windows, se ofrecen las unidades', async () => {
    await conArbol(async (raiz) => {
      const resultado = await listarCarpetas(parse(raiz).root, {
        limit: 1,
        platform: 'win32',
        unidades: async () => ['C:\\', 'D:\\'],
      })

      expect(resultado.ok).toBe(true)
      if (!resultado.ok) return

      expect(resultado.listado.parent).toBeNull()
      expect(resultado.listado.volumes).toEqual(['C:\\', 'D:\\'])
    })
  })

  test('fuera de Windows no se ofrecen unidades', async () => {
    await conArbol(async (raiz) => {
      const resultado = await listarCarpetas(parse(raiz).root, {
        limit: 1,
        platform: 'linux',
        unidades: async () => ['no debería llamarse'],
      })
      if (!resultado.ok) throw new Error('debía listar')

      expect(resultado.listado.volumes).toEqual([])
    })
  })

  test('el tope corta la lista', async () => {
    await conArbol(async (raiz) => {
      for (const nombre of ['uno', 'dos', 'tres']) await mkdir(join(raiz, nombre))

      const resultado = await listarCarpetas(raiz, { limit: 2 })
      if (!resultado.ok) throw new Error('debía listar')

      expect(nombres(resultado.listado)).toEqual(['dos', 'tres'])
    })
  })

  test('una ruta relativa no se lista', async () => {
    expect(await listarCarpetas('carpetas/relativas')).toEqual({
      ok: false,
      motivo: 'invalida',
      detalle: 'la carpeta tiene que ser una ruta absoluta',
    })
  })

  test('un carácter de control en la ruta no se lista', async () => {
    await conArbol(async (raiz) => {
      expect(await listarCarpetas(`${raiz}\u0007`)).toEqual({
        ok: false,
        motivo: 'invalida',
        detalle: 'la carpeta tiene que ser una ruta absoluta',
      })
    })
  })

  test('una carpeta que no existe se distingue de una que no se deja leer', async () => {
    await conArbol(async (raiz) => {
      expect(await listarCarpetas(join(raiz, 'no-existe'))).toEqual({
        ok: false,
        motivo: 'no-existe',
        detalle: 'esa carpeta no existe',
      })
    })
  })

  test('un archivo no es una carpeta que listar', async () => {
    await conArbol(async (raiz) => {
      const archivo = join(raiz, 'suelto.txt')
      await writeFile(archivo, 'texto')

      expect(await listarCarpetas(archivo)).toEqual({
        ok: false,
        motivo: 'no-existe',
        detalle: 'esa ruta no es una carpeta',
      })
    })
  })
})
