import { describe, expect, test } from 'bun:test'
import {
  ALLOWED_RESPONSE_HEADERS,
  contentTypeFor,
  resourceKind,
  sanitizeHeaders,
} from './response-headers'

function upstream(headers: Record<string, string>): Headers {
  return new Headers(headers)
}

describe('lista blanca de cabeceras', () => {
  test('pasa sólo las permitidas', () => {
    const salida = sanitizeHeaders(
      upstream({
        'content-type': 'video/mp4',
        'content-length': '64',
        'content-range': 'bytes 0-63/1024',
        'accept-ranges': 'bytes',
        'cache-control': 'max-age=60',
        etag: '"abc"',
        'last-modified': 'Wed, 21 Oct 2026 07:28:00 GMT',
        server: 'nginx',
        'x-powered-by': 'Express',
        'x-secreto': 'no',
      }),
    )

    expect([...salida.keys()].sort()).toEqual(
      [...ALLOWED_RESPONSE_HEADERS, 'x-content-type-options'].sort(),
    )
    expect(salida.get('server')).toBeNull()
    expect(salida.get('x-powered-by')).toBeNull()
  })

  test('`Set-Cookie` se elimina siempre', () => {
    const salida = sanitizeHeaders(
      upstream({ 'content-type': 'video/mp4', 'set-cookie': 'sesion=robada; Path=/' }),
    )

    expect(salida.get('set-cookie')).toBeNull()
    expect([...salida.keys()]).not.toContain('set-cookie')
  })

  test('varias cookies tampoco pasan', () => {
    const cabeceras = new Headers()
    cabeceras.append('set-cookie', 'una=1')
    cabeceras.append('set-cookie', 'dos=2')

    expect([...sanitizeHeaders(cabeceras).keys()]).not.toContain('set-cookie')
  })

  test('siempre añade `nosniff`', () => {
    expect(sanitizeHeaders(upstream({})).get('x-content-type-options')).toBe('nosniff')
  })

  test('un upstream que no manda nada no rompe', () => {
    const salida = sanitizeHeaders(upstream({}))

    expect([...salida.keys()]).toEqual(['x-content-type-options'])
  })
})

describe('tipo de contenido impuesto', () => {
  test('cada tipo que el proxy decide tiene el suyo', () => {
    expect(contentTypeFor('playlist')).toBe('application/vnd.apple.mpegurl')
    expect(contentTypeFor('segment')).toBe('video/mp2t')
    expect(contentTypeFor('subtitle')).toBe('text/vtt')
  })

  test('del archivo progresivo y de la imagen decide el upstream', () => {
    expect(contentTypeFor('progressive')).toBeUndefined()
    expect(contentTypeFor('image')).toBeUndefined()
  })

  test('un `text/html` del upstream no cambia el tipo de una playlist', () => {
    const salida = sanitizeHeaders(upstream({ 'content-type': 'text/html' }), {
      forceType: contentTypeFor('playlist'),
    })

    expect(salida.get('content-type')).toBe('application/vnd.apple.mpegurl')
  })

  test('sin tipo forzado, se copia el del upstream', () => {
    const salida = sanitizeHeaders(upstream({ 'content-type': 'video/mp4' }))

    expect(salida.get('content-type')).toBe('video/mp4')
  })

  test('el tipo forzado sustituye incluso a uno permitido', () => {
    const salida = sanitizeHeaders(upstream({ 'content-type': 'application/octet-stream' }), {
      forceType: 'text/vtt',
    })

    expect(salida.get('content-type')).toBe('text/vtt')
  })
})

describe('qué se está sirviendo', () => {
  test('se deduce de la dirección', () => {
    expect(resourceKind('https://ejemplo/a/master.m3u8')).toBe('playlist')
    expect(resourceKind('https://ejemplo/a/seg-1.ts')).toBe('segment')
    expect(resourceKind('https://ejemplo/a/seg-1.m4s')).toBe('segment')
    expect(resourceKind('https://ejemplo/a/es.vtt')).toBe('subtitle')
    expect(resourceKind('https://ejemplo/a/es.srt')).toBe('subtitle')
    expect(resourceKind('https://ejemplo/portada.webp')).toBe('image')
    expect(resourceKind('https://ejemplo/pelicula.mp4')).toBe('progressive')
  })

  test('no se fía de las mayúsculas ni de la consulta', () => {
    expect(resourceKind('https://ejemplo/A/MASTER.M3U8?token=abc')).toBe('playlist')
  })

  test('una dirección que no se puede analizar no lanza', () => {
    expect(resourceKind('no-es-una-url.m3u8')).toBe('playlist')
    expect(resourceKind('no-es-una-url')).toBe('progressive')
  })
})
