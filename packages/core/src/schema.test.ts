import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { type PublicStreamSource, toPublicStreamSource } from './models'
import {
  animeDetailSchema,
  cacheHitSchema,
  candidateSchema,
  episodeSchema,
  feedEntrySchema,
  providerCapabilitiesSchema,
  providerRefSchema,
  searchResultSchema,
  streamRequestSchema,
  streamSourceSchema,
  subtitleTrackSchema,
  watchEventInputSchema,
} from './schema'

const REF = { providerId: 'fuente-ejemplo', value: 'titulo-1' }

interface SafeParser {
  safeParse(
    value: unknown,
  ): { success: true; data: unknown } | { success: false; error: { message: string } }
}

interface ParseCase {
  readonly name: string
  readonly parser: SafeParser
  readonly valid: unknown
  readonly invalid: unknown
  readonly invalidField: string
}

function outcome(parser: SafeParser, value: unknown): { success: boolean; message: string } {
  const result = parser.safeParse(value)
  return result.success
    ? { success: true, message: '' }
    : { success: false, message: result.error.message }
}

const CASES: readonly ParseCase[] = [
  {
    name: 'providerRefSchema',
    parser: providerRefSchema,
    valid: REF,
    invalid: { providerId: 7, value: 'titulo-1' },
    invalidField: 'providerId',
  },
  {
    name: 'searchResultSchema',
    parser: searchResultSchema,
    valid: { ref: REF, title: 'Un título' },
    invalid: { ref: REF, title: 9 },
    invalidField: 'title',
  },
  {
    name: 'animeDetailSchema',
    parser: animeDetailSchema,
    valid: { ref: REF, title: 'Un título', genres: ['Acción'], studios: ['Estudio'] },
    invalid: { ref: REF, title: 'Un título', genres: 'Acción', studios: [] },
    invalidField: 'genres',
  },
  {
    name: 'episodeSchema',
    parser: episodeSchema,
    valid: { ref: REF, animeRef: REF, number: 1, mode: 'sub' },
    invalid: { ref: REF, animeRef: REF, number: 'uno', mode: 'sub' },
    invalidField: 'number',
  },
  {
    name: 'subtitleTrackSchema',
    parser: subtitleTrackSchema,
    valid: { lang: 'es', label: 'Español', url: 'https://ejemplo/es.vtt', format: 'vtt' },
    invalid: { lang: 'es', label: 'Español', url: 'https://ejemplo/es.txt', format: 'txt' },
    invalidField: 'format',
  },
  {
    name: 'streamSourceSchema',
    parser: streamSourceSchema,
    valid: { url: 'https://ejemplo/master.m3u8', kind: 'hls' },
    invalid: { url: 'https://ejemplo/master.mpd', kind: 'dash' },
    invalidField: 'kind',
  },
  {
    name: 'streamRequestSchema',
    parser: streamRequestSchema,
    valid: { episodeRef: REF, mode: 'dub' },
    invalid: { episodeRef: REF, mode: 'raw' },
    invalidField: 'mode',
  },
  {
    name: 'watchEventInputSchema',
    parser: watchEventInputSchema,
    valid: {
      animeRef: REF,
      episodeRef: REF,
      mode: 'sub',
      positionS: 0,
      durationS: 1440,
      startedAt: new Date('2026-10-10T12:00:00.000Z'),
    },
    invalid: {
      animeRef: REF,
      episodeRef: REF,
      mode: 'sub',
      positionS: -1,
      durationS: 1440,
      startedAt: new Date('2026-10-10T12:00:00.000Z'),
    },
    invalidField: 'positionS',
  },
  {
    name: 'candidateSchema',
    parser: candidateSchema,
    valid: { ref: REF, title: 'Un título', tags: ['Acción'], studios: [] },
    invalid: { ref: REF, title: 'Un título', tags: 'Acción', studios: [] },
    invalidField: 'tags',
  },
]

