import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from './errors'
import { MAX_PORT, MIN_PORT, readSettings } from './settings'

async function withFile<T>(
  content: string | undefined,
  body: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-ajustes-'))

  try {
    const path = join(dir, 'config.json')
    if (content !== undefined) await writeFile(path, content)
    return await body(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('readSettings', () => {
  test('sin archivo devuelve undefined, que no es un error', async () => {
    await withFile(undefined, async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBeUndefined()
    })
  })

  test('lee un archivo con todos los ajustes', async () => {
    const content = JSON.stringify({
      port: 8080,
      open: false,
      providers: ['uno', 'dos'],
      lang: 'es',
      verbose: true,
    })

    await withFile(content, async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual({
          port: 8080,
          open: false,
          providers: ['uno', 'dos'],
          lang: 'es',
          verbose: true,
        })
      }
    })
  })

  test('lee un archivo con un solo ajuste', async () => {
    await withFile('{"port": 9000}', async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toEqual({ port: 9000 })
    })
  })

  test('recorta los espacios de un identificador y del idioma', async () => {
    await withFile('{"providers": ["  uno  "], "lang": " es "}', async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toEqual({ providers: ['uno'], lang: 'es' })
    })
  })

  test('rechaza un proveedor en blanco: filtrar por nada no es un ajuste válido', async () => {
    await withFile('{"providers": ["   "]}', async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('config')
    })
  })

  test('rechaza un idioma en blanco', async () => {
    await withFile('{"lang": " "}', async (path) => {
      expect((await readSettings(path)).ok).toBe(false)
    })
  })

  test('rechaza un puerto fuera de rango', async () => {
    await withFile(`{"port": ${MAX_PORT + 1}}`, async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('config')
    })
  })

  test('rechaza el puerto cero', async () => {
    await withFile('{"port": 0}', async (path) => {
      expect((await readSettings(path)).ok).toBe(false)
    })
  })

  test('acepta los límites del rango', async () => {
    for (const port of [MIN_PORT, MAX_PORT]) {
      await withFile(`{"port": ${port}}`, async (path) => {
        expect((await readSettings(path)).ok, String(port)).toBe(true)
      })
    }
  })

  test('rechaza una clave desconocida en lugar de ignorarla', async () => {
    await withFile('{"puerto": 8080}', async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.message).toContain('puerto')
    })
  })

  test('el mensaje del error se puede leer en una terminal', async () => {
    await withFile('{"puerto": 8080, "otra": 1}', async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        // Una línea por problema, sin el volcado JSON de Zod.
        expect(result.error.message).not.toContain('\n')
        expect(result.error.message).not.toContain('"code"')
      }
    })
  })

  test('rechaza un valor con el tipo cambiado', async () => {
    await withFile('{"port": "8080"}', async (path) => {
      expect((await readSettings(path)).ok).toBe(false)
    })
  })

  test('rechaza JSON inválido con un error de configuración, no con una excepción', async () => {
    await withFile('{esto no es json', async (path) => {
      const result = await readSettings(path)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(AppError)
        expect(result.error.code).toBe('config')
      }
    })
  })

  test('un directorio en lugar de un archivo no rompe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nn-anime-ajustes-'))

    try {
      const result = await readSettings(dir)

      expect(result.ok).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
