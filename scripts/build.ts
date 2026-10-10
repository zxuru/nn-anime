#!/usr/bin/env bun
/**
 * Construye los workspaces que declaren script `build`.
 *
 * Se ejecuta en serie y se detiene en el primer fallo: un build roto no debe
 * dejar artefactos a medias de los paquetes siguientes.
 */
import { listWorkspaces, scriptOf } from './workspaces'

const workspaces = (await listWorkspaces()).filter((w) => scriptOf(w, 'build') !== undefined)

if (workspaces.length === 0) {
  process.stdout.write('build: ningún workspace declara script "build" todavía.\n')
  process.exit(0)
}

for (const workspace of workspaces) {
  process.stdout.write(`build: ${workspace.name}\n`)

  const child = Bun.spawn(['bun', 'run', 'build'], {
    cwd: workspace.dir,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const code = await child.exited
  if (code !== 0) {
    process.stderr.write(`build: ${workspace.name} falló con código ${code}\n`)
    process.exit(code)
  }
}
