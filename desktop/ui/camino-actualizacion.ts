// La decisión de qué hacer con la actualización que anuncia el updater.
//
// Vive aparte de la ventana para poder medirla sin DOM ni IPC. Ya no hay dos
// formas de entrega: el `.exe` portable se reemplaza a sí mismo, así que lo único
// que importa es que la release traiga su entrada firmada.

/** Lo que verifica el `.exe` portable: su URL y la firma minisign. */
export interface EntradaPortable {
  readonly url: string
  readonly signature: string
}

export const CLAVE_PORTABLE = 'windows-x86_64-portable'

function esRecord(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Saca la URL y la firma del `.exe` portable de lo que devolvió `check()`. */
export function entradaPortable(rawJson: Record<string, unknown>): EntradaPortable | null {
  const platforms = rawJson.platforms

  if (!esRecord(platforms)) return null

  const entrada = platforms[CLAVE_PORTABLE]

  if (!esRecord(entrada)) return null

  const { url, signature } = entrada

  if (typeof url !== 'string' || typeof signature !== 'string') return null

  return { url, signature }
}
