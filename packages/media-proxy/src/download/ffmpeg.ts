/**
 * Dónde está ffmpeg y cómo se le pide el remux.
 *
 * Vive aparte del motor porque la pregunta «¿hay ffmpeg?» se hace en dos
 * momentos —al arrancar la cola y al convertir una descarga que ya estaba en
 * disco— y la respuesta tiene que ser la misma en los dos.
 *
 * El orden de búsqueda no es casual:
 *
 * 1. **`NN_ANIME_FFMPEG`.** Es la salida de quien sabe dónde lo puso.
 * 2. **Junto al ejecutable.** Es donde el paquete de escritorio deja el binario
 *    que viaja con la aplicación; si se mira primero, el usuario no tiene que
 *    instalar nada ni tocar el PATH.
 * 3. **Las rutas donde lo dejan los instaladores.** En Windows, ni `winget` ni
 *    `scoop` ni `chocolatey` están en el PATH de una aplicación lanzada desde el
 *    menú de inicio, aunque el comando funcione en una consola recién abierta.
 * 4. **El `PATH`.** El último recurso y el que más gente ya tiene resuelto.
 *
 * Sólo se devuelve una ruta que **existe**: un `PATH` que nombra un binario
 * borrado daría un error de `spawn` en mitad de una descarga que parecía tener
 * ffmpeg.
 */

import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { RemuxFn } from './hls-download'

/** El nombre del binario en una plataforma. */
export function ffmpegFileName(platform: string): string {
  return platform === 'win32' || platform === 'windows' ? 'ffmpeg.exe' : 'ffmpeg'
}

/**
 * Los sitios donde se busca, en orden, sin contar el `PATH`.
 *
 * Exportada para poder medirla: una lista dentro de una función sólo se prueba
 * ejecutándola entera.
 *
 * Las rutas se componen con el módulo de la plataforma que se está mirando, no
 * con el del anfitrión: una prueba escrita en Linux tiene que poder comprobar la
 * lista de Windows sin que se le cuelen barras inversas o al revés.
 */
export function ffmpegCandidates(input: {
  readonly platform: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly executable: string
}): readonly string[] {
  const nombre = ffmpegFileName(input.platform)
  const windows = input.platform === 'win32' || input.platform === 'windows'
  const ruta = windows ? win32 : posix
  const candidatos: string[] = []
  const explicito = input.env.NN_ANIME_FFMPEG?.trim()
  if (explicito !== undefined && explicito !== '') candidatos.push(explicito)

  candidatos.push(ruta.join(ruta.dirname(input.executable), nombre))

  if (windows) {
    const local = input.env.LOCALAPPDATA
    const perfil = input.env.USERPROFILE
    const datos = input.env.ProgramData
    const programas = input.env.ProgramFiles

    if (local !== undefined) {
      candidatos.push(ruta.join(local, 'Microsoft', 'WinGet', 'Links', nombre))
    }
    if (perfil !== undefined) candidatos.push(ruta.join(perfil, 'scoop', 'shims', nombre))
    if (datos !== undefined) candidatos.push(ruta.join(datos, 'chocolatey', 'bin', nombre))
    if (programas !== undefined) {
      candidatos.push(ruta.join(programas, 'ffmpeg', 'bin', nombre))
    }
    candidatos.push(`C:\\ffmpeg\\bin\\${nombre}`)
  } else {
    candidatos.push('/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg')
  }

  return candidatos
}

export interface FfmpegLookup {
  readonly platform?: string | undefined
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** El ejecutable que corre: `process.execPath`, salvo en las pruebas. */
  readonly executable?: string | undefined
  readonly exists?: ((path: string) => boolean) | undefined
  /** La búsqueda en el `PATH`. `Bun.which`, salvo en las pruebas. */
  readonly which?: ((command: string) => string | null) | undefined
}

/** La ruta de ffmpeg, si hay uno al alcance. */
export function locateFfmpeg(lookup: FfmpegLookup = {}): string | undefined {
  const platform = lookup.platform ?? process.platform
  const exists = lookup.exists ?? existsSync
  const candidatos = ffmpegCandidates({
    platform,
    env: lookup.env ?? process.env,
    executable: lookup.executable ?? process.execPath,
  })

  for (const candidato of candidatos) {
    if (exists(candidato)) return candidato
  }

  const which = lookup.which ?? ((command: string) => Bun.which(command))

  return which('ffmpeg') ?? undefined
}

/**
 * El remux real: copia los códecs a MP4 sin recodificar.
 *
 * Sin shell y con argumentos en array. La playlist local no tiene ninguna URL de
 * red, así que ffmpeg no sale a ningún sitio; el `protocol_whitelist` lo deja
 * escrito por si el archivo cambiara.
 */
export function createFfmpegRemux(ffmpegPath: string): RemuxFn {
  return async (playlistPath, outputPath, signal) => {
    const proceso = Bun.spawn(
      [
        ffmpegPath,
        '-y',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file',
        '-i',
        playlistPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    )

    const abortar = (): void => {
      proceso.kill()
    }
    signal.addEventListener('abort', abortar, { once: true })

    try {
      const codigo = await proceso.exited
      if (codigo !== 0) {
        const error = await new Response(proceso.stderr).text()
        throw new Error(`ffmpeg falló (${codigo}): ${error.slice(-400)}`)
      }
    } finally {
      signal.removeEventListener('abort', abortar)
    }
  }
}
