import { describe, expect, test } from 'bun:test'
import { messages as es } from './es'
import { t } from './index'

describe('catálogo de la interfaz', () => {
  test('todas las claves tienen un valor no vacío', () => {
    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), `la clave ${key} está vacía`).not.toBe('')
    }
  })

  test('traduce una clave propia', () => {
    expect(t('es', 'nav.search')).toBe('Buscar')
  })

  test('traduce una clave de core, que llega mezclada', () => {
    expect(t('es', 'error.unknown')).toBe('Ocurrió un error inesperado.')
  })

  test('las claves propias ganan sobre las de core', () => {
    expect(t('es', 'app.name')).toBe('nn-anime')
  })

  test('interpola los parámetros', () => {
    expect(t('es', 'notFound.body', { path: '/raro' })).toContain('/raro')
  })

  test('una clave desconocida se devuelve a sí misma, sin lanzar', () => {
    expect(t('es', 'no.existe')).toBe('no.existe')
  })
})
