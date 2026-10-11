#!/usr/bin/env bun
/**
 * El listón, en el camino del commit.
 *
 * `AGENTS.md` y la skill se leen: dependen de que el agente los lea. Este gancho no se lee, se
 * ejecuta. Frena el commit directo en `main`, que es el gesto que mezcla el trabajo de dos
 * sesiones y hace desaparecer la mitad de `tasks/todo.md`.
 *
 * El integrador tiene salida con `NN_ANIME_INTEGRADOR=1`, y `cerrar` pasa porque el merge lleva
 * `MERGE_HEAD`. Un `--no-verify` sigue existiendo: un gancho es un aviso que se ejecuta, no una
 * cárcel.
 */

/** La misma rama que integra `scripts/agente.ts`. */
export const RAMA_BASE = 'main'

/** Los que AGENTS.md reserva al integrador: dos escritores los pisan sin dejar rastro. */
export const COMPARTIDOS: readonly string[] = [
  'tasks/todo.md',
  'tasks/plan.md',
  'tasks/discovery.md',
]

const SPEC = /^docs\/specs\/SPEC-.*\.md$/
const RAMA_DE_TAREA = /^tarea\/(.+)$/

export interface Contexto {
  readonly rama: string
  readonly fusion: boolean
  readonly integrador: boolean
  /** Existe `refs/claims/<tarea>` para la rama de este worktree. */
  readonly reclamado: boolean
  readonly archivos: readonly string[]
}

export interface Veredicto {
  readonly permitir: boolean
  readonly motivo: string
  /** Aviso que no frena nada: se imprime y el commit sigue. */
  readonly aviso?: string
}

export function decidir(contexto: Contexto): Veredicto {
  const tarea = RAMA_DE_TAREA.exec(contexto.rama)?.[1]

  // Sin reclamo, otro agente puede estar a punto de abrir el mismo task: se avisa, no se frena,
  // porque el worktree ya está creado y negarse aquí no devuelve nada.
  const aviso =
    tarea !== undefined && !contexto.reclamado
      ? `Sin reclamo para ${tarea}. Ábrelo con: bun run scripts/agente.ts abrir ${tarea}`
      : undefined

  if (contexto.rama !== RAMA_BASE) {
    return { permitir: true, motivo: '', aviso }
  }

  if (contexto.fusion || contexto.integrador) {
    return { permitir: true, motivo: '' }
  }

  const specs = contexto.archivos.filter((archivo) => SPEC.test(archivo))
  const compartidos = contexto.archivos.filter((archivo) => COMPARTIDOS.includes(archivo))
  const pistas = [
    specs.length > 0
      ? `Tocas el contrato de un módulo (${specs.join(', ')}): es evento de versión mayor y lo aprueba su dueño.`
      : '',
    compartidos.length > 0
      ? `Tocas un archivo de un solo escritor (${compartidos.join(', ')}): eso lo escribe el integrador.`
      : '',
  ].filter((pista) => pista !== '')

  return {
    permitir: false,
    motivo: [
      `Commit directo en ${RAMA_BASE}, con agentes trabajando en paralelo.`,
      '',
      'Abre tu worktree antes de escribir:',
      '  bun run scripts/agente.ts abrir T60',
      '',
      ...pistas.flatMap((pista) => [pista, '']),
      'Si esto es tuyo como integrador (fragmento de cierre, plan, merge):',
      `  NN_ANIME_INTEGRADOR=1 git commit …`,
      '',
      'Para saltarte el gancho, y decirlo en el mensaje:',
      '  git commit --no-verify …',
    ].join('\n'),
  }
}

export function git(args: readonly string[], cwd: string): string {
  const proceso = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })

  return proceso.exitCode === 0 ? proceso.stdout.toString().trim() : ''
}

function contexto(cwd: string): Contexto {
  const rama = git(['symbolic-ref', '--short', 'HEAD'], cwd)
  const tarea = RAMA_DE_TAREA.exec(rama)?.[1]

  return {
    rama,
    // `MERGE_HEAD` sólo existe a mitad de un merge: es la firma inequívoca de la integración.
    fusion: git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd) !== '',
    integrador: process.env.NN_ANIME_INTEGRADOR === '1',
    reclamado:
      tarea !== undefined && git(['show-ref', '--verify', `refs/claims/${tarea}`], cwd) !== '',
    archivos: git(['diff', '--cached', '--name-only'], cwd)
      .split('\n')
      .filter((linea) => linea !== ''),
  }
}

export function main(cwd: string = process.cwd()): number {
  const veredicto = decidir(contexto(cwd))

  if (!veredicto.permitir) {
    console.error(veredicto.motivo)
    return 1
  }

  if (veredicto.aviso !== undefined) console.error(veredicto.aviso)

  return 0
}

if (import.meta.main) {
  process.exitCode = main()
}
