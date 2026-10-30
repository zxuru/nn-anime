import { beforeEach, describe, expect, test } from 'bun:test'
import type { RequestDeps } from '../../api/client'
import { cargarFicha, detailCache } from './load-detail'
import { olvidarPrefetch } from './prefetch'

/**
 * La ficha fría: la que nadie abrió antes.
 *
 * Este archivo mide el fallo que la interfaz enseñaba como «el banner y los
 * relacionados no aparecen hasta recargar». El servidor de verdad tiene una
 * dependencia de orden que no se ve en los tipos: el enriquecimiento, los
 * metadatos, las relaciones de AniList y **también los hermanos de saga y las
 * otras fuentes** leen la fila local del anime para saber de qué obra hablan, y
 * esa fila la escribe el `GET` del detalle (`readThrough` → `write` antes de
 * responder). El servidor de mentira de aquí copia esa dependencia —`escrita`— en
 * vez de devolver siempre lo mismo: un doble más cómodo escondería justo el orden
 * que hay que medir.
 *
 * Con el orden anterior —todas las lecturas a la vez— las que dependen de la fila
 * leían la base antes de que existiera, devolvían vacío y la primera apertura se
 * quedaba sin banner, sin relacionadas y sin rail de saga; al recargar aparecían.
 */

const BASE = '/api/anime/fixture/aurora-nocturna'

const DETALLE = {
  ref: { providerId: 'fixture', value: 'aurora-nocturna' },
  title: 'Aurora Nocturna',
  year: 2019,
  kind: 'tv',
  genres: ['Acción'],
  studios: ['Estudio Cobre'],
}

const HERMANA = {
  ref: { providerId: 'fixture', value: 'aurora-nocturna-2' },
  title: 'Aurora Nocturna 2nd Season',
  year: 2021,
  kind: 'tv',
}

const FUENTE = {
  ref: { providerId: 'otra', value: 'aurora-nocturna' },
  title: 'Aurora Nocturna',
  year: 2019,
}

const ENRIQUECIDO = {
  anilistId: 555,
  cover: '/api/anilist/image/cover/555',
  banner: '/api/anilist/image/banner/555',
  genres: ['Misterio', 'Fantasía'],
  studios: ['Estudio Cobre'],
  adult: false,
  siteUrl: 'https://anilist.co/anime/555',
}

const RELACIONADA = {
  anilistId: 556,
  title: 'Aurora Nocturna 2nd Season',
  cover: '/api/anilist/image/cover/556',
  adult: false,
  relation: 'sequel',
}

interface ServidorFrio {
  readonly deps: RequestDeps
  /** Las rutas pedidas, en orden y sin la consulta. */
  readonly peticiones: readonly string[]
  /**
   * Las lecturas que se pidieron **antes** de que la fila local existiera.
   *
   * Es el fallo, medido en el sitio donde ocurre: con el orden anterior esta lista
   * tenía cinco entradas y la ficha fría se quedaba sin banner, sin relacionados y
   * sin saga. Tiene que quedar vacía siempre.
   */
  readonly lecturasFrias: readonly string[]
}

/**
 * Las rutas que necesitan la fila local del anime.
 *
 * Es la lista que el servidor exige de verdad: `related`, `sources`,
 * `enrichment`, `metadata` y `anilist-related` leen `readAnime` antes de
 * contestar (ver `routes/detail.ts`, `routes/tmdb.ts` y `routes/anilist.ts`).
 */
function necesitaLaFila(ruta: string): boolean {
  return (
    ruta === `${BASE}/related` ||
    ruta === `${BASE}/sources` ||
    ruta.endsWith('/enrichment') ||
    ruta.endsWith('/metadata') ||
    ruta.endsWith('/anilist-related')
  )
}

/**
 * Un servidor de mentira con la dependencia del de verdad.
 *
 * `escrita` empieza en falso —nadie abrió la ficha— y pasa a verdadero cuando el
 * `GET` del detalle responde, que es cuando el servidor de verdad ya escribió la
 * fila. Las lecturas que cuelgan de la fila contestan vacío mientras no esté
 * escrita, con el mismo contrato que las rutas del servidor.
 */
