/**
 * La lógica del check de migraciones, probada sin tocar el repositorio.
 *
 * Lo que se mide aquí es la regla, no el script: una migración editada, una
 * nueva sin registrar, un hueco, una declaración de esquema en el código y un
 * bloqueo desactualizado se tienen que ver todos. Si alguno pasara, el CI diría
 * que el esquema cuadra cuando no cuadra.
 */

import { describe, expect, test } from 'bun:test'
import {
  type BloqueoMigraciones,
  bloqueoDe,
  huella,
  type MigracionEnDisco,
  NOMBRE_MIGRACION,
  revisarMigraciones,
  serializarBloqueo,
  versionesDe,
} from './migraciones'

const MIGRACIONES: readonly MigracionEnDisco[] = [
  { nombre: '0001-initial.sql', sql: 'CREATE TABLE anime (id INTEGER PRIMARY KEY);' },
  { nombre: '0002-cache.sql', sql: 'CREATE TABLE cache (id INTEGER PRIMARY KEY);' },
]

describe('huellas y versiones', () => {
  test('la huella es estable y distinta si el SQL cambia', () => {
    expect(huella('SELECT 1;')).toBe(huella('SELECT 1;'))
    expect(huella('SELECT 1;')).not.toBe(huella('SELECT 2;'))
    expect(huella('SELECT 1;').startsWith('sha256:')).toBe(true)
  })

  test('las versiones se sacan del nombre y se ordenan', () => {
    expect(versionesDe(['0002-b.sql', '0001-a.sql', 'notas.txt'])).toEqual([1, 2])
    expect(NOMBRE_MIGRACION.test('0001-initial.sql')).toBe(true)
    expect(NOMBRE_MIGRACION.test('0001-initial.sql.bak')).toBe(false)
  })

  test('el bloqueo guarda la versión más alta y las huellas ordenadas', () => {
    const bloqueo = bloqueoDe([...MIGRACIONES].reverse())

    expect(bloqueo.version).toBe(2)
    expect(Object.keys(bloqueo.archivos)).toEqual(['0001-initial.sql', '0002-cache.sql'])
    expect(serializarBloqueo(bloqueo)).toBe(
      `${JSON.stringify(
        {
          version: 2,
          archivos: {
            '0001-initial.sql': huella(MIGRACIONES[0]?.sql ?? ''),
            '0002-cache.sql': huella(MIGRACIONES[1]?.sql ?? ''),
          },
        },
        null,
        2,
      )}\n`,
    )
  })
})

describe('revisar las migraciones contra el bloqueo', () => {
  const bloqueo = bloqueoDe(MIGRACIONES)

  test('unas migraciones que cuadran no dan problemas', () => {
    expect(revisarMigraciones(MIGRACIONES, bloqueo)).toEqual([])
  })

  test('editar una migración publicada se detecta', () => {
    const editadas = [
      MIGRACIONES[0],
      {
        nombre: '0002-cache.sql',
        sql: 'CREATE TABLE cache (id INTEGER PRIMARY KEY, ttl INTEGER);',
      },
    ].filter((migracion): migracion is MigracionEnDisco => migracion !== undefined)

    const problemas = revisarMigraciones(editadas, bloqueo)

    expect(problemas.map((problema) => problema.tipo)).toContain('bloqueada-editada')
    expect(problemas.map((problema) => problema.detalle).join('\n')).toContain('migración nueva')
  })

  test('borrar una migración publicada se detecta', () => {
    const problemas = revisarMigraciones([MIGRACIONES[0] as MigracionEnDisco], bloqueo)

    expect(problemas.map((problema) => problema.tipo)).toContain('bloqueada-ausente')
  })

  test('una migración nueva sin registrar se detecta', () => {
    const conNueva = [...MIGRACIONES, { nombre: '0003-nueva.sql', sql: 'SELECT 1;' }]

    expect(revisarMigraciones(conNueva, bloqueo).map((problema) => problema.tipo)).toContain(
      'sin-registrar',
    )
  })

  test('un hueco en la numeración se detecta', () => {
    const conHueco = [...MIGRACIONES, { nombre: '0004-cuatro.sql', sql: 'SELECT 1;' }]

    expect(revisarMigraciones(conHueco, bloqueoDe(conHueco)).map((p) => p.tipo)).toContain('hueco')
  })

  test('un bloqueo con la versión atrasada se detecta', () => {
    const atrasado: BloqueoMigraciones = { version: 1, archivos: bloqueo.archivos }

    expect(revisarMigraciones(MIGRACIONES, atrasado).map((p) => p.tipo)).toContain('version')
  })

  test('sin bloqueo se dice, en vez de dar por bueno lo que hay', () => {
    expect(revisarMigraciones(MIGRACIONES, undefined).map((p) => p.tipo)).toContain('sin-bloqueo')
  })

  test('declarar esquema en el código se detecta', () => {
    const problemas = revisarMigraciones(MIGRACIONES, bloqueo, [
      {
        archivo: 'packages/catalog-store/src/repositories/anime.ts',
        texto: 'const sql = `CREATE TABLE anime (id INTEGER)`',
      },
      {
        archivo: 'packages/server/src/app.ts',
        texto: 'app.get("/salud", (c) => c.json({ ok: true }))',
      },
      { archivo: 'packages/catalog-store/src/repositories/otro.ts', texto: 'SELECT * FROM anime' },
    ])

    const esquema = problemas.filter((problema) => problema.tipo === 'esquema-en-codigo')
    expect(esquema).toHaveLength(1)
    expect(esquema[0]?.detalle).toContain('repositories/anime.ts:1')
  })
})
