/**
 * El remux de TS a MP4 sin ffmpeg, con `mux.js`.
 *
 * Es el mismo trabajo que hace `createFfmpegRemux` —cambiar de contenedor sin
 * recodificar— pero en JavaScript puro: unos 180 KB de dependencia en vez de
 * ochenta megabytes de binario, y nada que instalar en el equipo del usuario.
 *
 * Lo que produce `mux.js` es un **fMP4**: una cabecera —`ftyp` y `moov`— y una
 * lista de fragmentos `moof`+`mdat`. Pegados en orden son un MP4 válido que abre
 * cualquier reproductor y que el navegador reproduce con `<video>`, que es lo que
 * la biblioteca necesita para no depender de hls.js después de convertir.
 *
 * Tres cosas que `mux.js` deja a medias porque las escribió para MSE —donde el
 * reproductor pone el resto— y que aquí hay que cerrar:
 *
 * 1. **Un fragmento por segmento.** Sin `flush()` por segmento, `mux.js` acumula
 *    el episodio entero en uno o dos fragmentos: el archivo se abre, pero buscar
 *    dentro salta de golpe. Con `flush()` cada segmento es un `moof`, que es lo
 *    que hace un MP4 normal.
 * 2. **La duración.** La cabecera de MSE declara `0xFFFFFFFF` —«no sé cuánto
 *    dura, ya lo dirá el reproductor»—; en un archivo eso se lee como trece horas
 *    en el explorador de Windows y deja la barra de progreso sin sentido. Se
 *    calcula sumando las muestras de los fragmentos y se escribe al final.
 * 3. **Nada a medias.** Si falla, el MP4 parcial se borra: un archivo truncado
 *    con el nombre bueno parece una descarga rota.
 */

import { open, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import muxjs, { type MuxSegment } from 'mux.js'
import { type RemuxFn, readLocalPlaylist } from './hls-download'

/**
 * Lo mínimo del `Transmuxer` que este módulo usa.
 *
 * Es una costura: las pruebas inyectan un doble y así se mide el pegamento —el
 * orden, la cabecera, el borrado del archivo a medias— sin depender de que
 * `mux.js` acepte un fragmento de vídeo concreto.
 */
export interface TransmuxerLike {
  on(event: 'data', handler: (segment: MuxSegment) => void): void
  push(chunk: Uint8Array): void
  flush(): void
}

export interface MuxRemuxOptions {
  /** Cómo se crea el transmuxer. En las pruebas, un doble. */
  readonly createTransmuxer?: (() => TransmuxerLike) | undefined
}

/** Las líneas de una playlist local que nombran un segmento. */
export function segmentosDePlaylist(texto: string): readonly string[] {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('#'))
}

/** Una caja del archivo: dónde empieza, dónde acaba y qué es. */
interface Caja {
  readonly tipo: string
  readonly inicio: number
  readonly fin: number
}

/**
 * Las cajas que caben entre dos offsets.
 *
 * Un `size` imposible corta el recorrido en vez de leer fuera del búfer: un
 * archivo corrupto tiene que dar un error, no una excepción de memoria.
 */
export function cajasDe(buf: Uint8Array, desde = 0, hasta = buf.length): readonly Caja[] {
  const vista = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const lista: Caja[] = []
  let o = desde

  while (o + 8 <= hasta) {
    let tamano = vista.getUint32(o)
    const tipo = String.fromCharCode(
      buf[o + 4] ?? 0,
      buf[o + 5] ?? 0,
      buf[o + 6] ?? 0,
      buf[o + 7] ?? 0,
    )
    let cabecera = 8

    if (tamano === 1) {
      if (o + 16 > hasta) break
      tamano = Number(vista.getBigUint64(o + 8))
      cabecera = 16
    } else if (tamano === 0) {
      tamano = hasta - o
    }

    if (tamano < cabecera || o + tamano > hasta) break
    lista.push({ tipo, inicio: o, fin: o + tamano })
    o += tamano
  }

  return lista
}

/**
 * Lo que un fragmento dice de cada pista: cuándo empieza y cuánto dura.
 *
 * Un `moof` de `mux.js` suele traer **dos `traf`** —vídeo y audio—, cada uno con
 * su `tfhd`, su `tfdt` y su `trun`: devolver uno solo mezclaría las duraciones de
 * dos escalas distintas (90000 y 44100) y la pista de audio se quedaría sin
 * duración. Por eso se devuelve una entrada por pista.
 *
 * Se lee el `trun` porque es la única fuente que no se inventa nada: el `tfdt` es
 * el instante del primer sample y la suma de duraciones de las muestras es el
 * resto. Todo en la escala de la pista, que es la del `mdhd`.
 */
