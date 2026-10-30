/**
 * La caché en memoria de las fichas.
 *
 * Abrir una ficha, volver a la vitrina y abrirla otra vez es lo normal, y cada
 * vuelta costaba una petición al proveedor —que puede tardar o fallar— para
 * enseñar exactamente lo mismo. Esta caché guarda el resultado **completo** de la
 * primera lectura y lo sirve al instante en las siguientes.
 *
 * Las tres decisiones que importan:
 *
 * 1. **TTL.** Pasado el tiempo de vida el dato deja de considerarse fresco y la
 *    siguiente visita vuelve a pedirlo. No se borra: `peek` lo devuelve como
 *    `stale`, que es lo que permite enseñarlo mientras se refresca por detrás
 *    —stale-while-revalidate— en vez de dejar la pantalla en blanco.
 * 2. **Tope.** Un `Map` sin límite en una aplicación que se deja abierta toda la
 *    tarde es una fuga de memoria. Con 50 entradas y descarte de la más antigua
 *    se acota, y la LRU hace que la ficha que se está usando no se vaya.
 * 3. **Reloj inyectable.** Los tests del TTL no esperan cinco minutos: reciben un
 *    reloj que avanza cuando se le dice.
 *
 * La clave es `${providerId}:${ref}`, escrita una sola vez en `detailCacheKey`.
 */

/** Lo que se guarda de cada ficha. */
export interface CacheEntry<T> {
  readonly value: T
  readonly storedAt: number
}

export interface DetailCacheOptions {
  /** Cuánto vale un dato como fresco. Cinco minutos por defecto. */
  readonly ttlMs?: number
  /** Cuántas fichas se guardan. Cincuenta por defecto. */
  readonly max?: number
  /** El reloj, inyectable en los tests. */
  readonly now?: () => number
}

export const DETAIL_CACHE_TTL_MS = 5 * 60_000
export const DETAIL_CACHE_MAX = 50

/** La clave de una ficha: proveedor y referencia, sin ambigüedad. */
export function detailCacheKey(providerId: string, ref: string): string {
  return `${providerId}:${ref}`
}

export class DetailCache<T> {
  /** El orden del `Map` es el orden de uso: el primero es el más viejo. */
  private readonly entries = new Map<string, CacheEntry<T>>()
  readonly ttlMs: number
  readonly max: number
  private readonly now: () => number

  constructor(options: DetailCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DETAIL_CACHE_TTL_MS
    this.max = Math.max(1, options.max ?? DETAIL_CACHE_MAX)
    this.now = options.now ?? Date.now
  }

  /** El dato fresco, o nada si no hay o caducó. Al devolverlo lo marca como usado. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined

    if (this.now() - entry.storedAt > this.ttlMs) return undefined

    this.touch(key, entry)

    return entry.value
  }

  /**
   * El dato aunque haya caducado.
   *
   * Es lo que sostiene el stale-while-revalidate: la pantalla pinta lo que ya
   * sabía —marcado como `fresh: false`— y el refresco va por detrás. Si el
   * refresco falla, lo que se ve sigue siendo el dato viejo y no un error.
   */
  peek(key: string): { readonly value: T; readonly fresh: boolean } | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined

    this.touch(key, entry)

    return { value: entry.value, fresh: this.now() - entry.storedAt <= this.ttlMs }
  }

  set(key: string, value: T): void {
    // Borrar antes de insertar mueve la clave al final del `Map`, que es la
    // posición de «recién usado» que usa el descarte.
    this.entries.delete(key)
    this.entries.set(key, { value, storedAt: this.now() })

    while (this.entries.size > this.max) {
      const masVieja = this.entries.keys().next()

      if (masVieja.done === true) break
      this.entries.delete(masVieja.value)
    }
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  private touch(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }
}
