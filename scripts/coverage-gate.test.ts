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
import { basename, join } from 'node:path'
import { evaluar, type FileCoverage, porcentaje, reenviarSalida, UMBRALES } from './coverage-gate'
import { listWorkspaces, ROOT } from './workspaces'

/**
 * La puerta de cobertura, medida.
 *
 * El gate es el único sitio del repositorio que puede decir «esto está bien
 * cubierto», así que su propio fallo es el que nadie ve: si el umbral se ignora,
 * o se compara al revés, o el mínimo general se cuela por encima del de cada
 * paquete, la puerta sigue en verde mientras no dice nada. Por eso estas
 * pruebas lo **ejecutan** —con un LCOV de mentira, para no esperar la suite
 * entera— y miran su código de salida: 0 cuando la medición llega, 1 cuando no
 * llega, 2 cuando no se entiende lo que se ha pedido.
 */

const BASE = join(ROOT, '.tmp', 'coverage-gate-prueba')

/** La medición que la propia tabla declara: cada paquete en su número. */
const MEDICION: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(UMBRALES).map(([nombre, umbral]) => [nombre, umbral.medido]),
)

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
})

/**
 * Un LCOV de mentira, con la cobertura que se le pida.
 *
 * Se mide en 10 000 líneas para que el porcentaje sea el que se pide sin ruido
 * de redondeo: `web` al 65,21 % son 6 521 líneas de 10 000.
 */
function lcov(medidas: Readonly<Record<string, number>>): string {
  const registros: string[] = []

  for (const [paquete, ratio] of Object.entries(medidas)) {
    const lineas = 10_000
    const cubiertas = Math.round(ratio * lineas)

    registros.push(
      `SF:packages/${paquete}/src/medido.ts`,
      `LF:${lineas}`,
      `LH:${cubiertas}`,
      'end_of_record',
    )
  }

  return `${registros.join('\n')}\n`
}

/** El LCOV de mentira, escrito donde la puerta lo pueda leer. */
function medicion(medidas: Readonly<Record<string, number>>): string {
  mkdirSync(BASE, { recursive: true })
  const temporal = mkdtempSync(join(BASE, 'lcov-'))
  const ruta = join(temporal, 'lcov.info')

  writeFileSync(ruta, lcov(medidas))

  return ruta
}

/**
 * La puerta, ejecutada de verdad.
 *
 * La salida del hijo se captura en archivos dentro de `.tmp/`: el sandbox de
 * escritura de este entorno no deja crear tuberías (`Bun.spawnSync` con
 * `stdout: 'pipe'` muere con `EPERM`). Es lo mismo que hacen
 * `scripts/git-hooks.test.ts` y `scripts/agente.ts`.
 */
function puerta(argumentos: readonly string[]): { code: number; out: string; err: string } {
  mkdirSync(BASE, { recursive: true })
  const temporal = mkdtempSync(join(BASE, 'puerta-'))
  const rutaOut = join(temporal, 'out')
  const rutaErr = join(temporal, 'err')
  const out = openSync(rutaOut, 'w')
  const err = openSync(rutaErr, 'w')

  try {
    const proceso = Bun.spawnSync(['bun', 'scripts/coverage-gate.ts', ...argumentos], {
      cwd: ROOT,
      stdout: out,
      stderr: err,
    })

    return {
      code: proceso.exitCode,
      out: readFileSync(rutaOut, 'utf8'),
      err: readFileSync(rutaErr, 'utf8'),
    }
  } finally {
    closeSync(out)
    closeSync(err)
    rmSync(temporal, { recursive: true, force: true })
  }
}

/** La fila de un paquete en el informe de la puerta. */
function fila(informe: string, paquete: string): string {
  const linea = informe.split('\n').find((candidata) => candidata.trim().startsWith(`${paquete} `))

  expect(linea, `la puerta no dice nada de ${paquete}`).toBeDefined()

  return linea ?? ''
}

describe('los umbrales', () => {
  test('cada paquete del repositorio tiene el suyo, y no sobra ninguno', async () => {
    const paquetes = (await listWorkspaces()).map((workspace) => basename(workspace.dir))

    // Un paquete sin umbral se mide y no se mira, que es exactamente como se
    // cae sin que nadie se entere. Y un umbral de un paquete que ya no existe
    // es una promesa que nadie cumple.
    expect(Object.keys(UMBRALES).sort()).toEqual(paquetes.sort())
  })

  test('cada umbral está por debajo de la cobertura con la que se fijó', () => {
    for (const [nombre, umbral] of Object.entries(UMBRALES)) {
      expect(umbral.minimo, nombre).toBeGreaterThan(0)
      // El umbral es una línea por debajo de lo medido: si lo suben por encima,
      // la puerta empieza a pedir cosas que nadie ha medido.
      expect(umbral.minimo, nombre).toBeLessThan(umbral.medido)
    }
  })

  test('`web` tiene su propio plan de subida por pasos, y termina en el 80 % del spec', () => {
    const plan = UMBRALES.web?.plan ?? []

    expect(plan[0]).toBe(UMBRALES.web?.minimo)
    // Una escalera: cada paso por encima del anterior.
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i], `paso ${i}`).toBeGreaterThan(plan[i - 1] ?? 0)
    }
    // Y el final es la meta del spec, no un número redondo inventado.
    expect(plan[plan.length - 1]).toBe(0.8)
    // El primer paso es el que se sostiene hoy: por debajo de lo medido.
    expect(plan[0]).toBeLessThan(UMBRALES.web?.medido ?? 0)
  })
})

