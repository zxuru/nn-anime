import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Frontera entre la interfaz y `core`.
 *
 * El barril de `@nn-anime/core` reexporta `config.ts` y `settings.ts`, que leen
 * el sistema de archivos. Importarlo desde un componente no falla en los tests
 * —Bun sí tiene `node:fs`— pero **rompe el build del navegador**, y el error que
 * da habla de `isAbsolute` y de un módulo externo, no de la línea que lo causó.
 *
 * Ocurrió al escribir la página de búsqueda, así que esto lo convierte en un
 * fallo de test con el archivo delante.
 */

const ROOT = fileURLToPath(new URL('.', import.meta.url))

async function sourceFiles(): Promise<readonly string[]> {
  const found: string[] = []

  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(ROOT, relative), { withFileTypes: true })) {
      const path = `${relative}${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') await walk(`${path}/`)
        continue
      }
      if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) found.push(path)
    }
  }

  await walk('./')

  return found.sort()
}

describe('importaciones de la interfaz', () => {
  test('ningún archivo importa el barril de core: sólo sus subrutas', async () => {
    const files = await sourceFiles()
    expect(files.length).toBeGreaterThan(5)

    for (const file of files) {
      const text = await Bun.file(join(ROOT, file)).text()
      expect(text, `${file} importa el barril de @nn-anime/core`).not.toMatch(
        /from '@nn-anime\/core'/,
      )
    }
  })

  test('las subrutas que se usan existen en el manifiesto de core', async () => {
    const manifest = (await Bun.file(
      fileURLToPath(new URL('../../core/package.json', import.meta.url)),
    ).json()) as { exports?: Record<string, string> }
    const declaradas = Object.keys(manifest.exports ?? {})

    for (const file of await sourceFiles()) {
      const text = await Bun.file(join(ROOT, file)).text()
      for (const match of text.matchAll(/from '@nn-anime\/core\/([a-z-]+)'/g)) {
        const subruta = `./${match[1]}`
        expect(declaradas, `${file} usa ${subruta}`).toContain(subruta)
      }
    }
  })
})
