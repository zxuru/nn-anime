import { describe, expect, test } from 'bun:test'
import { cajasDe, fijarDuraciones, muestrasDeFragmento } from './mux-remux'

/**
 * Las cajas de un MP4, a mano.
 *
 * La suite no puede traer un vídeo de verdad —son cientos de megas y no son del
 * repositorio—, así que el archivo se construye byte a byte. Lo que se mide no
 * es «¿reproduce?» sino las dos cuentas que `mux.js` deja a medias: leer la
 * duración de los fragmentos y escribirla en la cabecera.
 */

function unir(...trozos: Uint8Array[]): Uint8Array {
  const total = trozos.reduce((suma, trozo) => suma + trozo.length, 0)
  const salida = new Uint8Array(total)
  let o = 0
  for (const trozo of trozos) {
    salida.set(trozo, o)
    o += trozo.length
  }

  return salida
}

function enteros(...valores: number[]): Uint8Array {
  const buf = new Uint8Array(valores.length * 4)
  const vista = new DataView(buf.buffer)
  for (const [indice, valor] of valores.entries()) vista.setUint32(indice * 4, valor)

  return buf
}

function caja(tipo: string, ...hijos: Uint8Array[]): Uint8Array {
  const contenido = unir(...hijos)
  const cabecera = new Uint8Array(8)
  new DataView(cabecera.buffer).setUint32(0, 8 + contenido.length)
  cabecera.set(new TextEncoder().encode(tipo), 4)

  return unir(cabecera, contenido)
}

/** `tfhd` v0 con el `track_ID` y nada más (banderas 0). */
const tfhd = (pista: number): Uint8Array => caja('tfhd', enteros(0, pista))

/** `tfdt` v0 en la escala de la pista. */
const tfdt = (instante: number): Uint8Array => caja('tfdt', enteros(0, instante))

/**
 * `trun` con duración por muestra (bandera 0x100) y sin nada más.
 *
 * El `sample_count` va antes que las muestras y las banderas en los tres bytes
 * bajos del campo de versión y banderas: es justo el detalle que se equivoca
 * quien lea esto a ojo.
 */
const trun = (...duraciones: number[]): Uint8Array =>
  caja('trun', enteros(0x000100, duraciones.length, ...duraciones))

/** Un `moof` con un `traf` por pista, como los emite `mux.js` (tipo `combined`). */
function fragmento(
  pistas: readonly { id: number; instante: number; duraciones: number[] }[],
): Uint8Array {
  const trafs = pistas.map((pista) =>
    caja('traf', tfhd(pista.id), tfdt(pista.instante), trun(...pista.duraciones)),
  )

  return unir(caja('moof', caja('mfhd', enteros(0, 1)), ...trafs), caja('mdat', new Uint8Array(16)))
}

/** Una cabecera con `mvhd`, dos `trak` y sus `mvex`. */
function cabecera(): Uint8Array {
  const pista = (id: number, escala: number): Uint8Array =>
    caja(
      'trak',
      caja('tkhd', enteros(0, 0, 0, id, 0, 0xffffffff)),
      caja('mdia', caja('mdhd', enteros(0, 0, 0, escala, 0xffffffff))),
    )

  const moov = caja(
    'moov',
    caja('mvhd', enteros(0, 0, 0, 90_000, 0xffffffff)),
    pista(1, 90_000),
    pista(2, 44_100),
    caja('mvex', caja('trex', enteros(0, 1, 1, 0, 0, 0)), caja('trex', enteros(0, 2, 1, 0, 0, 0))),
  )

  return unir(caja('ftyp', new TextEncoder().encode('isomiso5')), moov)
}

/** Lee un `u32` de la cabecera, para comprobar lo que se escribió. */
function leer(buf: Uint8Array, desde: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(desde)
}

