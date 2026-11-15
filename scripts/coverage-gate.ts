#!/usr/bin/env bun
/**
 * Puerta de cobertura.
 *
 * `bun test --coverage` informa, pero no falla: el objetivo del 80 % del spec
 * quedaba como aspiración y nadie lo miraba. Esto lo convierte en un comando que
 * sale con 1 cuando no se cumple.
 *
 * **Cada paquete tiene su umbral**, y no un número único para todos: `core` mide
 * casi todas sus líneas y `web` sólo dos tercios, así que un objetivo común los
 * aprobaría a los dos por lo mismo. Los umbrales van **por debajo de la cobertura
 * medida** y con el margen escrito al lado del número: uno tan ajustado que
 * cualquier línea nueva lo rompe deja de medir nada, y uno tan holgado que la
 * cobertura pueda bajar a la mitad tampoco.
 *
 * `web` es el caso aparte: el 80 % del spec es una meta lejana, no un umbral —hoy
 * mide 65 %—. El número que se pone es el que se sostiene hoy, y los pasos por
 * los que sube están escritos en `UMBRALES`, junto al resto del razonamiento.
 *
 * Además imprime **los archivos que la medición no ve**. `bun test --coverage`
 * sólo mide los archivos que algún test carga, así que un porcentaje alto puede
 * convivir con puntos de entrada sin ninguna prueba. Un número sin su alcance es
 * una afirmación más firme que la realidad, y este proyecto ya ha pagado varias.
 *
 * Uso:
 * - `bun run coverage:gate`: cada paquete con su umbral.
 * - `bun run coverage:gate <objetivo>`: además, un mínimo general por encima del
 *   umbral de cada paquete. Antes ese mínimo general era 0,8; ahora es 0, porque
 *   `web` no llega a 0,8 y el mínimo de cada paquete es el suyo.
 * - `bun run coverage:gate --lcov <ruta>`: mide un LCOV ya hecho, sin volver a
 *   correr las pruebas. Sirve para medir sin esperar la suite entera.
 * - `bun run coverage:gate --umbral <paquete>=<fracción>`: cambia el umbral de un
 *   paquete para esta ejecución. Sirve para comprobar que la puerta discrimina; el
 *   CI no lo usa.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './workspaces'

/** El umbral de un paquete: el mínimo de líneas cubiertas que se le exige. */
export interface Umbral {
  /** El mínimo, como fracción entre 0 y 1. */
  readonly minimo: number
  /** La cobertura medida el día en que se fijó ese mínimo. */
  readonly medido: number
  /** Los pasos por los que sube, cuando el paquete sube por pasos. */
  readonly plan?: readonly number[]
}

/**
 * Los umbrales, con el margen escrito al lado de cada número.
 *
 * `medido` es la cobertura que se midió el día en que se fijó `minimo`, y el
 * margen es la distancia entre las dos: por eso van juntas. Cuando la cobertura
 * sube, `minimo` sube con ella y `medido` vuelve a apuntar al número nuevo.
 */
export const UMBRALES: Readonly<Record<string, Umbral>> = {
  // `core`: medido 98,97 %. El umbral queda en 98 %, un punto por debajo. Es
  // pura lógica y casi siempre llega con su prueba, así que el margen sólo tiene
  // que cubrir la línea que se cuela sin ella.
  core: { minimo: 0.98, medido: 0.9897 },

  // `catalog-store`: medido 95,41 %. Umbral 94 %: la base y las migraciones se
  // prueban por ruta, y un archivo nuevo sin pruebas baja el porcentaje más que
  // en los demás paquetes.
  'catalog-store': { minimo: 0.94, medido: 0.9541 },

  // `recsys`: medido 99,65 %. Umbral 99 %: es el paquete con más pruebas por
  // línea, y el que menos puede permitirse retroceder. El margen es de seis
  // décimas, el más pequeño de todos: aquí una caída sí significa algo.
  recsys: { minimo: 0.99, medido: 0.9965 },

  // `provider-sdk`: medido 99,18 %. Umbral 98 %: el margen de un punto cubre un
  // proveedor nuevo que llega sin pruebas.
  'provider-sdk': { minimo: 0.98, medido: 0.9918 },

  // `providers-fixture`: medido 98,36 %. Umbral 97 %: es el generador de datos
  // de los tests, así que su cobertura no es un fin; pero una caída delata
  // algo, y por eso tiene umbral.
  'providers-fixture': { minimo: 0.97, medido: 0.9836 },

  // `media-proxy`: medido 93,20 %. Umbral 92 %: hay partes que dependen de ffmpeg
  // y de la red, y esos caminos no se prueban en local; el margen de un punto es
  // justo para eso y ni un punto más.
  'media-proxy': { minimo: 0.92, medido: 0.932 },

  // `cli`: medido 91,50 %. Umbral 88 %: el arranque y el modo empaquetado se
  // prueban de punta a punta, no línea a línea, así que el número baja solo;
  // tres puntos y medio de margen evitan que un archivo nuevo lo baje más.
  cli: { minimo: 0.88, medido: 0.915 },

  // `server`: medido 88,23 %. Umbral 85 %: es el paquete más grande y el que más
  // rutas nuevas suma; tres puntos de margen evitan que una sola ruta sin
  // prueba tumbe la puerta.
  server: { minimo: 0.85, medido: 0.8823 },

  // `web`: medido 65,21 %. **El 80 % del spec es una meta lejana, no un umbral**:
  // la interfaz tiene más de cien ficheros de código y las pruebas cubren las
  // rutas y los datos, no cada componente. El número que se sostiene hoy es 60 %,
  // con cinco puntos de margen, porque es el paquete que más cambia: una
  // pantalla nueva sin pruebas baja el porcentaje más que en ninguna otra parte.
  //
  // El plan son pasos, no un salto: 60 → 62 → 65 → 68 → 70 → 75 → 80. Cada paso
  // se sube cuando la medición lo supere **con un punto de margen**, y nunca
  // antes: subir el número por lo que debería ser midiendo otra vez es la forma
  // de que la puerta deje de decir nada.
  web: {
    minimo: 0.6,
    medido: 0.6521,
    plan: [0.6, 0.62, 0.65, 0.68, 0.7, 0.75, 0.8],
  },
}

