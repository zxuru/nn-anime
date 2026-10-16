/**
 * La línea de arranque legible por máquina.
 *
 * El CLI imprime una línea **humana** con la URL —traducida, como todo lo que lee
 * una persona— y otra **fija** que lee un programa. La segunda existe por un
 * motivo concreto: quien lanza el servidor y necesita su dirección es un
 * anfitrión (hoy el `smoke` del paquete, mañana la ventana de escritorio), y
 * analizar texto traducido es un contrato que se rompe el día que se traduce el
 * idioma que falta. Hoy sólo hay catálogo en español, así que el análisis
 * funcionaría; mañana no.
 *
 * El formato es `NN_ANIME_BOOT {"port":N,"url":"…"}`, con el prefijo literal
 * —nunca traducido— y el resto JSON en **una sola línea**. El esquema vive aquí y
 * no en cada lector: el mismo archivo que la escribe la lee, y por eso los dos no
 * se pueden separar.
 *
 * **No va a un archivo**: la URL lleva el token de arranque, y «persistir el
 * token de sesión o el de arranque» está en la lista de lo que este proyecto no
 * hace. Va por `stdout`, y no se registra en el log.
 */

import { z } from 'zod'
import { httpUrlSchema } from './schema'

/** El prefijo literal. No se traduce y no cambia. */
export const BOOT_LINE_PREFIX = 'NN_ANIME_BOOT'

export const bootLineSchema = z.object({
  /** Puerto real de escucha. Es lo único de esta línea que es seguro registrar. */
  port: z.number().int().min(1).max(65535),
  /** La URL de arranque, con su token. */
  url: httpUrlSchema,
})

export type BootLine = z.infer<typeof bootLineSchema>

/**
 * La línea, tal y como tiene que salir por `stdout`.
 *
 * El objeto se construye aquí, campo a campo: con el que le pase quien llama, el
 * orden de las claves dependería de cómo lo escribiera y la línea dejaría de ser
 * comparable byte a byte entre dos arranques.
 */
export function formatBootLine(boot: BootLine): string {
  return `${BOOT_LINE_PREFIX} ${JSON.stringify({ port: boot.port, url: boot.url })}`
}

/**
 * La línea de arranque que haya en un texto, o `undefined` si no hay ninguna.
 *
 * Se busca en todas las líneas porque el `stdout` del CLI lleva más cosas —la URL
 * humana, la lista de proveedores activos— y el lector no tiene por qué saber en
 * qué orden salen. Una línea con el prefijo pero mal formada **no** se ignora en
 * silencio: devolver `undefined` es lo que hace que el lector diga «no encontré la
 * línea» en vez de arrancar con una dirección a medias.
 */
export function parseBootLine(text: string): BootLine | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`${BOOT_LINE_PREFIX} `)) continue

    const parsed = bootLineSchema.safeParse(parseJson(line.slice(BOOT_LINE_PREFIX.length + 1)))
    return parsed.success ? parsed.data : undefined
  }

  return undefined
}

/** El JSON de la línea, o `undefined` si no es JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
