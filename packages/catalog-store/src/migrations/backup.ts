/**
 * Copias de seguridad de la base antes de migrar.
 *
 * Una migración es el único cambio de la aplicación que puede dejar los datos
 * peor de como estaban: el código se puede volver a instalar, pero una tabla
 * borrada por un `ALTER` a medias no vuelve sola. Por eso, antes de aplicar
 * migraciones pendientes se deja una copia **consistente** en `dataDir/backups`
 * y, si la migración falla, se restaura.
 *
 * Tres decisiones que no son de estilo:
 *
 * 1. **La copia se hace con `VACUUM INTO`.** Copiar el archivo con
 *    `copyFile` mientras la base está en WAL puede llevarse el `.db` sin el
 *    contenido que todavía vive en el `-wal`. `VACUUM INTO` escribe una base
 *    nueva y completa, con el mismo contenido que ve una conexión abierta.
 * 2. **Temporal + `rename`.** Un archivo de copia a medio escribir tiene el
 *    nombre de una copia buena. El `rename` en el mismo volumen es atómico: o
 *    está la copia entera o no está.
 * 3. **Se conservan las N últimas.** Una copia por arranque llenaría el disco,
 *    y la que sirve es la de la versión desde la que se viene, no la de hace un
 *    año.
 *
 * El nombre lleva la marca de tiempo y la versión del esquema, ordenables como
 * texto: así la rotación no necesita leer el contenido de cada archivo.
 */

