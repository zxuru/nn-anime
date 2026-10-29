/**
 * La descarga de un HLS: segmentos, playlist local y, si se puede, un MP4.
 *
 * Se guarda **primero** el material tal cual —segmentos y una playlist con rutas
 * relativas— y después se ofrece el remux. Así el respaldo sin ffmpeg no es un
 * camino aparte: es el mismo resultado sin el último paso.
 *
 * Lo que no se hace:
 *
 * - **No se descifra HLS con `#EXT-X-KEY`.** Una clave AES exige implementar el
 *   descifrado o dejar que ffmpeg lo haga con red, y las dos cosas son otra tarea.
 *   Se rechaza con el motivo en vez de bajar basura cifrada que no se reproduce.
 * - **No se confía en las URLs del manifiesto.** Cada una se resuelve contra la
 *   playlist y el motor (T183d) es quien comprueba el destino antes de pedirla.
 * - **No se recodifica.** El remux copia los códecs; si ffmpeg falta, quedan los
 *   segmentos.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchLike } from '../byte-proxy'
import { downloadFile } from './file'

const MAX_PLAYLIST_TEXT = 2 * 1024 * 1024

/** Lo que el motor inyecta para remezclar. En las pruebas es un doble. */
export type RemuxFn = (
  playlistPath: string,
  outputPath: string,
  signal: AbortSignal,
) => Promise<void>

export interface HlsDownloadInput {
  readonly playlistUrl: string
  /** Directorio donde viven los segmentos y la playlist local. */
  readonly dir: string
  readonly mp4Path?: string | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly signal: AbortSignal
  readonly fetchImpl?: FetchLike | undefined
  readonly remux?: RemuxFn | undefined
  /**
   * Si un remux fallido no debe tumbar la descarga.
   *
   * Convertir es un extra: si el MP4 no sale, lo bajado sigue siendo el episodio
   * y se puede reintentar después sin volver a la red. La descarga automática lo
   * pone a `true`; la conversión que pide el usuario, no, porque ahí el fallo es
   * la respuesta.
   */
  readonly remuxOpcional?: boolean | undefined
  /**
   * Lo bajado y el total estimado.
   *
   * El segundo puede faltar: sin duraciones en la playlist no hay con qué
   * repartir lo descargado y prometer un total sería inventarlo. Cuando aparece,
   * es una proyección del bitrate medido en los segmentos ya bajados, no el
   * tamaño final.
   */
  readonly onProgress?: ((bytes: number, totalBytes: number | undefined) => void) | undefined
}

export interface HlsDownloadResult {
  /** `hls` si se remezcló a MP4; `segments` si se quedó en la playlist local. */
  readonly kind: 'hls' | 'segments'
  readonly path: string
  readonly segments: number
  readonly bytes: number
}

async function textoDe(
  url: string,
  input: HlsDownloadInput,
): Promise<{ texto: string; urlFinal: string }> {
  const fetchImpl: FetchLike = input.fetchImpl ?? ((destino, init) => fetch(destino, init))
  const respuesta = await fetchImpl(url, {
    headers: { ...input.headers },
    signal: input.signal,
  })

  if (!respuesta.ok) throw new Error(`la playlist respondió ${respuesta.status}`)

  const texto = await respuesta.text()
  if (texto.length > MAX_PLAYLIST_TEXT) throw new Error('la playlist es demasiado grande')
  if (!texto.trimStart().startsWith('#EXTM3U')) throw new Error('la playlist no es un HLS')

  return { texto, urlFinal: url }
}

/**
 * Del master a la variante con más ancho de banda.
 *
 * Es la misma elección que hace el reproductor cuando no hay preferencia: bajar
 * todas las variantes sería multiplicar el tamaño por el número de calidades.
 */
