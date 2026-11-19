/**
 * Una sola lectura de `/api/settings`.
 *
 * El defecto: `useAppTheme()` y `SettingsPage` montaban `useSettings` cada uno por
 * su cuenta, y cada uno pedía los ajustes. No estaban en vuelo a la vez —la raíz
 * lee al arrancar y la página al abrirse—, así que el dedupe de `api/client.ts`,
 * que sólo comparte lo que coincide en el aire, no las juntaba: con Ajustes
 * abierto el servidor recibía dos peticiones de lo mismo.
 *
 * Aquí se cuenta con un `fetch` inyectado (`RequestDeps`), sin DOM: el almacén es
 * un módulo, así que sus dos consumidores se representan por sus dos llamadas a
 * `cargarAjustes`. La primera lectura del archivo, con dos `apiGet` seguidos,
 * deja medido el defecto que el almacén cierra.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { settingsResponseSchema } from '@rona/core/api'
import { apiGet, type RequestDeps } from '../../api/client'
import {
  cargarAjustes,
  estadoAjustes,
  fijarContenidoAdultos,
  fijarPrioridadProveedores,
  fijarTema,
  olvidarAjustes,
  recargarAjustes,
  registrarProveedor,
} from './almacen'

const CAPACIDADES = { search: true, sub: true, dub: false, trending: false, feed: false }

const AJUSTES = {
  theme: 'dark',
  providerPriority: ['uno'],
  adultContent: false,
  paths: { data: '/datos', config: '/configuracion', cache: '/cache' },
  mpv: { available: false },
  providers: [{ id: 'uno', name: 'Uno', capabilities: CAPACIDADES, status: 'active' }],
}

/** El proveedor que devuelve un alta: el mismo id, recargado, para probar el reemplazo. */
const PROVEEDOR_NUEVO = {
  id: 'uno',
  name: 'Uno (recargado)',
  capabilities: { ...CAPACIDADES, dub: true },
  status: 'active' as const,
}

interface Peticion {
  readonly metodo: string
  readonly ruta: string
  readonly cuerpo: unknown
}

interface Servidor {
  readonly deps: RequestDeps
  readonly peticiones: readonly Peticion[]
  /** Cuántos `GET` se pidieron a una ruta. */
  readonly gets: (ruta: string) => number
  /** La primera petición de un método, si la hubo. */
  readonly primera: (metodo: 'PATCH' | 'POST') => Peticion | undefined
}

/**
 * Un servidor de mentira que apunta lo que le piden.
 *
 * `fallaEscritura` contesta 500 a todo lo que no sea `GET`, que es lo que hace el
 * servidor de verdad cuando no puede guardar un ajuste. El `GET` siempre contesta
 * los ajustes: aquí lo que se mide es cuántas veces se piden, no la carga.
 */
function servidor(opciones: { readonly fallaEscritura?: boolean } = {}): Servidor {
  const peticiones: Peticion[] = []

  const deps: RequestDeps = {
    fetch: async (input, init) => {
      const metodo = init.method ?? 'GET'
      const cuerpo: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined

      peticiones.push({ metodo, ruta: input, cuerpo })

      if (metodo !== 'GET' && opciones.fallaEscritura === true) {
        return Response.json({ error: 'no se pudo guardar' }, { status: 500 })
      }

      if (metodo === 'POST' && input === '/api/providers') {
        return Response.json({ provider: PROVEEDOR_NUEVO })
      }

      return Response.json(AJUSTES)
    },
  }

  return {
    deps,
    peticiones,
    gets: (ruta) =>
      peticiones.filter((peticion) => peticion.metodo === 'GET' && peticion.ruta === ruta).length,
    primera: (metodo) => peticiones.find((peticion) => peticion.metodo === metodo),
  }
}

/**
 * Espera a que se cumpla una condición.
 *
 * Las escrituras resuelven en microtareas y la reversión cuelga de un `catch`, así
 * que el número de vueltas no es predecible. Un `Bun.sleep` fijo sería una prueba
 * que pasa por llegar pronto; esto espera a que el hecho ocurra o falla diciendo
 * que no ocurrió.
 */
async function esperar(condicion: () => boolean): Promise<void> {
  const limite = Date.now() + 2000

  while (!condicion()) {
    if (Date.now() > limite) throw new Error('la condición no se cumplió en dos segundos')

    await Bun.sleep(1)
  }
}

/**
 * El almacén es del módulo y los casos lo comparten. Se devuelve a su estado
 * inicial después de cada uno —también al terminar el archivo, porque el registro
 * de módulos es del proceso—: sin esto, el siguiente caso —o el archivo que
 * monte la página— empieza con los ajustes ya leídos.
 */
afterEach(() => {
  olvidarAjustes()
})