describe('schemas: aceptan la forma canónica', () => {
  for (const parseCase of CASES) {
    test(`${parseCase.name} acepta un objeto válido`, () => {
      expect(outcome(parseCase.parser, parseCase.valid).success).toBe(true)
    })
  }
})

describe('schemas: rechazan un campo mal tipado y lo nombran', () => {
  for (const parseCase of CASES) {
    test(`${parseCase.name} rechaza el campo ${parseCase.invalidField}`, () => {
      const result = outcome(parseCase.parser, parseCase.invalid)

      expect(result.success).toBe(false)
      expect(result.message).toContain(parseCase.invalidField)
    })
  }
})

describe('schemas: son estrictos con las claves desconocidas', () => {
  test('un campo de más se rechaza en lugar de ignorarse', () => {
    const result = outcome(providerRefSchema, { ...REF, sobra: true })

    expect(result.success).toBe(false)
    expect(result.message).toContain('sobra')
  })

  test('un campo de más también se rechaza en un schema extendido', () => {
    const result = outcome(animeDetailSchema, {
      ref: REF,
      title: 'Un título',
      genres: ['Acción'],
      studios: [],
      sobra: true,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('sobra')
  })
})

describe('esquema de URL: la frontera rechaza esquemas peligrosos', () => {
  test('acepta http y https', () => {
    for (const url of ['http://ejemplo/a.mp4', 'https://ejemplo/a.m3u8']) {
      expect(outcome(streamSourceSchema, { url, kind: 'file' }).success, url).toBe(true)
    }
  })

  test('rechaza un espacio o un carácter de control dentro de la dirección', () => {
    // `new URL` los descarta o los normaliza, así que la cadena validada no es
    // la que se pediría: se rechazan en la frontera.
    const urls = [
      ' http://ejemplo/a.mp4',
      'http://ejemplo/a.mp4 ',
      'http://ejemplo/a\n.mp4',
      'http://ejemplo/a\t.mp4',
      'http://ejemplo/a\u0000.mp4',
    ]

    for (const url of urls) {
      expect(outcome(streamSourceSchema, { url, kind: 'file' }).success, JSON.stringify(url)).toBe(
        false,
      )
    }
  })

  test('rechaza una dirección sin autoridad explícita', () => {
    // `new URL('http:/x')` es `http://x/`: lo validado no es lo pedido.
    expect(outcome(streamSourceSchema, { url: 'http:/x', kind: 'file' }).success).toBe(false)
  })

  test('rechaza credenciales, que se persistirían en claro con la dirección', () => {
    expect(
      outcome(streamSourceSchema, { url: 'http://usuario:clave@ejemplo/a.mp4', kind: 'file' })
        .success,
    ).toBe(false)
  })

  test('el esquema en mayúsculas sigue valiendo', () => {
    expect(outcome(streamSourceSchema, { url: 'HTTP://ejemplo/a.mp4', kind: 'file' }).success).toBe(
      true,
    )
  })

  test('rechaza javascript:', () => {
    const result = outcome(streamSourceSchema, {
      url: 'javascript:alert(1)',
      kind: 'file',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('http')
  })

  test('rechaza data:', () => {
    expect(
      outcome(streamSourceSchema, { url: 'data:text/html,<script>1</script>', kind: 'file' })
        .success,
    ).toBe(false)
  })

  test('rechaza file:', () => {
    expect(outcome(streamSourceSchema, { url: 'file:///etc/passwd', kind: 'file' }).success).toBe(
      false,
    )
  })

  test('rechaza una portada con javascript:', () => {
    expect(
      outcome(searchResultSchema, { ref: REF, title: 'T', coverUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false)
  })

  test('acepta una portada https', () => {
    expect(
      outcome(searchResultSchema, {
        ref: REF,
        title: 'T',
        coverUrl: 'https://ejemplo/portada.webp',
      }).success,
    ).toBe(true)
  })

  test('rechaza una pista de subtítulos con data:', () => {
    expect(
      outcome(subtitleTrackSchema, {
        lang: 'es',
        label: 'Español',
        url: 'data:text/vtt,WEBVTT',
        format: 'vtt',
      }).success,
    ).toBe(false)
  })

  test('rechaza una cadena que no es una URL', () => {
    expect(outcome(streamSourceSchema, { url: 'no soy una url', kind: 'file' }).success).toBe(false)
  })
})

describe('streamSourceSchema: validación de headers', () => {
  test('acepta nombres y valores válidos', () => {
    const result = outcome(streamSourceSchema, {
      url: 'https://ejemplo/master.m3u8',
      kind: 'hls',
      headers: { Referer: 'https://sitio.example', 'User-Agent': 'nn-anime' },
    })

    expect(result.success).toBe(true)
  })

  test('rechaza un nombre de header que no cumple el patrón', () => {
    const result = outcome(streamSourceSchema, {
      url: 'https://ejemplo/master.m3u8',
      kind: 'hls',
      headers: { 'X Roto': 'valor' },
    })

    expect(result.success).toBe(false)
  })

  test('rechaza un valor con salto de línea, que inyectaría una cabecera', () => {
    const result = outcome(streamSourceSchema, {
      url: 'https://ejemplo/master.m3u8',
      kind: 'hls',
      headers: { Referer: 'https://sitio.example\r\nX-Inyectada: sí' },
    })

    expect(result.success).toBe(false)
  })

  test('rechaza un valor con carácter nulo', () => {
    const result = outcome(streamSourceSchema, {
      url: 'https://ejemplo/master.m3u8',
      kind: 'hls',
      headers: { Referer: 'https://sitio.example\0' },
    })

    expect(result.success).toBe(false)
  })
})

describe('toPublicStreamSource', () => {
  test('quita los headers y conserva el resto', () => {
    const subtitles = [
      { lang: 'es', label: 'Español', url: 'https://ejemplo/es.vtt', format: 'vtt' as const },
    ]

    const publicSource = toPublicStreamSource({
      url: 'https://ejemplo/master.m3u8',
      kind: 'hls',
      quality: '1080p',
      headers: { Referer: 'https://sitio.example' },
      subtitles,
    })

    expect(publicSource).toEqual({
      url: 'https://ejemplo/master.m3u8',
      kind: 'hls',
      quality: '1080p',
      subtitles,
    })
    expect('headers' in publicSource).toBe(false)
  })

  test('no incluye la clave headers ni siquiera con valor undefined', () => {
    const publicSource = toPublicStreamSource({ url: 'https://ejemplo/a.mp4', kind: 'file' })

    expect(Object.keys(publicSource).sort()).toEqual(['kind', 'url'])
  })

  test('no modifica el origen', () => {
    const source = {
      url: 'https://ejemplo/a.mp4',
      kind: 'file' as const,
      headers: { Referer: 'https://sitio.example' },
    }

    toPublicStreamSource(source)

    expect(source.headers).toEqual({ Referer: 'https://sitio.example' })
  })

  test('el tipo público no admite headers: el compilador lo impide', () => {
    const leaked: PublicStreamSource = {
      url: 'https://ejemplo/a.mp4',
      kind: 'file',
      // @ts-expect-error headers no existe en PublicStreamSource, y esa es la garantía
      headers: { Referer: 'https://sitio.example' },
    }

    expect(leaked).toBeDefined()
  })
})

describe('cacheHitSchema', () => {
  test('valida un acierto de caché con el tipo del valor indicado', () => {
    const schema = cacheHitSchema(z.string())

    expect(
      schema.safeParse({ value: 'dato', fetchedAt: new Date(), stale: false, ttlS: 900 }).success,
    ).toBe(true)
    expect(
      schema.safeParse({ value: 7, fetchedAt: new Date(), stale: false, ttlS: 900 }).success,
    ).toBe(false)
  })

  test('rechaza un ttl negativo', () => {
    const schema = cacheHitSchema(z.string())

    expect(
      schema.safeParse({ value: 'dato', fetchedAt: new Date(), stale: false, ttlS: -1 }).success,
    ).toBe(false)
  })
})

describe('modos', () => {
  test('episodeSchema acepta los tres modos, incluido raw', () => {
    for (const mode of ['sub', 'dub', 'raw']) {
      expect(episodeSchema.safeParse({ ref: REF, animeRef: REF, number: 1, mode }).success).toBe(
        true,
      )
    }
  })

  test('streamRequestSchema sólo acepta sub y dub', () => {
    expect(streamRequestSchema.safeParse({ episodeRef: REF, mode: 'sub' }).success).toBe(true)
    expect(streamRequestSchema.safeParse({ episodeRef: REF, mode: 'raw' }).success).toBe(false)
  })
})

describe('episodeSchema: el número', () => {
  test('acepta un decimal, que es como una fuente numera un recopilatorio', () => {
    expect(
      episodeSchema.safeParse({ ref: REF, animeRef: REF, number: 12.5, mode: 'sub' }).success,
    ).toBe(true)
  })

  test('sigue aceptando el entero de siempre', () => {
    expect(
      episodeSchema.safeParse({ ref: REF, animeRef: REF, number: 7, mode: 'sub' }).success,
    ).toBe(true)
  })

  test('rechaza un número negativo', () => {
    expect(
      episodeSchema.safeParse({ ref: REF, animeRef: REF, number: -1, mode: 'sub' }).success,
    ).toBe(false)
  })
})

describe('feed: la lista de novedades de una fuente', () => {
  test('sin declarar la capacidad queda en false', () => {
    const result = providerCapabilitiesSchema.safeParse({
      search: true,
      sub: true,
      dub: false,
      trending: false,
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.feed).toBe(false)
  })

  test('declarada, se respeta', () => {
    const result = providerCapabilitiesSchema.safeParse({
      search: true,
      sub: true,
      dub: false,
      trending: false,
      feed: true,
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.feed).toBe(true)
  })

  test('una entrada con fecha ISO se acepta', () => {
    const result = feedEntrySchema.safeParse({
      ref: REF,
      title: 'Un título',
      publishedAt: '2026-10-11T02:00:00.000Z',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.publishedAt).toBe('2026-10-11T02:00:00.000Z')
  })

  test('la fecha es opcional: un feed sin fechas vale', () => {
    expect(feedEntrySchema.safeParse({ ref: REF, title: 'Un título' }).success).toBe(true)
  })

  test('una fecha que no es ISO se rechaza nombrando el campo', () => {
    const result = feedEntrySchema.safeParse({ ref: REF, title: 'Un título', publishedAt: 'ayer' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.')).join(' | ')).toContain(
        'publishedAt',
      )
    }
  })
})

describe('media: qué sirve un proveedor', () => {
  test('sin declararla, el manifiesto de siempre sigue cargando', () => {
    // Es lo que hace que añadirla no sea un cambio de versión mayor para los
    // plugins publicados: no aparece y no se rechaza.
    const result = providerCapabilitiesSchema.safeParse({
      search: true,
      sub: true,
      dub: false,
      trending: false,
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.media).toBeUndefined()
  })

  test('declarada, se valida contra el vocabulario', () => {
    const vocabulario = ['anime', 'movies', 'both'] as const

    for (const media of vocabulario) {
      const result = providerCapabilitiesSchema.safeParse({
        search: true,
        sub: true,
        dub: false,
        trending: false,
        media,
      })

      expect(result.success, media).toBe(true)
      if (result.success) expect(result.data.media).toBe(media)
    }
  })

  test('un valor fuera del vocabulario se rechaza nombrando el campo', () => {
    const result = providerCapabilitiesSchema.safeParse({
      search: true,
      sub: true,
      dub: false,
      trending: false,
      media: 'anime-y-peliculas',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.')).join(' | ')).toContain(
        'media',
      )
    }
  })
})
