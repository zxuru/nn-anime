import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  createPlaylistCache,
  defaultKeyPath,
  defaultSegPath,
  isPlaylist,
  MAX_PLAYLIST_BYTES,
  MAX_PLAYLIST_LINES,
  PLAYLIST_TTL_MS,
  playlistTooLarge,
  playlistTooManyLines,
  rewritePlaylist,
} from './hls'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))

async function fixture(nombre: string): Promise<string> {
  return await readFile(`${FIXTURES}${nombre}`, 'utf8')
}

function reescribir(text: string, baseUrl = 'https://fixture.invalid/aurora/1/sub/master.m3u8') {
  return rewritePlaylist(text, { ticket: 'TICKET', baseUrl })
}

describe('detección', () => {
  test('por extensión', () => {
    expect(isPlaylist('https://ejemplo/a/master.m3u8')).toBe(true)
    expect(isPlaylist('https://ejemplo/a/master.M3U8?x=1')).toBe(true)
    expect(isPlaylist('https://ejemplo/a/segmento.ts')).toBe(false)
  })

  test('por tipo declarado, aunque la extensión no lo diga', () => {
    expect(isPlaylist('https://ejemplo/stream?id=7', 'application/vnd.apple.mpegurl')).toBe(true)
    expect(isPlaylist('https://ejemplo/stream', 'application/x-mpegURL; charset=utf-8')).toBe(true)
    expect(isPlaylist('https://ejemplo/a.mp4', 'video/mp4')).toBe(false)
  })

  test('sin tipo ni extensión, no es una playlist', () => {
    expect(isPlaylist('https://ejemplo/stream')).toBe(false)
  })
})

describe('reescritura contra los fixtures versionados', () => {
  test('el master coincide con la salida esperada', async () => {
    const salida = reescribir(await fixture('master.m3u8'))

    expect(salida.text).toBe(await fixture('master.expected.m3u8'))
  })

  test('la playlist de segmentos coincide con la salida esperada', async () => {
    const salida = reescribir(await fixture('media.m3u8'))

    expect(salida.text).toBe(await fixture('media.expected.m3u8'))
  })

  test('conserva el orden y los atributos de `#EXT-X-STREAM-INF`', async () => {
    const salida = reescribir(await fixture('master.m3u8'))
    const etiquetas = salida.text
      .split('\n')
      .filter((linea) => linea.startsWith('#EXT-X-STREAM-INF'))

    expect(etiquetas).toHaveLength(2)
    expect(etiquetas[0]).toContain('BANDWIDTH=1400000')
    expect(etiquetas[0]).toContain('CODECS="avc1.4d401f,mp4a.40.2"')
    expect(etiquetas[1]).toContain('RESOLUTION=1920x1080')
  })

  test('las URIs originales salen en orden, resueltas', async () => {
    const salida = reescribir(await fixture('media.m3u8'))

    expect(salida.uris).toEqual([
      'https://fixture.invalid/aurora/1/sub/segmento-0.ts',
      'https://fixture.invalid/aurora/1/sub/sub/segmento-1.ts',
      'https://otro.example/absoluto-2.ts',
    ])
  })
})

describe('resolución de direcciones', () => {
  test('una sub-playlist se resuelve contra la playlist, no contra el master', () => {
    const salida = rewritePlaylist('#EXTM3U\n720/index.m3u8\n', {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a/master.m3u8',
    })

    expect(salida.uris).toEqual(['https://ejemplo/a/720/index.m3u8'])
    expect(salida.text).toContain('/stream/T/seg/0')
  })

  test('una absoluta no se toca al resolver, sólo al reescribir', () => {
    const salida = rewritePlaylist('https://otro.example/x.ts\n', {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a/master.m3u8',
    })

    expect(salida.uris).toEqual(['https://otro.example/x.ts'])
  })

  test('una raíz se resuelve contra el host de la playlist', () => {
    const salida = rewritePlaylist('/raiz/x.ts\n', {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a/b/master.m3u8',
    })

    expect(salida.uris).toEqual(['https://ejemplo/raiz/x.ts'])
  })

  test('una dirección que no se puede resolver se conserva tal cual', () => {
    const salida = rewritePlaylist('http://[mal\n', { ticket: 'T', baseUrl: 'no-es-url' })

    expect(salida.uris).toEqual(['http://[mal'])
  })
})

