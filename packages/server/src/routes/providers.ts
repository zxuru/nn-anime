/**
 * Ruta `/api/providers`: qué plugins cargaron y cuáles no.
 *
 * La interfaz necesita las dos listas. Un plugin rechazado es lo que el usuario
 * tiene que ver cuando copia un archivo mal escrito: si la ruta sólo devolviera
 * los activos, el plugin «desaparecería» sin decir nada, que es el modo de fallo
 * silencioso que este proyecto corrige una y otra vez.
 *
 * El resumen se construye aquí, en el server, a partir del informe del loader, y
 * no lo construye el CLI: así hay una sola definición de qué es un resumen de
 * proveedor y el CLI no tiene que saber la forma de la respuesta.
 */

import { type ProviderSummary, providersResponseSchema } from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'

/**
 * Lo que el loader encontró, en la forma mínima que el server necesita.
 *
 * Es estructural y no importado de `provider-sdk` para que el server no dependa
 * del tipo exacto del informe: basta con que traiga lo que hace falta.
 */
export interface PluginReport {
  readonly active: readonly { readonly provider: Provider; readonly file: string }[]
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

/**
 * Los plugins activos y los rechazados, como resúmenes.
 *
 * Un rechazo puede no tener `id` ni capacidades legibles —puede que el archivo
 * ni siquiera fuera un objeto—, así que se usa el nombre del archivo y unas
 * capacidades en falso. Inventar un `id` que nadie declaró haría que la interfaz
 * ofreciera un filtro que no existe.
 */
export function summarizePlugins(report: PluginReport): readonly ProviderSummary[] {
  const activos: ProviderSummary[] = report.active.map((entry) => ({
    id: entry.provider.id,
    name: entry.provider.name,
    capabilities: entry.provider.capabilities,
    status: 'active',
  }))

  const rechazados: ProviderSummary[] = report.rejected.map((entry) => ({
    id: fileStem(entry.file),
    name: fileStem(entry.file),
    capabilities: { search: false, sub: false, dub: false, trending: false, feed: false },
    status: 'rejected',
    reason: entry.reason.message,
  }))

  return [...activos, ...rechazados]
}

export interface ProvidersRouteOptions {
  readonly plugins: PluginReport
}

export function registerProvidersRoute(app: Hono, options: ProvidersRouteOptions): void {
  app.get('/api/providers', (c) =>
    // Se valida lo que se sirve: el schema es el contrato, y construir el cuerpo
    // a mano sin comprobarlo es cómo se publica una forma que la interfaz
    // rechaza en el navegador, lejos de la causa.
    c.json(providersResponseSchema.parse({ providers: summarizePlugins(options.plugins) })),
  )
}
