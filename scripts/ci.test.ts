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
 * Los workflows, leídos enteros.
 *
 * `ci.yml` se miraba desde la tarea de la puerta de cobertura; `release.yml` y
 * `release-please.yml` no se parseaban en ningún sitio, así que un YAML roto o una
 * comprobación borrada se descubría el día de la release. Aquí se leen los tres con
 * `Bun.YAML.parse` y se defienden las tres puertas que no pueden desaparecer sin que
 * alguien lo note: el tag contra `package.json`, la versión de `latest.json` contra los
 * assets y el commit contra `main` antes de recibir un secreto de firma.
 */

const WORKFLOWS = join(ROOT, '.github', 'workflows')

interface PasoWorkflow {
  readonly name?: string
  readonly id?: string
  readonly run?: string
  readonly uses?: string
  readonly with?: Readonly<Record<string, unknown>>
}

interface TrabajoWorkflow {
  readonly steps?: readonly PasoWorkflow[]
  readonly environment?: unknown
  readonly if?: string
}

interface Workflow {
  readonly on?: Readonly<Record<string, unknown>>
  readonly env?: Readonly<Record<string, string>>
  readonly jobs?: Readonly<Record<string, TrabajoWorkflow>>
}

function workflow(nombre: string): Workflow {
  const yaml: unknown = Bun.YAML.parse(readFileSync(join(WORKFLOWS, nombre), 'utf8'))

  if (typeof yaml !== 'object' || yaml === null) {
    throw new Error(`${nombre} no contiene un workflow`)
  }

  return yaml as Workflow
}

function trabajosDe(nombre: string): ReadonlyMap<string, TrabajoWorkflow> {
  return new Map(Object.entries(workflow(nombre).jobs ?? {}))
}

/** Todo lo que ejecutan los pasos de un trabajo, unido: el orden no importa para estas pruebas. */
function guionDe(nombre: string, trabajo: string): string {
  return (trabajosDe(nombre).get(trabajo)?.steps ?? []).map((paso) => paso.run ?? '').join('\n')
}

