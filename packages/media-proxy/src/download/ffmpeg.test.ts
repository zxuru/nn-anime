import { describe, expect, test } from 'bun:test'
import { ffmpegCandidates, locateFfmpeg } from './ffmpeg'

/**
 * La búsqueda de ffmpeg.
 *
 * Ninguna prueba toca el disco ni el `PATH` de verdad: se inyectan `exists`,
 * `env` y `which`, que es la razón de que esas costuras existan. Sin eso, un
 * portátil con `ffmpeg` instalado y un `CI` sin él darían resultados distintos
 * para la misma prueba.
 */

const WIN = 'C:\\Program Files\\rona\\rona.exe'
const POSIX = '/opt/rona/rona'

function entorno(datos: Record<string, string | undefined> = {}): Record<string, string> {
  const limpio: Record<string, string> = {}
  for (const [clave, valor] of Object.entries(datos)) {
    if (valor !== undefined) limpio[clave] = valor
  }

  return limpio
}

describe('la búsqueda de ffmpeg', () => {
  test('sin nada en el entorno no se inventa una ruta', () => {
    expect(
      locateFfmpeg({
        platform: 'linux',
        env: entorno(),
        executable: POSIX,
        exists: () => false,
        which: () => null,
      }),
    ).toBeUndefined()
  })

  test('`RONA_FFMPEG` manda sobre lo demás', () => {
    const ruta = '/datos/ffmpeg-custom'
    expect(
      locateFfmpeg({
        platform: 'linux',
        env: entorno({ RONA_FFMPEG: ruta }),
        executable: POSIX,
        exists: (candidato) => candidato === ruta,
        which: () => '/usr/bin/ffmpeg',
      }),
    ).toBe(ruta)
  })

  test('una ruta del entorno que no existe no se devuelve: se sigue buscando', () => {
    const elegido = locateFfmpeg({
      platform: 'linux',
      env: entorno({ RONA_FFMPEG: '/no/existe/ffmpeg' }),
      executable: POSIX,
      exists: (candidato) => candidato === '/opt/rona/ffmpeg',
      which: () => null,
    })

    expect(elegido).toBe('/opt/rona/ffmpeg')
  })

  test('el binario al lado del ejecutable gana al del PATH', () => {
    expect(
      locateFfmpeg({
        platform: 'linux',
        env: entorno(),
        executable: '/opt/rona/rona',
        exists: (candidato) => candidato === '/opt/rona/ffmpeg',
        which: () => '/usr/bin/ffmpeg',
      }),
    ).toBe('/opt/rona/ffmpeg')
  })

  test('en Windows se miran los sitios donde dejan el binario los instaladores', () => {
    const candidatos = ffmpegCandidates({
      platform: 'win32',
      env: entorno({
        LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\ana',
        ProgramData: 'C:\\ProgramData',
        ProgramFiles: 'C:\\Program Files',
      }),
      executable: WIN,
    })

    expect(candidatos).toContain(
      'C:\\Users\\ana\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
    )
    expect(candidatos).toContain('C:\\Users\\ana\\scoop\\shims\\ffmpeg.exe')
    expect(candidatos).toContain('C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe')
    expect(candidatos).toContain('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')
    // Y el que viaja con la aplicación, primero entre los que no son del entorno.
    expect(candidatos[0]).toBe('C:\\Program Files\\rona\\ffmpeg.exe')
  })

  test('el `PATH` es el último recurso', () => {
    expect(
      locateFfmpeg({
        platform: 'win32',
        env: entorno(),
        executable: WIN,
        exists: () => false,
        which: () => 'C:\\tools\\ffmpeg.exe',
      }),
    ).toBe('C:\\tools\\ffmpeg.exe')
  })
})
