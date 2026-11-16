// La decisión de qué hacer con la actualización que anuncia el updater.
//
// Vive aparte de la ventana para poder medirla sin DOM ni IPC: el orden importa
// y es justo lo que cambió. Las dos formas de entrega se actualizan reemplazando
// el `.exe`; el instalador NSIS queda sólo como reserva de la copia instalada
// cuando la release no trae la entrada portable.

/** Lo que verifica el `.exe` portable: su URL y la firma minisign. */
export interface EntradaPortable {
  readonly url: string
  readonly signature: string
}

/** Los tres caminos posibles, en orden de preferencia. */
export type Camino = 'portable' | 'nsis' | 'ninguno'

const CLAVE_PORTABLE = 'windows-x86_64-portable'

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

/**
 * El camino para esta copia.
 *
 * El auto-reemplazo sirve para las dos formas de entrega, así que se intenta
 * primero. La copia instalada puede caer al NSIS si la release no publicó el
 * ejecutable portable; la portable no tiene instalador al que caer.
 */
export function camino(instalada: boolean, rawJson: Record<string, unknown>): Camino {
  if (entradaPortable(rawJson) !== null) return 'portable'

  return instalada ? 'nsis' : 'ninguno'
}