const COVERAGE_DIR = `${ROOT}.tmp/coverage`
const LCOV = join(COVERAGE_DIR, 'lcov.info')

export interface FileCoverage {
  readonly lines: number
  readonly hit: number
}

/**
 * La ruta de un archivo del LCOV, como la guarda el repositorio.
 *
 * `bun test --coverage` escribe las rutas como las ve: con el separador de la
 * plataforma y relativas al directorio de trabajo. Sin normalizarlas, ni el
 * reparto por paquete ni la lista de archivos que nadie carga dicen nada: en
 * Windows las rutas salían con barras invertidas, el gate medía **cero** en
 * todos los paquetes y daba por no medidos todos los archivos del repositorio.
 */
function rutaRepo(path: string): string {
  const normalizada = path.replace(/\\/g, '/')
  const raiz = ROOT.replace(/\\/g, '/')
  const relativa = normalizada.startsWith(raiz) ? normalizada.slice(raiz.length + 1) : normalizada

  return relativa.replace(/^\.\//, '')
}

export function parseLcov(text: string): ReadonlyMap<string, FileCoverage> {
  const files = new Map<string, FileCoverage>()
  let path: string | undefined
  let lines = 0
  let hit = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) path = line.slice(3)
    else if (line.startsWith('LF:')) lines = Number(line.slice(3))
    else if (line.startsWith('LH:')) hit = Number(line.slice(3))
    else if (line === 'end_of_record' && path !== undefined) {
      files.set(path, { lines, hit })
      path = undefined
    }
  }

  return files
}

/** Todos los archivos de código del repositorio, sin tests ni dependencias. */
function sourceFiles(): readonly string[] {
  const found: string[] = []

  for (const dir of ['packages', 'scripts']) {
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
        const path = `${relative}/${entry.name}`
        if (entry.isDirectory()) {
          // `__fixtures__` son datos de prueba, no código: los carga un test a
          // propósito y contarlos como no medidos infla la lista hasta hacerla
          // inútil, que es lo contrario de para lo que existe.
          if (
            entry.name !== 'node_modules' &&
            entry.name !== 'dist' &&
            entry.name !== '__fixtures__'
          ) {
            walk(path)
          }
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          found.push(path)
        }
      }
    }
    walk(dir)
  }

  return found.sort()
}

/** Cuánto mide cada paquete, según la medición por líneas. */
export function medirPorPaquete(
  coverage: ReadonlyMap<string, FileCoverage>,
): ReadonlyMap<string, FileCoverage> {
  const measured = new Map<string, FileCoverage>()

  for (const [path, data] of coverage) {
    const match = /^packages\/([^/]+)\//.exec(rutaRepo(path))
    if (match?.[1] === undefined) continue

    const previous = measured.get(match[1]) ?? { lines: 0, hit: 0 }
    measured.set(match[1], { lines: previous.lines + data.lines, hit: previous.hit + data.hit })
  }

  return measured
}

