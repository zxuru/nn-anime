/**
 * Reglas que una migración tiene que cumplir, como funciones puras.
 *
 * Las migraciones son el único sitio del repositorio donde el esquema cambia, y
 * por eso se les exige dos cosas que no se pueden revisar a ojo en un diff de
 * SQL:
 *
 * 1. **No destruyen datos.** Un `DROP TABLE` o un `DELETE FROM` en una migración
 *    borra lo que el usuario tenía y no hay vuelta atrás desde la aplicación. Si
 *    de verdad hace falta una excepción, el archivo lo declara con
 *    `-- nn-anime: destructiva-ok: <motivo>` y el revisor lo ve en el diff. Sin
 *    la marca, la comprobación falla; con ella, queda escrito por qué.
 * 2. **No manejan transacciones.** El runner ya envuelve cada archivo en una, y
 *    un `BEGIN`/`COMMIT` dentro la anidaría o la cerraría a la mitad.
 *
 * La lógica vive aquí, pura y exportada, para que el test la mida sin tocar
 * disco y el script de CI la use sin reimplementarla. El runner comprueba el
 * control de transacciones por su cuenta: esa sí es una condición de ejecución.
 */

import { type MigrationFile, sinComentarios, transactionControl } from './runner'

/** El comentario que permite una migración destructiva, con su motivo. */
export const DESTRUCTIVE_MARKER = 'nn-anime: destructiva-ok:'

/**
 * Lo que se considera destructivo.
 *
 * `ALTER TABLE … DROP COLUMN` entra por la segunda mitad de la expresión; no se
 * consideran destructivos los `UPDATE` de relleno (la 0015 los usa para arreglar
 * datos ya escritos) ni los `CREATE … IF NOT EXISTS`.
 */
const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i,
  /\bALTER\s+TABLE\s+[\w."`[\]]+\s+DROP\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
]

export type MigrationIssueKind = 'destructiva' | 'transaccion'

export interface MigrationIssue {
  readonly file: string
  readonly version: number
  readonly kind: MigrationIssueKind
  /** La sentencia culpable, recortada para el mensaje. */
  readonly statement: string
}

/** Las sentencias destructivas de un SQL, sin los comentarios. */
export function destructiveStatements(sql: string): readonly string[] {
  const encontradas: string[] = []

  for (const sentencia of sinComentarios(sql).split(';')) {
    const limpia = sentencia.trim()
    if (limpia === '') continue

    if (DESTRUCTIVE.some((patron) => patron.test(limpia))) encontradas.push(limpia)
  }

  return encontradas
}

/** `true` si el archivo declaró, con su motivo, que su destrucción es a propósito. */
export function declaresDestructive(sql: string): boolean {
  return sql.includes(DESTRUCTIVE_MARKER)
}

/**
 * Los problemas de una migración, con el nombre del archivo delante.
 *
 * La marca de destructiva se mira en el archivo entero y no sentencia a
 * sentencia: una migración que declara el motivo es una decisión revisada, y
 * repetir el comentario en cada `DELETE` no añade nada.
 */
export function migrationIssues(migration: MigrationFile): readonly MigrationIssue[] {
  const problemas: MigrationIssue[] = []
  const destructivas = declaresDestructive(migration.sql)
    ? []
    : destructiveStatements(migration.sql)

  for (const sentencia of destructivas) {
    problemas.push({
      file: migration.file,
      version: migration.version,
      kind: 'destructiva',
      statement: sentencia.slice(0, 160),
    })
  }

  const control = transactionControl(migration.sql)
  if (control !== undefined) {
    problemas.push({
      file: migration.file,
      version: migration.version,
      kind: 'transaccion',
      statement: control.slice(0, 160),
    })
  }

  return problemas
}

/** Los problemas de un conjunto de migraciones, en orden de versión. */
export function migrationsIssues(migrations: readonly MigrationFile[]): readonly MigrationIssue[] {
  return migrations.flatMap((migration) => migrationIssues(migration))
}