describe('lo que no se toca', () => {
  test('las etiquetas y las líneas vacías se copian literales', () => {
    const original = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n\n#EXTINF:4.0,\nseg.ts\n#EXT-X-ENDLIST'
    const salida = rewritePlaylist(original, { ticket: 'T', baseUrl: 'https://ejemplo/a.m3u8' })
    const lineas = salida.text.split('\n')

    expect(lineas[0]).toBe('#EXTM3U')
    expect(lineas[1]).toBe('#EXT-X-TARGETDURATION:4')
    expect(lineas[2]).toBe('')
    expect(lineas[3]).toBe('#EXTINF:4.0,')
    expect(lineas[5]).toBe('#EXT-X-ENDLIST')
  })

  test('el sangrado de la línea se conserva', () => {
    const salida = rewritePlaylist('#EXTM3U\n  seg.ts\n', {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a.m3u8',
    })

    expect(salida.text.split('\n')[1]).toBe('  /stream/T/seg/0')
  })

  test('la ruta del proxy es la del spec', () => {
    expect(defaultSegPath('abc', 3)).toBe('/stream/abc/seg/3')
  })
})

describe('tope de tamaño', () => {
  test('el tope es el del spec', () => {
    expect(MAX_PLAYLIST_BYTES).toBe(4 * 1024 * 1024)
  })

  test('el error dice cuántos bytes llegaron y cuál es el tope', () => {
    const error = playlistTooLarge(MAX_PLAYLIST_BYTES + 1)

    expect(error.message).toContain(String(MAX_PLAYLIST_BYTES))
    expect(error.context.bytes).toBe(MAX_PLAYLIST_BYTES + 1)
    expect(error.context.max).toBe(MAX_PLAYLIST_BYTES)
  })
})

describe('claves, inicializadores y discontinuidad', () => {
  test('la playlist cifrada coincide con la salida esperada', async () => {
    const salida = reescribir(await fixture('cifrado.m3u8'))

    expect(salida.text).toBe(await fixture('cifrado.expected.m3u8'))
  })

  test('cada clave apunta a su propia ruta y las dos se resuelven', async () => {
    const salida = reescribir(await fixture('cifrado.m3u8'))

    expect(salida.keys).toEqual([
      'https://fixture.invalid/aurora/1/sub/init.mp4',
      'https://fixture.invalid/aurora/1/sub/clave-1.bin',
      'https://otro.example/clave-2.bin',
    ])
    expect(salida.text).toContain('URI="/stream/TICKET/key/0"')
    expect(salida.text).toContain('URI="/stream/TICKET/key/1"')
    expect(salida.text).toContain('URI="/stream/TICKET/key/2"')
  })

  test('`#EXT-X-DISCONTINUITY` se conserva, y en su sitio', async () => {
    const salida = reescribir(await fixture('cifrado.m3u8'))
    const lineas = salida.text.split('\n')

    expect(lineas.filter((linea) => linea === '#EXT-X-DISCONTINUITY')).toHaveLength(1)
    // Va después del primer segmento y antes de la segunda clave.
    expect(lineas.indexOf('#EXT-X-DISCONTINUITY')).toBeGreaterThan(
      lineas.indexOf('/stream/TICKET/seg/0'),
    )
    expect(lineas.indexOf('#EXT-X-DISCONTINUITY')).toBeLessThan(
      lineas.indexOf('#EXT-X-KEY:METHOD=AES-128,URI="/stream/TICKET/key/2",IV=0x9c7d'),
    )
  })

  test('los demás atributos de la etiqueta no se tocan', async () => {
    const salida = reescribir(await fixture('cifrado.m3u8'))

    expect(salida.text).toContain('#EXT-X-KEY:METHOD=AES-128,URI="/stream/TICKET/key/1",IV=0x1234')
    expect(salida.text).toContain('#EXT-X-KEY:METHOD=AES-128,URI="/stream/TICKET/key/2",IV=0x9c7d')
  })

  test('una etiqueta desconocida con URI no se toca: no es una clave', () => {
    const salida = rewritePlaylist('#EXTM3U\n#EXT-X-INVENTADA:URI="x.bin"\n', {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a.m3u8',
    })

    expect(salida.keys).toEqual([])
    expect(salida.text).toContain('#EXT-X-INVENTADA:URI="x.bin"')
  })

  test('una clave con comillas simples también se reescribe', () => {
    const salida = rewritePlaylist("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI='k.bin'\n", {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a.m3u8',
    })

    expect(salida.keys).toEqual(['https://ejemplo/k.bin'])
    expect(salida.text).toContain('URI="/stream/T/key/0"')
  })

  test('la ruta de una clave es la del spec', () => {
    expect(defaultKeyPath('abc', 2)).toBe('/stream/abc/key/2')
  })

  test('sin `URI` no hay nada que reescribir', () => {
    const salida = rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n', {
      ticket: 'T',
      baseUrl: 'https://ejemplo/a.m3u8',
    })

    expect(salida.keys).toEqual([])
    expect(salida.text).toContain('#EXT-X-KEY:METHOD=NONE')
  })
})

