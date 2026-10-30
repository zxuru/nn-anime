import { describe, expect, test } from 'bun:test'
import type { RequestDeps } from '../../api/client'
import { loadDetailCore } from './load-detail'

/**
 * Las lecturas del núcleo de la ficha, por su dirección, sin red.
 *
 * La que importa aquí es la del detalle: es la única que lleva la consulta de la
 * búsqueda de la que viene la ficha, y es lo que el servidor anota para que el
 * motor recomiende lo que el usuario está buscando.
 */
function lecturas(options: { readonly consulta?: string } = {}): {
  readonly pedidas: readonly string[]
  readonly promesa: Promise<unknown>
} {
  const pedidas: string[] = []
  const fetch: RequestDeps['fetch'] = async (input) => {
    pedidas.push(input)
    throw new Error('sin red')
  }

  return {
    pedidas,
    promesa: loadDetailCore('fixture', 'aurora-nocturna', {
      deps: { fetch },
      ...(options.consulta === undefined ? {} : { consulta: options.consulta }),
    }),
  }
}

describe('la lectura del detalle', () => {
  test('lleva la consulta de la búsqueda en la dirección de la petición', async () => {
    const { pedidas, promesa } = lecturas({ consulta: 'aurora nocturna' })

    // La petición falla —no hay red fingida— pero la dirección ya se pidió.
    await expect(promesa).rejects.toThrow()

    expect(pedidas).toContain('/api/anime/fixture/aurora-nocturna?q=aurora%20nocturna')
  })

  test('sin consulta la petición es la de siempre', async () => {
    const { pedidas, promesa } = lecturas()

    await expect(promesa).rejects.toThrow()

    expect(pedidas).toContain('/api/anime/fixture/aurora-nocturna')
    expect(pedidas.some((ruta) => ruta.includes('?q='))).toBe(false)
  })

  /**
   * La consulta va sólo en el detalle.
   *
   * Las subrutas se componen sobre la base: con la consulta dentro, el sufijo caía
   * detrás del `?` y las direcciones `/watched`, `/enrichment` y `/metadata` de la
   * ficha no existían. Se veía como una ficha que no carga al abrirla desde una
   * búsqueda, que es justo lo que no puede pasar.
   */
  test('la consulta no se cuela en las subrutas de la ficha', async () => {
    const { pedidas, promesa } = lecturas({ consulta: 'aurora' })

    await expect(promesa).rejects.toThrow()

    expect(pedidas).toContain('/api/anime/fixture/aurora-nocturna/watched')
    expect(pedidas.filter((ruta) => ruta.includes('?q='))).toEqual([
      '/api/anime/fixture/aurora-nocturna?q=aurora',
    ])
  })

  /**
   * El núcleo no pregunta por los adornos.
   *
   * No es una preferencia de estilo: las tres rutas de adorno leen la fila local
   * del anime, que escribe **esta** lectura. Si viajan en la misma tanda piden
   * antes de que la fila exista y la ficha fría se queda sin banner y sin
   * relacionados. La prueba que mide el efecto completo está en `carga-ficha.test.ts`;
   * ésta sujeta la separación en el cargador, que es donde se rompería sin ruido.
   */
  test('el núcleo no pide enriquecimiento, metadatos ni relaciones de AniList', async () => {
    const { pedidas, promesa } = lecturas()

    await expect(promesa).rejects.toThrow()

    expect(pedidas.some((ruta) => ruta.endsWith('/enrichment'))).toBe(false)
    expect(pedidas.some((ruta) => ruta.endsWith('/metadata'))).toBe(false)
    expect(pedidas.some((ruta) => ruta.endsWith('/anilist-related'))).toBe(false)
  })
})
