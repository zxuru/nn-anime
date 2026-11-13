import { afterAll, describe, expect, test } from 'bun:test'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { type Contexto, decidir, main } from './git-hooks'

/**
 * El gancho, medido.
 *
 * `decidir` es la regla; la prueba de integración comprueba lo que de verdad
 * importa: que git lo ejecute antes del commit. Un gancho que no está instalado
 * —o que no es ejecutable— pasa todas las pruebas de la regla y no frena nada.
 */

const RAIZ = resolve(import.meta.dir, '..')
const BASE = `${RAIZ}/.tmp/gancho`

/**
 * git sin tuberías.
 *
 * El sandbox de escritura de este entorno no deja capturar la salida de un hijo: `Bun.spawnSync`
 * con `stdout: 'pipe'` muere con `EPERM`. Se redirige a archivos dentro de `.tmp/` y se leen
 * después, que mide lo mismo y también funciona fuera del sandbox.
 */
function ejecutar(
  args: readonly string[],
  cwd: string,
  extra: Record<string, string> = {},
): { code: number; out: string; err: string } {
  mkdirSync(`${RAIZ}/.tmp`, { recursive: true })
  const temporal = mkdtempSync(`${RAIZ}/.tmp/hook-git-`)
  const rutaOut = join(temporal, 'out')
  const rutaErr = join(temporal, 'err')
  const out = openSync(rutaOut, 'w')
  const err = openSync(rutaErr, 'w')

  try {
    const proceso = Bun.spawnSync(['git', ...args], {
      cwd,
      stdout: out,
      stderr: err,
      env: { ...process.env, ...extra },
    })

    return {
      code: proceso.exitCode,
      out: readFileSync(rutaOut, 'utf8').trim(),
      err: readFileSync(rutaErr, 'utf8').trim(),
    }
  } finally {
    closeSync(out)
    closeSync(err)
    rmSync(temporal, { recursive: true, force: true })
  }
}

function git(args: readonly string[], cwd: string): { code: number; out: string; err: string } {
  return ejecutar(args, cwd)
}

/**
 * ¿Puede git ejecutar un gancho en esta máquina?
 *
 * No es una lista de plataformas: es la cosa misma. En el sandbox de escritura de Windows, git
 * arranca el `#!/usr/bin/env bun` del gancho con el `env.exe` de MSYS, y el sandbox no le deja
 * crear su tubería de señales: el commit muere con un fatal de `env.exe` y no con el mensaje del
 * gancho. Se mide con un gancho trivial que tiene que dejar pasar el commit. Donde la respuesta es
 * verdadera —CI y cualquier Windows sin ese sandbox—, las pruebas de integración corren enteras.
 */
function puedeEjecutarGanchos(): boolean {
  const raiz = `${BASE}/capacidad`
  const repo = `${raiz}/repo`
  const ganchos = `${raiz}/ganchos`

  rmSync(raiz, { recursive: true, force: true })
  mkdirSync(repo, { recursive: true })
  mkdirSync(ganchos, { recursive: true })
  writeFileSync(`${ganchos}/pre-commit`, '#!/bin/sh\nexit 0\n')
  git(['init', '-b', 'main'], repo)
  git(['config', 'user.email', 'nn-anime@localhost'], repo)
  git(['config', 'user.name', 'nn-anime'], repo)
  git(['config', 'core.hooksPath', ganchos], repo)
  writeFileSync(`${repo}/README.md`, '# prueba\n')
  git(['add', 'README.md'], repo)

  return git(['commit', '-m', 'base'], repo).code === 0
}

/** Las de integración con git; se saltan sólo donde el gancho no puede ejecutarse. */
const testDeGancho = test.skipIf(!puedeEjecutarGanchos())