describe('los tres workflows', () => {
  test('se parsean y cada trabajo declara sus pasos', () => {
    for (const archivo of ['ci.yml', 'release.yml', 'release-please.yml']) {
      const trabajos = trabajosDe(archivo)

      expect(trabajos.size, archivo).toBeGreaterThan(0)

      for (const [nombre, trabajo] of trabajos) {
        // Un YAML que no carga deja el workflow en «workflow file issue» y no corre nada: se ve
        // en GitHub, no en un `bun test`. Parsearlo aquí es lo que lo convierte en un fallo local.
        expect(Array.isArray(trabajo.steps), `${archivo}:${nombre}`).toBe(true)
      }
    }
  })

  test('la rama manual deriva la versión de package.json y valida el tag', () => {
    const guion = guionDe('release.yml', 'comprobar')

    // La entrada libre de `workflow_dispatch` ya no elige la versión: sale del `package.json`.
    expect(guion).toContain('version="$(bun run scripts/version.ts current)"')
    expect(guion).not.toContain('version="${ENTRADA:-')

    // Y se comprueba el tag entero, no sólo la versión: si `version:check` pierde la uve, el tag
    // podría no coincidir con el binario.
    expect(guion).toContain('bun run version:check "v$version"')
  })

  test('latest.json anuncia la versión y el asset que se publica', () => {
    const guion = guionDe('release.yml', 'publicar')

    // Sin esto, el manifiesto podía decir otra versión o apuntar a un `.exe` de otro tag: el
    // updater anuncia una actualización que da 404.
    expect(guion).toContain('version_manifiesto')
    expect(guion).toContain('basename_portable')
    expect(guion).toContain('grep -Fxq "$basename_portable"')
  })

  test('un tag fuera de main no recibe los secretos de firma', () => {
    const guion = guionDe('release.yml', 'comprobar')

    // El push de tag no pasa por el CI de la rama. La comprobación de ancestro es la que impide
    // que un tag creado desde una rama suelta llegue a `portables` con el certificado dentro.
    expect(guion).toContain('git fetch --no-tags origin main')
    expect(guion).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main')
  })

  test('los trabajos que leen secretos de firma pasan por el entorno release', () => {
    const SECRETO = /(WINDOWS_CERT_|APPLE_|TAURI_SIGNING_)/
    const conSecretos = [...trabajosDe('release.yml')].filter(([, trabajo]) =>
      SECRETO.test(JSON.stringify(trabajo)),
    )

    expect(conSecretos.length).toBeGreaterThan(0)

    for (const [nombre, trabajo] of conSecretos) {
      // `environment: release` con revisores es la segunda puerta: sin él, cualquier tag recibe
      // el certificado de Windows, el de Apple y la clave del updater sin que nadie lo apruebe.
      expect(trabajo.environment, nombre).toBe('release')
    }
  })

  test('Bun se instala desde una sola versión por workflow', () => {
    // Estaba escrito tres veces en `release.yml`: dos trabajos podían compilar el mismo tag con
    // versiones distintas del gestor, que es justo lo que `bun.lock` no puede garantizar.
    expect(workflow('release.yml').env?.BUN_VERSION).toBe(workflow('ci.yml').env?.BUN_VERSION)
    expect(readFileSync(join(WORKFLOWS, 'release.yml'), 'utf8')).not.toMatch(/bun-version:\s*\d/)
  })

  test('las acciones de terceros van fijadas por SHA', () => {
    for (const archivo of ['ci.yml', 'release.yml', 'release-please.yml']) {
      const texto = readFileSync(join(WORKFLOWS, archivo), 'utf8')
      const usos = [...texto.matchAll(/^\s*(?:- )?uses:\s*(\S+)(?:\s+#.*)?$/gm)].map(
        (match) => match[1] ?? '',
      )

      expect(usos.length, archivo).toBeGreaterThan(0)

      for (const uso of usos) {
        // Una acción local (`./.github/…`) no se puede mover: no lleva SHA. Una de terceros sí,
        // y una etiqueta movida ejecuta lo que quiera con el token del workflow.
        if (uso.startsWith('./')) continue
        expect(uso, `${archivo}: ${uso}`).toMatch(/@[0-9a-f]{40}$/)
      }
    }
  })
})

/**
 * La imagen arm64 y el alias `latest` (R6).
 *
 * Las dos cosas se declaraban pendientes en el propio workflow: arm64 se construía sin arrancarla
 * —una dependencia nativa rota o un `USER` inexistente sólo se ve al ejecutarla— y `latest` se movía
 * con cualquier tag, también con una `-rc.1`. Lo que se defiende aquí es que el CI arranque las dos
 * arquitecturas y que la etiqueta móvil dependa de si la versión es un prerelease.
 */
describe('la imagen arm64 y el alias latest (R6)', () => {
  const pasosDocker = (workflowName: string, trabajo: string) =>
    trabajosDe(workflowName).get(trabajo)?.steps ?? []

  test('el CI construye y carga una imagen por arquitectura', () => {
    const builds = pasosDocker('ci.yml', 'docker').filter((paso) =>
      (paso.uses ?? '').startsWith('docker/build-push-action@'),
    )
    const plataformas = builds.map((paso) => paso.with?.platforms)

    // Sin una imagen cargada no hay nada que arrancar: `load` es la mitad del criterio.
    expect(plataformas).toContain('linux/amd64')
    expect(plataformas).toContain('linux/arm64')
    for (const build of builds) expect(build.with?.load).toBe(true)
  })

  test('QEMU está antes de los builds y el smoke arranca las dos', () => {
    const pasos = pasosDocker('ci.yml', 'docker')
    const usos = pasos.map((paso) => paso.uses ?? '')
    const qemu = usos.findIndex((uso) => uso.startsWith('docker/setup-qemu-action@'))
    const primerBuild = usos.findIndex((uso) => uso.startsWith('docker/build-push-action@'))

    // Sin QEMU, `docker run --platform linux/arm64` no puede ejecutar el binario.
    expect(qemu).toBeGreaterThanOrEqual(0)
    expect(qemu).toBeLessThan(primerBuild)

    const guion = pasos.map((paso) => paso.run ?? '').join('\n')
    expect(guion).toContain('--platform "$plataforma"')
    expect(guion).toContain('linux/arm64')
    expect(guion).toContain('rona:ci-arm64')
  })

  test('comprobar marca el prerelease y calcula las etiquetas de la imagen', () => {
    const guion = guionDe('release.yml', 'comprobar')

    expect(guion).toContain('prerelease=true')
    expect(guion).toContain('prerelease=false')
    expect(guion).toContain('docker_tags')
    expect(guion).toContain('ghcr.io/zxuru/rona:latest')
  })

  test('la imagen usa las etiquetas calculadas, no una lista fija con latest', () => {
    const build = pasosDocker('release.yml', 'docker').find((paso) =>
      (paso.uses ?? '').startsWith('docker/build-push-action@'),
    )

    expect(build?.with?.tags).toContain('needs.comprobar.outputs.docker_tags')
  })

  test('la release marca el prerelease y make_latest depende de ella', () => {
    const guion = guionDe('release.yml', 'publicar')

    expect(guion).toContain('PRERELEASE')
    expect(guion).toContain('make_latest=false')
    expect(guion).toContain('make_latest=true')
    // El valor fijo es justo lo que movía «latest» con una prerelease.
    expect(guion).not.toContain('-F make_latest=true')
  })
})

/**
 * El reloj semanal (R8).
 *
 * Sin `schedule`, `bun audit` y `cargo-deny` sólo corrían cuando alguien abría un PR: un aviso
 * sobre el `Cargo.lock` o el `bun.lock` que ya están en `main` podía esperar meses. Lo que se
 * defiende aquí es que el reloj exista **y** que no arrastre media CI: `cambios` sin base
 * comparable asumiría que cambió todo.
 */
describe('el reloj del CI', () => {
  test('hay un schedule semanal', () => {
    const schedule = workflow('ci.yml').on?.schedule
    const primero = Array.isArray(schedule) ? schedule[0] : undefined
    const cron =
      typeof primero === 'object' && primero !== null && 'cron' in primero
        ? primero.cron
        : undefined

    expect(typeof cron).toBe('string')
    expect(cron).toMatch(/^\d+ \d+ \* \* \d+$/)
  })

  test('la corrida programada no arrastra los trabajos caros', () => {
    // `calidad` y `auditoria-rust` no dependen de `cambios` y corren solos. El resto cuelga de
    // `cambios`, que se salta: sin este `if`, cada lunes se construiría Docker, e2e y Tauri.
    expect(trabajosDe('ci.yml').get('cambios')?.if).toContain('schedule')
    expect(trabajosDe('ci.yml').get('calidad')?.if).toBeUndefined()
    expect(trabajosDe('ci.yml').get('auditoria-rust')?.if).toBeUndefined()
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