function varianteElegida(texto: string, base: string): { url: string } | undefined {
  const lineas = texto.split(/\r?\n/)
  let mejor: { url: string; bandwidth: number } | undefined

  for (let indice = 0; indice < lineas.length; indice += 1) {
    const linea = lineas[indice]?.trim() ?? ''
    if (!linea.startsWith('#EXT-X-STREAM-INF')) continue

    const ancho = /BANDWIDTH=(\d+)/.exec(linea)?.[1]
    const uri = lineas.slice(indice + 1).find((candidata) => {
      const limpia = candidata.trim()
      return limpia !== '' && !limpia.startsWith('#')
    })

    if (ancho === undefined || uri === undefined) continue

    const banda = Number(ancho)
    if (mejor === undefined || banda > mejor.bandwidth) {
      mejor = { url: new URL(uri.trim(), base).toString(), bandwidth: banda }
    }
  }

  return mejor === undefined ? undefined : { url: mejor.url }
}

function extensionDe(url: string): string {
  const encontrada = /\.([a-z0-9]{1,5})(?:[?#]|$)/i.exec(new URL(url).pathname)?.[1]

  return (encontrada ?? 'ts').toLowerCase()
}

/**
 * La duración que declara un `#EXTINF`, en segundos.
 *
 * Es lo único que la playlist dice del tamaño del episodio: cuánto dura. Con eso
 * y lo que pesan los segmentos ya bajados se puede proyectar el total, que es lo
 * que la barra necesita para no quedarse girando. Un valor que no es un número
 * positivo no cuenta.
 */
export function duracionDeExtinf(linea: string): number | undefined {
  const valor = /^#EXTINF:\s*([0-9]+(?:\.[0-9]+)?)/.exec(linea.trim())?.[1]
  if (valor === undefined) return undefined

  const segundos = Number(valor)

  return Number.isFinite(segundos) && segundos > 0 ? segundos : undefined
}

/** Cuánto dura la playlist entera: la suma de sus `#EXTINF`. */
export function duracionDePlaylist(texto: string): number {
  let total = 0

  for (const linea of texto.split(/\r?\n/)) {
    total += duracionDeExtinf(linea) ?? 0
  }

  return total
}

/**
 * Reescribe la playlist con nombres locales y descarga lo que nombra.
 *
 * `#EXT-X-KEY` con un método que no sea `NONE` se rechaza: sin descifrado, el
 * archivo no se podría reproducir y el usuario tendría una descarga rota que
 * parece completa.
 */
async function descargarSegmentos(
  texto: string,
  base: string,
  input: HlsDownloadInput,
  fetchImpl: FetchLike,
): Promise<{ lineas: string[]; segmentos: number; bytes: number }> {
  const lineas: string[] = []
  const duracionTotal = duracionDePlaylist(texto)
  let segmentos = 0
  let iniciales = 0
  let bytes = 0
  let bytesIniciales = 0
  let duracionHecha = 0
  let duracionPendiente = 0

  /**
   * El total que se enseña mientras se baja, medido con lo que ya se bajó.
   *
   * El HLS no publica el peso del episodio, pero sí su duración: lo que pesó la
   * parte descargada, repartido por los segundos que dura, da un bitrate medido
   * con el que se proyecta el resto. Los bytes del `#EXT-X-MAP` no se reparten
   * por duración —no duran nada y se pagan una vez—, así que van aparte. Al
   * terminar, el total deja de ser proyección: es lo que hay en disco.
   */
  const estimarTotal = (hecha: number, bajados: number): number | undefined => {
    if (duracionTotal <= 0 || hecha <= 0) return undefined
    if (hecha >= duracionTotal) return Math.round(bajados)

    const bytesPorSegundo = (bajados - bytesIniciales) / hecha

    return Math.round(bytesIniciales + bytesPorSegundo * duracionTotal)
  }

  const avisar = (hecha: number, bajados: number): void => {
    input.onProgress?.(bajados, estimarTotal(hecha, bajados))
  }

  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trimEnd()

    if (linea.startsWith('#EXT-X-KEY')) {
      const metodo = /METHOD=([^,\s]+)/.exec(linea)?.[1]?.toUpperCase()
      if (metodo !== undefined && metodo !== 'NONE') {
        throw new Error(`el HLS está cifrado (${metodo}) y no se puede descargar`)
      }
      lineas.push(linea)
      continue
    }

    if (linea.startsWith('#EXT-X-MAP')) {
      const uri = /URI="([^"]+)"/.exec(linea)?.[1]
      if (uri === undefined) {
        lineas.push(linea)
        continue
      }

      const url = new URL(uri, base).toString()
      const nombre = `init-${String(iniciales).padStart(5, '0')}.${extensionDe(url)}`
      iniciales += 1

      const bajado = await downloadFile({
        url,
        filePath: join(input.dir, nombre),
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        signal: input.signal,
        fetchImpl,
      })
      bytes += bajado.bytes
      bytesIniciales += bajado.bytes
      lineas.push(linea.replace(`URI="${uri}"`, `URI="${nombre}"`))
      continue
    }

    const duracion = duracionDeExtinf(linea)
    if (duracion !== undefined) duracionPendiente = duracion

    if (linea === '' || linea.startsWith('#')) {
      lineas.push(linea)
      continue
    }

    // Una línea que no es etiqueta es una URI de segmento.
    const url = new URL(linea, base).toString()
    const nombre = `segmento-${String(segmentos).padStart(5, '0')}.${extensionDe(url)}`
    segmentos += 1

    const bajado = await downloadFile({
      url,
      filePath: join(input.dir, nombre),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      signal: input.signal,
      fetchImpl,
      ...(input.onProgress === undefined
        ? {}
        : {
            onProgress: (parcial, tamano) => {
              // Mientras baja un segmento se le atribuye la parte de su duración
              // que ya entró: así el porcentaje avanza dentro del segmento y no
              // a saltos de cuatro segundos.
              const cuota = tamano !== undefined && tamano > 0 ? parcial / tamano : 0
              avisar(duracionHecha + duracionPendiente * cuota, bytes + parcial)
            },
          }),
    })
    bytes += bajado.bytes
    duracionHecha += duracionPendiente
    duracionPendiente = 0
    lineas.push(nombre)
    avisar(duracionHecha, bytes)
  }

  if (segmentos === 0) throw new Error('la playlist no tiene ningún segmento')
  if (!lineas.includes('#EXT-X-ENDLIST')) lineas.push('#EXT-X-ENDLIST')

  return { lineas, segmentos, bytes }
}

