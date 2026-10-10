#!/usr/bin/env bun
/**
 * Arranca en paralelo el script `dev` de cada workspace que declare uno.
 *
 * Hasta que el server y la SPA lo declaren, informa y sale con 0. Así el repo
 * queda en un estado utilizable en cualquier punto del plan.
 */
import { listWorkspaces, scriptOf } from './workspaces'

const workspaces = (await listWorkspaces()).filter((w) => scriptOf(w, 'dev') !== undefined)

if (workspaces.length === 0) {
  process.stdout.write('dev: ningún workspace declara script "dev" todavía.\n')
  process.exit(0)
}

const children = workspaces.map((workspace) => ({
  name: workspace.name,
  process: Bun.spawn(['bun', 'run', 'dev'], {
    cwd: workspace.dir,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
}))

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
