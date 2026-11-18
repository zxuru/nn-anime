/**
 * Repositorio del perfil de gustos.
 *
 * Guarda el perfil entero como JSON porque las lecturas y las escrituras son
 * completas: la encuesta manda todas las respuestas y el motor lee todo el
 * perfil de una vez. Partirlo en tablas de géneros y títulos daría transacciones
 * y ninguna consulta nueva.
 *
 * Una fila corrupta se trata como ausente. Un perfil que no valida no puede
 * impedir que la aplicación arranque ni que el motor funcione: se cae al
 * arranque en frío, que es exactamente lo que hay cuando no se ha contestado.
 */

import type { Database } from 'bun:sqlite'
import { LOCAL_TASTE_USER, type TasteProfile, tasteProfileSchema } from '@rona/core'

interface TasteRow {
  readonly profile_json: string
}

export function createTasteRepository(db: Database) {
  const select = db.query<TasteRow, [string]>(
    'SELECT profile_json FROM taste_profile WHERE user_id = ?',
  )
  const upsert = db.query(
    `INSERT INTO taste_profile (user_id, profile_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       updated_at = excluded.updated_at`,
  )

  return {
    read(userId: string = LOCAL_TASTE_USER): TasteProfile | undefined {
      const row = select.get(userId)
      if (row === null) return undefined

      let crudo: unknown
      try {
        crudo = JSON.parse(row.profile_json)
      } catch {
        return undefined
      }

      const parsed = tasteProfileSchema.safeParse(crudo)

      return parsed.success ? parsed.data : undefined
    },

    write(profile: TasteProfile): void {
      upsert.run(profile.userId, JSON.stringify(profile), Date.parse(profile.updatedAt))
    },
  }
}

export type TasteStore = ReturnType<typeof createTasteRepository>