export function muestrasDeFragmento(fragmento: Uint8Array): readonly {
  readonly pista: number
  readonly inicio: number
  readonly duracion: number
}[] {
  const vista = new DataView(fragmento.buffer, fragmento.byteOffset, fragmento.byteLength)
  const salida: { pista: number; inicio: number; duracion: number }[] = []

  for (const caja of cajasDe(fragmento)) {
    if (caja.tipo !== 'moof') continue

    for (const traf of cajasDe(fragmento, caja.inicio + 8, caja.fin)) {
      if (traf.tipo !== 'traf') continue

      let pista: number | undefined
      let inicio = 0
      let duracion = 0

      for (const hija of cajasDe(fragmento, traf.inicio + 8, traf.fin)) {
        const base = hija.inicio + 8

        if (hija.tipo === 'tfhd') {
          pista = vista.getUint32(base + 4)
        }

        if (hija.tipo === 'tfdt') {
          inicio =
            fragmento[base] === 1 ? Number(vista.getBigUint64(base + 4)) : vista.getUint32(base + 4)
        }

        if (hija.tipo === 'trun') {
          const banderas = vista.getUint32(base) & 0xffffff
          const cuantas = vista.getUint32(base + 4)
          let o = base + 8

          if ((banderas & 0x000001) !== 0) o += 4
          if ((banderas & 0x000004) !== 0) o += 4

          for (let i = 0; i < cuantas; i += 1) {
            if ((banderas & 0x000100) !== 0) {
              duracion += vista.getUint32(o)
              o += 4
            }
            if ((banderas & 0x000200) !== 0) o += 4
            if ((banderas & 0x000400) !== 0) o += 4
            if ((banderas & 0x000800) !== 0) o += 4
          }
        }
      }

      if (pista !== undefined && duracion > 0) salida.push({ pista, inicio, duracion })
    }
  }

  return salida
}

/**
 * Escribe en la cabecera la duración que de verdad tiene el archivo.
 *
 * `mux.js` deja `0xFFFFFFFF` en `mvhd`, `tkhd` y `mdhd` porque en MSE la pone el
 * reproductor. Aquí se recorre la cabecera que se va a escribir —está en
 * memoria, son dos kilobytes— y se ponen los números: el de cada pista en su
 * escala y el de la película en la suya.
 *
 * Devuelve la cabecera nueva; no toca la que recibe.
 */
export function fijarDuraciones(
  cabecera: Uint8Array,
  finales: ReadonlyMap<number, number>,
): Uint8Array {
  const nueva = Uint8Array.from(cabecera)
  const vista = new DataView(nueva.buffer, nueva.byteOffset, nueva.byteLength)
  const moov = cajasDe(nueva).find((caja) => caja.tipo === 'moov')
  if (moov === undefined) return nueva

  const hijos = cajasDe(nueva, moov.inicio + 8, moov.fin)
  const mvhd = hijos.find((caja) => caja.tipo === 'mvhd')
  const escalaPelicula =
    mvhd === undefined
      ? 1000
      : nueva[mvhd.inicio + 8] === 1
        ? vista.getUint32(mvhd.inicio + 8 + 20)
        : vista.getUint32(mvhd.inicio + 8 + 12)

  let duracionPelicula = 0

  for (const trak of hijos) {
    if (trak.tipo !== 'trak') continue

    const dentro = cajasDe(nueva, trak.inicio + 8, trak.fin)
    const tkhd = dentro.find((caja) => caja.tipo === 'tkhd')
    const mdia = dentro.find((caja) => caja.tipo === 'mdia')
    if (tkhd === undefined || mdia === undefined) continue

    const vTkhd = nueva[tkhd.inicio + 8] ?? 0
    const id =
      vTkhd === 1 ? vista.getUint32(tkhd.inicio + 8 + 20) : vista.getUint32(tkhd.inicio + 8 + 12)
    const final = finales.get(id)
    if (final === undefined) continue

    const mdhd = cajasDe(nueva, mdia.inicio + 8, mdia.fin).find((caja) => caja.tipo === 'mdhd')
    if (mdhd === undefined) continue

    const vMdhd = nueva[mdhd.inicio + 8] ?? 0
    const escalaPista =
      vMdhd === 1 ? vista.getUint32(mdhd.inicio + 8 + 20) : vista.getUint32(mdhd.inicio + 8 + 12)

    // La duración de la pista, en su escala.
    if (vMdhd === 1) vista.setBigUint64(mdhd.inicio + 8 + 24, BigInt(Math.round(final)))
    else vista.setUint32(mdhd.inicio + 8 + 16, Math.min(Math.round(final), 0xfffffffe))

    // La misma, en la escala de la película, para el `tkhd` y el `mvhd`.
    const enPelicula = Math.round((final / Math.max(escalaPista, 1)) * escalaPelicula)
    if (vTkhd === 1) vista.setBigUint64(tkhd.inicio + 8 + 24, BigInt(enPelicula))
    else vista.setUint32(tkhd.inicio + 8 + 20, Math.min(enPelicula, 0xfffffffe))

    duracionPelicula = Math.max(duracionPelicula, enPelicula)
  }

  if (mvhd !== undefined && duracionPelicula > 0) {
    const vMvhd = nueva[mvhd.inicio + 8] ?? 0
    if (vMvhd === 1) vista.setBigUint64(mvhd.inicio + 8 + 24, BigInt(duracionPelicula))
    else vista.setUint32(mvhd.inicio + 8 + 16, Math.min(duracionPelicula, 0xfffffffe))
  }

  return nueva
}

