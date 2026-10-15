import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analizarPlaylist,
  atributos,
  buscarArchivos,
  dirDeRepos,
  leerOpciones,
  lineasVeladas,
} from './sonda-subtitulos'

/**
 * Las piezas de la sonda que se pueden medir sin red.
 *
 * Resolver un título y bajar su manifiesto depende de sitios de terceros y no se
 * prueba; lo que sí se prueba es lo que se **lee** de ese manifiesto, que es de
 * donde sale la conclusión de la sonda: contar variantes, contar pistas y no
 * imprimir un `URI` firmado.
 */

/** El master de VixSrc, con la forma que se midió en «El Faro». */
const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Italian",LANGUAGE="ita",DEFAULT=NO,URI="https://x.invalid/a?token=secreto"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="eng",DEFAULT=YES,URI="https://x.invalid/b?token=secreto"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="English",LANGUAGE="eng",AUTOSELECT=YES,FORCED=NO,URI="https://x.invalid/c.vtt?token=secreto"',
  '#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,FRAME-RATE=24,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio",SUBTITLES="sub"',
  '1080/index.m3u8',
  '',
].join('\n')

describe('los atributos de una etiqueta', () => {
  test('la coma de dentro de las comillas no parte el atributo', () => {
    // `CODECS="avc1.640028,mp4a.40.2"` es un atributo, no dos: cortar por comas
    // es leer mal todas las listas de estos sitios.
    const campos = atributos(
      '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1,mp4a",RESOLUTION=1920x1080',
    )

    expect(campos.get('CODECS')).toBe('avc1,mp4a')
    expect(campos.get('RESOLUTION')).toBe('1920x1080')
  })
})

describe('analizar un manifiesto', () => {
  test('cuenta variantes, pistas y sus tipos', () => {
    const resumen = analizarPlaylist(MASTER)

    expect(resumen.tipo).toBe('maestra')
    expect(resumen.variantes.length).toBe(1)
    expect(resumen.variantes[0]).toEqual({
      bandaAncha: '4500000',
      resolucion: '1920x1080',
      codecs: 'avc1.640028,mp4a.40.2',
      fotogramas: '24',
    })
    expect(resumen.pistas.filter((pista) => pista.tipo === 'SUBTITLES').length).toBe(1)
    expect(resumen.pistas.filter((pista) => pista.tipo === 'AUDIO').length).toBe(2)
  })

  test('la pista de subtítulos conserva lo que decide si sirve', () => {
    const subtitulos = analizarPlaylist(MASTER).pistas.filter((pista) => pista.tipo === 'SUBTITLES')

    expect(subtitulos[0]).toEqual({
      tipo: 'SUBTITLES',
      grupo: 'sub',
      idioma: 'eng',
      nombre: 'English',
      porDefecto: false,
      autoseleccionable: true,
      forzada: false,
      canales: undefined,
    })
  })

  test('una lista con segmentos es de medios, no la maestra', () => {
    const medios = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="k.bin"',
      '#EXTINF:4.0,',
      'segmento-0.ts',
      '#EXTINF:4.0,',
      'segmento-1.ts',
    ].join('\n')
    const resumen = analizarPlaylist(medios)

    expect(resumen.tipo).toBe('multimedia')
    expect(resumen.segmentos).toBe(2)
    expect(resumen.claves).toBe(1)
    expect(resumen.variantes.length).toBe(0)
  })
})

describe('las etiquetas que se imprimen en crudo', () => {
  test('el valor de `URI` va velado y lo demás se conserva', () => {
    // El manifiesto de estos sitios va firmado en la consulta: imprimir el `URI`
    // tal cual es regalar el testigo del upstream en una captura de pantalla.
    const lineas = lineasVeladas(MASTER)
    const subtitulos = lineas.find((linea) => linea.includes('TYPE=SUBTITLES')) ?? ''

    expect(subtitulos).toContain('NAME="English"')
    expect(subtitulos).toContain('LANGUAGE="eng"')
    expect(subtitulos).toContain('URI="[velado]"')
    expect(lineas.join('\n')).not.toContain('secreto')
    expect(lineas.join('\n')).not.toContain('x.invalid')
  })

  test('no se imprimen las líneas de segmento, que son miles', () => {
    const lineas = lineasVeladas(
      ['#EXTINF:4.0,', '#EXT-X-BYTERANGE:100@0', 'segmento.ts'].join('\n'),
    )

    expect(lineas).toEqual([])
  })
})

describe('las opciones de la línea de órdenes', () => {
  test('en Windows los plugins viven bajo LOCALAPPDATA', () => {
    expect(dirDeRepos({ LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' })).toBe(
      join('C:\\Users\\ana\\AppData\\Local', 'nn-anime', 'repos'),
    )
  })

  test('fuera de Windows, bajo XDG_DATA_HOME o el directorio personal', () => {
    expect(dirDeRepos({ XDG_DATA_HOME: '/datos' })).toBe(join('/datos', 'nn-anime', 'repos'))
    expect(dirDeRepos({ HOME: '/home/ana' })).toBe(
      join('/home/ana', '.local', 'share', 'nn-anime', 'repos'),
    )
  })

  test('`--buscar` es obligatorio: la sonda mide un título, no el primero del catálogo', () => {
    expect(() => leerOpciones(['--plugin', 'p.ts'], {})).toThrow('falta --buscar')
  })

  test('lee las órdenes con su valor y el modo crudo sin él', () => {
    const opciones = leerOpciones(
      ['--plugin', 'p.ts', '--buscar', 'El Faro', '--indice', '2', '--episodio', '3', '--crudo'],
      {},
    )

    expect(opciones).toEqual({
      plugin: 'p.ts',
      archivo: 'cuevana3.ts',
      dir: expect.any(String),
      buscar: 'El Faro',
      indice: 2,
      episodio: 3,
      crudo: true,
    })
  })

  test('un número que no es un entero no negativo se rechaza', () => {
    expect(() => leerOpciones(['--buscar', 'x', '--indice', '-1'], {})).toThrow('--indice')
    expect(() => leerOpciones(['--buscar', 'x', '--episodio', '1.5'], {})).toThrow('--episodio')
  })

  test('una orden desconocida se nombra en vez de ignorarse', () => {
    expect(() => leerOpciones(['--buscar', 'x', '--crudo=si'], {})).toThrow('--crudo=si')
  })
})

describe('encontrar el plugin instalado', () => {
  test('busca por nombre hasta cierta hondura y no más', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'nn-anime-sonda-'))

    try {
      const fondo = join(raiz, 'a', 'b', 'c', 'd', 'e')
      await mkdir(join(raiz, 'a', 'b'), { recursive: true })
      await mkdir(fondo, { recursive: true })
      await writeFile(join(raiz, 'a', 'cuevana3.ts'), 'export default {}\n')
      await writeFile(join(fondo, 'cuevana3.ts'), 'export default {}\n')

      const encontrados = await buscarArchivos(raiz, 'cuevana3.ts')

      expect(encontrados).toEqual([join(raiz, 'a', 'cuevana3.ts')])
    } finally {
      await rm(raiz, { recursive: true, force: true })
    }
  })

  test('un directorio que no existe devuelve nada y no lanza', async () => {
    expect(await buscarArchivos(join(tmpdir(), 'nn-anime-no-existe-jamas'), 'x.ts')).toEqual([])
  })
})
