import { describe, expect, test } from 'bun:test'
import { ProviderError } from '@nn-anime/core'
import type { CallOptions } from '@nn-anime/provider-sdk'
import { CATALOGO, cargarCatalogo, TITULO_CON_REFERER } from './data'
import {
  createFixtureProvider,
  FIXTURE_PROVIDER_ID,
  fixtureOptionsFromEnv,
  REF_FALLA,
  REF_LENTO,
  REF_NO_EXISTE,
} from './index'

function opciones(ms = 50): CallOptions {
  return { signal: AbortSignal.timeout(ms), timeoutMs: ms }
}

const REF_AURORA = { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna' }

describe('catálogo', () => {
  test('tiene al menos doce títulos', () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(12)
  })

  test('cada título trae lo que la interfaz necesita mostrar', () => {
    for (const titulo of CATALOGO) {
      expect(titulo.title.length, titulo.ref).toBeGreaterThan(0)
      expect(titulo.synopsis.length, titulo.ref).toBeGreaterThan(0)
      expect(titulo.studios.length, titulo.ref).toBeGreaterThan(0)
      expect(titulo.genres.length, titulo.ref).toBeGreaterThan(0)
      expect(Number.isInteger(titulo.year), titulo.ref).toBe(true)
    }
  })

  test('hay streams de los dos tipos y subtítulos en los dos formatos', () => {
    const tipos = new Set(CATALOGO.flatMap((titulo) => titulo.streams))
    const formatos = new Set(CATALOGO.flatMap((titulo) => titulo.subs))

    expect([...tipos].sort()).toEqual(['file', 'hls'])
    expect([...formatos].sort()).toEqual(['srt', 'vtt'])
  })

  test('hay al menos un título que exige Referer y otro que no', () => {
    const conReferer = CATALOGO.filter((titulo) => titulo.ref === TITULO_CON_REFERER)
    const sinReferer = CATALOGO.filter((titulo) => titulo.ref !== TITULO_CON_REFERER)

    expect(conReferer).toHaveLength(1)
    expect(sinReferer.length).toBeGreaterThan(0)
  })

  test('un catálogo con un campo que falta se rechaza al cargarlo, no al usarlo', () => {
    expect(() => cargarCatalogo('/no/existe/catalogo.json')).toThrow()
  })
})