describe('las cajas del MP4', () => {
  test('se recorren por su tamaño, sin leer fuera', () => {
    const buf = cabecera()

    expect(cajasDe(buf).map((caja) => caja.tipo)).toEqual(['ftyp', 'moov'])
    // Un tamaño imposible corta el recorrido en vez de lanzar.
    const roto = Uint8Array.from([0, 0, 0, 2, 0x6d, 0x6f, 0x6f, 0x76])
    expect(cajasDe(roto)).toEqual([])
  })
})

describe('la duración de un fragmento', () => {
  test('sale una entrada por pista, con su instante y sus muestras', () => {
    const trozo = fragmento([
      { id: 1, instante: 0, duraciones: [3000, 3000, 3000] },
      { id: 2, instante: 1024, duraciones: [1024, 1024] },
    ])

    expect(muestrasDeFragmento(trozo)).toEqual([
      { pista: 1, inicio: 0, duracion: 9000 },
      { pista: 2, inicio: 1024, duracion: 2048 },
    ])
  })

  test('no se mezclan las escalas de dos pistas en un mismo moof', () => {
    // Es el error que se cometió: sumar el vídeo (90000) con el audio (44100)
    // daría una duración que no es de nadie.
    const trozo = fragmento([
      { id: 1, instante: 0, duraciones: [90_000] },
      { id: 2, instante: 0, duraciones: [44_100] },
    ])

    const [video, audio] = muestrasDeFragmento(trozo)
    expect(video?.duracion).toBe(90_000)
    expect(audio?.duracion).toBe(44_100)
  })
})

describe('fijar la duración en la cabecera', () => {
  test('la película toma la pista más larga, convertida a su escala', () => {
    const buf = cabecera()
    // 1420 s en las dos pistas, cada una en su escala.
    const nueva = fijarDuraciones(
      buf,
      new Map([
        [1, 1420 * 90_000],
        [2, 1420 * 44_100],
      ]),
    )

    const moov = cajasDe(nueva).find((caja) => caja.tipo === 'moov')
    if (moov === undefined) throw new Error('falta el moov')
    const mvhd = cajasDe(nueva, moov.inicio + 8, moov.fin).find((caja) => caja.tipo === 'mvhd')
    if (mvhd === undefined) throw new Error('falta el mvhd')

    // Las dos pistas duran lo mismo en segundos, así que la película también.
    expect(leer(nueva, mvhd.inicio + 8 + 16)).toBe(1420 * 90_000)
  })

  test('cada pista declara lo suyo en su propia escala', () => {
    const buf = cabecera()
    const nueva = fijarDuraciones(
      buf,
      new Map([
        [1, 1420 * 90_000],
        [2, 1420 * 44_100],
      ]),
    )

    const moov = cajasDe(nueva).find((caja) => caja.tipo === 'moov')
    const traks = cajasDe(nueva, (moov?.inicio ?? 0) + 8, moov?.fin ?? 0).filter(
      (caja) => caja.tipo === 'trak',
    )
    expect(traks).toHaveLength(2)

    for (const [indice, escala] of [90_000, 44_100].entries()) {
      const trak = traks[indice]
      if (trak === undefined) throw new Error('falta el trak')

      const dentro = cajasDe(nueva, trak.inicio + 8, trak.fin)
      const tkhd = dentro.find((caja) => caja.tipo === 'tkhd')
      const mdia = dentro.find((caja) => caja.tipo === 'mdia')
      if (tkhd === undefined || mdia === undefined) throw new Error('falta una caja')

      const mdhd = cajasDe(nueva, mdia.inicio + 8, mdia.fin).find((caja) => caja.tipo === 'mdhd')
      if (mdhd === undefined) throw new Error('falta el mdhd')

      // `mdhd` en su escala; `tkhd` en la de la película (90000).
      expect(leer(nueva, mdhd.inicio + 8 + 16)).toBe(1420 * escala)
      expect(leer(nueva, tkhd.inicio + 8 + 20)).toBe(1420 * 90_000)
    }
  })

  test('no toca la cabecera que recibe', () => {
    const buf = cabecera()
    const copia = Uint8Array.from(buf)

    fijarDuraciones(buf, new Map([[1, 90_000]]))

    expect(buf).toEqual(copia)
  })
})
