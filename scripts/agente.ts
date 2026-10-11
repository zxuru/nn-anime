#!/usr/bin/env bun
/**
 * Un agente por worktree.
 *
 * Varios agentes sobre el mismo directorio comparten el índice de git y los
 * mismos archivos: dos commits a la vez se llevan el stage del otro y
 * `tasks/todo.md` pierde la mitad de las ediciones. El worktree da a cada
 * agente su árbol, su índice y su base de datos.
 *
 * El reclamo del task va en un ref porque los refs viven en el directorio común
 * del repositorio —los ven todos los worktrees— y `git update-ref` con valor
 * antiguo vacío crea el ref sólo si no existe: es un lock atómico sin remoto ni
 * proceso servidor.
 *
 * Uso:
 *   bun run scripts/agente.ts abrir T60
 *   bun run scripts/agente.ts cerrar T60
 *   bun run scripts/agente.ts abandonar T60 --si
 *   bun run scripts/agente.ts estado
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const RAIZ = resolve(dirname(Bun.fileURLToPath(import.meta.url)), '..')
const RAMA_BASE = 'main'

/** 9000 en adelante: por debajo viven el 7717 del CLI, 5173 de Vite y 7802 de e2e. */
const PUERTO_BASE = 9000

/** El id tal y como se usa en `tasks/todo.md`: `T60`, `T6a`, `T26b`. */
export function idDeTask(entrada: string): string {
  const coincidencia = /^T(\d+)([a-z]?)$/i.exec(entrada.trim())

  if (!coincidencia) {
    throw new Error(`id de task inválido: «${entrada}». Se espera T60, T6a, T26b…`)
  }

  return `T${coincidencia[1] ?? ''}${(coincidencia[2] ?? '').toLowerCase()}`
}

export function nombreRama(id: string): string {
  return `tarea/${idDeTask(id)}`
}

/**
 * Dentro del repo y en `.gitignore`: el sandbox de escritura de un agente se limita al
 * workspace, así que un directorio hermano no se puede crear. Anidado no estorba porque
 * `bun test` y biome respetan `.gitignore` (medido: la sonda de `.worktrees/` no se ejecuta).
 */
export function rutaWorktree(raiz: string, id: string): string {
  return `${raiz.replace(/\/+$/, '')}/.worktrees/${idDeTask(id)}`
}

export function nombreClaim(id: string): string {
  return `refs/claims/${idDeTask(id)}`
}

/**
 * Puerto distinto por task, derivado del id para que no dependa de un registro
 * compartido. El sufijo suma uno: `T6` y `T6a` son tasks distintas.
 */
export function puertoDe(id: string): number {
  const limpio = idDeTask(id)
  const ultimo = limpio.slice(limpio.length - 1)
  const sufijo = /[a-z]/.test(ultimo) ? ultimo.charCodeAt(0) - 96 : 0

  return PUERTO_BASE + Number.parseInt(limpio.slice(1), 10) + sufijo
}

interface Salida {
  readonly code: number
  readonly out: string
  readonly err: string
}

function git(args: readonly string[], cwd: string): Salida {
  const proceso = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })

  return {
    code: proceso.exitCode,
    out: proceso.stdout.toString().trim(),
    err: proceso.stderr.toString().trim(),
  }
}

function exigir(salida: Salida, contexto: string): string {
  if (salida.code !== 0) {
    throw new Error(`${contexto}: ${salida.err || salida.out || `código ${salida.code}`}`)
  }

  return salida.out
}

export function abrir(id: string, raiz: string = RAIZ): string {
  const limpio = idDeTask(id)
  const ruta = rutaWorktree(raiz, limpio)
  const rama = nombreRama(limpio)
  const claim = nombreClaim(limpio)
  const base = exigir(git(['rev-parse', RAMA_BASE], raiz), `no hay rama ${RAMA_BASE}`)

  const reclamo = git(['update-ref', claim, base, ''], raiz)
  if (reclamo.code !== 0) {
    throw new Error(`${limpio} ya está reclamado. Quién lo tiene: bun run scripts/agente.ts estado`)
  }

  const alta = git(['worktree', 'add', ruta, '-b', rama, RAMA_BASE], raiz)
  if (alta.code !== 0) {
    // Un alta fallida deja la rama creada a medias: sin borrarla, el reintento muere
    // con «una rama llamada tarea/T60 ya existe» y el reclamo queda en un limbo.
    git(['branch', '-D', rama], raiz)
    git(['update-ref', '-d', claim], raiz)
    throw new Error(`no se pudo crear el worktree: ${alta.err || alta.out}`)
  }

  const puerto = puertoDe(limpio)
  console.log(
    [
      `${limpio} abierto.`,
      `  Worktree  ${ruta}`,
      `  Rama      ${rama}`,
      `  Reclamo   ${claim}`,
      `  Puerto    ${puerto}`,
      `  Datos     NN_ANIME_DATA_DIR=${ruta}/.data/`,
      '',
      'Siguiente:',
      `  cd ${ruta} && bun install`,
      `  bun run start -- --port ${puerto}`,
      `  bun run scripts/agente.ts cerrar ${limpio}     # desde la raíz, al terminar`,
    ].join('\n'),
  )

  return ruta
}

