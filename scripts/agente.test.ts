import { afterAll, describe, expect, test } from 'bun:test'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  abandonar,
  abrir,
  cerrar,
  idDeTask,
  limpiar,
  nombreClaim,
  nombreRama,
  puertoDe,
  rutaWorktree,
} from './agente'

/**
 * El worktree y el reclamo, medidos sobre un repositorio de verdad.
 *
 * Los refs son la parte que no se puede comprobar leyendo el código: que
 * `update-ref` con valor antiguo vacío rechace el segundo reclamo depende del
 * comportamiento de git, no del nuestro. Por eso la prueba crea un repositorio
 * temporal y ejecuta el ciclo entero.
 */

const RAIZ = resolve(import.meta.dir, '..')
const BASE = `${RAIZ}/.tmp/agente`

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
): { code: number; out: string; err: string } {
  mkdirSync(`${RAIZ}/.tmp`, { recursive: true })
  const temporal = mkdtempSync(`${RAIZ}/.tmp/git-test-`)
  const rutaOut = join(temporal, 'out')
  const rutaErr = join(temporal, 'err')
  const out = openSync(rutaOut, 'w')
  const err = openSync(rutaErr, 'w')

  try {
    const proceso = Bun.spawnSync(['git', ...args], { cwd, stdout: out, stderr: err })

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

function correr(args: readonly string[], cwd: string): string {
  const salida = ejecutar(args, cwd)

  if (salida.code !== 0) {
    throw new Error(`git ${args.join(' ')}: ${salida.err}`)
  }

  return salida.out
}

/** `show-ref --verify` sale con 1 cuando el ref no existe; aquí eso es la respuesta. */
function existeRef(repo: string, ref: string): boolean {
  return ejecutar(['show-ref', '--verify', ref], repo).code === 0
}

/** Bajo `.tmp/agente/<nombre>/repo` para que el worktree caiga dentro de `.tmp/`. */
function repoDePrueba(nombre: string): string {
  const repo = `${BASE}/${nombre}/repo`

  rmSync(`${BASE}/${nombre}`, { recursive: true, force: true })
  mkdirSync(repo, { recursive: true })
  correr(['init', '-b', 'main'], repo)
  correr(['config', 'user.email', 'rona@localhost'], repo)
  correr(['config', 'user.name', 'rona'], repo)
  writeFileSync(`${repo}/README.md`, '# prueba\n')
  correr(['add', 'README.md'], repo)
  correr(['commit', '-m', 'base'], repo)

  return repo
}

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
})

describe('idDeTask', () => {
  test('normaliza la mayúscula y el espacio', () => {
    expect(idDeTask(' t60 ')).toBe('T60')
    expect(idDeTask('T6A')).toBe('T6a')
  })

  test('rechaza lo que no es un id', () => {
    expect(() => idDeTask('60')).toThrow()
    expect(() => idDeTask('T')).toThrow()
    expect(() => idDeTask('T60bc')).toThrow()
  })
})

describe('los nombres derivados del id', () => {
  test('la rama lleva el id tal cual', () => {
    expect(nombreRama('t26b')).toBe('tarea/T26b')
  })

  test('el worktree vive dentro del repo, en .worktrees', () => {
    expect(rutaWorktree('/home/ana/code/rona', 'T60')).toBe('/home/ana/code/rona/.worktrees/T60')
    expect(rutaWorktree('/home/ana/code/rona/', 'T60')).toBe('/home/ana/code/rona/.worktrees/T60')
  })

  test('el repositorio ignora .worktrees, así que la copia no entra en git', () => {
    expect(ejecutar(['check-ignore', '-q', '.worktrees/T60'], RAIZ).code).toBe(0)
  })

  test('el reclamo es un ref, no un archivo del árbol', () => {
    expect(nombreClaim('T60')).toBe('refs/claims/T60')
  })
})

