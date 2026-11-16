/**
 * Actualizar desde **cada** versión anterior, con el esquema viejo real.
 *
 * No hay un esquema de mentira: se aplican las migraciones de verdad hasta la
 * versión k, se escriben datos como los que tendría un usuario que se quedó en
 * esa versión y se migra al día. Así se mide la propiedad que de verdad importa
 * —que cualquier instalación anterior sobrevive a la actualización— y no una
 * copia parcial de ella.
 *
 * Las filas se insertan con las tablas que existen en esa versión. Todas las
 * versiones tienen ya `anime`, `episode`, `watch_event`, `favorite` y `setting`;
 * las tablas que llegan después se comprueban al final.
 */

import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db'
import { migrateDatabase } from './migrate'
import { listMigrations, runMigrations, schemaVersion } from './runner'

const MIGRACIONES = listMigrations()
const VERSIONES = MIGRACIONES.map((migration) => migration.version)
const ULTIMA = Math.max(...VERSIONES)

interface DatosDelUsuario {
  readonly positionS: number
  readonly title: string
  readonly setting: string
}

/** Escribe datos con las tablas que ya existen en la versión `hasta`. */
function sembrar(db: Database): DatosDelUsuario {
  db.exec(
    "INSERT INTO anime (provider_id, provider_ref, title, fetched_at, ttl_s) VALUES ('fixture', 'aurora', 'Aurora Nocturna', 0, 0)",
  )
  db.exec(
    "INSERT INTO episode (anime_id, provider_ref, number, title, mode, fetched_at, ttl_s) VALUES (1, 'aurora#1', 1, 'Episodio 1', 'sub', 0, 0)",
  )
  db.query(
    `INSERT INTO watch_event
       (anime_id, episode_id, provider_id, mode, position_s, duration_s, started_at, finished)
     VALUES (1, 1, 'fixture', 'sub', 137, 1440, 1700000000000, 0)`,
  ).run()
  db.query('INSERT INTO favorite (anime_id, created_at) VALUES (1, 1700000000000)').run()
  db.query("INSERT INTO setting (key, value_json) VALUES ('volumen', '0.5')").run()

  return { positionS: 137, title: 'Aurora Nocturna', setting: '0.5' }
}

describe('migrar desde cada versión anterior', () => {
  // Se prueba **todas** y no una: un `ALTER TABLE` que depende de una columna
  // que sólo existe desde cierta versión rompe justo en las instalaciones más
  // viejas, que son las que no se prueban nunca.
  for (const version of VERSIONES.filter((v) => v < ULTIMA)) {
    test(`desde la ${version} hasta la ${ULTIMA}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), `nn-anime-upgrade-${version}-`))

      try {
        const path = join(dir, 'nn-anime.db')

        const vieja = openDb(path)
        let datos: DatosDelUsuario
        try {
          runMigrations(
            vieja,
            MIGRACIONES.filter((migration) => migration.version <= version),
          )
          expect(schemaVersion(vieja)).toBe(version)
          datos = sembrar(vieja)
        } finally {
          vieja.close()
        }

        const resultado = migrateDatabase({
          dbPath: path,
          migrations: MIGRACIONES,
          backup: { dir: join(dir, 'backups') },
        })

        expect(resultado.ok).toBe(true)
        if (!resultado.ok) return

        expect(resultado.report.applied).toEqual(VERSIONES.filter((v) => v > version))
        expect(resultado.report.version).toBe(ULTIMA)
        expect(resultado.backupPath).toBeDefined()

        const db = openDb(path)
        try {
          expect(schemaVersion(db)).toBe(ULTIMA)

          const visionado = db
            .query('SELECT position_s, duration_s FROM watch_event WHERE id = 1')
            .get()
          expect(visionado).toEqual({ position_s: datos.positionS, duration_s: 1440 })

          expect(db.query('SELECT title FROM anime WHERE id = 1').get()).toEqual({
            title: datos.title,
          })
          expect(db.query("SELECT value_json FROM setting WHERE key = 'volumen'").get()).toEqual({
            value_json: datos.setting,
          })
          expect(db.query('SELECT COUNT(*) AS total FROM favorite').get()).toEqual({ total: 1 })
        } finally {
          db.close()
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  }

  test('las migraciones no se saltan versiones', () => {
    expect(VERSIONES).toEqual(VERSIONES.map((_, indice) => indice + 1))
  })
})
