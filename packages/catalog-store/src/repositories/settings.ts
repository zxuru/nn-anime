/**
 * Ajustes clave-valor.
 *
 * El valor se guarda como JSON, así que cabe un booleano, un número, una lista o
 * un objeto sin cambiar el esquema.
 *
 * **`get` pide un schema, no sólo el valor por defecto.** El contrato de
 * `SPEC-catalog-store.md` lo escribía como `getSetting<T>(key, fallback): T`, y
 * eso no se puede cumplir de verdad: el JSON de la fila es `unknown`, y
 * devolverlo como `T` exige una conversión de tipo —justo lo que el proyecto
 * prohíbe— o mentir al compilador. Con el schema, un ajuste con otra forma
 * devuelve el valor por defecto en lugar de colarse en el resto de la aplicación
 * disfrazado de lo que no es.
 *
 * Un JSON ilegible devuelve el valor por defecto en vez de fallar: un ajuste
 * corrupto no puede impedir que la aplicación arranque, y «lo que se usa cuando
 * no hay ajuste» es exactamente lo que corresponde. La fila sigue en la tabla,
 * así que se puede ver y borrar.
 */

import type { Database } from 'bun:sqlite'
import type { z } from 'zod'

interface SettingRow {
  readonly value_json: string
}

export function createSettingsRepository(db: Database) {
  const select = db.query<SettingRow, [string]>('SELECT value_json FROM setting WHERE key = ?')

  return {
    get<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
      const row = select.get(key)
      if (row === null) return fallback

      let crudo: unknown
      try {
        crudo = JSON.parse(row.value_json)
      } catch {
        return fallback
      }

      const parsed = schema.safeParse(crudo)

      return parsed.success ? parsed.data : fallback
    },

    set(key: string, value: unknown): void {
      db.query(
        `INSERT INTO setting (key, value_json) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      ).run(key, JSON.stringify(value))
    },
  }
}

export type SettingsStore = ReturnType<typeof createSettingsRepository>
