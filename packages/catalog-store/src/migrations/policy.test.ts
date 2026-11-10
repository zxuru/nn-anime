/**
 * Las reglas de una migración, como funciones puras.
 *
 * Se prueba la lógica y no el script de CI porque el script sólo lee archivos:
 * lo que hay que tener bien es qué cuenta como destructivo y qué no. La regla
 * del repositorio —«todo cambio de esquema requiere migración»— se apoya en
 * esto.
 */

import { describe, expect, test } from 'bun:test'
import {
  DESTRUCTIVE_MARKER,
  declaresDestructive,
  destructiveStatements,
  migrationIssues,
  migrationsIssues,
} from './policy'
import { listMigrations, sinComentarios, transactionControl } from './runner'

const REALES = listMigrations()

describe('qué es destructivo', () => {
  test('DROP, DELETE y ALTER … DROP lo son', () => {
    expect(destructiveStatements('DROP TABLE anime;')).toHaveLength(1)
    expect(destructiveStatements('DROP INDEX idx_anime;')).toHaveLength(1)
    expect(destructiveStatements('DELETE FROM watch_event WHERE id = 1;')).toHaveLength(1)
    expect(destructiveStatements('ALTER TABLE anime DROP COLUMN cover_url;')).toHaveLength(1)
    expect(destructiveStatements('TRUNCATE anime;')).toHaveLength(1)
  })

  test('crear y rellenar no lo son', () => {
    expect(destructiveStatements('CREATE TABLE nueva (id INTEGER PRIMARY KEY);')).toEqual([])
    expect(destructiveStatements('CREATE INDEX idx ON anime (title);')).toEqual([])
    expect(destructiveStatements("UPDATE download SET kind = 'segments' WHERE 1;")).toEqual([])
    expect(destructiveStatements('ALTER TABLE anime ADD COLUMN cover_url TEXT;')).toEqual([])
    expect(destructiveStatements('SELECT 1;')).toEqual([])
  })

  test('un comentario con DROP no cuenta', () => {
    expect(destructiveStatements('-- ojo: DROP TABLE anime;\nSELECT 1;')).toEqual([])
    expect(destructiveStatements('/* DELETE FROM watch_event */\nSELECT 1;')).toEqual([])
    expect(sinComentarios('-- DROP\nSELECT 1; -- DELETE')).toBe('\nSELECT 1; ')
  })

  test('la marca con motivo permite la destrucción, y se nota que está', () => {
    const sql = `-- ${DESTRUCTIVE_MARKER} se recorta una tabla que ya no se lee\nDROP TABLE vieja;`

    expect(declaresDestructive(sql)).toBe(true)
    expect(
      migrationIssues({ version: 16, name: 'recorte', file: '/m/0016-recorte.sql', sql }),
    ).toEqual([])
  })

  test('sin la marca, la migración destructiva se señala con archivo y versión', () => {
    const problemas = migrationIssues({
      version: 16,
      name: 'recorte',
      file: '/m/0016-recorte.sql',
      sql: 'DROP TABLE vieja;',
    })

    expect(problemas).toHaveLength(1)
    expect(problemas[0]).toMatchObject({
      file: '/m/0016-recorte.sql',
      version: 16,
      kind: 'destructiva',
    })
  })
})

describe('el control de transacciones', () => {
  test('se detecta en las cinco formas, y en ninguna con comentarios', () => {
    expect(transactionControl('BEGIN; CREATE TABLE x (a INTEGER);')).toContain('BEGIN')
    expect(transactionControl('CREATE TABLE x (a INTEGER); COMMIT;')).toContain('COMMIT')
    expect(transactionControl('ROLLBACK;')).toContain('ROLLBACK')
    expect(transactionControl('SAVEPOINT uno;')).toContain('SAVEPOINT')
    expect(transactionControl('-- BEGIN;\nSELECT 1;')).toBeUndefined()
    expect(transactionControl('SELECT 1;')).toBeUndefined()
  })
})

describe('las migraciones del repositorio', () => {
  test('ninguna es destructiva y las versiones son 1..N', () => {
    expect(REALES.length).toBeGreaterThanOrEqual(15)
    expect(REALES.map((migration) => migration.version)).toEqual(
      REALES.map((_, indice) => indice + 1),
    )
    expect(migrationsIssues(REALES)).toEqual([])
  })
})
