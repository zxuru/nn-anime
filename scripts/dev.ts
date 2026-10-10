#!/usr/bin/env bun
/**
 * Modo desarrollo.
 *
 * Arranca dos procesos: Vite sirviendo la interfaz con recarga en caliente, y
 * el CLI con el server local. El CLI abre el navegador en el origen de Vite y su
 * proxy reenvía el canje del token de arranque al server, así que el flujo de
 * sesión es el mismo que en producción: misma cookie, mismo origen lógico,
 * mismos guards sin relajar.
 *
 * El CLI recibe el origen por `NN_ANIME_DEV_ORIGIN`. Es una comodidad de
 * arranque, no un permiso: el server sigue validando `Host` y `Origin` igual.
 */

import { ROOT } from './workspaces'

const WEB_ORIGIN = 'http://127.0.0.1:5173'
const VITE_PORT = '5173'

/** Argumentos extra para el CLI, por ejemplo `bun run dev -- --no-open`. */
const cliArgs = Bun.argv.slice(2)

const children = [
  {
    name: 'web',
    process: Bun.spawn(['bun', 'run', 'dev'], {
      cwd: `${ROOT}packages/web`,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, NN_ANIME_DEV_ORIGIN: WEB_ORIGIN },
    }),
  },
  {
    name: 'cli',
    process: Bun.spawn(
      ['bun', 'run', `${ROOT}packages/cli/src/index.ts`, '--verbose', ...cliArgs],
      {
        cwd: ROOT,
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env, NN_ANIME_DEV_ORIGIN: WEB_ORIGIN },
      },
    ),
  },
]

process.stdout.write(`dev: Vite en ${WEB_ORIGIN} (puerto ${VITE_PORT}, estricto)\n`)

function shutdown(): void {
  for (const child of children) child.process.kill('SIGTERM')
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

for (const child of children) {
  void child.process.exited.then((code) => {
    process.stdout.write(`dev: ${child.name} terminó con código ${code}\n`)
    shutdown()
    process.exit(code === 0 ? 0 : 1)
  })
}