/** Una fila del informe: lo medido, lo exigido y si se cumple. */
export interface Fila {
  readonly nombre: string
  readonly lineas: number
  readonly cubiertas: number
  readonly ratio: number
  /** El umbral propio del paquete, o `undefined` si no tiene. */
  readonly umbral: number | undefined
  /** Lo que se le exige: su umbral, o el mínimo general si lo hay. */
  readonly exigido: number
  readonly ok: boolean
}

/**
 * Decide, paquete por paquete, si la medición llega.
 *
 * El mínimo general se aplica **encima** del umbral de cada paquete, nunca por
 * debajo: así el número que se pide por línea de comando nunca afloja la puerta,
 * y `coverage:gate 0.99` sigue siendo una medición más estricta, no una más floja.
 */
export function evaluar(
  medidas: ReadonlyMap<string, FileCoverage>,
  umbrales: Readonly<Record<string, Umbral>>,
  general: number,
): readonly Fila[] {
  const nombres = new Set<string>([...Object.keys(umbrales), ...medidas.keys()])
  const filas: Fila[] = []

  for (const nombre of [...nombres].sort()) {
    const medida = medidas.get(nombre)
    const umbral = umbrales[nombre]?.minimo
    const exigido = Math.max(umbral ?? 0, general)
    const lineas = medida?.lines ?? 0
    const cubiertas = medida?.hit ?? 0

    if (lineas === 0) {
      // Sin código medido no hay nada que comprobar, y eso no es un paquete
      // conforme: es una medición que no vio el paquete. Pasa por la puerta
      // quien no miró, que es justo lo que la puerta tiene que impedir.
      filas.push({ nombre, lineas, cubiertas, ratio: 0, umbral, exigido, ok: false })
      continue
    }

    const ratio = cubiertas / lineas
    // Un paquete medido sin umbral propio tampoco pasa: su número se fija
    // cuando se mide, no cuando aparece.
    const ok = umbral !== undefined && ratio >= exigido

    filas.push({ nombre, lineas, cubiertas, ratio, umbral, exigido, ok })
  }

  return filas
}

/** Lo que se le pide a cada paquete en esta ejecución. */
interface Opciones {
  /** El mínimo general, por encima del umbral de cada paquete. */
  readonly general: number
  /** De dónde leer el LCOV; si no se dice, se corre la suite y se lee el suyo. */
  readonly lcov: string | undefined
  /** Los umbrales que se cambian para esta ejecución. */
  readonly ajustes: ReadonlyMap<string, number>
}

/** Un número entre 0 y 1, o `undefined` si no lo es. */
function fraccion(texto: string | undefined): number | undefined {
  if (texto === undefined) return undefined
  const valor = Number(texto)
  return Number.isFinite(valor) && valor >= 0 && valor <= 1 ? valor : undefined
}

/**
 * Lee la línea de comando.
 *
 * Los errores salen con 2, como el objetivo inválido de siempre: un 2 es «no se
 * entiende lo que has pedido», y un 1 es «la cobertura no llega». Confundirlos
 * haría que un error de escritura pareciera una regresión de cobertura.
 */
function opciones(argumentos: readonly string[]): Opciones {
  let general = 0
  let lcov: string | undefined
  const ajustes = new Map<string, number>()

  for (let i = 0; i < argumentos.length; i++) {
    const argumento = argumentos[i]
    if (argumento === undefined) continue

    if (argumento === '--lcov' || argumento === '--umbral') {
      const valor = argumentos[++i]
      if (valor === undefined) {
        process.stderr.write(`coverage:gate: ${argumento} necesita un valor\n`)
        process.exit(2)
      }

      if (argumento === '--lcov') {
        lcov = valor
        continue
      }

      const [paquete, numero] = valor.split('=')
      const proporcion = fraccion(numero)
      if (paquete === undefined || paquete === '' || proporcion === undefined) {
        process.stderr.write(`coverage:gate: umbral inválido: ${valor}\n`)
        process.exit(2)
      }

      ajustes.set(paquete, proporcion)
      continue
    }

    if (argumento.startsWith('--lcov=')) {
      lcov = argumento.slice('--lcov='.length)
      continue
    }

    if (argumento.startsWith('--umbral=')) {
      const valor = argumento.slice('--umbral='.length)
      const [paquete, numero] = valor.split('=')
      const proporcion = fraccion(numero)
      if (paquete === undefined || paquete === '' || proporcion === undefined) {
        process.stderr.write(`coverage:gate: umbral inválido: ${valor}\n`)
        process.exit(2)
      }

      ajustes.set(paquete, proporcion)
      continue
    }

    if (argumento.startsWith('-')) {
      process.stderr.write(`coverage:gate: opción desconocida: ${argumento}\n`)
      process.exit(2)
    }

    const objetivo = fraccion(argumento)
    if (objetivo === undefined) {
      process.stderr.write(`coverage:gate: objetivo inválido: ${argumento}\n`)
      process.exit(2)
    }

    general = objetivo
  }

  return { general, lcov, ajustes }
}

