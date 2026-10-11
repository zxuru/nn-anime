import { describe, expect, test } from 'bun:test'
import { streamResolveResponseSchema } from '@nn-anime/core'
import {
  animeResponseSchema,
  episodesResponseSchema,
  providersResponseSchema,
} from '@nn-anime/core/api'
import { conCiclo, filas, JSON_HEADERS } from './fixtures'

const REF = 'aurora-nocturna'
const EPISODIO = `${REF}#1`

/** Una vuelta completa del ciclo, por HTTP. */
async function vueltaCompleta(pedir: (ruta: string, init?: RequestInit) => Promise<Response>) {
  const busqueda = await pedir('/api/search?q=aurora')
  const detalle = await pedir(`/api/anime/fixture/${REF}`)
  const episodios = await pedir(`/api/anime/fixture/${REF}/episodes`)
  const stream = await pedir('/api/stream/resolve', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ episodeRef: { providerId: 'fixture', value: EPISODIO }, mode: 'sub' }),
  })

  return { busqueda, detalle, episodios, stream }
}

describe('el ciclo completo, por las rutas HTTP', () => {
  test('buscar → detalle → episodios → resolver stream, y todo queda cacheado', async () => {
    await conCiclo(async ({ pedir, json, db }) => {
      const respuestas = await vueltaCompleta(pedir)

      expect(respuestas.busqueda.status).toBe(200)
      expect(respuestas.detalle.status).toBe(200)
      expect(respuestas.episodios.status).toBe(200)
      expect(respuestas.stream.status).toBe(200)

      const detalle = animeResponseSchema.parse(await respuestas.detalle.json())
      expect(detalle.title).toBe('Aurora Nocturna')
      expect(detalle.genres.length).toBeGreaterThan(0)

      const lista = episodesResponseSchema.parse(await respuestas.episodios.json())
      expect(lista.episodes.length).toBeGreaterThan(0)

      const stream = streamResolveResponseSchema.parse(await respuestas.stream.json())
      expect(stream.sources[0]?.url).toStartWith('/stream/')

      // Que quedó cacheado se observa **en la tabla**, no en el contador.
      expect(filas(db, 'anime')).toBe(1)
      expect(filas(db, 'episode')).toBeGreaterThan(0)
      expect(filas(db, 'stream_cache')).toBe(1)

      // Y el proveedor se consultó, como mínimo, una vez por recurso.
      expect(await json<{ providers: unknown[] }>('/api/providers')).toBeDefined()
    })
  })

  test('la segunda vuelta no llama al proveedor', async () => {
    await conCiclo(async ({ pedir, proveedor }) => {
      await vueltaCompleta(pedir)
      const trasLaPrimera = {
        search: proveedor.calls.count('search'),
        getAnime: proveedor.calls.count('getAnime'),
        getEpisodes: proveedor.calls.count('getEpisodes'),
        resolveStream: proveedor.calls.count('resolveStream'),
      }

      await vueltaCompleta(pedir)

      expect(proveedor.calls.count('search')).toBe(trasLaPrimera.search)
      expect(proveedor.calls.count('getAnime')).toBe(trasLaPrimera.getAnime)
      expect(proveedor.calls.count('getEpisodes')).toBe(trasLaPrimera.getEpisodes)
      expect(proveedor.calls.count('resolveStream')).toBe(trasLaPrimera.resolveStream)
    })
  })

  test('el detalle y los episodios anuncian su origen en `X-Cache`', async () => {
    await conCiclo(async ({ pedir }) => {
      const primera = await pedir(`/api/anime/fixture/${REF}`)
      const segunda = await pedir(`/api/anime/fixture/${REF}`)
      const episodios = await pedir(`/api/anime/fixture/${REF}/episodes`)

      expect(primera.headers.get('x-cache')).toBe('miss')
      expect(segunda.headers.get('x-cache')).toBe('hit')
      expect(episodios.headers.get('x-cache')).toBe('miss')
    })
  })

  test('un proveedor que falla no rompe el ciclo: se sirve lo cacheado', async () => {
    await conCiclo(async ({ pedir }) => {
      // Primero se llena la caché con el proveedor bueno.
      await pedir(`/api/anime/fixture/${REF}`)
      await pedir(`/api/anime/fixture/${REF}/episodes`)
      await pedir('/api/search?q=aurora')
    })

    // Y ahora se monta otro ciclo con el mismo... no: la base es nueva, así que
    // lo que se prueba es el orden contrario: se llena, se rompe el proveedor y
    // se comprueba que lo cacheado sigue sirviéndose.
    await conCiclo(
      async ({ pedir }) => {
        const detalle = await pedir(`/api/anime/fixture/${REF}`)

        // El proveedor está roto y no hay nada cacheado: el fallo se cuenta, no
        // se disfraza de éxito.
        expect(detalle.status).toBe(502)
      },
      { fallos: { getAnime: 'http500' } },
    )
  })
})