describe('la puerta', () => {
  test('con la medición que declara la tabla, sale con 0 y dice qué exige de cada paquete', () => {
    const resultado = puerta(['--lcov', medicion(MEDICION)])

    expect(resultado.code).toBe(0)

    // El log tiene que decir qué se pide de cada paquete, no sólo si se pasó:
    // un umbral que no se ve es un umbral que nadie puede quitar.
    for (const [nombre, umbral] of Object.entries(UMBRALES)) {
      expect(fila(resultado.out, nombre), nombre).toContain(
        `exige >= ${porcentaje(umbral.minimo)} %`,
      )
    }
  })

  test('subir el umbral de un paquete por encima de su cobertura hace fallar la puerta', () => {
    const ruta = medicion(MEDICION)

    // Antes de subirlo, la puerta pasa.
    expect(puerta(['--lcov', ruta]).code).toBe(0)

    // Subido por encima de lo medido, tiene que caer.
    const subido = puerta(['--lcov', ruta, '--umbral', 'web=0.99'])

    expect(subido.code).toBe(1)
    expect(fila(subido.out, 'web')).toContain('exige >= 99.00 %')
    expect(fila(subido.out, 'web')).toContain('POR DEBAJO')
    expect(subido.err).toContain('por debajo de su umbral')
  })

  test('un paquete por debajo de su umbral hace fallar la puerta, aunque llegue al 80 %', () => {
    // `core` al 90 %: por encima del objetivo general que el spec pedía (80 %)
    // y por debajo de su umbral propio (98 %). Si la puerta mirara el objetivo
    // general en vez del umbral del paquete, esto pasaría.
    const resultado = puerta(['--lcov', medicion({ ...MEDICION, core: 0.9 })])

    expect(resultado.code).toBe(1)
    expect(fila(resultado.out, 'core')).toContain('POR DEBAJO')
  })

  test('el objetivo general es un mínimo por encima, no un techo', () => {
    const ruta = medicion(MEDICION)

    // 0,99 no lo llega ni `web`: la puerta cae.
    expect(puerta(['--lcov', ruta, '0.99']).code).toBe(1)

    // Y uno por debajo de cada umbral no afloja nada: `web` sigue pidiendo 60 %.
    const flojo = puerta(['--lcov', ruta, '0.5'])
    expect(flojo.code).toBe(0)
    expect(fila(flojo.out, 'web')).toContain(`exige >= ${porcentaje(0.6)} %`)
  })

  test('una orden que no se entiende sale con 2, no con 1', () => {
    // 2 es «no te he entendido»; 1 es «la cobertura no llega». Confundirlos
    // haría que un error de escritura pareciera una regresión de cobertura.
    expect(puerta(['1.5']).code).toBe(2)
    expect(puerta(['--umbral', 'web=2']).code).toBe(2)
    expect(puerta(['--inventada']).code).toBe(2)
  })

  test('un paquete medido sin umbral propio no pasa', () => {
    // El número de un paquete se fija cuando se mide. Un paquete que aparece
    // sin umbral se mide solo y se aprueba solo.
    const resultado = puerta(['--lcov', medicion({ ...MEDICION, inventado: 0.99 })])

    expect(resultado.code).toBe(1)
    expect(resultado.out).toContain('SIN UMBRAL')
  })

  test('un paquete que la medición no ve tampoco pasa', () => {
    // Sin código medido no hay cobertura que comprobar, y no comprobar nada no
    // es conformidad: es no haber mirado.
    const medidas = { ...MEDICION }
    delete medidas.web

    const resultado = puerta(['--lcov', medicion(medidas)])

    expect(resultado.code).toBe(1)
    expect(resultado.out).toContain('sin código que medir')
  })
})

describe('la decisión', () => {
  const medidas = new Map<string, FileCoverage>([['web', { lines: 100, hit: 65 }]])

  test('un umbral igual a la cobertura se cumple, y uno más alto no', () => {
    const justo = evaluar(medidas, { web: { minimo: 0.65, medido: 0.65 } }, 0)
    expect(justo[0]?.ok).toBe(true)

    const subido = evaluar(medidas, { web: { minimo: 0.66, medido: 0.65 } }, 0)
    expect(subido[0]?.ok).toBe(false)
  })

  test('el mínimo general nunca afloja el umbral del paquete', () => {
    const fila = evaluar(medidas, { web: { minimo: 0.6, medido: 0.65 } }, 0.9)[0]

    expect(fila?.exigido).toBe(0.9)
    expect(fila?.ok).toBe(false)
  })
})

describe('el informe de las pruebas', () => {
  test('la salida de las pruebas va a la salida de error, que es la que enseña el log', async () => {
    const original = process.stderr.write
    const capturado: string[] = []

    process.stderr.write = ((trozo: unknown) => {
      // `process.stderr.write` recibe bytes: hay que decodificarlos para poder
      // mirar lo que se escribió.
      const texto =
        trozo instanceof Uint8Array
          ? new TextDecoder().decode(trozo)
          : new TextDecoder().decode(new TextEncoder().encode(String(trozo)))
      capturado.push(texto)

      return true
    }) as typeof process.stderr.write

    try {
      await reenviarSalida(
        new ReadableStream<Uint8Array>({
          start(control) {
            control.enqueue(new TextEncoder().encode('(fail) la prueba que falla\n'))
            control.close()
          },
        }),
      )
    } finally {
      process.stderr.write = original
    }

    // Si esto se escribiera en la salida estándar, el CI mostraría el informe de
    // un fallo en el resumen del PR y no en el log, y el job en rojo no diría por
    // qué está en rojo.
    expect(capturado.join('')).toContain('(fail) la prueba que falla')
  })
})