function servidorFrio(): ServidorFrio {
  const peticiones: string[] = []
  const lecturasFrias: string[] = []
  let escrita = false

  const deps: RequestDeps = {
    fetch: async (input) => {
      const [ruta = ''] = input.split('?')
      peticiones.push(ruta)

      if (necesitaLaFila(ruta) && !escrita) lecturasFrias.push(ruta)

      if (ruta === BASE) {
        // El servidor escribe antes de responder; que tarde un poco es la ventana
        // que el orden anterior aprovechaba para preguntar antes de tiempo.
        await Bun.sleep(5)
        escrita = true

        return Response.json(DETALLE)
      }

      // Hermanos de saga, franquicia y otras fuentes: locales, pero cuelgan de la
      // fila del anime que acaba de escribir el detalle.
      if (ruta === `${BASE}/related`) return Response.json({ items: escrita ? [HERMANA] : [] })
      if (ruta === `${BASE}/sources`) return Response.json({ items: escrita ? [FUENTE] : [] })
      if (ruta === `${BASE}/watched`) return Response.json({ episodes: [] })

      if (ruta === '/api/providers') {
        return Response.json({
          providers: [
            {
              id: 'fixture',
              name: 'Fixture',
              status: 'active',
              capabilities: {
                search: true,
                sub: true,
                dub: false,
                trending: false,
                feed: false,
              },
            },
          ],
        })
      }

      // Los adornos de terceros: sin la fila local no hay con qué emparejar.
      if (ruta === `${BASE}/enrichment`) {
        return Response.json({ enrichment: escrita ? ENRIQUECIDO : null })
      }
      if (ruta === `${BASE}/metadata`) return Response.json({ metadata: null })
      if (ruta === `${BASE}/anilist-related`) {
        return Response.json({ items: escrita ? [RELACIONADA] : [] })
      }

      return new Response('ruta no esperada', { status: 500 })
    },
  }

  return { deps, peticiones, lecturasFrias }
}

beforeEach(() => {
  detailCache.clear()
  olvidarPrefetch('fixture', 'aurora-nocturna')
})

describe('la ficha fría', () => {
  test('llega entera —saga, fuentes, banner y relacionadas— sin recargar', async () => {
    const { deps } = servidorFrio()
    const carga = cargarFicha('fixture', 'aurora-nocturna', { deps })

    const nucleo = await carga.nucleo
    const adornos = await carga.adornos

    expect(nucleo.detail.title).toBe('Aurora Nocturna')
    // El rail de saga y el «también en» también se quedaban vacíos en frío.
    expect(nucleo.related.map((item) => item.title)).toEqual(['Aurora Nocturna 2nd Season'])
    expect(nucleo.franchise.map((item) => item.title)).toEqual(['Aurora Nocturna 2nd Season'])
    expect(nucleo.sources.map((item) => item.ref.providerId)).toEqual(['otra'])
    // Lo que el usuario reportaba: sin esto hay que recargar la página.
    expect(adornos?.enrichment?.banner).toBe('/api/anilist/image/banner/555')
    expect(adornos?.anilistRelated.map((item) => item.anilistId)).toEqual([556])
  })

  /**
   * El orden, medido en el sitio donde importa.
   *
   * La prueba de arriba falla si el orden está mal, pero ésta dice **cuál** es el
   * orden: cuando se pregunta por una lectura que cuelga de la fila, la fila ya
   * está escrita. Es la que distingue «se arregló el orden» de «se cambió el
   * servidor de mentira hasta que pasara».
   */
  test('las lecturas que cuelgan de la fila se piden cuando está escrita', async () => {
    const { deps, peticiones, lecturasFrias } = servidorFrio()
    const carga = cargarFicha('fixture', 'aurora-nocturna', { deps })

    await carga.nucleo
    await carga.adornos

    expect(lecturasFrias).toEqual([])
    for (const ruta of [
      `${BASE}/related`,
      `${BASE}/sources`,
      `${BASE}/enrichment`,
      `${BASE}/metadata`,
      `${BASE}/anilist-related`,
    ]) {
      expect(peticiones).toContain(ruta)
    }
  })

  test('sin núcleo no se pregunta por lo que cuelga de la fila', async () => {
    const peticiones: string[] = []
    const deps: RequestDeps = {
      fetch: async (input) => {
        const [ruta = ''] = input.split('?')
        peticiones.push(ruta)

        return new Response(JSON.stringify({ error: 'no está' }), { status: 404 })
      },
    }

    const carga = cargarFicha('fixture', 'aurora-nocturna', { deps })

    await expect(carga.nucleo).rejects.toThrow()
    expect(await carga.adornos).toBeUndefined()
    expect(peticiones.some((ruta) => ruta.includes('/related'))).toBe(false)
    expect(peticiones.some((ruta) => ruta.includes('/sources'))).toBe(false)
    expect(peticiones.some((ruta) => ruta.includes('/enrichment'))).toBe(false)
    expect(peticiones.some((ruta) => ruta.includes('/anilist-related'))).toBe(false)
  })
})
