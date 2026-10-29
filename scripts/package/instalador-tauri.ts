#!/usr/bin/env bun
/**
 * El instalador de Windows, con el NSIS de `tauri-bundler`.
 *
 * Desde T189 el instalador **no** se escribe a mano: `packaging/windows/nn-anime.nsi`
 * ya no existe y el que se publica lo genera Tauri a partir de `tauri.conf.json`.
 * No es un cambio cosmético: sólo `tauri-bundler` produce el `.sig` del instalador
 * y el `latest.json` que el updater necesita para actualizar de verdad.
 *
 * Uso:
 *   bun run desktop:installer            # instalador sin artefactos del updater
 *   bun run desktop:installer --updater  # con .sig y latest.json (necesita la clave)
 *
 * `createUpdaterArtifacts` **falla** si no está `TAURI_SIGNING_PRIVATE_KEY`, y un
 * push normal no tiene el secreto. Por eso se apaga salvo que se pida con
 * `--updater`: el CI compila el instalador igual, y la release es la única que
 * firma.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../workspaces'
import { run } from './desktop'

const DESKTOP = join(ROOT, 'desktop')
const CLI = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.exe' : 'tauri')

if (!existsSync(CLI)) {
  throw new Error('falta el CLI de Tauri en node_modules/.bin: ejecuta `bun install`')
}

const conUpdater = Bun.argv.includes('--updater')

// La ventana de actualizaciones viaja dentro de `frontendDist` y `tauri build` la
// embebe al compilar: sin este paso, el instalador llevaría una ventana en blanco.
process.stdout.write('construyendo la ventana de actualizaciones…\n')
await run([process.execPath, 'run', 'desktop:ui'])

const config = conUpdater
  ? undefined
  : JSON.stringify({ bundle: { createUpdaterArtifacts: false } })

process.stdout.write('armando el instalador NSIS con tauri-bundler…\n')
await run(
  [CLI, 'build', '--bundles', 'nsis', ...(config === undefined ? [] : ['--config', config])],
  {
    // `tauri build` compila desde `desktop/`, que es donde está `src-tauri`.
    cwd: DESKTOP,
    // El servidor se embebe al compilar el anfitrión: si falta, el `.exe` saldría
    // sin interfaz. `build.rs` se para con esta variable en vez de generar un
    // anfitrión vacío.
    env: { ...process.env, NN_ANIME_EXIGIR_SERVIDOR: '1' },
  },
)