/**
 * Baja un HLS completo y devuelve dónde quedó.
 *
 * Si hay `remux`, el MP4 es el resultado y los segmentos se borran después: el
 * usuario quería un archivo, no un directorio. Si el remux falla, los segmentos
 * se quedan para reintentar sin volver a bajar todo.
 */
export async function downloadHls(input: HlsDownloadInput): Promise<HlsDownloadResult> {
  await mkdir(input.dir, { recursive: true })
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))

  const primera = await textoDe(input.playlistUrl, input)
  const master = primera.texto.includes('#EXT-X-STREAM-INF')
  const elegida = master ? varianteElegida(primera.texto, primera.urlFinal) : undefined
  if (master && elegida === undefined) throw new Error('el master no tiene ninguna variante')

  const media =
    elegida === undefined
      ? primera
      : await textoDe(elegida.url, { ...input, playlistUrl: elegida.url })

  const { lineas, segmentos, bytes } = await descargarSegmentos(
    media.texto,
    media.urlFinal,
    input,
    fetchImpl,
  )

  const playlistLocal = join(input.dir, 'index.m3u8')
  await writeFile(playlistLocal, `${lineas.join('\n')}\n`, 'utf8')

  if (input.remux === undefined) {
    return { kind: 'segments', path: playlistLocal, segments: segmentos, bytes }
  }

  const mp4 = input.mp4Path ?? `${input.dir}.mp4`
  try {
    await input.remux(playlistLocal, mp4, input.signal)
  } catch (cause) {
    if (input.remuxOpcional !== true) throw cause

    // Un MP4 a medias con el nombre bueno parece una descarga rota. Se borra y
    // el resultado se declara como lo que es: segmentos.
    await rm(mp4, { force: true })

    return { kind: 'segments', path: playlistLocal, segments: segmentos, bytes }
  }

  // El MP4 ya existe: los segmentos eran el andamio, no el resultado.
  await rm(input.dir, { recursive: true, force: true })

  return { kind: 'hls', path: mp4, segments: segmentos, bytes }
}

/** Lee la playlist local que dejó una descarga de segmentos. */
export async function readLocalPlaylist(playlistPath: string): Promise<string> {
  return await readFile(playlistPath, 'utf8')
}
