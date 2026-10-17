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
import { HOST_NAME, MANIFEST, manifestVersion, SERVER_NAME } from './package/desktop'
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

    // Biome nombra la carpeta sin comodín: `!desktop/**` lo rechaza con «use
    // `!desktop`», así que la guarda fija la forma que la herramienta acepta.
    expect(biome.files?.includes ?? []).toContain('!desktop')
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

describe('el anfitrión de ventana', () => {
  const CRATE = join(ROOT, 'desktop', 'src-tauri')

  test('el prefijo de la línea de arranque es el mismo en Rust y en TypeScript', async () => {
    // El formato vive en dos sitios por necesidad: uno lo escribe (`core`) y otro
    // lo lee (Rust). Si el prefijo se separa, el anfitrión no encuentra nunca la
    // línea y el síntoma es «no anunció su dirección», lejos de la causa.
    const enTs = /BOOT_LINE_PREFIX\s*=\s*'([^']+)'/.exec(
      await leer(join(ROOT, 'packages', 'core', 'src', 'boot-line.ts')),
    )?.[1]
    const enRust = /BOOT_LINE_PREFIX:\s*&str\s*=\s*"([^"]+)"/.exec(
      await leer(join(CRATE, 'src', 'boot_line.rs')),
    )?.[1]

    expect(enTs).toBeDefined()
    expect(enRust).toBe(enTs)
  })

  test('la versión del anfitrión es la de los package.json', async () => {
    const raiz = JSON.parse(await leer(join(ROOT, 'package.json'))) as { version: string }

    // `release-please` no sabe tocar un `Cargo.toml`: esta prueba es la que avisa
    // el día que las dos versiones se separen.
    expect(await manifestVersion()).toBe(raiz.version)
  })

  test('el anfitrión no se llama como el servidor, y Rust busca el nombre del servidor', async () => {
    const manifiesto = await leer(MANIFEST)
    const sidecar = await leer(join(CRATE, 'src', 'sidecar.rs'))

    // Los dos tienen que convivir en el mismo directorio: si se llamaran igual,
    // el instalador no podría llevar los dos.
    expect(HOST_NAME).not.toBe(SERVER_NAME)
    expect(manifiesto).toContain(`name = "${HOST_NAME}"`)
    expect(sidecar).toContain(`const SIDECAR_NAME: &str = "${SERVER_NAME}"`)
  })

  test('la ventana se crea en tiempo de ejecución y el webview no tiene permisos', async () => {
    const config = JSON.parse(await leer(join(CRATE, 'tauri.conf.json'))) as {
      build: { frontendDist: string }
      app: { windows: readonly unknown[] }
      bundle: { active: boolean }
    }

    // Sin ventanas declaradas: la URL y el tamaño los pone `main.rs`, que es quien
    // sabe en qué puerto escucha el servidor. El puerto no se puede fijar antes.
    expect(config.app.windows).toHaveLength(0)

    // Y el empaquetado de Tauri está apagado: los instaladores los sigue armando
    // `scripts/package.ts`, que es el que está probado.
    expect(config.bundle.active).toBe(false)

    const relleno = join(CRATE, config.build.frontendDist, 'index.html')
    expect(await Bun.file(relleno).exists()).toBe(true)

    const capacidades = JSON.parse(await leer(join(CRATE, 'capabilities', 'default.json'))) as {
      permissions: readonly unknown[]
    }

    // El webview carga un origen remoto: sin permisos no puede invocar ni un
    // comando, y por eso no hay superficie de IPC que auditar.
    expect(capacidades.permissions).toHaveLength(0)
  })

  test('el anfitrión de Windows no abre consola', async () => {
    // Guarda **estática**, y se dice lo que es: la medición de verdad es la
    // cabecera PE del binario, que comprueba el CI. Esto avisa antes, al editar.
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    expect(main).toContain('windows_subsystem = "windows"')
  })
})
