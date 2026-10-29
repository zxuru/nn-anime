import { describe, expect, test } from 'bun:test'
import type { DownloadItem } from '@nn-anime/core/api'
import { datos } from './LibraryPage'

/**
 * Una fila con lo mínimo que mira el texto del progreso.
 *
 * Los campos que no importan para la cuenta se rellenan con valores fijos: si la
 * prueba empieza a depender de ellos, es que la función mira más de lo que dice
 * su contrato.
 */
function descarga(cambios: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 1,
    providerId: 'fixture',
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    episodeRef: { providerId: 'fixture', value: 'aurora-nocturna#1' },
    title: 'Aurora Nocturna',
    episodeLabel: 'Episodio 1',
    kind: 'file',
    status: 'downloading',
    bytes: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...cambios,
  }
}

const MIB = 1024 * 1024

describe('el texto del progreso de una descarga', () => {
  test('con total dice el porcentaje, lo que lleva, lo que falta y lo que queda', () => {
    const texto = datos(descarga({ bytes: 3 * MIB, totalBytes: 12 * MIB }), MIB)

    expect(texto).toContain('25 %')
    expect(texto).toContain('Llevas 3,0 MiB de 12,0 MiB')
    expect(texto).toContain('faltan 9,0 MiB')
    expect(texto).toContain('1,0 MiB/s')
    expect(texto).toContain('quedan 9 s')
  })

  test('sin total no inventa porcentaje ni lo que falta', () => {
    const texto = datos(descarga({ bytes: 5 * MIB }), undefined)

    expect(texto).toBe('Llevas 5,0 MiB')
  })

  test('una descarga completa no promete que todavía falta algo', () => {
    const texto = datos(descarga({ status: 'complete', bytes: 10, totalBytes: 10 }), undefined)

    expect(texto).toContain('100 %')
    expect(texto).toContain('Llevas 10 B de 10 B')
    expect(texto).not.toContain('faltan')
  })
})
