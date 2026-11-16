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

/**
 * La auditoría del `Cargo.lock` (T235).
 *
 * `bun audit` mira `bun.lock` y el árbol de Rust se quedaba sin nadie que
 * leyera sus avisos. El modo de que esto vuelva a pasar no es borrar el paso y
 * ya está: es dejarlo con `continue-on-error`, o colgarlo de un `if` que lo
 * salta justo en el PR que no toca Rust —y un trabajo saltado por condición
 * cuenta como «Success»—. Las tres formas se miran aquí.
 */
describe('la auditoría del Cargo.lock en el CI', () => {
  const ACCION = /EmbarkStudios\/cargo-deny-action@[0-9a-f]{40}\b/

  /** Los trabajos que ejecutan `cargo-deny`, con su nombre y su YAML crudo. */
  function trabajosConDeny(): [string, Record<string, unknown>][] {
    const yaml: unknown = Bun.YAML.parse(readFileSync(WORKFLOW, 'utf8'))
    const trabajosYaml = (yaml as { jobs?: Record<string, Record<string, unknown>> }).jobs ?? {}

    return Object.entries(trabajosYaml).filter(([, trabajo]) =>
      ((trabajo.steps ?? []) as { uses?: string }[]).some((paso) => ACCION.test(paso.uses ?? '')),
    )
  }

  /** El trabajo que audita, o un fallo con nombre: sin él no hay nada que mirar. */
  function trabajoConDeny(): [string, Record<string, unknown>] {
    const [primero] = trabajosConDeny()
    if (!primero) throw new Error(`ningún trabajo de ${WORKFLOW} audita el Cargo.lock`)
    return primero
  }

  test('algún trabajo audita el árbol de Rust', () => {
    // Sin esto, el `Cargo.lock` de 133 KB vuelve a ser el único lockfile que
    // nadie audita, que es como estaba antes de esta tarea.
    expect(trabajosConDeny().length).toBeGreaterThan(0)
  })

  test('la auditoría corre en cada ejecución del workflow, no sólo cuando cambia Rust', () => {
    const [nombre, trabajo] = trabajoConDeny()

    // `if` o `needs` lo condicionan a lo que diga `cambios`, y una ejecución de
    // sólo documentación se quedaría sin auditar un lockfile que sigue ahí.
    expect(trabajo.if, nombre).toBeUndefined()
    expect(trabajo.needs, nombre).toBeUndefined()
  })

  test('la auditoría no va con continue-on-error: la forma sutil de apagarla', () => {
    for (const [nombre, trabajo] of trabajosConDeny()) {
      expect(trabajo['continue-on-error'] ?? false, nombre).toBe(false)

      for (const paso of (trabajo.steps ?? []) as {
        uses?: string
        'continue-on-error'?: boolean
      }[]) {
        if (!ACCION.test(paso.uses ?? '')) continue
        expect(paso['continue-on-error'] ?? false, nombre).toBe(false)
      }
    }
  })

  test('la acción va fijada por SHA y lee el manifiesto y la política del anfitrión', () => {
    const [nombre, trabajo] = trabajoConDeny()
    const paso = ((trabajo.steps ?? []) as { uses?: string; with?: Record<string, string> }[]).find(
      (candidato) => ACCION.test(candidato.uses ?? ''),
    )

    // Una etiqueta se puede mover; el SHA no. Y sin `--config`, cargo-deny
    // buscaría `deny.toml` en la raíz del repositorio y su política —con sus
    // excepciones y su lista de licencias— no se aplicaría.
    expect(paso?.with?.['manifest-path'], nombre).toBe('desktop/src-tauri/Cargo.toml')
    expect(paso?.with?.arguments ?? '', nombre).toContain('--config desktop/src-tauri/deny.toml')
  })
})
