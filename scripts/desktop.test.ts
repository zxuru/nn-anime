#!/usr/bin/env bun
/**
 * Las guardas del módulo `desktop`.
 *
 * El anfitrión de ventana vive en `desktop/`, **fuera de `packages/`**, y eso es
 * una decisión con tres consecuencias que se deshacen solas si nadie las vigila:
 *
 * 1. `bun run lint` recorre el repositorio entero. El árbol de Rust trae JSON
 *    generado que biome no debe reformatear, así que tiene que estar fuera de su
 *    alcance; si alguien quita esa exclusión, el listón se pone rojo en el sitio
 *    equivocado.
 * 2. Lo que compila `cargo` no se versiona, pero `Cargo.lock` sí: sin él la
 *    release no es reproducible.
 * 3. El contrato vive en `docs/specs/SPEC-desktop.md`, y la propuesta de la que
 *    salió (`proposals/SPEC-desktop.T135.md`) se borra al integrarla. Dos copias
 *    del mismo contrato acaban diciendo cosas distintas, que es justo lo que el
 *    Checkpoint H decidió no volver a permitir.
 *
 * Nada de esto lo mira `tsc` ni lo ve una prueba de producto: son archivos de
 * configuración y de documentación. Por eso se comprueban aquí.
 */

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { ROOT } from './workspaces'

const SPEC = join(ROOT, 'docs', 'specs', 'SPEC-desktop.md')
const PROPUESTA = join(ROOT, 'docs', 'specs', 'proposals', 'SPEC-desktop.T135.md')
const MAPA = join(ROOT, 'docs', 'specs', 'CAPABILITY-MAP.md')
const BIOME = join(ROOT, 'biome.json')
const GITIGNORE = join(ROOT, '.gitignore')
const STUB = join(ROOT, 'desktop', 'stub', 'index.html')

async function leer(ruta: string): Promise<string> {
  return await Bun.file(ruta).text()
}

describe('el contrato del módulo desktop', () => {
  test('el spec existe y la propuesta que lo originó ya no', async () => {
    const spec = await leer(SPEC)

    expect(spec).toContain('Module id: `desktop`')
    // El *Never* que corrige la propuesta: la salida del hijo no se escribe a
    // disco porque lleva el token de arranque.
    expect(spec).toContain('no la escribe en disco')
    expect(await Bun.file(PROPUESTA).exists()).toBe(false)
  })

  test('el mapa de capacidades lista el módulo y su árbol', async () => {
    const mapa = await leer(MAPA)

    expect(mapa).toContain('| `desktop` |')
    // Fuera de `packages/`, que es lo que mantiene verdes a `workspaces.test.ts`
    // (nueve paquetes) y a `tsconfig.json` (sólo mira `packages/*/src`).
    expect(mapa).toContain('fuera de `packages/`')
  })

  test('el árbol de Rust queda fuera del alcance de biome', async () => {
    const biome = JSON.parse(await leer(BIOME)) as {
      files?: { includes?: readonly string[] }
    }

    expect(biome.files?.includes ?? []).toContain('!desktop/**')
  })

  test('lo que compila cargo no se versiona, y el lock sí', async () => {
    const ignore = await leer(GITIGNORE)

    expect(ignore).toContain('desktop/src-tauri/target/')
    expect(ignore).toContain('desktop/src-tauri/gen/')

    // Se miran los **patrones**, no el texto: el comentario de arriba nombra
    // `Cargo.lock` para decir que sí se versiona, y una comprobación por
    // subcadena se leería a sí misma y fallaría por su propia nota.
    const patrones = ignore
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter((linea) => linea !== '' && !linea.startsWith('#'))

    expect(patrones.some((patron) => patron.endsWith('Cargo.lock'))).toBe(false)
  })

  test('el relleno de `tauri build` existe y no se llama `dist`', async () => {
    // `dist/` está ignorado en cualquier nivel del repositorio: un relleno con ese
    // nombre no llegaría al control de versiones y el `tauri build` del CI
    // fallaría por un archivo que existe en la máquina de quien lo escribió.
    expect(await Bun.file(STUB).exists()).toBe(true)
    expect(await Bun.file(join(ROOT, 'desktop', 'dist')).exists()).toBe(false)
  })
})