describe('puertoDe', () => {
  test('da un puerto por task y no repite entre T6 y T6a', () => {
    expect(puertoDe('T6')).toBe(9006)
    expect(puertoDe('T6a')).toBe(9007)
    expect(puertoDe('T60')).not.toBe(puertoDe('T6'))
  })

  test('no pisa los puertos del CLI, Vite ni e2e', () => {
    for (const id of ['T1', 'T60', 'T63']) {
      expect(puertoDe(id)).toBeGreaterThan(8000)
    }
  })
})

describe('el ciclo de un agente', () => {
  // El ciclo entero son quince procesos de git: con el plazo por defecto de 5 s, en un Windows
  // con el sandbox de escritura roza el límite y la prueba muere a mitad. El plazo es para el
  // reloj de la máquina, no para el código.
  const PLAZO_MS = 30_000

  test(
    'abre worktree, integra el commit y libera el reclamo',
    () => {
      const repo = repoDePrueba('ciclo')
      const ruta = abrir('T99', repo)
      const rama = nombreRama('T99')

      expect(existsSync(`${ruta}/.git`)).toBe(true)
      expect(correr(['rev-parse', '--abbrev-ref', 'HEAD'], ruta)).toBe(rama)

      writeFileSync(`${ruta}/cover.ts`, 'export const cover = 1\n')
      correr(['add', 'cover.ts'], ruta)
      correr(['commit', '-m', 'feat: la carátula (T99)'], ruta)

      cerrar('T99', repo)

      expect(existsSync(`${ruta}`)).toBe(false)
      expect(existsSync(`${repo}/cover.ts`)).toBe(true)
      expect(existeRef(repo, nombreClaim('T99'))).toBe(false)
    },
    PLAZO_MS,
  )

  test('el segundo agente no puede reclamar el mismo task', () => {
    const repo = repoDePrueba('reclamo')

    abrir('T98', repo)

    expect(() => abrir('T98', repo)).toThrow(/ya está reclamado/)
    expect(existeRef(repo, nombreClaim('T98'))).toBe(true)
  })

  test('cerrar con cambios sin commitear no toca main', () => {
    const repo = repoDePrueba('sucio')
    const ruta = abrir('T97', repo)
    const antes = correr(['rev-parse', 'main'], repo)

    writeFileSync(`${ruta}/a-medio.ts`, 'export const a = 1\n')

    expect(() => cerrar('T97', repo)).toThrow(/sin commitear/)
    expect(correr(['rev-parse', 'main'], repo)).toBe(antes)
  })

  test('un alta fallida no deja la rama ni el reclamo, y el reintento entra', () => {
    const repo = repoDePrueba('reintento')
    const ruta = rutaWorktree(repo, 'T95')

    // Un directorio que ya existe hace fallar `worktree add` después de crear la rama.
    mkdirSync(ruta, { recursive: true })
    writeFileSync(`${ruta}/estorbo.txt`, 'algo\n')

    expect(() => abrir('T95', repo)).toThrow(/no se pudo crear el worktree/)
    expect(existeRef(repo, nombreClaim('T95'))).toBe(false)
    expect(correr(['branch', '--list', nombreRama('T95')], repo)).toBe('')

    rmSync(ruta, { recursive: true, force: true })

    expect(existsSync(abrir('T95', repo))).toBe(true)
  })

  test('abandonar exige confirmación y con ella deja el reclamo libre', () => {
    const repo = repoDePrueba('abandono')
    const ruta = abrir('T96', repo)

    expect(() => abandonar('T96', false, repo)).toThrow(/--si/)
    expect(existsSync(ruta)).toBe(true)

    abandonar('T96', true, repo)

    expect(existsSync(ruta)).toBe(false)
    expect(correr(['branch', '--list', nombreRama('T96')], repo)).toBe('')
  })
})

/**
 * Podar los restos.
 *
 * Un resto es un directorio de `.worktrees/` que git no tiene registrado: la sesión que
 * lo usó terminó y nadie lo podó. Lo que no se puede perder es lo que está sin integrar
 * o sin commitear, así que la prueba mide las dos cosas: que se borra lo que no tiene
 * nada dentro y que no se toca lo que sí.
 */