export function cerrar(id: string, raiz: string = RAIZ): void {
  const limpio = idDeTask(id)
  const ruta = rutaWorktree(raiz, limpio)
  const rama = nombreRama(limpio)
  const claim = nombreClaim(limpio)

  if (!existsSync(ruta)) {
    throw new Error(`no hay worktree en ${ruta}`)
  }

  const sucio = exigir(git(['status', '--porcelain'], ruta), `no se pudo leer ${ruta}`)
  if (sucio !== '') {
    throw new Error(`quedan cambios sin commitear en ${limpio}:\n${sucio}`)
  }

  exigir(git(['rebase', RAMA_BASE], ruta), `${limpio} no se pudo rebasar sobre ${RAMA_BASE}`)

  // El merge se hace desde la raíz, que es el árbol de integración: si ahí hay
  // trabajo a medias que el merge tocaría, git lo rechaza y no se pierde nada.
  const sucioRaiz = git(['status', '--porcelain'], raiz).out
  if (sucioRaiz !== '') {
    console.log(
      `Aviso: el árbol de integración viene sucio; el merge puede rechazarse.\n${sucioRaiz}`,
    )
  }

  exigir(
    git(['merge', '--no-ff', '-m', `merge: integrar ${limpio} (${rama})`, rama], raiz),
    `${limpio} no se pudo integrar en ${RAMA_BASE}`,
  )

  exigir(git(['worktree', 'remove', ruta], raiz), `no se pudo borrar el worktree ${ruta}`)
  git(['branch', '-d', rama], raiz)
  git(['update-ref', '-d', claim], raiz)

  console.log(`${limpio} integrado en ${RAMA_BASE}; worktree, rama y reclamo borrados.`)
}

/** Destructivo: tira los commits de la rama sin integrarlos. Exige `--si`. */
export function abandonar(id: string, confirmado: boolean, raiz: string = RAIZ): void {
  const limpio = idDeTask(id)

  if (!confirmado) {
    throw new Error(
      `abandonar ${limpio} borra su worktree y su rama, con lo que no se haya integrado. Repite con --si.`,
    )
  }

  const ruta = rutaWorktree(raiz, limpio)

  git(['worktree', 'remove', '--force', ruta], raiz)
  git(['branch', '-D', nombreRama(limpio)], raiz)
  git(['update-ref', '-d', nombreClaim(limpio)], raiz)

  console.log(`${limpio} abandonado. Reclamo libre.`)
}

export function estado(raiz: string = RAIZ): void {
  const reclamos = git(['for-each-ref', '--format=%(refname)', 'refs/claims/'], raiz)
  const lineas = reclamos.out === '' ? [] : reclamos.out.split('\n')
  const arboles = git(['worktree', 'list', '--porcelain'], raiz).out

  console.log(
    `Reclamos:\n${lineas.length > 0 ? lineas.map((l) => `  ${l}`).join('\n') : '  (ninguno)'}`,
  )
  console.log(`Worktrees:\n${arboles}`)
}

function requerido(valor: string | undefined, uso: string): string {
  if (valor === undefined || valor === '') {
    throw new Error(`falta el id del task. Uso: ${uso}`)
  }

  return valor
}

const USO = [
  'Uso: bun run scripts/agente.ts <orden> <T60>',
  '',
  '  abrir <id>              crea worktree, rama y reclamo',
  '  cerrar <id>             rebasa, integra en main y limpia',
  '  abandonar <id> --si     tira la rama sin integrarla (destructivo)',
  '  estado                  reclamos abiertos y worktrees',
].join('\n')

export function main(argv: readonly string[], raiz: string = RAIZ): number {
  const [orden, id, ...resto] = argv

  try {
    switch (orden) {
      case 'abrir':
        abrir(requerido(id, 'abrir <T60>'), raiz)
        return 0
      case 'cerrar':
        cerrar(requerido(id, 'cerrar <T60>'), raiz)
        return 0
      case 'abandonar':
        abandonar(requerido(id, 'abandonar <T60> --si'), resto.includes('--si'), raiz)
        return 0
      case 'estado':
        estado(raiz)
        return 0
      default:
        console.log(USO)
        return orden === undefined || orden === '--help' || orden === '-h' ? 0 : 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.main) {
  process.exitCode = main(Bun.argv.slice(2))
}