describe('una sola lectura de /api/settings', () => {
  test('la raíz y Ajustes comparten la lectura: una petición', async () => {
    const servidorDePrueba = servidor()

    // La raíz: `useAppTheme` pide los ajustes al montar la aplicación.
    await cargarAjustes(servidorDePrueba.deps)
    expect(estadoAjustes().state).toBe('ready')

    // Ajustes: la pantalla monta después y los consume del mismo almacén. Es el
    // caso del defecto —una lectura detrás de otra, nunca en vuelo a la vez—.
    await cargarAjustes(servidorDePrueba.deps)

    expect(servidorDePrueba.gets('/api/settings')).toBe(1)
  })

  test('dos montajes a la vez comparten la lectura en vuelo', async () => {
    const servidorDePrueba = servidor()

    await Promise.all([cargarAjustes(servidorDePrueba.deps), cargarAjustes(servidorDePrueba.deps)])

    expect(servidorDePrueba.gets('/api/settings')).toBe(1)
  })

  /**
   * El defecto, medido.
   *
   * Es lo que hacían los dos hooks antes de compartir almacén: dos `apiGet`
   * seguidos, uno por consumidor. El dedupe del cliente no los junta porque no
   * coinciden en el aire, así que el servidor ve dos. Si alguien vuelve a leer los
   * ajustes por su cuenta —o el almacén pierde el «una sola vez»—, la cuenta de la
   * prueba de arriba sube a este número.
   */
  test('dos lecturas independientes sí son dos peticiones: el defecto que esto cierra', async () => {
    const servidorDePrueba = servidor()

    await apiGet('/api/settings', settingsResponseSchema, {}, servidorDePrueba.deps)
    await apiGet('/api/settings', settingsResponseSchema, {}, servidorDePrueba.deps)

    expect(servidorDePrueba.gets('/api/settings')).toBe(2)
  })

  test('releer sí vuelve a pedirlos: la relectura se conserva', async () => {
    const servidorDePrueba = servidor()

    await cargarAjustes(servidorDePrueba.deps)
    recargarAjustes()

    await esperar(() => servidorDePrueba.gets('/api/settings') === 2)
  })

  test('un fallo no se queda pegado: la siguiente carga reintenta', async () => {
    const roto: RequestDeps = { fetch: () => Promise.reject(new Error('sin red')) }
    const servidorDePrueba = servidor()

    await cargarAjustes(roto)
    expect(estadoAjustes().state).toBe('error')

    // Volver a entrar en Ajustes tiene que reintentar, como antes: si el «una
    // sola vez» se aplicara también al fallo, la pantalla se quedaría en error
    // para siempre.
    await cargarAjustes(servidorDePrueba.deps)

    expect(estadoAjustes().state).toBe('ready')
    expect(servidorDePrueba.gets('/api/settings')).toBe(1)
  })
})

describe('las escrituras, con el comportamiento de antes', () => {
  test('el tema cambia al instante y se guarda', async () => {
    const servidorDePrueba = servidor()
    await cargarAjustes(servidorDePrueba.deps)

    fijarTema('light')

    // Optimista: el documento cambia de color sin esperar a la red.
    expect(estadoAjustes().data?.theme).toBe('light')

    await esperar(() => servidorDePrueba.primera('PATCH') !== undefined)
    expect(servidorDePrueba.primera('PATCH')?.cuerpo).toEqual({ theme: 'light' })
  })

  test('si el servidor no guarda, el tema vuelve al que estaba', async () => {
    const servidorDePrueba = servidor({ fallaEscritura: true })
    await cargarAjustes(servidorDePrueba.deps)

    fijarTema('light')
    expect(estadoAjustes().data?.theme).toBe('light')

    await esperar(() => estadoAjustes().data?.theme === 'dark')
  })

  test('el contenido para adultos se guarda al instante', async () => {
    const servidorDePrueba = servidor()
    await cargarAjustes(servidorDePrueba.deps)

    fijarContenidoAdultos(true)

    expect(estadoAjustes().data?.adultContent).toBe(true)

    await esperar(() => servidorDePrueba.primera('PATCH') !== undefined)
    expect(servidorDePrueba.primera('PATCH')?.cuerpo).toEqual({ adultContent: true })
  })

  test('el orden de proveedores se guarda al instante', async () => {
    const servidorDePrueba = servidor()
    await cargarAjustes(servidorDePrueba.deps)

    fijarPrioridadProveedores(['dos', 'uno'])

    expect(estadoAjustes().data?.providerPriority).toEqual(['dos', 'uno'])

    await esperar(() => servidorDePrueba.primera('PATCH') !== undefined)
    expect(servidorDePrueba.primera('PATCH')?.cuerpo).toEqual({ providerPriority: ['dos', 'uno'] })
  })

  test('registrar un proveedor lo deja en la lista, sin releerla', async () => {
    const servidorDePrueba = servidor()
    await cargarAjustes(servidorDePrueba.deps)
    const antes = servidorDePrueba.gets('/api/settings')

    const registrado = await registrarProveedor({ id: 'uno' })

    expect(registrado.id).toBe('uno')
    // Un alta repetida no deja dos filas del mismo: se sustituye por id.
    expect(estadoAjustes().data?.providers).toEqual([PROVEEDOR_NUEVO])
    expect(servidorDePrueba.primera('POST')?.ruta).toBe('/api/providers')
    // La lista se compone con la respuesta y no con otra lectura.
    expect(servidorDePrueba.gets('/api/settings')).toBe(antes)
  })
})
