/**
 * La biblioteca: agrupar lo descargado y medir su avance.
 *
 * Son funciones puras a propósito. La pantalla decide cómo se pinta, pero lo que
 * se agrupa, lo que ocupa una serie y cuánto falta de una descarga se puede
 * medir sin un DOM, y así el fallo de una cuenta no se disfraza de fallo visual.
 *
 * Una descarga **completa** entra en la biblioteca; las demás —en cola,
 * descargando, en pausa o fallidas— viven en la zona de descargas. `cancelled`
 * no es ninguna de las dos: es una fila que ya no existe para quien mira.
 */

import type { DownloadItem } from '@nn-anime/core/api'

export type Descarga = DownloadItem

export interface SerieBiblioteca {
  /** Identidad de la serie: proveedor y referencia, sin depender del título. */
  readonly key: string
  readonly providerId: string
  readonly animeRef: string
  readonly title: string
  /** Los episodios completos, del primero descargado al último. */
  readonly episodes: readonly Descarga[]
  /** Lo que ocupan sus episodios completos. */
  readonly bytes: number
  /** La fecha del último episodio descargado, para ordenar la estantería. */
  readonly latest: string
}

/** ¿Esta fila pertenece a la zona de descargas y no a la biblioteca? */
export function estaActiva(item: Descarga): boolean {
  return (
    item.status === 'queued' ||
    item.status === 'downloading' ||
    item.status === 'paused' ||
    item.status === 'failed'
  )
}

/**
 * Agrupa las descargas completas por título.
 *
 * La clave es la referencia del título y no su nombre: dos temporadas del mismo
 * anime pueden llegar con títulos distintos y siguen siendo la misma serie. El
 * nombre que se enseña es el de la primera fila, que es el que el proveedor dio
 * al pedir la descarga.
 *
 * Los episodios se ordenan por cuándo se descargaron, que es el orden en el que
 * quien los pidió los va a reconocer; el `id` desempata dos altas del mismo
 * instante. La estantería se ordena por la descarga más reciente.
 */
export function agruparBiblioteca(items: readonly Descarga[]): readonly SerieBiblioteca[] {
  const porSerie = new Map<string, Descarga[]>()

  for (const item of items) {
    if (item.status !== 'complete') continue

    const key = `${item.providerId}\u0000${item.animeRef.value}`
    const lista = porSerie.get(key)
    if (lista === undefined) porSerie.set(key, [item])
    else lista.push(item)
  }

  const series: SerieBiblioteca[] = []

  for (const [key, episodes] of porSerie) {
    const ordenados = [...episodes].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
    )
    const primero = ordenados[0]
    if (primero === undefined) continue

    series.push({
      key,
      providerId: primero.providerId,
      animeRef: primero.animeRef.value,
      title: primero.title,
      episodes: ordenados,
      bytes: ordenados.reduce((total, item) => total + item.bytes, 0),
      latest: ordenados[ordenados.length - 1]?.createdAt ?? primero.createdAt,
    })
  }

  return series.sort((a, b) => b.latest.localeCompare(a.latest) || a.title.localeCompare(b.title))
}

/** El avance de una descarga, en por ciento entero, si el total se conoce. */
export function porcentaje(item: Descarga): number | undefined {
  if (item.totalBytes === undefined || item.totalBytes <= 0) return undefined

  return Math.min(100, Math.max(0, Math.round((item.bytes / item.totalBytes) * 100)))
}

/** Un tamaño en la unidad que le toca, con coma decimal como el resto de la casa. */
export function formatearBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'

  const decimal = (valor: number): string => valor.toFixed(1).replace('.', ',')

  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${decimal(n / 1024)} KiB`
  if (n < 1024 * 1024 * 1024) return `${decimal(n / (1024 * 1024))} MiB`

  return `${decimal(n / (1024 * 1024 * 1024))} GiB`
}

/**
 * La velocidad entre dos avisos de la cola.
 *
 * Se mide con lo que creció el contador y el tiempo que pasó, no con una marca
 * dentro del motor: la cola escribe cada medio segundo y la pantalla lee cada
 * segundo, así que la diferencia entre dos lecturas es lo que de verdad se movió
 * en ese intervalo. Un contador que no creció no es una velocidad de cero: es
 * que todavía no hay dato, y por eso devuelve `undefined`.
 */
export function calcularVelocidad(
  actual: number,
  anterior: number | undefined,
  segundos: number,
): number | undefined {
  if (anterior === undefined || segundos <= 0 || actual <= anterior) return undefined

  return (actual - anterior) / segundos
}

/** Lo que falta, en segundos, si se sabe el total y la velocidad. */
export function estimarRestante(
  totalBytes: number | undefined,
  bytes: number,
  bytesPorSegundo: number | undefined,
): number | undefined {
  if (totalBytes === undefined || bytesPorSegundo === undefined || bytesPorSegundo <= 0) {
    return undefined
  }

  const restantes = totalBytes - bytes
  if (restantes <= 0) return undefined

  return restantes / bytesPorSegundo
}

/** Una espera en palabras: «2 min 10 s», «40 s», «1 h 5 min». */
export function formatearEspera(segundos: number): string {
  const total = Math.max(0, Math.round(segundos))
  if (total < 60) return `${total} s`

  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const resto = total % 60

  if (horas > 0) {
    return resto === 0 ? `${horas} h ${minutos} min` : `${horas} h ${minutos} min ${resto} s`
  }
  if (resto === 0) return `${minutos} min`

  return `${minutos} min ${resto} s`
}