describe('tope de líneas', () => {
  test('el tope es el del spec', () => {
    expect(MAX_PLAYLIST_LINES).toBe(5000)
  })

  test('una playlist con más líneas se rechaza antes de reescribir', () => {
    const enorme = `#EXTM3U\n${'#EXTINF:4.0,\nseg.ts\n'.repeat(MAX_PLAYLIST_LINES)}`

    expect(() =>
      rewritePlaylist(enorme, { ticket: 'T', baseUrl: 'https://ejemplo/a.m3u8' }),
    ).toThrow(/líneas/)
  })

  test('justo en el tope, se reescribe', () => {
    const justa = `#EXTM3U\n${'#EXTINF:4.0,\nseg.ts\n'.repeat(2000)}`
    const salida = rewritePlaylist(justa, { ticket: 'T', baseUrl: 'https://ejemplo/a.m3u8' })

    expect(salida.uris.length).toBe(2000)
  })

  test('el error dice cuántas líneas llegaron y cuál es el tope', () => {
    const error = playlistTooManyLines(MAX_PLAYLIST_LINES + 1)

    expect(error.message).toContain(String(MAX_PLAYLIST_LINES))
    expect(error.context.lines).toBe(MAX_PLAYLIST_LINES + 1)
  })
})

describe('caché de playlists', () => {
  test('guarda y devuelve', () => {
    const cache = createPlaylistCache()

    cache.set('t1', { text: 'texto', uris: ['u'], keys: [] })

    expect(cache.get('t1')?.text).toBe('texto')
    expect(cache.size()).toBe(1)
  })

  test('mientras se pida, vive; sin que nadie la pida, vence', () => {
    let ahora = 1_000_000
    const cache = createPlaylistCache({ now: () => ahora })
    cache.set('t1', { text: 'texto', uris: ['u'], keys: [] })

    // Diez peticiones de segmento, una cada nueve segundos: el índice se sigue
    // usando, así que la lista sigue viva. Sin esto, un episodio se quedaba sin
    // índice a los diez segundos y todos los segmentos pasaban a ser 404.
    for (let vuelta = 0; vuelta < 10; vuelta++) {
      ahora += PLAYLIST_TTL_MS - 1_000
      expect(cache.get('t1')?.text, `vuelta ${vuelta}`).toBe('texto')
    }

    ahora += PLAYLIST_TTL_MS
    expect(cache.get('t1')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  test('prune quita las vencidas y deja las vivas', () => {
    let ahora = 1_000_000
    const cache = createPlaylistCache({ now: () => ahora })
    cache.set('vieja', { text: 'a', uris: [], keys: [] })

    ahora += PLAYLIST_TTL_MS
    cache.set('nueva', { text: 'b', uris: [], keys: [] })

    expect(cache.prune()).toBe(1)
    expect(cache.get('nueva')?.text).toBe('b')
  })

  test('una clave que no está devuelve nada, sin lanzar', () => {
    expect(createPlaylistCache().get('no-existe')).toBeUndefined()
  })
})