function crearTransmuxer(): TransmuxerLike {
  return new muxjs.mp4.Transmuxer({ remux: true })
}

/**
 * Un segmento que no es MPEG-TS.
 *
 * `mux.js` lee TS: si la descarga guardó un `init-*.mp4` o trozos `.m4s` —
 * fuentes que ya publican fMP4—, dárselos sería basura silenciosa. Se dice cuál
 * es el problema en vez de producir un MP4 que no reproduce.
 */
function comprobarFormato(nombres: readonly string[]): void {
  for (const nombre of nombres) {
    if (/\.(m4s|mp4|m4v|cmfv)$/i.test(nombre)) {
      throw new Error(`el segmento ${nombre} no es MPEG-TS: mux.js no puede remezclarlo`)
    }
  }
}

export function createMuxRemux(options: MuxRemuxOptions = {}): RemuxFn {
  const crear = options.createTransmuxer ?? crearTransmuxer

  return async (playlistPath, outputPath, signal) => {
    const nombres = segmentosDePlaylist(await readLocalPlaylist(playlistPath))
    if (nombres.length === 0) throw new Error('la playlist no tiene segmentos')
    comprobarFormato(nombres)

    const carpeta = dirname(playlistPath)
    const archivo = await open(outputPath, 'w')
    const transmuxer = crear()

    let cabecera: Uint8Array | undefined
    let cabeceraEscrita = false
    let pendientes: Uint8Array[] = []
    let escrito = false
    let enEspera = 0

    /** Dónde termina cada pista: el mayor `tfdt + duración` que se haya visto. */
    const finales = new Map<number, number>()

    /**
     * El tope de lo que se aguanta sin cabecera.
     *
     * `mux.js` la emite con el primer fragmento; si no aparece, es que no
     * reconoció el flujo. Sin tope, un episodio entero se acumularía en memoria
     * esperando un `initSegment` que no va a llegar.
     */
    const MAX_SIN_CABECERA = 16 * 1024 * 1024

    transmuxer.on('data', (segmento) => {
      // Sólo la primera cabecera: el transmuxer puede repetirla en cada
      // fragmento, y repetirla en el archivo rompería el MP4.
      if (!cabeceraEscrita && cabecera === undefined && segmento.initSegment !== undefined) {
        if (segmento.initSegment.length > 0) cabecera = segmento.initSegment
      }

      const muestras = muestrasDeFragmento(segmento.data)
      for (const pista of muestras) {
        finales.set(
          pista.pista,
          Math.max(finales.get(pista.pista) ?? 0, pista.inicio + pista.duracion),
        )
      }

      pendientes.push(segmento.data)
      enEspera += segmento.data.length
    })

    /**
     * Vuelca lo que haya, con la cabecera delante la primera vez.
     *
     * No se escribe nada hasta tener la cabecera: un fragmento suelto al
     * principio de un archivo es exactamente el MP4 que ningún reproductor abre.
     * La cabecera se escribe ya, con la duración provisional de `mux.js`, y se
     * reescribe al final —mismo tamaño, otros números— cuando se sabe la real.
     */
    const volcar = async (): Promise<void> => {
      if (pendientes.length === 0) return

      if (!cabeceraEscrita) {
        if (cabecera === undefined) return

        await archivo.write(cabecera)
        cabeceraEscrita = true
      }

      const trozos = pendientes
      pendientes = []
      enEspera = 0

      for (const trozo of trozos) await archivo.write(trozo)
      escrito = true
    }

    try {
      for (const nombre of nombres) {
        if (signal.aborted) throw new Error('la conversión se canceló')

        transmuxer.push(await readFile(join(carpeta, nombre)))
        // Un fragmento por segmento: es lo que permite buscar dentro del MP4.
        transmuxer.flush()
        await volcar()

        if (cabecera === undefined && enEspera > MAX_SIN_CABECERA) {
          throw new Error('mux.js no reconoció la cabecera del flujo')
        }
      }

      transmuxer.flush()
      await volcar()

      if (!escrito || cabecera === undefined) {
        // Ni cabecera ni fragmentos: no se reconoció el flujo. Se dice, en vez de
        // dejar un archivo de cero bytes que parecería una conversión hecha.
        throw new Error('mux.js no reconoció ningún flujo de vídeo en los segmentos')
      }

      await archivo.close()

      // La cabecera está al principio del archivo: se reescribe en su sitio, con
      // las mismas posiciones y las duraciones de verdad.
      const conDuraciones = fijarDuraciones(cabecera, finales)
      const final = await open(outputPath, 'r+')
      try {
        await final.write(conDuraciones, 0, conDuraciones.length, 0)
      } finally {
        await final.close()
      }
    } catch (cause) {
      await archivo.close().catch(() => undefined)
      await rm(outputPath, { force: true })

      throw cause
    }
  }
}
