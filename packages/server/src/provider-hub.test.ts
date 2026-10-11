import { describe, expect, test } from 'bun:test'
import { type LoadReport, providerFailure } from '@nn-anime/provider-sdk'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createProviderHub } from './provider-hub'

const proveedor = createFixtureProvider()

function report(cargados: readonly string[], motivo = 'no conforma'): LoadReport {
  return {
    active: cargados.map((file) => ({
      provider: { ...proveedor, id: file },
      file: `/p/${file}.ts`,
    })),
    rejected: [
      {
        file: '/p/roto.ts',
        reason: providerFailure({ providerId: 'roto', kind: 'invalid-shape', detail: motivo }),
      },
    ],
  }
}

describe('registro vivo de proveedores', () => {
  test('el arranque deja dentro lo que ya estaba cargado', () => {
    const hub = createProviderHub({
      initial: { active: [{ provider: proveedor, file: '/p/fixture.ts' }], rejected: [] },
    })

    expect(hub.providers.map((p) => p.id)).toEqual(['fixture'])
    expect(hub.report.active.length).toBe(1)
  })

  test('la recarga cambia el contenido sin cambiar las referencias', async () => {
    const hub = createProviderHub({
      directory: '/p',
      initial: { active: [{ provider: proveedor, file: '/p/fixture.ts' }], rejected: [] },
      load: async () => report(['uno', 'dos']),
    })

    // Las rutas que ya están montadas guardan estas dos referencias.
    const lista = hub.providers
    const informe = hub.report

    await hub.reload()

    expect(hub.providers).toBe(lista)
    expect(hub.report).toBe(informe)
    expect(lista.map((p) => p.id)).toEqual(['uno', 'dos'])
    // El informe es el mismo objeto: se ve lo nuevo por la misma referencia.
    expect(informe.active.map((e) => e.file)).toEqual(['/p/uno.ts', '/p/dos.ts'])
    expect(informe.rejected.length).toBe(1)
  })

  test('devuelve lo que el cargador devolvió, para poder decir qué falló', async () => {
    const hub = createProviderHub({
      directory: '/p',
      load: async () => report(['uno'], 'el archivo no exporta un proveedor'),
    })

    const salida = await hub.reload()

    expect(salida.rejected[0]?.reason.message).toContain('el archivo no exporta un proveedor')
  })

  test('sin directorio no llama al cargador y devuelve lo que hay', async () => {
    let llamadas = 0
    const hub = createProviderHub({
      initial: { active: [{ provider: proveedor, file: '/p/fixture.ts' }], rejected: [] },
      load: async () => {
        llamadas += 1

        return report(['otro'])
      },
    })

    const salida = await hub.reload()

    expect(llamadas).toBe(0)
    expect(salida.active.map((e) => e.provider.id)).toEqual(['fixture'])
  })

  test('una recarga que deja la lista vacía también vacía los proveedores', async () => {
    const hub = createProviderHub({
      directory: '/p',
      initial: { active: [{ provider: proveedor, file: '/p/fixture.ts' }], rejected: [] },
      load: async () => ({ active: [], rejected: [] }),
    })

    await hub.reload()

    expect(hub.providers).toEqual([])
    expect(hub.report.active).toEqual([])
  })
})
