/**
 * El menú de subtítulos: las pistas declaradas por el proveedor y las que trae el
 * manifiesto, en una sola decisión.
 *
 * Son dos orígenes distintos con un solo mando. Una pista declarada vive en un
 * `<track>` del elemento y se enciende con su `mode`; una del manifiesto la sirve
 * hls.js —viaja dentro de la lista, en `#EXT-X-MEDIA:TYPE=SUBTITLES`— y se
 * enciende con su índice. Y no pueden estar las dos a la vez: encender una apaga
 * la otra, que es lo que evita dos subtítulos superpuestos en la misma pantalla.
 *
 * Vive aquí, y no dentro del componente, porque el reproductor se prueba
 * renderizando a cadena —sin DOM y sin efectos—, y lo que hay que medir es esta
 * decisión: qué se ofrece, cuál está puesta y qué se toca al elegir.
 */

/**
 * Una pista de subtítulos del manifiesto, en la forma que el reproductor pinta.
 *
 * `id` es el índice que entiende hls.js: el mismo que se le asigna a
 * `hls.subtitleTrack`, y `-1` no es una pista sino «ninguna».
 */
export interface HlsSubtitleTrack {
  readonly id: number
  readonly lang: string
  readonly label: string
}

/**
 * Una pista del manifiesto tal y como la publica hls.js.
 *
 * Es la parte de `MediaPlaylist` que este módulo mira, escrita a mano para no
 * importar el tipo de la biblioteca: es una dependencia dinámica —hls.js se carga
 * sólo al reproducir HLS— y arrastrar sus tipos hasta aquí ataría el menú a su
 * versión.
 */
export interface HlsTrackLike {
  readonly id: number
  readonly name?: string | undefined
  readonly lang?: string | undefined
}

/**
 * Las pistas del manifiesto, en orden, con su etiqueta.
 *
 * La etiqueta es el `NAME` de la etiqueta `#EXT-X-MEDIA` y, si no lo trae, el
 * idioma: un botón sin texto no se puede pulsar con un lector de pantalla. Cuando
 * tampoco hay idioma la etiqueta sale vacía y quien pinta pone su respaldo.
 */
export function hlsSubtitleTracks(crudas: readonly HlsTrackLike[]): readonly HlsSubtitleTrack[] {
  return crudas.map((cruda) => {
    const nombre = (cruda.name ?? '').trim()
    const idioma = (cruda.lang ?? '').trim()

    return { id: cruda.id, lang: idioma, label: nombre === '' ? idioma : nombre }
  })
}

/** Qué subtítulos están puestos: una pista declarada, una del manifiesto o ninguno. */
export type SubtitleChoice =
  | { readonly origen: 'ninguna' }
  | { readonly origen: 'declarada'; readonly indice: number }
  | { readonly origen: 'manifiesto'; readonly id: number }

/** Una entrada del menú, ya resuelta para pintarla. */
export interface SubtitleOption {
  /** Clave de la lista: estable e independiente del rótulo. */
  readonly key: string
  readonly choice: SubtitleChoice
  readonly label: string
  readonly pressed: boolean
}

export interface SubtitleMenuInput {
  readonly declaradas: readonly { readonly label: string }[]
  readonly manifiesto: readonly HlsSubtitleTrack[]
  readonly elegida: SubtitleChoice
  /** El rótulo de «ninguno», del catálogo: aquí no se escribe texto de interfaz. */
  readonly ninguna: string
  /** El respaldo de una pista sin nombre ni idioma, del catálogo. */
  readonly sinNombre: string
}

/**
 * Las entradas del menú, en orden: ninguno, las declaradas y las del manifiesto.
 *
 * Los dos orígenes van en la misma lista a propósito: para quien elige son
 * subtítulos, y partirla en dos bloques obligaría a saber de dónde sale cada uno
 * para encontrar el idioma que busca.
 */
export function subtitleOptions(entrada: SubtitleMenuInput): readonly SubtitleOption[] {
  const opciones: SubtitleOption[] = [
    {
      key: 'ninguna',
      choice: { origen: 'ninguna' },
      label: entrada.ninguna,
      pressed: entrada.elegida.origen === 'ninguna',
    },
  ]

  for (const [indice, declarada] of entrada.declaradas.entries()) {
    opciones.push({
      key: `declarada:${indice}`,
      choice: { origen: 'declarada', indice },
      label: declarada.label,
      pressed: entrada.elegida.origen === 'declarada' && entrada.elegida.indice === indice,
    })
  }

  for (const pista of entrada.manifiesto) {
    opciones.push({
      key: `manifiesto:${pista.id}`,
      choice: { origen: 'manifiesto', id: pista.id },
      label: pista.label === '' ? entrada.sinNombre : pista.label,
      pressed: entrada.elegida.origen === 'manifiesto' && entrada.elegida.id === pista.id,
    })
  }

  return opciones
}

/** Lo que hay que tocar al elegir: el `<track>` del elemento y hls.js. */
export interface SubtitleAction {
  /** El índice de la pista declarada que se enciende, o `'ninguna'`. */
  readonly declarada: number | 'ninguna'
  /** El índice de la pista del manifiesto, o `-1` para apagarlas todas. */
  readonly manifiesto: number
}

/**
 * La acción de una elección, con los dos lados apagados cuando no toca.
 *
 * Es la regla que impide los subtítulos duplicados: elegir cualquiera de los dos
 * orígenes apaga el otro, y elegir «ninguno» los apaga los dos. Estaba repartida
 * entre el manejador del menú y el efecto que toca el elemento, que es donde una
 * de las dos mitades se olvida.
 */
export function subtitleAction(choice: SubtitleChoice): SubtitleAction {
  switch (choice.origen) {
    case 'ninguna':
      return { declarada: 'ninguna', manifiesto: -1 }
    case 'declarada':
      return { declarada: choice.indice, manifiesto: -1 }
    case 'manifiesto':
      return { declarada: 'ninguna', manifiesto: choice.id }
  }
}
