import { describe, expect, test } from 'bun:test'
import { DEFAULT_LOCALE, LOCALES, type Messages, resolveLocale, t, translate } from './i18n'
import { messages as es } from './i18n/es'

describe('resolveLocale', () => {
  test('sin petición devuelve el idioma por defecto', () => {
    expect(resolveLocale()).toBe(DEFAULT_LOCALE)
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  test('acepta el código exacto', () => {
    expect(resolveLocale('es')).toBe('es')
  })

  test('normaliza mayúsculas y espacios', () => {
    expect(resolveLocale('  ES  ')).toBe('es')
  })

  test('reduce una variante regional a su idioma base', () => {
    expect(resolveLocale('es-AR')).toBe('es')
    expect(resolveLocale('es_MX')).toBe('es')
  })

  test('cae al idioma por defecto ante un idioma desconocido, sin lanzar', () => {
    expect(resolveLocale('en')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale('xx-YY')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
  })
})

describe('t', () => {
  test('devuelve el texto del catálogo', () => {
    expect(t('es', 'app.name')).toBe('nn-anime')
  })

  test('interpola un parámetro', () => {
    const catalogs = { es: { saludo: 'Hola, {nombre}' } }

    expect(translate(catalogs, 'es', 'saludo', { nombre: 'Mundo' })).toBe('Hola, Mundo')
  })

  test('interpola varios parámetros y repite los que aparecen más de una vez', () => {
    const catalogs = { es: { linea: '{a} y {b} y {a}' } }

    expect(translate(catalogs, 'es', 'linea', { a: 1, b: 2 })).toBe('1 y 2 y 1')
  })

  test('deja el marcador intacto si falta el parámetro', () => {
    const catalogs = { es: { saludo: 'Hola, {nombre}' } }

    expect(translate(catalogs, 'es', 'saludo', {})).toBe('Hola, {nombre}')
  })

  test('sin parámetros devuelve la plantilla tal cual', () => {
    const catalogs = { es: { plantilla: 'Hola, {nombre}' } }

    expect(translate(catalogs, 'es', 'plantilla')).toBe('Hola, {nombre}')
  })

  test('ante una clave desconocida devuelve la clave, sin lanzar', () => {
    expect(t('es', 'no.existe')).toBe('no.existe')
    expect(() => t('es', 'no.existe')).not.toThrow()
  })
})

describe('translate: respaldo de idioma', () => {
  const catalogs: Readonly<Record<string, Messages>> = {
    es: { saludo: 'Hola', solo_es: 'Sólo en español' },
    en: { saludo: 'Hello' },
  }

  test('usa el idioma pedido cuando la clave existe', () => {
    expect(translate(catalogs, 'en', 'saludo')).toBe('Hello')
  })

  test('cae al idioma por defecto cuando la clave falta en el idioma pedido', () => {
    expect(translate(catalogs, 'en', 'solo_es')).toBe('Sólo en español')
  })

  test('cae al idioma por defecto cuando el idioma pedido no tiene catálogo', () => {
    expect(translate(catalogs, 'xx', 'saludo')).toBe('Hola')
  })
})

describe('catálogo español', () => {
  test('el idioma por defecto está en la lista de idiomas soportados', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })

  test('todas las claves tienen un valor no vacío', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), `la clave ${key} está vacía`).not.toBe('')
    }
  })

  test('las claves de los mensajes son estables y están en español', () => {
    expect(Object.keys(es).length).toBeGreaterThan(0)
    expect(es['app.name']).toBe('nn-anime')
  })
})