function repoConGancho(nombre: string): string {
  const repo = `${BASE}/${nombre}/repo`

  rmSync(`${BASE}/${nombre}`, { recursive: true, force: true })
  mkdirSync(repo, { recursive: true })
  git(['init', '-b', 'main'], repo)
  git(['config', 'user.email', 'nn-anime@localhost'], repo)
  git(['config', 'user.name', 'nn-anime'], repo)
  // El gancho del repositorio de verdad, apuntado desde un repositorio de prueba.
  git(['config', 'core.hooksPath', `${RAIZ}/.githooks`], repo)
  writeFileSync(`${repo}/README.md`, '# prueba\n')
  git(['add', 'README.md'], repo)
  git(['commit', '--no-verify', '-m', 'base'], repo)

  return repo
}

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
})

const base: Contexto = {
  rama: 'main',
  fusion: false,
  integrador: false,
  reclamado: true,
  archivos: [],
}

describe('decidir', () => {
  test('frena el commit directo en main', () => {
    const veredicto = decidir(base)

    expect(veredicto.permitir).toBe(false)
    expect(veredicto.motivo).toContain('abrir T60')
  })

  test('deja pasar el merge de la integración', () => {
    expect(decidir({ ...base, fusion: true }).permitir).toBe(true)
  })

  test('deja pasar al integrador con la variable puesta', () => {
    expect(decidir({ ...base, integrador: true }).permitir).toBe(true)
  })

  test('dentro de un worktree cada agente manda en su rama', () => {
    expect(decidir({ ...base, rama: 'tarea/T60' }).permitir).toBe(true)
  })

  test('nombra el archivo compartido que se está tocando', () => {
    const veredicto = decidir({ ...base, archivos: ['tasks/todo.md', 'packages/core/src/a.ts'] })

    expect(veredicto.motivo).toContain('un solo escritor')
    expect(veredicto.motivo).toContain('tasks/todo.md')
  })

  test('nombra el spec como contrato, no como archivo cualquiera', () => {
    const veredicto = decidir({ ...base, archivos: ['docs/specs/SPEC-web-ui.md'] })

    expect(veredicto.motivo).toContain('SPEC-web-ui.md')
    expect(veredicto.motivo).toContain('versión mayor')
  })

  test('avisa sin frenar cuando la rama de tarea no tiene reclamo', () => {
    const veredicto = decidir({ ...base, rama: 'tarea/T61', reclamado: false })

    expect(veredicto.permitir).toBe(true)
    expect(veredicto.aviso).toContain('Sin reclamo para T61')
  })
})

describe('el gancho instalado', () => {
  test('core.hooksPath apunta a .githooks', () => {
    expect(git(['config', 'core.hooksPath'], RAIZ).out).toBe('.githooks')
  })

  testDeGancho('git frena el commit en main y lo permite con la variable del integrador', () => {
    const repo = repoConGancho('frena')

    writeFileSync(`${repo}/cover.ts`, 'export const cover = 1\n')
    git(['add', 'cover.ts'], repo)

    const frenado = git(['commit', '-m', 'feat: la carátula (T60)'], repo)
    expect(frenado.code).not.toBe(0)
    expect(frenado.err).toContain('abrir T60')

    const proceso = ejecutar(['commit', '-m', 'feat: la carátula (T60)'], repo, {
      NN_ANIME_INTEGRADOR: '1',
    })
    expect(proceso.code).toBe(0)
  })

  testDeGancho('dentro de un worktree el commit pasa sin la variable', () => {
    const repo = repoConGancho('worktree')

    git(['worktree', 'add', `${BASE}/worktree/rama`, '-b', 'tarea/T62'], repo)
    writeFileSync(`${BASE}/worktree/rama/cover.ts`, 'export const cover = 1\n')
    git(['add', 'cover.ts'], `${BASE}/worktree/rama`)

    const commit = git(['commit', '-m', 'feat: la carátula (T62)'], `${BASE}/worktree/rama`)

    expect(commit.code).toBe(0)
  })

  test('main sale con 1 y dice por qué', () => {
    const repo = repoConGancho('salida')

    writeFileSync(`${repo}/plan.md`, 'texto\n')
    git(['add', 'plan.md'], repo)

    const original = process.cwd()
    process.chdir(repo)
    try {
      expect(main()).toBe(1)
    } finally {
      process.chdir(original)
    }
  })
})
