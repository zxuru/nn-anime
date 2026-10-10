/**
 * Lectura de cookies sin dependencias.
 *
 * No descodifica el valor: la sesión viaja en base64url y descodificar
 * introduciría una superficie de más sin ganar nada.
 */

/** Devuelve el valor de la cookie indicada, o `undefined` si no está. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined || header === '') return undefined

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue

    if (part.slice(0, separator).trim() !== name) continue

    return part.slice(separator + 1).trim()
  }

  return undefined
}