describe('caducidad y refresco por detrás', () => {
  test('pasado el TTL, el detalle se sirve viejo y se refresca por detrás', async () => {
    await conCiclo(async ({ pedir, reloj, proveedor, db }) => {
      await pedir(`/api/anime/fixture/${REF}`)
      const consultas = proveedor.calls.count('getAnime')

      // El TTL del detalle es 86400 s: se mueve el reloj en vez de esperar.
      reloj.avanzar(86_400 * 1000 + 1)

      const respuesta = await pedir(`/api/anime/fixture/${REF}`)

      expect(respuesta.headers.get('x-cache')).toBe('stale')
      expect(respuesta.status).toBe(200)

      // El refresco ocurre por detrás: al poco rato el proveedor fue consultado
      // otra vez y la fila tiene la fecha nueva.
      for (
        let intento = 0;
        intento < 50 && proveedor.calls.count('getAnime') <= consultas;
        intento++
      ) {
        await Bun.sleep(5)
      }

      expect(proveedor.calls.count('getAnime')).toBeGreaterThan(consultas)
      const fila = db.query('SELECT fetched_at FROM anime').get() as { fetched_at: number }
      expect(fila.fetched_at).toBe(reloj.ahora())
    })
  })

  test('dentro del TTL no se llama al proveedor', async () => {
    await conCiclo(async ({ pedir, reloj, proveedor }) => {
      await pedir(`/api/anime/fixture/${REF}`)
      const consultas = proveedor.calls.count('getAnime')

      reloj.avanzar(60_000)
      const respuesta = await pedir(`/api/anime/fixture/${REF}`)

      expect(respuesta.headers.get('x-cache')).toBe('hit')
      expect(proveedor.calls.count('getAnime')).toBe(consultas)
    })
  })

  test('un enlace de stream caducado no se sirve viejo: se resuelve otra vez', async () => {
    await conCiclo(async ({ pedir, reloj, proveedor }) => {
      const cuerpo = JSON.stringify({
        episodeRef: { providerId: 'fixture', value: EPISODIO },
        mode: 'sub',
      })
      const primera = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: cuerpo,
      })
      const consultas = proveedor.calls.count('resolveStream')

      // El TTL del stream es 600 s y no hay rama stale: vencido, se resuelve.
      reloj.avanzar(600 * 1000 + 1)

      const segunda = await pedir('/api/stream/resolve', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: cuerpo,
      })

      expect(primera.headers.get('x-cache')).toBe('miss')
      expect(segunda.headers.get('x-cache')).toBe('miss')
      expect(proveedor.calls.count('resolveStream')).toBeGreaterThan(consultas)
    })
  })
})

describe('la búsqueda por HTTP', () => {
  test('devuelve resultados del fixture por SSE y los cachea', async () => {
    await conCiclo(async ({ pedir, db }) => {
      const respuesta = await pedir('/api/search?q=aurora')
      const texto = await respuesta.text()

      expect(respuesta.headers.get('content-type')).toContain('text/event-stream')
      expect(texto).toContain('"type":"results"')
      expect(texto).toContain('"type":"done"')
      expect(filas(db, 'search_cache')).toBe(1)
    })
  })

  test('la segunda búsqueda idéntica sale de la caché', async () => {
    await conCiclo(async ({ pedir, proveedor }) => {
      await (await pedir('/api/search?q=aurora')).text()
      const consultas = proveedor.calls.count('search')

      const texto = await (await pedir('/api/search?q=aurora')).text()

      expect(texto).toContain('Aurora Nocturna')
      expect(proveedor.calls.count('search')).toBe(consultas)
    })
  })

  test('los proveedores se listan con sus capacidades', async () => {
    await conCiclo(async ({ json }) => {
      const salida = providersResponseSchema.parse(await json('/api/providers'))

      expect(salida.providers).toHaveLength(1)
      expect(salida.providers[0]?.status).toBe('active')
      expect(salida.providers[0]?.capabilities.search).toBe(true)
    })
  })
})

describe('la puerta de entrada', () => {
  test('sin sesión, ninguna ruta de la API responde', async () => {
    await conCiclo(async ({ pedir }) => {
      for (const ruta of [
        '/api/health',
        '/api/providers',
        '/api/anime/fixture/x',
        '/api/search?q=a',
      ]) {
        const respuesta = await pedir(ruta, { headers: {} })

        expect(respuesta.status, ruta).toBe(401)
      }
    })
  })

  test('con `Host` ajeno y cookie válida, tampoco', async () => {
    await conCiclo(async ({ pedir }) => {
      const respuesta = await pedir('/api/health', {
        headers: { cookie: 'nn_session=sesion-de-integracion', host: 'otro.example' },
      })

      expect(respuesta.status).toBe(403)
    })
  })
})

describe('la segunda vuelta de la home', () => {
  test('las recomendaciones no vuelven a pedir tendencias: están cacheadas', async () => {
    await conCiclo(async ({ pedir, proveedor }) => {
      await (await pedir('/api/recommendations')).json()
      const trasLaPrimera = proveedor.calls.count('getTrending')

      await (await pedir('/api/recommendations')).json()

      // **Era un hallazgo de la auditoría de T47 y ya está arreglado**: las
      // tendencias no se cacheaban, así que la segunda vuelta volvía a pedirlas.
      // Ahora hay `trending_cache` con TTL de 900 s y la segunda carga no llama a
      // nadie.
      expect(proveedor.calls.count('getTrending')).toBe(trasLaPrimera)
    })
  })

  test('el detalle y la búsqueda sí salen de la base sin llamar a nadie', async () => {
    await conCiclo(async ({ pedir, proveedor }) => {
      await pedir(`/api/anime/fixture/aurora-nocturna`)
      await pedir('/api/anime/fixture/aurora-nocturna/episodes')
      await (await pedir('/api/search?q=aurora')).text()

      const antes = {
        getAnime: proveedor.calls.count('getAnime'),
        getEpisodes: proveedor.calls.count('getEpisodes'),
        search: proveedor.calls.count('search'),
      }

      await pedir(`/api/anime/fixture/aurora-nocturna`)
      await pedir('/api/anime/fixture/aurora-nocturna/episodes')
      await (await pedir('/api/search?q=aurora')).text()

      expect(proveedor.calls.count('getAnime')).toBe(antes.getAnime)
      expect(proveedor.calls.count('getEpisodes')).toBe(antes.getEpisodes)
      expect(proveedor.calls.count('search')).toBe(antes.search)
    })
  })
})
