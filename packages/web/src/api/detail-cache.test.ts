import { describe, expect, test } from 'bun:test'
import { DETAIL_CACHE_MAX, DETAIL_CACHE_TTL_MS, DetailCache, detailCacheKey } from './detail-cache'

/**
 * La caché de fichas: el TTL, el tope y el stale-while-revalidate.
 *
 * Se prueba aquí y no en el navegador porque la lógica es pura —una clave, un
 * reloj y un `Map`— y porque el fallo que importa es de tiempo: un TTL que no
 * caduca deja fichas viejas para siempre, y un tope que no descarta convierte la
 * aplicación en una fuga de memoria. El reloj se inyecta para no esperar cinco
 * minutos.
 */

function reloj(arranque = 0): { ahora: number; now: () => number } {
  const estado = { ahora: arranque, now: () => estado.ahora }

  return estado
}

describe('el TTL', () => {
  test('un dato recién guardado es fresco', () => {
    const cache = new DetailCache<string>({ ttlMs: 100, now: () => 0 })

    cache.set('a', 'uno')

    expect(cache.get('a')).toBe('uno')
  })

  test('pasado el TTL deja de ser fresco y `get` no lo devuelve', () => {
    const tiempo = reloj()
    const cache = new DetailCache<string>({ ttlMs: 100, now: tiempo.now })

    cache.set('a', 'uno')
    tiempo.ahora = 101

    expect(cache.get('a')).toBeUndefined()
  })

  test('el borde exacto del TTL sigue valiendo', () => {
    const tiempo = reloj()
    const cache = new DetailCache<string>({ ttlMs: 100, now: tiempo.now })

    cache.set('a', 'uno')
    tiempo.ahora = 100

    expect(cache.get('a')).toBe('uno')
  })

  test('el TTL por defecto es de cinco minutos', () => {
    expect(DETAIL_CACHE_TTL_MS).toBe(5 * 60_000)
  })
})

describe('stale-while-revalidate', () => {
  test('`peek` devuelve el dato caducado, marcado como no fresco', () => {
    const tiempo = reloj()
    const cache = new DetailCache<string>({ ttlMs: 100, now: tiempo.now })

    cache.set('a', 'uno')
    tiempo.ahora = 101

    expect(cache.peek('a')).toEqual({ value: 'uno', fresh: false })
  })

  test('mientras caduca, el valor viejo se sigue pudiendo enseñar', () => {
    const tiempo = reloj()
    const cache = new DetailCache<string>({ ttlMs: 100, now: tiempo.now })

    cache.set('a', 'viejo')
    tiempo.ahora = 90

    expect(cache.peek('a')?.fresh).toBe(true)
    expect(cache.peek('a')?.value).toBe('viejo')
  })

  test('el refresco por detrás sustituye el valor sin perder la entrada', () => {
    const tiempo = reloj()
    const cache = new DetailCache<string>({ ttlMs: 100, now: tiempo.now })

    cache.set('a', 'viejo')
    tiempo.ahora = 101
    // Lo que hace la pantalla: enseña el viejo y, cuando llega el nuevo, lo guarda.
    expect(cache.peek('a')?.value).toBe('viejo')
    cache.set('a', 'nuevo')

    expect(cache.get('a')).toBe('nuevo')
    expect(cache.size).toBe(1)
  })

  test('si el refresco falla, el dato viejo sigue en la caché', () => {
    const tiempo = reloj()
    const cache = new DetailCache<string>({ ttlMs: 100, now: tiempo.now })

    cache.set('a', 'viejo')
    tiempo.ahora = 101
    // Nada lo sustituye: el fallo de la revalidación no borra la entrada.
    expect(cache.peek('a')?.value).toBe('viejo')
  })
})

describe('el tope de tamaño', () => {
  test('el tope por defecto es de cincuenta fichas', () => {
    expect(DETAIL_CACHE_MAX).toBe(50)
  })

  test('al pasar del tope se descarta la más antigua', () => {
    const cache = new DetailCache<string>({ max: 3, now: () => 0 })

    for (const clave of ['a', 'b', 'c', 'd']) cache.set(clave, clave)

    expect(cache.size).toBe(3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('b')
    expect(cache.get('d')).toBe('d')
  })

  test('usar una entrada la salva del descarte', () => {
    const cache = new DetailCache<string>({ max: 3, now: () => 0 })

    cache.set('a', 'a')
    cache.set('b', 'b')
    cache.set('c', 'c')
    // La LRU: leer `a` la mueve al final, así que la siguiente en salir es `b`.
    expect(cache.get('a')).toBe('a')
    cache.set('d', 'd')

    expect(cache.get('a')).toBe('a')
    expect(cache.get('b')).toBeUndefined()
  })

  test('actualizar una entrada existente no la duplica', () => {
    const cache = new DetailCache<string>({ max: 2, now: () => 0 })

    cache.set('a', 'uno')
    cache.set('a', 'dos')

    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe('dos')
  })
})

describe('la clave y el ciclo de vida', () => {
  test('la clave es proveedor:referencia', () => {
    expect(detailCacheKey('jkanime', 'bleach-movie-3')).toBe('jkanime:bleach-movie-3')
  })

  test('borrar y vaciar quitan lo guardado', () => {
    const cache = new DetailCache<string>({ now: () => 0 })

    cache.set('a', 'uno')
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()

    cache.set('b', 'dos')
    cache.clear()
    expect(cache.size).toBe(0)
  })

  test('un tamaño máximo inválido no deja la caché a cero', () => {
    const cache = new DetailCache<string>({ max: 0, now: () => 0 })

    cache.set('a', 'uno')

    expect(cache.get('a')).toBe('uno')
  })
})
