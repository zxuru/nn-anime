/**
 * El lote de portadas del motor.
 *
 * Lo que se mide es la parte que decide cuántas peticiones salen: que el mismo
 * conjunto de referencias no se pida dos veces, que no haya repetidos, que el tope
 * del contrato se respete y que lo que no tiene portada no ocupe un hueco en el
 * mapa. La petición en sí es una línea y la cubre el e2e.
 */

import { describe, expect, test } from 'bun:test'
import type { EnrichmentBatchResponse } from '@nn-anime/core/api'
import type { ProviderRef } from '@nn-anime/core/models'
import {
  claveDeRef,
  firmaDeRefs,
  MAX_ENRIQUECIDOS,
  portadasDeRespuesta,
  refsAPedir,
} from './useEnriquecidos'

function ref(value: string, providerId = 'fixture'): ProviderRef {
  return { providerId, value }
}

describe('qué referencias se piden', () => {
  test('sin repetidos y sin pasar del tope del contrato', () => {
    const repetidas = [ref('a'), ref('a'), ref('b'), ref('a')]

    expect(refsAPedir(repetidas).map((una) => una.value)).toEqual(['a', 'b'])

    const muchas = Array.from({ length: MAX_ENRIQUECIDOS + 5 }, (_, indice) => ref(`o-${indice}`))
    expect(refsAPedir(muchas)).toHaveLength(MAX_ENRIQUECIDOS)
  })

  test('la firma no depende del orden y no repite peticiones por reordenar', () => {
    const una = firmaDeRefs([ref('a'), ref('b')])
    const otra = firmaDeRefs([ref('b'), ref('a')])

    expect(una).toBe(otra)
    expect(firmaDeRefs([])).toBe('')
  })

  test('la clave de una referencia lleva el proveedor: dos fuentes pueden repetir el valor', () => {
    expect(claveDeRef(ref('x', 'uno'))).not.toBe(claveDeRef(ref('x', 'dos')))
  })
})

describe('las portadas de la respuesta', () => {
  test('sólo entran las que tienen portada', () => {
    const respuesta: EnrichmentBatchResponse = {
      items: [
        {
          ref: ref('a'),
          enrichment: {
            anilistId: 1,
            cover: '/api/anilist/image/cover/1',
            adult: false,
            genres: [],
            studios: [],
            siteUrl: 'https://anilist.co/anime/1',
          },
        },
        { ref: ref('b') },
      ],
    }

    const portadas = portadasDeRespuesta(respuesta)

    expect(portadas.get(claveDeRef(ref('a')))).toBe('/api/anilist/image/cover/1')
    expect(portadas.has(claveDeRef(ref('b')))).toBe(false)
  })
})