/** Un porcentaje con dos decimales, como el resto del repositorio los escribe. */
export function porcentaje(valor: number): string {
  return (valor * 100).toFixed(2)
}

/**
 * Pasa la salida de las pruebas a la salida de error de la puerta.
 *
 * El informe de un fallo —prueba, aserción y traza— sale por la salida estándar
 * de `bun test`, y con `stdout: 'ignore'` la puerta se lo tragaba: en el CI, un
 * job en rojo sin una sola línea de diagnóstico. Aquí se escribe en la salida de
 * error, que el log del job enseña siempre.
 */
export async function reenviarSalida(flujo: ReadableStream<Uint8Array>): Promise<void> {
  for await (const trozo of flujo) process.stderr.write(trozo)
}

async function principal(): Promise<void> {
  const { general, lcov: lcovPedido, ajustes } = opciones(Bun.argv.slice(2))

  const umbrales: Record<string, Umbral> = {}
  for (const [nombre, umbral] of Object.entries(UMBRALES)) umbrales[nombre] = umbral
  for (const [nombre, minimo] of ajustes) {
    umbrales[nombre] = { minimo, medido: umbrales[nombre]?.medido ?? minimo }
  }

  let lcov = LCOV

  if (lcovPedido === undefined) {
    const runner = Bun.spawn(
      ['bun', 'test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${COVERAGE_DIR}`],
      { cwd: ROOT, stdout: 'pipe', stderr: 'inherit' },
    )

    // La salida del `bun test` va **a la salida de error**, no a la estándar: el
    // informe de un fallo —prueba, aserción y traza— sale por ahí, y con
    // `stdout: 'ignore'` se lo tragaba la puerta. En el CI, un job en rojo sin
    // una sola línea de diagnóstico es un job que hay que volver a correr en
    // local para entender.
    await reenviarSalida(runner.stdout)

    const testCode = await runner.exited
    if (testCode !== 0) {
      process.stderr.write('coverage:gate: los tests fallaron; no se mide la cobertura\n')
      process.exit(testCode)
    }
  } else {
    lcov = lcovPedido
  }

  const coverage = parseLcov(readFileSync(lcov, 'utf8'))
  const medidas = medirPorPaquete(coverage)
  const filas = evaluar(medidas, umbrales, general)

  let failed = false

  process.stdout.write('umbrales de cobertura por paquete (líneas cubiertas)\n\n')
  if (general > 0) {
    process.stdout.write(
      `objetivo general: ${porcentaje(general)} %, por encima del umbral de cada paquete\n\n`,
    )
  }

  for (const fila of filas) {
    if (fila.lineas === 0) {
      failed = true
      process.stdout.write(
        `  ${fila.nombre.padEnd(16)} sin código que medir: la medición no lo vio\n`,
      )
      continue
    }

    if (fila.umbral === undefined) {
      failed = true
      process.stdout.write(
        `  ${fila.nombre.padEnd(16)} ${porcentaje(fila.ratio)} %  SIN UMBRAL: hay que medirlo y fijar su número\n`,
      )
      continue
    }

    if (!fila.ok) failed = true

    const margen = (fila.ratio - fila.exigido) * 100
    process.stdout.write(
      `  ${fila.nombre.padEnd(16)} ${porcentaje(fila.ratio)} %  exige >= ${porcentaje(fila.exigido)} %  margen ${margen.toFixed(2).padStart(6)}  ${fila.ok ? 'ok' : 'POR DEBAJO'}\n`,
    )
  }

  const planes = Object.entries(umbrales).filter(([, umbral]) => umbral.plan !== undefined)
  if (planes.length > 0) {
    process.stdout.write('\nplan de subida por pasos:\n')
    for (const [nombre, umbral] of planes) {
      const pasos = (umbral.plan ?? []).map(porcentaje).join(' % -> ')
      process.stdout.write(`  ${nombre.padEnd(16)} ${pasos} %\n`)
    }
  }

  const seen = new Set([...coverage.keys()].map((path) => rutaRepo(path)))
  const unseen = sourceFiles().filter((path) => !seen.has(path))

  process.stdout.write(`\narchivos de código que ningún test carga: ${unseen.length}\n`)
  for (const path of unseen) process.stdout.write(`  ${path}\n`)

  if (failed) {
    process.stderr.write('\ncoverage:gate: hay paquetes por debajo de su umbral\n')
    process.exit(1)
  }

  process.stdout.write('\ncoverage:gate: umbrales cumplidos\n')
}

if (import.meta.main) {
  await principal()
}
