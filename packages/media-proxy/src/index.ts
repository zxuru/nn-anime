/**
 * Superficie pública de `@nn-anime/media-proxy`.
 *
 * El módulo que se interpone entre el navegador y los sitios de video: emite
 * tickets opacos para que el cliente nunca vea una URL del upstream, y proxya
 * bytes, playlists y subtítulos. Hoy expone el almacén de tickets; el proxy de
 * bytes llega en T26.
 */

export {
  createTicketStore,
  DEFAULT_CAPACITY,
  DEFAULT_TTL_S,
  type TicketContents,
  type TicketFailure,
  type TicketOutcome,
  type TicketStore,
  type TicketStoreOptions,
  ticketError,
} from './ticket-store'
