/**
 * Almacén de tickets opacos.
 *
 * El cliente web nunca ve la URL del upstream: ve un ticket, y el servidor lo
 * resuelve. Eso es lo que impide que la interfaz pueda leer, compartir o pedir
 * directamente el enlace de un tercero, y lo que hace que la lista blanca de
 * destinos sea la única puerta de salida.
 *
 * Cuatro reglas, y las cuatro se prueban:
 *
 * 1. **Aleatorio con CSPRNG.** Adivinar un ticket es acceder al video de otro;
 *    un contador o un hash de la URL serían adivinables o deducibles.
 * 2. **Tope de 500 con desalojo LRU.** Sin tope, una sesión larga acumula
 *    entradas para siempre. Se desaloja la que hace más tiempo que no se usa.
 * 3. **Vida de 600 s.** Una URL de stream caduca; el ticket que la representa,
 *    también. Resolver uno vencido es 410, no 404: la diferencia entre «existió y
 *    ya no» y «nunca existió» es la que permite diagnosticar.
 * 4. **Nada de esto se registra en un log.** El almacén no escribe ni una línea,
 *    no expone la lista de tickets y su representación no los incluye. Un ticket
 *    en un log es una URL de video en un log.
 */

import { AppError } from '@nn-anime/core'

/** Entradas vivas a la vez. */
export const DEFAULT_CAPACITY = 500

/** Segundos de vida de un ticket, del spec. */
export const DEFAULT_TTL_S = 600

export interface TicketContents {
  readonly url: string
  /** Headers que el upstream exige. Nunca salen del proceso. */
  readonly headers: Readonly<Record<string, string>>
}

export type TicketFailure = 'unknown' | 'expired'

export type TicketOutcome =
  | { readonly ok: true; readonly contents: TicketContents }
  | { readonly ok: false; readonly kind: TicketFailure }

export interface TicketStore {
  /** Emite un ticket para una URL y sus headers. */
  issue(contents: TicketContents, ttlS?: number): string
  /** Resuelve un ticket. Un vencido da `expired`; uno que no existe, `unknown`. */
  resolve(ticket: string): TicketOutcome
  /** Cuántos tickets vivos hay. No hay forma de listarlos, a propósito. */
  size(): number
  /** Borra los vencidos y devuelve cuántos quitó. */
  prune(): number
}

interface Entry {
  readonly contents: TicketContents
  readonly issuedAt: number
  readonly ttlS: number
}

export interface TicketStoreOptions {
  readonly capacity?: number
  readonly ttlS?: number
  /** Reloj inyectable: una prueba de caducidad no debe esperar diez minutos. */
  readonly now?: () => number
  /** Fuente de aleatoriedad inyectable, para poder fijar los tickets en un test. */
  readonly randomBytes?: (size: number) => Uint8Array
}

/** Un ticket: 24 bytes de CSPRNG en base64url, sin relleno. */
const TICKET_BYTES = 24

function randomTicket(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(TICKET_BYTES)

  return Buffer.from(bytes).toString('base64url')
}

/**
 * El error que corresponde a un ticket que no se puede resolver.
 *
 * 410 para el vencido y 404 para el desconocido: son dos cosas distintas y quien
 * depure agradece poder distinguirlas.
 */
export function ticketError(kind: TicketFailure, ticket: string): AppError {
  return new AppError({
    code: 'internal',
    message:
      kind === 'expired' ? 'el ticket caducó; vuelve a resolver el stream' : 'ese ticket no existe',
    context: { kind, length: ticket.length },
    scope: 'media-proxy',
    op: 'resolveTicket',
  })
}

export function createTicketStore(options: TicketStoreOptions = {}): TicketStore {
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  const ttlS = options.ttlS ?? DEFAULT_TTL_S
  const now = options.now ?? Date.now
  const randomBytes =
    options.randomBytes ?? ((size: number) => crypto.getRandomValues(new Uint8Array(size)))

  // El `Map` conserva el orden de inserción, y resolver mueve la entrada al
  // final: el primero de la tabla es siempre la que hace más tiempo que no se
  // usa. Así el LRU no necesita ninguna estructura extra.
  const entries = new Map<string, Entry>()

  const expired = (entry: Entry, at: number): boolean => entry.issuedAt + entry.ttlS * 1000 <= at

  return {
    issue(contents, ttlSPedido) {
      const at = now()
      const ticket = randomTicket(randomBytes)

      entries.set(ticket, { contents, issuedAt: at, ttlS: ttlSPedido ?? ttlS })

      // Desalojo por antigüedad: se quitan tantas como hagan falta, no una.
      while (entries.size > capacity) {
        const masViejo = entries.keys().next()
        if (masViejo.done === true) break

        entries.delete(masViejo.value)
      }

      return ticket
    },

    resolve(ticket) {
      const entry = entries.get(ticket)
      if (entry === undefined) return { ok: false, kind: 'unknown' }

      const at = now()
      if (expired(entry, at)) {
        entries.delete(ticket)

        return { ok: false, kind: 'expired' }
      }

      // Se reinserta para marcarla como la última usada.
      entries.delete(ticket)
      entries.set(ticket, entry)

      return { ok: true, contents: entry.contents }
    },

    size: () => entries.size,

    prune() {
      const at = now()
      let quitados = 0

      for (const [ticket, entry] of entries) {
        if (expired(entry, at)) {
          entries.delete(ticket)
          quitados += 1
        }
      }

      return quitados
    },
  }
}
