import { describe, expect, test } from 'bun:test'
import {
  assertConforms,
  type CallOptions,
  getAnime,
  getEpisodes,
  getTrending,
  resolveStream,
  search,
} from '@nn-anime/provider-sdk'
import { CATALOGO } from './data'
import { createFixtureProvider, FIXTURE_PROVIDER_ID, fixtureProvider } from './index'

function opciones(ms = 8000): CallOptions {
  return { signal: AbortSignal.timeout(ms), timeoutMs: ms }
}

const REF_AURORA = { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna' }

describe('conformidad', () => {
  test('el proveedor pasa el test de conformidad', () => {
    const result = assertConforms(fixtureProvider)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.id).toBe(FIXTURE_PROVIDER_ID)
  })

  test('la instancia compartida declara las capacidades del spec', () => {
    expect(fixtureProvider.capabilities).toEqual({
      search: true,
      sub: true,
      dub: true,
      trending: true,
      feed: false,
    })
  })

  test('una instancia creada a mano también conforme, con otro id', () => {
    const otro = createFixtureProvider({ id: 'fixture-2', name: 'Otro' })

    expect(assertConforms(otro).ok).toBe(true)
    expect(otro.capabilities.search).toBe(true)
  })
})

describe('el SDK contra el proveedor de prueba', () => {
  test('search devuelve resultados que cumplen el contrato', async () => {
    const result = await search(fixtureProvider, 'aurora', opciones())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]?.ref.providerId).toBe(FIXTURE_PROVIDER_ID)
      expect(result.value[0]?.coverUrl).toContain('fixture.invalid')
    }
  })

  test('todos los títulos del catálogo se encuentran por su nombre exacto', async () => {
    for (const titulo of CATALOGO) {
      const result = await search(fixtureProvider, titulo.title, opciones())

      expect(result.ok, titulo.ref).toBe(true)
      if (result.ok)
        expect(
          result.value.map((item) => item.ref.value),
          titulo.ref,
        ).toContain(titulo.ref)
    }
  })

  test('getAnime, getEpisodes y resolveStream devuelven formas válidas', async () => {
    const detalle = await getAnime(fixtureProvider, REF_AURORA, opciones())
    const lista = await getEpisodes(fixtureProvider, REF_AURORA, opciones())
    const fuentes = await resolveStream(
      fixtureProvider,
      { episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna#1' }, mode: 'sub' },
      opciones(),
    )

    expect(detalle.ok).toBe(true)
    expect(lista.ok).toBe(true)
    expect(fuentes.ok).toBe(true)
    if (lista.ok) expect(lista.value.length).toBe(12)
    if (fuentes.ok) expect(fuentes.value.length).toBeGreaterThan(0)
  })

  test('getTrending pasa por la capacidad declarada', async () => {
    const result = await getTrending(fixtureProvider, opciones())

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(5)
  })
})

describe('defectos simulados, vistos desde el SDK', () => {
  test('un 500 se convierte en Result, no en una excepción', async () => {
    const roto = createFixtureProvider({ failures: { search: 'http500' } })
    const result = await search(roto, 'aurora', opciones())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('500')
      expect(result.error.op).toBe('search')
      // El estado del upstream llega intacto: el SDK no vuelve a envolver un
      // error que ya es del proveedor, porque al hacerlo perdía este dato y un
      // 404 del sitio acababa siendo un fallo genérico. Antes esta prueba
      // esperaba `kind: 'threw'`, que era justo la señal de esa pérdida.
      expect(result.error.context.estado).toBe(500)
    }
  })

  test('un método que lanza se aísla por método', async () => {
    const roto = createFixtureProvider({ failures: { getEpisodes: 'throws' } })
    const bueno = await getAnime(roto, REF_AURORA, opciones())
    const malo = await getEpisodes(roto, REF_AURORA, opciones())

    expect(bueno.ok).toBe(true)
    expect(malo.ok).toBe(false)
  })

  test('un método que nunca resuelve se aborta por la señal', async () => {
    const colgado = createFixtureProvider({ failures: { search: 'timeout' } })
    const inicio = Date.now()
    const result = await search(colgado, 'aurora', {
      signal: AbortSignal.timeout(30),
      timeoutMs: 30,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.context.kind).toBe('timeout')
    expect(Date.now() - inicio).toBeLessThan(1000)
  })

  test('una referencia que no existe da 404 con el título en el mensaje', async () => {
    const result = await getAnime(
      fixtureProvider,
      { providerId: FIXTURE_PROVIDER_ID, value: 'no-esta' },
      opciones(),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('no-esta')
  })
})

describe('sin red', () => {
  test('el ciclo entero funciona con `fetch` sustituido por algo que lanza', async () => {
    const original = globalThis.fetch
    // Devuelve `never`: no hay ninguna respuesta que fingir, porque lo que se
    // comprueba es que nadie llama. Se conserva `preconnect` para que el objeto
    // siga siendo un `fetch` y no haga falta ninguna conversión de tipo.
    globalThis.fetch = Object.assign(
      (): never => {
        throw new Error('el proveedor de prueba intentó salir a la red')
      },
      { preconnect: original.preconnect },
    )

    try {
      const proveedor = createFixtureProvider()
      const resultados = await search(proveedor, 'aurora', opciones())
      const detalle = await getAnime(proveedor, REF_AURORA, opciones())
      const lista = await getEpisodes(proveedor, REF_AURORA, opciones())
      const fuentes = await resolveStream(
        proveedor,
        {
          episodeRef: { providerId: FIXTURE_PROVIDER_ID, value: 'aurora-nocturna#2' },
          mode: 'sub',
        },
        opciones(),
      )

      expect([resultados.ok, detalle.ok, lista.ok, fuentes.ok]).toEqual([true, true, true, true])
    } finally {
      globalThis.fetch = original
    }
  })
})
