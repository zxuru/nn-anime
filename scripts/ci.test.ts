import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './workspaces'

/**
 * La puerta de cobertura, en el CI.
 *
 * `scripts/coverage-gate.ts` sale con 1 cuando un paquete baja de su umbral, y
 * ese código no se ejecutaba nunca: el objetivo era una aspiración que nadie
 * miraba. La puerta se puso en el workflow, y el modo de desactivarla sin borrar
 * nada —ponla con `continue-on-error`, o quítale el `bun test` que la mide— es
 * lo que estas pruebas miran.
 *
 * Miden **el archivo del workflow**, no una copia: el fallo tiene que saltar en
 * el `bun test` de todos, no sólo en el CI.
 */

const WORKFLOW = join(ROOT, '.github/workflows/ci.yml')

interface Paso {
  readonly name?: string
  readonly run?: string
  readonly 'continue-on-error'?: boolean
}

interface Trabajo {
  readonly steps?: readonly Paso[]
  readonly 'continue-on-error'?: boolean
}

/** Un paso del YAML: sólo los campos que se miran. */
function esPaso(valor: unknown): valor is Paso {
  return typeof valor === 'object' && valor !== null
}

/** Un trabajo del YAML: sólo los campos que se miran. */
function esTrabajo(valor: unknown): valor is Trabajo {
  return typeof valor === 'object' && valor !== null
}

/** Los trabajos del workflow, con sus pasos. */
function trabajos(): Map<string, readonly Paso[]> {
  const yaml: unknown = Bun.YAML.parse(readFileSync(WORKFLOW, 'utf8'))
  const trabajosYaml = (yaml as { jobs?: unknown }).jobs

  if (typeof trabajosYaml !== 'object' || trabajosYaml === null) {
    throw new Error('el workflow no tiene jobs')
  }

  const salida = new Map<string, readonly Paso[]>()

  for (const [nombre, valor] of Object.entries(trabajosYaml)) {
    if (!esTrabajo(valor)) continue
    const pasos = (valor.steps ?? []).filter(esPaso)
    salida.set(nombre, pasos)
  }

  return salida
}

/**
 * Los pasos que **ejecutan** la puerta de cobertura.
 *
 * El patrón es el comando, no la palabra: el workflow trae además un paso que
 * **comprueba** que la puerta siga ahí, y ese paso menciona `coverage-gate` en
 * su texto sin ejecutarla. Contarlo como una ejecución haría que la puerta
 * pareciera estar en el workflow con el paso de comprobación borrado.
 */
function pasosConPuerta(pasos: readonly Paso[]): readonly Paso[] {
  return pasos.filter((paso) =>
    /bun run (coverage:gate|scripts\/coverage-gate\.ts)/.test(paso.run ?? ''),
  )
}

describe('la puerta de cobertura en el CI', () => {
  test('algún trabajo llama a la puerta de cobertura', () => {
    const conPuerta = [...trabajos().entries()].filter(
      ([, pasos]) => pasosConPuerta(pasos).length > 0,
    )

    // Sin esto, la cobertura puede bajar a cero sin que nadie se entere: es
    // exactamente lo que pasó antes de que esta tarea existiera.
    expect(conPuerta.length).toBeGreaterThan(0)
  })

  test('la puerta se llama una sola vez en su trabajo, para no medir dos veces', () => {
    for (const [nombre, pasos] of trabajos()) {
      const conPuerta = pasosConPuerta(pasos)
      expect(conPuerta.length, nombre).toBeLessThanOrEqual(1)
    }
  })

  test('la puerta no va con continue-on-error: la forma sutil de desactivarla', () => {
    for (const [nombre, pasos] of trabajos()) {
      for (const paso of pasosConPuerta(pasos)) {
        // `continue-on-error` en el paso o en el trabajo deja la puerta como un
        // aviso: el job se pone verde aunque la cobertura no llegue.
        expect(paso['continue-on-error'] ?? false, nombre).toBe(false)
      }
    }
  })

  test('el trabajo de calidad no corre la suite aparte de la puerta', () => {
    const pasos = trabajos().get('calidad') ?? []

    // La puerta lanza su propio `bun test --coverage` y lee el LCOV que produce:
    // no hay forma de darle el resultado de un `bun test` ya hecho. Correr la
    // suite otra vez sería medir dos veces para obtener lo mismo.
    const sueltas = pasos.filter((paso) => /^\s*bun test\s*$/m.test(paso.run ?? ''))

    expect(sueltas.length).toBe(0)
  })
})
