#!/usr/bin/env bun
/**
 * Comprobación de que todo cambio de esquema va con su migración.
 *
 * La regla del repositorio —«todo cambio de esquema requiere migración y test de
 * migración»— no se sostiene con buena voluntad: se sostiene con un archivo que
 * fija qué migraciones existen y qué contiene cada una. A partir de ahí:
 *
 * - Si alguien **edita** una migración ya publicada, su huella deja de cuadrar.
 *   Ese es el fallo que más caro sale: las instalaciones que ya la aplicaron no
 *   vuelven a ejecutarla, así que su base y la de un clon nuevo divergen sin que
 *   nada avise. El cambio tiene que ser una migración **nueva**.
 * - Si alguien **añade** una migración y no actualiza el bloqueo, la
 *   comprobación falla hasta que la registre con `--actualizar`: el archivo
 *   entra en revisión y en el diff, no por la puerta de atrás.
 * - Si alguien escribe `CREATE TABLE` o `ALTER TABLE` en el código de un
 *   repositorio —la otra forma de cambiar el esquema sin migración—, aparece
 *   aquí. Es una búsqueda determinista, no una interpretación.
 *
 * Uso:
 *   bun run scripts/migraciones.ts              comprueba (lo que corre el CI)
 *   bun run scripts/migraciones.ts --actualizar registra las migraciones actuales
 *
 * La lógica pura es lo que prueban `scripts/migraciones.test.ts` y
 * `packages/catalog-store/src/migrations/policy.test.ts`; el CLI sólo lee el
 * disco y escribe el bloqueo.
 */

import type { Dirent } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { migrationsIssues } from '@nn-anime/catalog-store'
import { ROOT } from './workspaces'

/** Dónde viven las migraciones y el bloqueo. */
export const MIGRACIONES_DIR = join(ROOT, 'packages', 'catalog-store', 'src', 'migrations')
export const BLOQUEO = join(ROOT, 'packages', 'catalog-store', 'migrations.lock.json')

/** El nombre de una migración, igual que en el runner. */
export const NOMBRE_MIGRACION = /^(\d{4})-([a-z0-9-]+)\.sql$/

