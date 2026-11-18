/**
 * Rutas `/api/providers`: qué plugins cargaron, cuáles no y cómo se porta uno.
 *
 * La interfaz necesita las dos listas. Un plugin rechazado es lo que el usuario
 * tiene que ver cuando copia un archivo mal escrito: si la ruta sólo devolviera
 * los activos, el plugin «desaparecería» sin decir nada, que es el modo de fallo
 * silencioso que este proyecto corrige una y otra vez.
 *
 * El resumen se construye aquí, en el server, a partir del informe del loader, y
 * no lo construye el CLI: así hay una sola definición de qué es un resumen de
 * proveedor y el CLI no tiene que saber la forma de la respuesta.
 *
 * `POST /api/providers/:id/probe` es el diagnóstico. Consulta una vez al
 * proveedor con un término fijo, mide lo que tarda y **no guarda el resultado en
 * ningún sitio**: lo que se persiste es lo que luego no se puede podar, y un
 * dato de salud que envejece en la base es peor que no tenerlo.
 */

import {
  errorResponseSchema,
  type ProviderProbeResponse,
  type ProviderSummary,
  providerProbeResponseSchema,
  providersResponseSchema,
} from '@rona/core'
import { type Provider, search as searchProvider } from '@rona/provider-sdk'
import type { Hono } from 'hono'

/**
 * Lo que el loader encontró, en la forma mínima que el server necesita.
 *
 * Es estructural y no importado de `provider-sdk` para que el server no dependa
 * del tipo exacto del informe: basta con que traiga lo que hace falta.
 */
export interface PluginReport {
  readonly active: readonly {
    readonly provider: Provider
    readonly file: string
    /**
     * Un fallo que el loader quiera dejar dicho de un plugin que **sí** cargó.
     *
     * El informe de hoy no lo trae, pero el resumen de la interfaz ya lo admite:
     * el día que el loader sepa contar un aviso, no hay que cambiar el contrato
     * de `/api/providers` ni la pantalla de Ajustes.
     */
    readonly lastError?: { readonly message: string } | undefined
  }[]
  readonly rejected: readonly {
    readonly file: string
    readonly reason: { readonly message: string }
  }[]
}

/**
 * El nombre del archivo sin ruta ni extensión, para poder nombrar un rechazo.
 *
 * Parte por **los dos separadores**, no sólo por `/`: en Windows una ruta llega
 * con `\`, y partir sólo por `/` devolvía la ruta entera como nombre. Se vio en
 * vivo: un proveedor habilitado de un repositorio que no conformaba salía en la
 * lista con `C:\datos\repos\…\index.js` de identificador.
 */
export function fileStem(file: string): string {
  const base = file.split(/[\\/]/).at(-1) ?? file

  return base.replace(/\.(ts|js|mjs)$/, '')
}

/** Lo que puede ocupar un error en una fila de Ajustes sin romper la línea. */
const MAX_ERROR_LENGTH = 300

/**
 * Una ruta absoluta, de Windows o de Unix, para quitarla del mensaje.
 *
 * El `(^|[\s"'(])` del principio no es decoración: sin él, los `//` de una URL
 * se leerían como una ruta y `https://sitio/x` acabaría en `https:/…`. Una ruta
 * de verdad empieza la frase o va detrás de un espacio, una comilla o un paréntesis.
 */