import { Database } from 'bun:sqlite'
import {
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { StoreError } from '@nn-anime/core'

/** Cuántas copias se conservan por defecto. */
export const BACKUP_RETENTION = 5

/** Nombre del directorio de copias, dentro de `dataDir`. */
export const BACKUP_DIR_NAME = 'backups'

/**
 * Una copia: `nn-anime-backup-AAAAMMDDTHHMMSSmmmZ-vNNNN.db`.
 *
 * El formato se ordena como texto de la más vieja a la más nueva, que es lo que
 * permite rotar sin abrir ninguna. La versión va al final para leerla sin
 * analizar la fecha.
 */
const BACKUP_NAME = /^nn-anime-backup-(\d{8}T\d{9}Z)-v(\d{4,})\.db$/

/** El prefijo que se usa para el archivo temporal de una copia. */
const TEMPORARY_PREFIX = '.nn-anime-backup-'

export interface BackupFile {
  readonly path: string
  /** Versión del esquema que contenía la copia. */
  readonly version: number
  /** Marca de tiempo del nombre, como texto ordenable. */
  readonly stamp: string
}

export interface BackupOptions {
  /** Directorio de copias. Por defecto, `dataDir/backups` (junto a la base). */
  readonly dir?: string
  /** Cuántas se conservan. Por defecto, `BACKUP_RETENTION`. */
  readonly retention?: number
  /** Reloj inyectable, para probar la rotación sin esperar. */
  readonly now?: () => Date
}

export interface BackupResult {
  readonly path: string
  /** Copias que se borraron al rotar. */
  readonly removed: readonly string[]
}

/** El directorio de copias que corresponde a una base. */
export function backupDirOf(dbPath: string): string {
  return join(dirname(dbPath), BACKUP_DIR_NAME)
}

/** La marca de tiempo que va en el nombre: UTC y sin dos puntos. */
export function stampOf(date: Date): string {
  const iso = date.toISOString()
  // `2026-11-08T03:20:00.123Z` → `20261108T032000123Z`
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`
}

/** Cuatro dígitos como mínimo, para que el orden de texto siga al numérico. */
function padVersion(version: number): string {
  return String(version).padStart(4, '0')
}

/** Las copias que hay en un directorio, de la más vieja a la más nueva. */
export function listBackups(dir: string): readonly BackupFile[] {
  let nombres: string[]

  try {
    nombres = readdirSync(dir)
  } catch {
    // Sin directorio no hay copias. Que no exista todavía no es un fallo: la
    // primera migración lo crea.
    return []
  }

  const copias: BackupFile[] = []

  for (const nombre of nombres) {
    const coincidencia = BACKUP_NAME.exec(nombre)

    if (coincidencia === null) continue

    copias.push({
      path: join(dir, nombre),
      version: Number(coincidencia[2]),
      stamp: coincidencia[1] ?? '',
    })
  }

  return copias.sort((a, b) => a.stamp.localeCompare(b.stamp))
}

/** Escapa una ruta para meterla entre comillas simples de SQL. */
function sqlPath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`
}

/**
 * Fuerza a disco lo que ya se escribió, antes de renombrarlo.
 *
 * Se abre en `r+` porque en Windows `fsync` sobre un descriptor de sólo lectura
 * falla con `EPERM`; los archivos que se sincronizan aquí los acaba de crear
 * este módulo, así que son escribibles. Si aun así no se puede sincronizar, no
 * se aborta: el `rename` sigue siendo atómico y perder la copia por un `fsync`
 * que el sistema no deja hacer sería peor que no forzarlo.
 */
function syncFile(path: string): void {
  let descriptor: number | undefined

  try {
    descriptor = openSync(path, 'r+')
    fsyncSync(descriptor)
  } catch {
    // Ver el comentario: no es motivo para no dejar la copia.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Borra los temporales que dejó un cierre brusco. */
function limpiarTemporales(dir: string): void {
  let nombres: string[]

  try {
    nombres = readdirSync(dir)
  } catch {
    return
  }

  for (const nombre of nombres) {
    if (nombre.startsWith(TEMPORARY_PREFIX)) rmSync(join(dir, nombre), { force: true })
  }
}

/**
 * La versión del esquema de una base, leída sin crearla si no existe.
 *
 * `schemaVersion` del runner crea la tabla; aquí se lee una base que puede ser
 * una copia antigua, y escribirle una tabla para preguntarle la versión sería
 * modificarla.
 */
function versionOf(db: Database): number {
  const existe = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get()

  if (existe === null) return 0

  const fila = db.query('SELECT MAX(version) AS version FROM schema_version').get()

  return typeof fila === 'object' && fila !== null && 'version' in fila
    ? Number(fila.version ?? 0)
    : 0
}

/**
 * Deja una copia consistente de la base y rota las viejas.
 *
 * Devuelve la ruta de la copia y las que se borraron. Si no se puede copiar,
 * lanza: seguir con la migración sin copia es justo lo que este módulo evita.
 *
 * En `:memory:` no hay archivo que copiar y devuelve `undefined`; las pruebas
 * que migran en memoria no tienen datos que perder.
 */
export function backupDatabase(
  db: Database,
  options: BackupOptions & { readonly dbPath?: string } = {},
): BackupResult | undefined {
  const dbPath = options.dbPath ?? db.filename

  if (dbPath === ':memory:' || dbPath === '') return undefined

  const dir = options.dir ?? backupDirOf(dbPath)
  const retention = options.retention ?? BACKUP_RETENTION
  if (!Number.isInteger(retention) || retention < 1) {
    throw new StoreError({
      message: `la retención de copias tiene que ser un entero positivo: ${retention}`,
      scope: 'catalog-store',
      op: 'backupDatabase',
    })
  }

  mkdirSync(dir, { recursive: true })
  limpiarTemporales(dir)

  const ahora = (options.now ?? (() => new Date()))()
  const version = versionOf(db)
  const stamp = stampOf(ahora)
  const destino = join(dir, `nn-anime-backup-${stamp}-v${padVersion(version)}.db`)
  const temporal = join(dir, `${TEMPORARY_PREFIX}${process.pid}-${stamp}.tmp`)

  // `VACUUM INTO` no puede correr dentro de una transacción y escribe una base
  // nueva: se borra el temporal por si quedó de un intento anterior.
  rmSync(temporal, { force: true })

  try {
    db.exec(`VACUUM INTO ${sqlPath(temporal)}`)
    syncFile(temporal)
    // Un `rename` sobre un destino existente lo reemplaza en POSIX y en Windows
    // moderno; el nombre lleva milisegundos, así que dos copias iguales serían
    // el mismo instante y quedarse con una es lo correcto.
    renameSync(temporal, destino)
  } catch (cause) {
    rmSync(temporal, { force: true })

    throw new StoreError({
      message: `no se pudo copiar la base antes de migrar: ${cause instanceof Error ? cause.message : String(cause)}`,
      scope: 'catalog-store',
      op: 'backupDatabase',
      cause,
    })
  }

  const removidas: string[] = []
  const copias = listBackups(dir)

  for (const copia of copias.slice(0, Math.max(copias.length - retention, 0))) {
    try {
      rmSync(copia.path, { force: true })
      removidas.push(copia.path)
    } catch {
      // No poder borrar una copia vieja no puede tumbar el arranque: la copia
      // nueva ya está hecha y el disco, como mucho, guarda una más.
    }
  }

  return { path: destino, removed: removidas }
}

/**
 * Restaura una copia sobre la base, de forma atómica.
 *
 * El orden importa. Los `-wal` y `-shm` de la base actual se borran **antes**
 * del reemplazo: si sobrevive un WAL de la base fallida, SQLite lo aplicaría
 * sobre la copia restaurada y volvería a dejar el esquema roto. La copia se
 * lleva a un temporal y se renombra encima: nunca hay un instante en el que el
 * archivo de la base esté a medias.
 *
 * Quien llama tiene que haber cerrado la conexión: reemplazar el archivo que
 * SQLite tiene abierto no es algo que se pueda hacer con garantías.
 */
export function restoreBackup(dbPath: string, backupPath: string): void {
  const temporal = `${dbPath}.restore-${process.pid}.tmp`

  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  rmSync(temporal, { force: true })

  try {
    copyFileSync(backupPath, temporal)
    syncFile(temporal)
    renameSync(temporal, dbPath)
  } catch (cause) {
    rmSync(temporal, { force: true })

    throw new StoreError({
      message: `no se pudo restaurar la copia ${backupPath} en ${dbPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      scope: 'catalog-store',
      op: 'restoreBackup',
      cause,
    })
  }
}

export interface VerifiedDatabase {
  /** `true` si `PRAGMA integrity_check` dice `ok`. */
  readonly ok: boolean
  /** Versión del esquema de la copia. */
  readonly version: number
}

/**
 * Abre una base en sólo lectura y comprueba que sirve.
 *
 * La restauración no se da por buena porque el `rename` no haya lanzado: se
 * abre la copia y se pregunta. Un archivo que existe pero no es una base válida
 * es peor que no tener copia, porque parece que la hay.
 */
export function verifyDatabase(path: string): VerifiedDatabase {
  const db = new Database(path, { readonly: true })

  try {
    const integridad = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()

    return { ok: integridad?.integrity_check === 'ok', version: versionOf(db) }
  } finally {
    db.close()
  }
}