/** Lo que se considera una declaración de esquema dentro del código. */
const DECLARACION_DE_ESQUEMA = /\b(CREATE\s+(TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE)\b/i

export interface MigracionEnDisco {
  readonly nombre: string
  readonly sql: string
}

export interface BloqueoMigraciones {
  readonly version: number
  readonly archivos: Readonly<Record<string, string>>
}

export type TipoProblema =
  | 'sin-bloqueo'
  | 'hueco'
  | 'bloqueada-editada'
  | 'bloqueada-ausente'
  | 'sin-registrar'
  | 'version'
  | 'esquema-en-codigo'
  | 'destructiva'
  | 'transaccion'

export interface Problema {
  readonly tipo: TipoProblema
  readonly detalle: string
}

/** El hash de una migración, con prefijo para que el formato no se confunda. */
export function huella(sql: string): string {
  return `sha256:${new Bun.CryptoHasher('sha256').update(sql).digest('hex')}`
}

/** Las versiones de un conjunto de nombres, ordenadas. */
export function versionesDe(nombres: readonly string[]): readonly number[] {
  return nombres
    .map((nombre) => NOMBRE_MIGRACION.exec(nombre)?.[1])
    .filter((version): version is string => version !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
}

/**
 * Los problemas de las migraciones frente al bloqueo.
 *
 * `codigo` son los archivos de producción donde no debería haber ninguna
 * declaración de esquema. La función no lee nada: recibe el contenido ya leído.
 */
export function revisarMigraciones(
  actuales: readonly MigracionEnDisco[],
  bloqueo: BloqueoMigraciones | undefined,
  codigo: readonly { readonly archivo: string; readonly texto: string }[] = [],
): readonly Problema[] {
  const problemas: Problema[] = []
  const ordenadas = [...actuales].sort((a, b) => a.nombre.localeCompare(b.nombre))
  const versiones = versionesDe(ordenadas.map((migracion) => migracion.nombre))

  // 1. La numeración tiene que ser 1..N sin huecos, igual que exige el runner.
  for (const [indice, version] of versiones.entries()) {
    if (version !== indice + 1) {
      problemas.push({
        tipo: 'hueco',
        detalle: `las versiones tienen que ser 1, 2, 3…; la posición ${indice + 1} es la ${String(version)}`,
      })
      break
    }
  }

  // 2. Sin bloqueo no hay nada que comparar: es el caso de una copia nueva del
  //    repositorio sin el archivo, y no puede pasar como si estuviera bien.
  if (bloqueo === undefined) {
    problemas.push({
      tipo: 'sin-bloqueo',
      detalle: 'falta migrations.lock.json; regístralo con --actualizar y commitéalo',
    })

    return problemas
  }

  const porNombre = new Map(ordenadas.map((migracion) => [migracion.nombre, migracion]))

  // 3. Una migración registrada no se puede editar ni borrar.
  for (const [nombre, hash] of Object.entries(bloqueo.archivos).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const migracion = porNombre.get(nombre)

    if (migracion === undefined) {
      problemas.push({
        tipo: 'bloqueada-ausente',
        detalle: `${nombre} está en el bloqueo y ya no existe; no se borra una migración publicada`,
      })
      continue
    }

    if (huella(migracion.sql) !== hash) {
      problemas.push({
        tipo: 'bloqueada-editada',
        detalle: `${nombre} cambió después de publicarse; el cambio de esquema tiene que ir en una migración nueva`,
      })
    }
  }

  // 4. Una migración nueva tiene que estar registrada, para que su contenido
  //    quede revisado y congelado como las anteriores.
  for (const migracion of ordenadas) {
    if (!(migracion.nombre in bloqueo.archivos)) {
      problemas.push({
        tipo: 'sin-registrar',
        detalle: `${migracion.nombre} no está en el bloqueo; ejecuta --actualizar y commitea el resultado`,
      })
    }
  }

  // 5. La versión del bloqueo es la última migración. Si no cuadra, alguien
  //    tocó una de las dos partes y no la otra.
  const versionActual = versiones.length === 0 ? 0 : (versiones[versiones.length - 1] ?? 0)
  if (bloqueo.version !== versionActual) {
    problemas.push({
      tipo: 'version',
      detalle: `el bloqueo dice la versión ${bloqueo.version} y las migraciones llegan a la ${versionActual}`,
    })
  }

  // 6. El esquema no se declara en el código: sólo en las migraciones.
  for (const archivo of [...codigo].sort((a, b) => a.archivo.localeCompare(b.archivo))) {
    for (const [indice, linea] of archivo.texto.split(/\r?\n/).entries()) {
      if (DECLARACION_DE_ESQUEMA.test(linea)) {
        problemas.push({
          tipo: 'esquema-en-codigo',
          detalle: `${archivo.archivo}:${indice + 1} declara esquema fuera de una migración`,
        })
      }
    }
  }

  // 7. Las reglas de forma de `catalog-store`: nada destructivo sin declararlo y
  //    nada de transacciones dentro de un archivo.
  for (const problema of migrationsIssues(
    ordenadas.map((migracion, indice) => ({
      version: indice + 1,
      name: migracion.nombre,
      file: migracion.nombre,
      sql: migracion.sql,
    })),
  )) {
    problemas.push({
      tipo: problema.kind === 'destructiva' ? 'destructiva' : 'transaccion',
      detalle: `${problema.file}: ${problema.statement}`,
    })
  }

  return problemas
}

/** El bloqueo que corresponde a unas migraciones. */
export function bloqueoDe(actuales: readonly MigracionEnDisco[]): BloqueoMigraciones {
  const ordenadas = [...actuales].sort((a, b) => a.nombre.localeCompare(b.nombre))
  const archivos: Record<string, string> = {}

  for (const migracion of ordenadas) {
    if (NOMBRE_MIGRACION.test(migracion.nombre)) archivos[migracion.nombre] = huella(migracion.sql)
  }

  const versiones = versionesDe(Object.keys(archivos))

  return {
    version: versiones.length === 0 ? 0 : (versiones[versiones.length - 1] ?? 0),
    archivos,
  }
}

/** El JSON del bloqueo, estable: mismas claves, mismo orden, mismas sangrías. */
export function serializarBloqueo(bloqueo: BloqueoMigraciones): string {
  const archivos: Record<string, string> = {}

  for (const nombre of Object.keys(bloqueo.archivos).sort()) {
    const hash = bloqueo.archivos[nombre]
    if (hash !== undefined) archivos[nombre] = hash
  }

  return `${JSON.stringify({ version: bloqueo.version, archivos }, null, 2)}\n`
}

/** Lee las migraciones de un directorio, ordenadas por nombre. */
export async function leerMigraciones(dir: string): Promise<readonly MigracionEnDisco[]> {
  const nombres = (await readdir(dir)).filter((nombre) => NOMBRE_MIGRACION.test(nombre)).sort()
  const migraciones: MigracionEnDisco[] = []

  for (const nombre of nombres) {
    migraciones.push({ nombre, sql: await readFile(join(dir, nombre), 'utf8') })
  }

  return migraciones
}

/**
 * Los archivos de producción donde hay código, para buscar declaraciones de
 * esquema. Quedan fuera las pruebas, las migraciones y `node_modules`.
 */
export async function leerCodigo(
  raiz: string = ROOT,
): Promise<readonly { readonly archivo: string; readonly texto: string }[]> {
  const archivos: { archivo: string; texto: string }[] = []
  const paquetes = join(raiz, 'packages')

  async function recorrer(dir: string, relativo: string): Promise<void> {
    let entradas: Dirent[]

    try {
      entradas = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entrada of entradas) {
      const nombre = entrada.name
      const camino = join(dir, nombre)
      const rel = posix.join(relativo, nombre)

      if (entrada.isDirectory()) {
        if (nombre === 'node_modules' || nombre === 'dist' || nombre === 'migrations') continue
        await recorrer(camino, rel)
        continue
      }

      // Las pruebas montan bases y migraciones de mentira a propósito: no son
      // el esquema de la aplicación, y señalarlas sería ruido que enseña a
      // ignorar el aviso. El e2e de persistencia escribe una migración 0016 de
      // prueba en un directorio inyectado; tampoco es el esquema real.
      if (!nombre.endsWith('.ts') && !nombre.endsWith('.tsx')) continue
      if (nombre.endsWith('.test.ts') || nombre.endsWith('.test.tsx')) continue
      if (nombre.endsWith('.e2e.ts')) continue

      archivos.push({ archivo: rel, texto: await readFile(camino, 'utf8') })
    }
  }

  await recorrer(join(paquetes), 'packages')

  return archivos.sort((a, b) => a.archivo.localeCompare(b.archivo))
}

/** La comprobación completa, con disco y bloqueo. */
export async function comprobar(raiz: string = ROOT): Promise<readonly Problema[]> {
  const dir = join(raiz, 'packages', 'catalog-store', 'src', 'migrations')
  const rutaBloqueo = join(raiz, 'packages', 'catalog-store', 'migrations.lock.json')
  const actuales = await leerMigraciones(dir)
  const bloqueo = existsSync(rutaBloqueo)
    ? (JSON.parse(await readFile(rutaBloqueo, 'utf8')) as BloqueoMigraciones)
    : undefined

  return revisarMigraciones(actuales, bloqueo, await leerCodigo(raiz))
}

if (import.meta.main) {
  const actualizar = Bun.argv.slice(2).includes('--actualizar')

  if (actualizar) {
    const migraciones = await leerMigraciones(MIGRACIONES_DIR)
    const problemas = revisarMigraciones(migraciones, bloqueoDe(migraciones))

    // Sin bloqueo todavía no se puede comparar: `revisarMigraciones` devuelve
    // ese problema a propósito, y aquí se ignora porque lo estamos creando.
    const sinBloqueo = problemas.filter((problema) => problema.tipo !== 'sin-bloqueo')
    if (sinBloqueo.length > 0) {
      for (const problema of sinBloqueo) process.stderr.write(`migraciones: ${problema.detalle}\n`)
      process.exitCode = 1
    } else {
      await mkdir(dirname(BLOQUEO), { recursive: true })
      await writeFile(BLOQUEO, serializarBloqueo(bloqueoDe(migraciones)))
      process.stdout.write(`migraciones: bloqueo actualizado con ${migraciones.length} archivos\n`)
    }
  } else {
    const problemas = await comprobar()

    if (problemas.length === 0) {
      process.stdout.write('migraciones: el esquema y las migraciones cuadran\n')
    } else {
      for (const problema of problemas) {
        process.stderr.write(`migraciones: ${problema.detalle}\n`)
      }
      process.stderr.write(
        'migraciones: todo cambio de esquema requiere una migración nueva y su test\n',
      )
      process.exitCode = 1
    }
  }
}