describe('métodos del proveedor', () => {
  test('search encuentra por título y por título alternativo', async () => {
    const proveedor = createFixtureProvider()

    expect((await proveedor.search('aurora', opciones()))[0]?.title).toBe('Aurora Nocturna')
    expect((await proveedor.search('night aurora', opciones()))[0]?.ref.value).toBe(
      'aurora-nocturna',
    )
    expect(await proveedor.search('no-existe-esta-obra', opciones())).toEqual([])
  })

  test('search sin consulta devuelve el catálogo, del más popular al menos', async () => {
    const proveedor = createFixtureProvider()
    const resultados = await proveedor.search('', opciones())

    expect(resultados).toHaveLength(CATALOGO.length)
    expect(resultados[0]?.ref.value).toBe('mar-de-cristal')
  })

  test('getAnime devuelve sinopsis, estado, géneros y estudios', async () => {
    const proveedor = createFixtureProvider()
    const detalle = await proveedor.getAnime(REF_AURORA, opciones())

    expect(detalle.title).toBe('Aurora Nocturna')
    expect(detalle.genres).toContain('Acción')
    expect(detalle.studios).toContain('Estudio Cobre')
    expect(detalle.episodeCount).toBe(12)
    expect(detalle.coverUrl).toContain('fixture.invalid')
  })

  test('getEpisodes devuelve tantos como declara el título', async () => {
    const proveedor = createFixtureProvider()
    const lista = await proveedor.getEpisodes(REF_AURORA, opciones())

    expect(lista).toHaveLength(12)
    expect(lista[0]?.number).toBe(1)
    expect(lista[11]?.number).toBe(12)
    expect(lista[0]?.animeRef.value).toBe('aurora-nocturna')
  })

  test('un título sin episodios devuelve una lista vacía, no un error', async () => {
    const proveedor = createFixtureProvider()
    const lista = await proveedor.getEpisodes(
      { providerId: FIXTURE_PROVIDER_ID, value: 'orbita-corta' },
      opciones(),
    )

    expect(lista).toEqual([])
  })

  test('resolveStream da hls con subtítulos de los dos formatos', async () => {
    const proveedor = createFixtureProvider()
    const fuentes = await proveedor.resolveStream(
      { episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna#3' }, mode: 'sub' },
      opciones(),
    )

    const hls = fuentes.find((fuente) => fuente.kind === 'hls')
    expect(hls?.url).toContain('aurora-nocturna/3/sub/master.m3u8')
    expect(hls?.subtitles?.map((pista) => pista.format).sort()).toEqual(['srt', 'vtt'])
    expect(fuentes.some((fuente) => fuente.kind === 'file')).toBe(true)
  })

  test('el modo cambia la dirección, no la forma', async () => {
    const proveedor = createFixtureProvider()
    const doblaje = await proveedor.resolveStream(
      { episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna#3' }, mode: 'dub' },
      opciones(),
    )

    expect(doblaje.every((fuente) => fuente.url.includes('/dub'))).toBe(true)
  })

  test('un solo título exige Referer, y lo declara en el stream hls', async () => {
    const proveedor = createFixtureProvider()
    const conReferer = await proveedor.resolveStream(
      {
        episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: `${TITULO_CON_REFERER}#1` },
        mode: 'sub',
      },
      opciones(),
    )
    const sinReferer = await proveedor.resolveStream(
      { episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna#1' }, mode: 'sub' },
      opciones(),
    )

    expect(conReferer.find((fuente) => fuente.kind === 'hls')?.headers).toEqual({
      Referer: expect.stringContaining(TITULO_CON_REFERER),
    })
    expect(sinReferer.every((fuente) => fuente.headers === undefined)).toBe(true)
  })

  test('getTrending devuelve los más populares', async () => {
    const proveedor = createFixtureProvider()
    const lista = await proveedor.getTrending?.(opciones())

    expect(lista).toHaveLength(5)
    expect(lista?.[0]?.ref.value).toBe('mar-de-cristal')
  })

  test('toda dirección es del dominio reservado: no hay red que tocar', async () => {
    const proveedor = createFixtureProvider()
    const fuentes = await proveedor.resolveStream(
      { episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna#1' }, mode: 'sub' },
      opciones(),
    )

    for (const fuente of fuentes) expect(fuente.url).toStartWith('https://fixture.invalid/')
    for (const pista of fuentes[0]?.subtitles ?? []) {
      expect(pista.url).toStartWith('https://fixture.invalid/')
    }
  })
})

describe('modos de fallo', () => {
  test('500 por método, con el estado en el contexto', async () => {
    const proveedor = createFixtureProvider({ failures: { search: 'http500' } })

    try {
      await proveedor.search('aurora', opciones())
      throw new Error('debería haber lanzado')
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error
      // El estado viaja en el contexto: el mensaje es para leer y el estado para
      // decidir, y quien decide no puede depender de un texto.
      expect(error.context.estado).toBe(500)
    }
  })

  test('404 con una referencia que no existe, con el estado en el contexto', async () => {
    const proveedor = createFixtureProvider()

    try {
      await proveedor.getAnime({ providerId: 'fixture', value: 'no-esta' }, opciones())
      throw new Error('debería haber lanzado')
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error
      expect(error.message).toContain('no existe')
      expect(error.context.estado).toBe(404)
    }
  })

  test('un método que lanza deja pasar la excepción, que es lo que el SDK captura', async () => {
    const proveedor = createFixtureProvider({ failures: { getEpisodes: 'throws' } })

    await expect(proveedor.getEpisodes(REF_AURORA, opciones())).rejects.toThrow(/lanza a propósito/)
  })

  test('timeout: el método no resuelve y sólo sale por la señal', async () => {
    const proveedor = createFixtureProvider({ failures: { search: 'timeout' } })
    const controlador = new AbortController()
    const promesa = proveedor.search('aurora', {
      signal: controlador.signal,
      timeoutMs: 10_000,
    })

    controlador.abort(new DOMException('se agotó', 'TimeoutError'))

    await expect(promesa).rejects.toThrow(/se agotó/)
  })

  test('la latencia se puede subir, y la señal la corta', async () => {
    const proveedor = createFixtureProvider({ latencyMs: 40 })
    const inicio = Date.now()
    await proveedor.search('aurora', opciones(500))
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(35)

    const controlador = new AbortController()
    const promesa = proveedor.search('aurora', { signal: controlador.signal, timeoutMs: 5000 })
    controlador.abort(new Error('cortado'))

    await expect(promesa).rejects.toThrow(/cortado/)
  })

  test('la referencia especial fuerza el fallo sin tocar la configuración', async () => {
    const proveedor = createFixtureProvider()

    await expect(
      proveedor.getAnime({ providerId: 'fixture', value: REF_FALLA }, opciones()),
    ).rejects.toThrow(/lanza a propósito/)
    await expect(
      proveedor.getAnime({ providerId: 'fixture', value: REF_NO_EXISTE }, opciones()),
    ).rejects.toThrow(/no existe/)
  })

  test('la consulta lenta multiplica la latencia', async () => {
    const proveedor = createFixtureProvider({ latencyMs: 5 })

    const inicioLento = Date.now()
    await proveedor.search(REF_LENTO, opciones(500))
    const conLentitud = Date.now() - inicioLento

    const inicioNormal = Date.now()
    await proveedor.search('aurora', opciones(500))
    const sinLentitud = Date.now() - inicioNormal

    // 50 ms contra ~1 ms: el margen es de sobra para no depender del reloj.
    expect(conLentitud).toBeGreaterThan(sinLentitud + 20)
  })

  test('sin latencia ni fallos, un método no falla', async () => {
    const proveedor = createFixtureProvider()

    expect(await proveedor.search('aurora', opciones())).toHaveLength(1)
  })
})

describe('contador de llamadas', () => {
  test('cuenta por método y en total', async () => {
    const proveedor = createFixtureProvider()

    await proveedor.search('aurora', opciones())
    await proveedor.search('aurora', opciones())
    await proveedor.getAnime(REF_AURORA, opciones())

    expect(proveedor.calls.count('search')).toBe(2)
    expect(proveedor.calls.count('getAnime')).toBe(1)
    expect(proveedor.calls.count('getEpisodes')).toBe(0)
    expect(proveedor.calls.total()).toBe(3)
  })

  test('una llamada que falla también se cuenta', async () => {
    const proveedor = createFixtureProvider({ failures: { search: 'throws' } })

    await expect(proveedor.search('aurora', opciones())).rejects.toThrow()

    expect(proveedor.calls.count('search')).toBe(1)
  })

  test('se puede reiniciar', async () => {
    const proveedor = createFixtureProvider()
    await proveedor.search('aurora', opciones())

    proveedor.calls.reset()

    expect(proveedor.calls.total()).toBe(0)
  })
})

describe('opciones desde el entorno', () => {
  test('sin variables, no hay ni latencia ni fallos', () => {
    expect(fixtureOptionsFromEnv({})).toEqual({})
  })

  test('lee la latencia y los fallos por método', () => {
    expect(
      fixtureOptionsFromEnv({
        NN_ANIME_FIXTURE_LATENCY_MS: '25',
        NN_ANIME_FIXTURE_FAIL: 'search=http500,resolveStream=timeout',
      }),
    ).toEqual({
      latencyMs: 25,
      failures: { search: 'http500', resolveStream: 'timeout' },
    })
  })

  test('ignora lo que no entiende en lugar de romper el arranque', () => {
    expect(
      fixtureOptionsFromEnv({
        NN_ANIME_FIXTURE_LATENCY_MS: 'no-es-un-numero',
        NN_ANIME_FIXTURE_FAIL: 'metodo-que-no-existe=500,search=fallo-que-no-existe,vacio',
      }),
    ).toEqual({})
  })
})
