import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

function git(args: readonly string[], cwd: string): { code: number; out: string; err: string } {
  const proceso = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })

  return {
    code: proceso.exitCode,
    out: proceso.stdout.toString().trim(),
    err: proceso.stderr.toString().trim(),
  }
}

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

  test('git frena el commit en main y lo permite con la variable del integrador', () => {
    const repo = repoConGancho('frena')

    writeFileSync(`${repo}/cover.ts`, 'export const cover = 1\n')
    git(['add', 'cover.ts'], repo)

    const frenado = git(['commit', '-m', 'feat: la carátula (T60)'], repo)
    expect(frenado.code).not.toBe(0)
    expect(frenado.err).toContain('abrir T60')

    const proceso = Bun.spawnSync(['git', 'commit', '-m', 'feat: la carátula (T60)'], {
      cwd: repo,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NN_ANIME_INTEGRADOR: '1' },
    })
    expect(proceso.exitCode).toBe(0)
  })

  test('dentro de un worktree el commit pasa sin la variable', () => {
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
