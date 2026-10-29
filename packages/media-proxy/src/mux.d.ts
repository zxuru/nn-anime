/**
 * Los tipos de `mux.js`, escritos a mano.
 *
 * El paquete no publica declaraciones y no hay `@types/mux.js` en el registro.
 * En vez de tapar el import con un `any` —que aquí está prohibido— se declara lo
 * que este repositorio usa. Si una versión futura cambia la forma del evento
 * `data`, es este archivo el que lo delata, y no un `undefined` en mitad de una
 * conversión de cuatrocientos segmentos.
 */
declare module 'mux.js' {
  export interface MuxSegment {
    /** El `ftyp` + `moov`: la cabecera del fMP4. Viaja con el primer `data`. */
    readonly initSegment?: Uint8Array
    /** Un fragmento (`moof` + `mdat`) del MP4. */
    readonly data: Uint8Array
    readonly type: string
  }

  class Transmuxer {
    constructor(options?: {
      readonly remux?: boolean
      readonly keepOriginalTimestamps?: boolean
      readonly alignGopsAtEnd?: boolean
    })
    on(event: 'data', handler: (segment: MuxSegment) => void): void
    on(event: 'error' | 'done' | 'log', handler: (payload: unknown) => void): void
    push(chunk: Uint8Array): void
    flush(): void
  }

  const muxjs: {
    readonly mp4: { readonly Transmuxer: typeof Transmuxer }
  }

  export default muxjs
}
