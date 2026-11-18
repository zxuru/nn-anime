import { describe, expect, test } from 'bun:test'
import type { CatalogStore } from '@rona/catalog-store'
import { popularTitles, TASTE_TITLE_LIMIT } from './taste'

type Fila = Awaited<ReturnType<CatalogStore['listCandidates']>>[number]

/** El paso 2 lee del catálogo cacheado: aquí se le da una lista ya hecha. */
function conFilas(filas: readonly Fila[]): Pick<CatalogStore, 'listCandidates'> {
  return { listCandidates: async () => filas }
}

function fila(providerId: string, value: string, title: string): Fila {
  return { ref: { providerId, value }, title, tags: [], studios: [] }
}

describe('los títulos populares de la encuesta', () => {
  /**
   * El mismo anime puede estar cacheado en dos fuentes —AniList y el proveedor
   * de turno— y el paso 2 enseñaba dos tarjetas con el mismo nombre. Se elige
   * una; cuál no importa, porque lo que el usuario marca es la obra.
   */
  test('la misma obra en dos fuentes ocupa una sola tarjeta', async () => {
    const titulos = await popularTitles(
      conFilas([
        fila('anilist', '101922', 'Super Crooks'),
        fila('fixture', 'super-crooks', 'Super Crooks'),
        fila('fixture', 'aurora-nocturna', 'Aurora Nocturna'),
      ]),
    )

    expect(titulos.map((item) => item.title)).toEqual(['Super Crooks', 'Aurora Nocturna'])
  })

  test('la comparación no distingue mayúsculas ni espacios de sobra', async () => {
    const titulos = await popularTitles(
      conFilas([
        fila('anilist', '1', '  super   crooks '),
        fila('fixture', 'super-crooks', 'Super Crooks'),
      ]),
    )

    expect(titulos).toHaveLength(1)
  })

  test('dos temporadas distintas siguen siendo dos tarjetas', async () => {
    const titulos = await popularTitles(
      conFilas([
        fila('anilist', '1', 'Sousou no Frieren'),
        fila('anilist', '2', 'Sousou no Frieren 2nd Season'),
      ]),
    )

    expect(titulos).toHaveLength(2)
  })

  test('no enseña más de doce aunque el catálogo tenga más', async () => {
    const filas = Array.from({ length: TASTE_TITLE_LIMIT + 5 }, (_, indice) =>
      fila('fixture', `titulo-${indice}`, `Título ${indice}`),
    )

    const titulos = await popularTitles(conFilas(filas))

    expect(titulos).toHaveLength(TASTE_TITLE_LIMIT)
  })
})
