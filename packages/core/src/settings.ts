/**
 * Ajustes de proceso leídos de `config.json`.
 *
 * El archivo vive dentro del directorio de configuración, así que no puede
 * decidir dónde está ese directorio: las rutas llegan de las banderas y del
 * entorno. Lo que sí decide son los ajustes que no dependen de la ruta.
 *
 * Los schemas son estrictos. Un `config.json` con una clave de más es un error,
 * no algo que se ignora en silencio: casi siempre es una errata, y una errata
 * que no se reporta es un ajuste que el usuario cree haber puesto y no está.
 */

import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { AppError } from './errors'
import { err, ok, type Result } from './result'

export const MIN_PORT = 1
export const MAX_PORT = 65535

export const settingsSchema = z.strictObject({
  port: z.number().int().min(MIN_PORT).max(MAX_PORT).optional(),
  open: z.boolean().optional(),
  // `trim()` antes de `min(1)`: un identificador en blanco tiene longitud y
  // pasaría la comprobación, y luego filtraría por un proveedor que no existe
  // sin decir por qué. La interfaz recibe la lista tal cual, así que la frontera
  // es aquí.
  providers: z.array(z.string().trim().min(1)).optional(),
  lang: z.string().trim().min(1).optional(),
  verbose: z.boolean().optional(),
})

export type Settings = Readonly<z.infer<typeof settingsSchema>>

/**
 * Resumen legible de los problemas de validación.
 *
 * `error.message` de Zod es un volcado JSON de varias líneas: correcto para
 * depurar, inservible como mensaje de una herramienta de terminal. Aquí se
 * queda en una línea por problema, nombrando el campo.
 */
function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const where = issue.path.map(String).join('.')
      return where === '' ? issue.message : `${where}: ${issue.message}`
    })
    .join('; ')
}

/** `ENOENT` es la única causa que significa «no hay archivo». */
function isMissing(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false

  return cause.code === 'ENOENT'
}

/**
 * Lee los ajustes del archivo indicado. Devuelve `undefined` si no existe.
 *
 * Que el archivo no esté es normal y no es un error. Que esté y no se pueda
 * leer, o no cumpla el esquema, sí lo es: se devuelve un `AppError` de
 * configuración con el motivo, en lugar de arrancar con los valores por defecto
 * y dejar al usuario preguntándose por qué no se aplicó su configuración.
 */
export async function readSettings(path: string): Promise<Result<Settings | undefined, AppError>> {
  // La puerta es `stat`, no `Bun.file(...).exists()`: sobre un directorio
  // `exists()` dice que no existe, y tratarlo como «no hay ajustes» sería
  // silencioso. Un `config.json` que es un directorio conviene verlo.
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(path)
  } catch (cause) {
    if (isMissing(cause)) return ok(undefined)

    return err(
      new AppError({
        code: 'config',
        message: `los ajustes no se pueden leer: ${path}`,
        cause,
        scope: 'config',
        op: 'readSettings',
      }),
    )
  }

  if (!stats.isFile()) {
    return err(
      new AppError({
        code: 'config',
        message: `los ajustes no son un archivo: ${path}`,
        scope: 'config',
        op: 'readSettings',
      }),
    )
  }

  const file = Bun.file(path)

  let raw: unknown
  try {
    raw = await file.json()
  } catch (cause) {
    return err(
      new AppError({
        code: 'config',
        message: `los ajustes no son JSON válido: ${path}`,
        cause,
        scope: 'config',
        op: 'readSettings',
      }),
    )
  }

  const parsed = settingsSchema.safeParse(raw)
  if (!parsed.success) {
    return err(
      new AppError({
        code: 'config',
        message: `los ajustes no cumplen el esquema: ${describeIssues(parsed.error.issues)}`,
        scope: 'config',
        op: 'readSettings',
      }),
    )
  }

  return ok(parsed.data)
}
