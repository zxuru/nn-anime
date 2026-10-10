import { describe, expect, test } from 'bun:test'
import { parseArgs } from './args'
import { applySettings } from './settings'

function options(argv: readonly string[] = []) {
  const parsed = parseArgs(argv)
  if (!parsed.ok) throw new Error('se esperaban argumentos válidos')
  return parsed.value
}

describe('sin archivo de ajustes', () => {
  test('las opciones pasan intactas', () => {
    const original = options(['naruto', '--port', '8080'])

    expect(applySettings(original, undefined)).toEqual(original)
  })
})

describe('el archivo rellena lo que no se dijo', () => {
  test('usa el puerto del archivo', () => {
    expect(applySettings(options(), { port: 9999 }).port).toBe(9999)
  })

  test('usa los proveedores del archivo', () => {
    expect(applySettings(options(), { providers: ['uno'] }).providers).toEqual(['uno'])
  })

  test('usa el idioma del archivo', () => {
    expect(applySettings(options(), { lang: 'en' }).lang).toBe('en')
  })

  test('activa el modo detallado si el archivo lo pide', () => {
    expect(applySettings(options(), { verbose: true }).verbose).toBe(true)
  })

  test('respeta un open falso del archivo', () => {
    expect(applySettings(options(), { open: false }).open).toBe(false)
  })

  test('mantiene el navegador abierto si el archivo no dice nada', () => {
    expect(applySettings(options(), { port: 9999 }).open).toBe(true)
  })
})

describe('la bandera gana sobre el archivo', () => {
  test('el puerto de la bandera', () => {
    expect(applySettings(options(['--port', '8080']), { port: 9999 }).port).toBe(8080)
  })

  test('los proveedores de la bandera, y no se mezclan', () => {
    const applied = applySettings(options(['--provider', 'a']), { providers: ['b'] })

    expect(applied.providers).toEqual(['a'])
  })

  test('el idioma de la bandera', () => {
    expect(applySettings(options(['--lang', 'es']), { lang: 'en' }).lang).toBe('es')
  })

  test('--no-open gana sobre un open verdadero del archivo', () => {
    expect(applySettings(options(['--no-open']), { open: true }).open).toBe(false)
  })

  test('el modo detallado de la bandera no se apaga desde el archivo', () => {
    expect(applySettings(options(['-v']), { verbose: false }).verbose).toBe(true)
  })
})

describe('idempotencia', () => {
  test('aplicar dos veces da lo mismo', () => {
    const settings = { port: 9999, open: false, providers: ['uno'], lang: 'en', verbose: true }
    const once = applySettings(options(), settings)

    expect(applySettings(once, settings)).toEqual(once)
  })

  test('tras aplicar, open deja de ser ambiguo', () => {
    expect(applySettings(options(), { port: 1 }).openSpecified).toBe(true)
  })
})