const ABSOLUTE_PATH = /(^|[\s"'(])(?:[A-Za-z]:[\\/]|\/)[^\s'"`<>|:,;)]*/g

/**
 * Un mensaje de error breve y sin rutas del disco.
 *
 * El motivo de un rechazo lo escribe el loader y suele empezar por la ruta del
 * archivo. Esa ruta es útil mientras se depura el plugin, pero en Ajustes ocupa
 * el renglón y no le dice nada a quien sólo quiere saber qué pasó.
 */
export function briefError(message: string): string {
  const sinRutas = message.replace(ABSOLUTE_PATH, '$1…')
  const plano = sinRutas.replace(/\s+/g, ' ').trim()

  return plano.length <= MAX_ERROR_LENGTH ? plano : `${plano.slice(0, MAX_ERROR_LENGTH).trimEnd()}…`
}

/**
 * Los plugins activos y los rechazados, como resúmenes.
 *
 * Un rechazo puede no tener `id` ni capacidades legibles —puede que el archivo
 * ni siquiera fuera un objeto—, así que se usa el nombre del archivo y unas
 * capacidades en falso. Inventar un `id` que nadie declaró haría que la interfaz
 * ofreciera un filtro que no existe.
 */
export function summarizePlugins(report: PluginReport): readonly ProviderSummary[] {
  const activos: ProviderSummary[] = report.active.map((entry) => {
    const lastError = entry.lastError === undefined ? '' : briefError(entry.lastError.message)

    return {
      id: entry.provider.id,
      name: entry.provider.name,
      capabilities: entry.provider.capabilities,
      status: 'active',
      ...(lastError === '' ? {} : { lastError }),
    }
  })

  const rechazados: ProviderSummary[] = report.rejected.map((entry) => {
    const lastError = briefError(entry.reason.message)

    return {
      id: fileStem(entry.file),
      name: fileStem(entry.file),
      capabilities: { search: false, sub: false, dub: false, trending: false, feed: false },
      status: 'rejected',
      reason: entry.reason.message,
      ...(lastError === '' ? {} : { lastError }),
    }
  })

  return [...activos, ...rechazados]
}

/** El término de la prueba: uno que cualquier fuente de anime debería entender. */
export const PROBE_QUERY = 'naruto'

/**
 * Lo que se espera a un proveedor en la prueba.
 *
 * Cinco segundos y no los ocho de la búsqueda: aquí el usuario está mirando un
 * botón, no esperando resultados, y un diagnóstico que tarda ocho segundos en
 * decir «no responde» es un diagnóstico que se abandonó antes de leerlo.
 */
export const PROBE_TIMEOUT_MS = 5000

/**
 * Prueba un proveedor y devuelve latencia y fallo, sin lanzar nunca.
 *
 * La carrera con el plazo es la misma que la de la búsqueda y por el mismo
 * motivo: un plugin que ignore la señal no puede dejar la petición colgada.
 * Además del `race`, la señal se le pasa al SDK para que aborte la red que el
 * plugin esté haciendo; ambas cosas cubren casos distintos.
 */
export async function probeProvider(
  provider: Provider,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProviderProbeResponse> {
  const inicio = performance.now()
  const latencia = (): number => Math.max(0, Math.round(performance.now() - inicio))
  const plazo = AbortSignal.timeout(timeoutMs)
  const vencido = (): ProviderProbeResponse => ({
    ok: false,
    latencyMs: latencia(),
    error: `el proveedor '${provider.id}' no respondió en ${timeoutMs} ms`,
  })
  /*
    La bandera no es un adorno: el proveedor que respeta la señal rechaza su
    promesa **antes** de que nuestro oyente del plazo llegue a correr, y sin ella
    el mensaje dependería del orden de dos microtareas. Con la bandera, cualquier
    respuesta que llegue después del plazo se cuenta como plazo, que es lo que el
    usuario tiene que leer.
  */
  let agotado = false

  const consulta = searchProvider(provider, PROBE_QUERY, { signal: plazo, timeoutMs })
    .then((resultado): ProviderProbeResponse => {
      if (agotado) return vencido()
      if (resultado.ok) return { ok: true, latencyMs: latencia() }

      return { ok: false, latencyMs: latencia(), error: briefError(resultado.error.message) }
    })
    .catch(
      (cause: unknown): ProviderProbeResponse =>
        agotado
          ? vencido()
          : {
              ok: false,
              latencyMs: latencia(),
              error: briefError(cause instanceof Error ? cause.message : String(cause)),
            },
    )

  /**
   * El mensaje del plazo lo pone esta promesa, no el rechazo del SDK: el SDK
   * propaga el motivo de la señal —un `TimeoutError` de la plataforma— y ese
   * texto no dice cuánto se esperó ni de quién era la culpa.
   */
  const limite = new Promise<ProviderProbeResponse>((resolve) => {
    plazo.addEventListener(
      'abort',
      () => {
        agotado = true
        resolve(vencido())
      },
      { once: true },
    )
  })

  return Promise.race([consulta, limite])
}

/** Una respuesta de error con la forma que espera la interfaz. */
function failure(message: string): { readonly error: string } {
  return errorResponseSchema.parse({ error: message })
}

export interface ProvidersRouteOptions {
  readonly plugins: PluginReport
  /** Plazo de la prueba. Se acorta en las pruebas de la ruta. */
  readonly timeoutMs?: number | undefined
}

export function registerProvidersRoute(app: Hono, options: ProvidersRouteOptions): void {
  app.get('/api/providers', (c) =>
    // Se valida lo que se sirve: el schema es el contrato, y construir el cuerpo
    // a mano sin comprobarlo es cómo se publica una forma que la interfaz
    // rechaza en el navegador, lejos de la causa.
    c.json(providersResponseSchema.parse({ providers: summarizePlugins(options.plugins) })),
  )

  app.post('/api/providers/:id/probe', async (c) => {
    const id = c.req.param('id')
    const activo = options.plugins.active.find((entry) => entry.provider.id === id)

    if (activo === undefined) {
      /*
        Un rechazado no es un proveedor que no exista: existía, no cargó, y el
        usuario lo ve en la lista. Confundir los dos casos con un 404 mandaría a
        buscar un archivo que sí está en el disco.
      */
      const rechazado = options.plugins.rejected.find((entry) => fileStem(entry.file) === id)
      if (rechazado !== undefined) {
        return c.json(
          failure(`el proveedor ${id} no cargó: ${briefError(rechazado.reason.message)}`),
          409,
        )
      }

      return c.json(failure(`no hay ningún proveedor llamado ${id}`), 404)
    }

    if (!activo.provider.capabilities.search) {
      return c.json(failure(`el proveedor ${id} no declara búsqueda`), 409)
    }

    const resultado = await probeProvider(activo.provider, options.timeoutMs)

    // Una prueba es una foto del ahora: guardarla en una caché HTTP sería
    // enseñar mañana la latencia de ayer.
    c.header('cache-control', 'no-store')

    return c.json(providerProbeResponseSchema.parse(resultado))
  })
}
