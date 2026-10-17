import { describe, expect, test } from 'bun:test'
import { BOOT_LINE_PREFIX, formatBootLine, parseBootLine } from './boot-line'

const ARRANQUE = { port: 7811, url: 'http://127.0.0.1:7811/?boot=abc-DEF_123' }

/** Un texto con la línea en medio, como sale de verdad por `stdout`. */
function conLinea(linea: string): string {
  return [
    `Servidor en ${ARRANQUE.url}`,
    linea,
    'Proveedores activos: fixture',
    '{"port":7811,"ts":"2026-10-16T02:12:58.448Z","level":"info","msg":"servidor en marcha"}',
  ].join('\n')
}

describe('formatBootLine', () => {
  test('lleva el prefijo literal y el JSON en la misma línea', () => {
    const linea = formatBootLine(ARRANQUE)

    expect(linea).toBe(`${BOOT_LINE_PREFIX} {"port":7811,"url":"${ARRANQUE.url}"}`)
    expect(linea.split('\n')).toHaveLength(1)
  })

  test('el orden de las claves no depende de quien llama', () => {
    const alReves = { url: ARRANQUE.url, port: ARRANQUE.port }

    expect(formatBootLine(alReves)).toBe(formatBootLine(ARRANQUE))
  })

  test('no lleva el token a ningún sitio que no sea la URL', () => {
    const linea = formatBootLine(ARRANQUE)
    const apariciones = linea.split('boot=').length - 1

    expect(apariciones).toBe(1)
  })
})

describe('parseBootLine', () => {
  test('encuentra la línea entre las demás', () => {
    expect(parseBootLine(conLinea(formatBootLine(ARRANQUE)))).toEqual(ARRANQUE)
  })

  test('la encuentra también si es la primera', () => {
    expect(parseBootLine(formatBootLine(ARRANQUE))).toEqual(ARRANQUE)
  })

  test('sin línea, no hay nada que devolver', () => {
    expect(parseBootLine(conLinea('Proveedores activos: fixture'))).toBeUndefined()
  })

  test('una línea con el prefijo y el JSON roto no devuelve una dirección a medias', () => {
    expect(parseBootLine(conLinea(`${BOOT_LINE_PREFIX} {"port":7811,"url":`))).toBeUndefined()
  })

  test('un puerto fuera de rango no pasa el esquema', () => {
    expect(
      parseBootLine(conLinea(`${BOOT_LINE_PREFIX} {"port":0,"url":"${ARRANQUE.url}"}`)),
    ).toBeUndefined()
    expect(
      parseBootLine(conLinea(`${BOOT_LINE_PREFIX} {"port":70000,"url":"${ARRANQUE.url}"}`)),
    ).toBeUndefined()
  })

  test('una dirección que no es http no pasa el esquema', () => {
    expect(
      parseBootLine(conLinea(`${BOOT_LINE_PREFIX} {"port":7811,"url":"file:///etc/passwd"}`)),
    ).toBeUndefined()
  })

  test('ida y vuelta con CRLF, que es como escribe Windows', () => {
    const texto = `Servidor en ${ARRANQUE.url}\r\n${formatBootLine(ARRANQUE)}\r\n`

    expect(parseBootLine(texto)).toEqual(ARRANQUE)
  })
})