describe('limpiar', () => {
  const PLAZO_MS = 30_000

  /** Un directorio suelto en `.worktrees/`: git no lo tiene registrado. */
  function resto(repo: string, id: string): string {
    const ruta = rutaWorktree(repo, id)
    mkdirSync(`${ruta}/node_modules`, { recursive: true })

    return ruta
  }

  test(
    'borra el directorio suelto y deja el worktree registrado',
    () => {
      const repo = repoDePrueba('limpiar')
      const registrado = abrir('T99', repo)
      const suelto = resto(repo, 'T98')
      // Su rama ya está integrada: no hay trabajo sin integrar que perder.
      correr(['branch', nombreRama('T98'), 'main'], repo)

      const resumen = limpiar(true, repo)

      expect(existsSync(suelto)).toBe(false)
      expect(existsSync(registrado)).toBe(true)
      expect(resumen.borrados).toEqual(['T98'])
      expect(resumen.conservados).toEqual([])
    },
    PLAZO_MS,
  )

  test(
    'sin --si dice qué va a borrar y no borra nada',
    () => {
      const repo = repoDePrueba('simular')
      const suelto = resto(repo, 'T97')

      const resumen = limpiar(false, repo)

      expect(existsSync(suelto)).toBe(true)
      expect(resumen.borrados).toEqual([])
      expect(
        resumen.juicios.filter((juicio) => juicio.borrar).map((juicio) => juicio.nombre),
      ).toEqual(['T97'])
    },
    PLAZO_MS,
  )

  test(
    'no borra un directorio con cambios sin commitear',
    () => {
      const repo = repoDePrueba('cambios')
      const suelto = resto(repo, 'T96')
      correr(['branch', nombreRama('T96'), 'main'], repo)
      // Un archivo que su rama no tiene: trabajo a medias, que no se tira.
      writeFileSync(`${suelto}/pendiente.ts`, 'export const pendiente = 1\n')

      const resumen = limpiar(true, repo)

      expect(existsSync(suelto)).toBe(true)
      expect(resumen.borrados).toEqual([])
      expect(resumen.conservados[0]?.cambios).toEqual(['sin versionar: pendiente.ts'])
    },
    PLAZO_MS,
  )

  test(
    'no borra una rama sin integrar',
    () => {
      const repo = repoDePrueba('sin-integrar')
      const suelto = resto(repo, 'T95')
      // Una rama con un commit que nadie ha integrado en main.
      correr(['checkout', '-b', nombreRama('T95')], repo)
      writeFileSync(`${repo}/nuevo.ts`, 'export const nuevo = 1\n')
      correr(['add', 'nuevo.ts'], repo)
      correr(['commit', '-m', 'feat: lo nuevo (T95)'], repo)
      correr(['checkout', 'main'], repo)

      const resumen = limpiar(true, repo)

      expect(existsSync(suelto)).toBe(true)
      expect(resumen.borrados).toEqual([])
      expect(resumen.conservados[0]?.motivo).toMatch(/no está integrada/)
    },
    PLAZO_MS,
  )

  test(
    'borra un worktree al que le quitaron los metadatos de git si su rama está integrada',
    () => {
      const repo = repoDePrueba('sin-metadatos')
      const ruta = abrir('T94', repo)
      writeFileSync(`${ruta}/cover.ts`, 'export const cover = 1\n')
      correr(['add', 'cover.ts'], ruta)
      correr(['commit', '-m', 'feat: la carátula (T94)'], ruta)
      correr(['merge', '--no-ff', '-m', 'merge: integrar T94 (tarea/T94)', nombreRama('T94')], repo)
      // Git deja de reconocerlo, pero el directorio con su checkout se queda.
      rmSync(`${repo}/.git/worktrees/T94`, { recursive: true, force: true })
      expect(correr(['worktree', 'list'], repo)).not.toContain('T94')

      const resumen = limpiar(true, repo)

      expect(existsSync(ruta)).toBe(false)
      expect(resumen.borrados).toEqual(['T94'])
    },
    PLAZO_MS,
  )
})
