import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { type PublicStreamSource, toPublicStreamSource } from './models'
import {
  animeDetailSchema,
  cacheHitSchema,
  candidateSchema,
  episodeSchema,
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
