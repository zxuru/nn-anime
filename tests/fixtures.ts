/**
 * Andamiaje del nivel de integración.
 *
 * Estos tests viven fuera de los paquetes a propósito: recorren el ciclo
 * **por las rutas HTTP**, contra la aplicación montada, no llamando a los
 * módulos de cada paquete. Los tres fallos de integración reales de este
 * proyecto —los estáticos tragándose la API, el orden de las reglas del proxy de
 * Vite y el guard de sesión— no estaban en ningún módulo: estaban en la
 * composición, y sólo se ven desde aquí.
 *
 * Nada toca la red ni `$XDG_*`: la base va en un directorio temporal, el
 * proveedor es el fixture del repositorio y el proxy recibe un `fetch` de
 * mentira.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, runMigrations, type StoreConnection } from '@nn-anime/catalog-store'
import type { Provider } from '@nn-anime/provider-sdk'
import type { FixtureOptions } from '@nn-anime/providers-fixture'
import { createFixtureProvider } from '@nn-anime/providers-fixture'
import { createApp, createContainer, type ServerContainer } from '@nn-anime/server'

export const PORT = 7717
export const SESSION_COOKIE = 'nn_session'
export const SESSION_VALUE = 'sesion-de-integracion'
export const BASE = `http://127.0.0.1:${PORT}`

/**
 * El valor que lleva la cabecera `Host`: nombre y puerto, sin esquema.
 *
 * Existía una prueba que ponía `host: GOOD.origin` —con el `http://` dentro— y
 * pasaba porque el guard de `Host` no cubría `/`. Un valor así no es un `Host`
 * válido: no lo manda ningún navegador. Ahora que el guard cubre todo, se usa
 * esto.
 */
export const HOST = `127.0.0.1:${PORT}`
export const GOOD = { cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`, origin: BASE }
export const JSON_HEADERS = { ...GOOD, 'content-type': 'application/json' }

/** Reloj de mentira, que se puede mover sin esperar. */
export interface Reloj {
  ahora(): number
  avanzar(ms: number): void
}

export function reloj(inicio: number = 1_000_000_000_000): Reloj {
  let valor = inicio

  return {
    ahora: () => valor,
    avanzar(ms) {
      valor += ms
    },
  }
}

export interface Ciclo {
  readonly db: StoreConnection
  /** El contenedor montado: las pruebas de seguridad emiten tickets con él. */
  readonly container: ServerContainer
  readonly reloj: Reloj
  readonly proveedor: ReturnType<typeof createFixtureProvider>
  readonly upstream: { llamadas: number }
  /** Petición a la aplicación, con la sesión ya puesta. */
  readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>
  readonly json: <T>(ruta: string, init?: RequestInit) => Promise<T>
}

export interface CicloOptions {
  /** Fallo del proveedor, por método. */
  readonly fallos?: FixtureOptions['failures']
  /**
   * Proveedores activos **además** del fixture.
   *
   * Existe para poder medir lo contrario de una ausencia: las mismas filas de la
   * base, con su proveedor cargado. Sin ese control, una prueba que espera que no
   * salga nada pasaría también con la lectura rota.
   */
  readonly activos?: readonly Provider[]
}

/**
 * Monta la aplicación completa contra una base temporal y un fixture.
 *
 * El contenedor comparte el reloj de mentira con la base: la caducidad y el
 * `stale-while-revalidate` se prueban moviendo el reloj, no esperando.
 */
export async function conCiclo<T>(
  body: (ciclo: Ciclo) => Promise<T>,
  options: CicloOptions = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nn-anime-ciclo-'))
  const db = openDb(join(dir, 'nn-anime.db'))
  runMigrations(db)

  const relojDePrueba = reloj()
  const upstream = { llamadas: 0 }
  const proveedor = createFixtureProvider(
    options.fallos === undefined ? {} : { failures: options.fallos },
  )
  const container = createContainer({ db, now: () => relojDePrueba.ahora() })

  // Proxy de mentira: ni red ni DNS. Lo que se prueba aquí es el ciclo, no el
  // reenvío de bytes, que tiene sus propias pruebas.
  const fetchImpl = async (): Promise<Response> => {
    upstream.llamadas += 1

    return new Response(new Uint8Array(64), {
      status: 206,
      headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-63/1024' },
    })
  }

  try {
    const servidor = createApp({
      port: PORT,
      session: {
        cookieName: SESSION_COOKIE,
        value: SESSION_VALUE,
        matches: (candidate) => candidate === SESSION_VALUE,
      },
      bootToken: 'token-de-integracion',
      version: '0.1.0',
      plugins: {
        active: [
          { provider: proveedor, file: '/plugins/fixture.ts' },
          ...(options.activos ?? []).map((provider) => ({
            provider,
            file: `/plugins/${provider.id}.ts`,
          })),
        ],
        rejected: [],
      },
      container,
      streamFetchImpl: fetchImpl,
      streamResolver: async () => ['93.184.216.34'],
    })

    const pedir = async (ruta: string, init?: RequestInit): Promise<Response> =>
      await Promise.resolve(servidor.request(`${BASE}${ruta}`, init ?? { headers: GOOD }))

    return await body({
      db,
      container,
      reloj: relojDePrueba,
      proveedor,
      upstream,
      pedir,
      json: async <T>(ruta: string, init?: RequestInit): Promise<T> =>
        (await (await pedir(ruta, init)).json()) as T,
    })
  } finally {
    await container.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

/** Cuenta las filas de una tabla. Es como se observa que algo quedó cacheado. */
export function filas(db: StoreConnection, tabla: string): number {
  const resultado = db.query(`SELECT COUNT(*) AS total FROM ${tabla}`).get() as { total: number }

  return resultado.total
}
