/**
 * Ruta de ajustes: `GET /api/settings` y `PATCH /api/settings`.
 *
 * La página de ajustes existe para que el usuario pueda ver **qué está pasando**:
 * qué proveedores hay y cuáles se rechazaron, dónde vive cada cosa, si hay
 * reproductor externo. Sin esa página, un plugin roto es un misterio.
 *
 * Dos decisiones que se ven aquí:
 *
 * 1. **Los proveedores rechazados se listan con su motivo.** Esconderlos sería lo
 *    cómodo y lo peor: el usuario copió un archivo y no pasa nada, y sin el motivo
 *    no tiene por dónde empezar.
 * 2. **El tema se guarda en la base, no en el navegador.** Un ajuste que vive en
 *    `localStorage` se pierde al cambiar de navegador y no se puede leer desde el
 *    servidor; el spec dice «persistido en ajustes», y los ajustes son del store.
 * 3. **La prioridad de proveedor es un orden, no una marca.** Dos proveedores
 *    pueden ofrecer la misma obra, y «el preferido» sólo tiene sentido frente a
 *    los demás: se guarda la lista entera, del primero al último. Un booleano por
 *    proveedor no diría qué hacer cuando hay tres, ni qué pasa si el primero no
 *    tiene el título.
 */

import type { ConfigPaths } from '@nn-anime/core'
import { errorResponseSchema, settingsPatchSchema, settingsResponseSchema } from '@nn-anime/core'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ServerContainer } from '../container'
import type { PluginReport } from './providers'

/** Clave del tema en la tabla de ajustes. */
export const THEME_KEY = 'theme'

/**
 * Clave del orden de preferencia de proveedores.
 *
 * No se filtra contra los activos al guardarlo: un plugin que hoy no carga —un
 * archivo a medias, una carpeta de red caída— recupera su sitio cuando vuelve,
 * y olvidarlo obligaría a reordenar cada vez que un proveedor falla al arrancar.
 * Un id que no iguala a ninguno no hace nada: nadie lo consulta.
 */
export const PROVIDER_PRIORITY_KEY = 'providerPriority'

/**
 * Clave de «enseñar también el contenido para adultos».
 *
 * Vive donde viven los demás ajustes y no en el navegador por el motivo que ya
 * está escrito arriba: es el servidor quien decide qué pide a AniList, qué guarda
 * y qué sirve, y un ajuste que sólo lee la interfaz no puede cambiar nada de eso.
 */
export const ADULT_CONTENT_KEY = 'adultContent'

const themeSchema = z.enum(['dark', 'light', 'system'])
const DEFAULT_THEME = 'system' as const
const prioritySchema = z.array(z.string().min(1)).max(64)
const NO_PRIORITY: readonly string[] = []
const adultContentSchema = z.boolean()
/** Apagado: lo que no se enciende a conciencia no se enseña. */
const DEFAULT_ADULT_CONTENT = false

/**
 * Si esta instalación pide, guarda y sirve el contenido para adultos.
 *
 * Se lee en cada petición y no se guarda en memoria al arrancar: encender el
 * interruptor en Ajustes tiene que verse sin reiniciar. Lo leen las rutas de AniList,
 * que con él deciden qué piden y qué sirven.
 */
export async function adultContentOf(
  store: Pick<ServerContainer['store'], 'getSetting'>,
): Promise<boolean> {
  return await store.getSetting(ADULT_CONTENT_KEY, adultContentSchema, DEFAULT_ADULT_CONTENT)
}

export interface SettingsRouteOptions {
  readonly container: ServerContainer
  readonly plugins: PluginReport
  /** Modo restringido: la interfaz oculta las superficies de plugins. */
  readonly locked?: boolean | undefined
  /** Rutas en uso. Las conoce el arranque, que es quien las calculó. */
  readonly paths?: ConfigPaths | undefined
  readonly mpvAvailable?: boolean | undefined
  readonly mpvVersion?: string | undefined
}

/** Las rutas que se enseñan, con un valor claro si no se saben. */
function pathsOf(paths: ConfigPaths | undefined) {
  return {
    data: paths?.dataDir ?? 'sin determinar',
    config: paths?.configDir ?? 'sin determinar',
    cache: paths?.cacheDir ?? 'sin determinar',
  }
}

export function registerSettingsRoute(app: Hono, options: SettingsRouteOptions): void {
  app.get('/api/settings', async (c) => {
    const theme = await options.container.store.getSetting(THEME_KEY, themeSchema, DEFAULT_THEME)
    const providerPriority = await options.container.store.getSetting(
      PROVIDER_PRIORITY_KEY,
      prioritySchema,
      NO_PRIORITY,
    )
    const adultContent = await options.container.store.getSetting(
      ADULT_CONTENT_KEY,
      adultContentSchema,
      DEFAULT_ADULT_CONTENT,
    )

    const activos = options.plugins.active.map((entrada) => ({
      id: entrada.provider.id,
      name: entrada.provider.name,
      capabilities: entrada.provider.capabilities,
      status: 'active' as const,
    }))

    const rechazados = options.plugins.rejected.map((entrada) => ({
      id: entrada.file,
      name: entrada.file,
      // Un rechazado no tiene capacidades: no llegó a cargarse. Se declaran todas
      // en falso en vez de inventarse las que diría su manifiesto, que no se leyó.
      capabilities: { search: false, sub: false, dub: false, trending: false },
      status: 'rejected' as const,
      // El rechazo trae un objeto con el mensaje; se enseña el texto, no el objeto.
      reason: entrada.reason.message,
    }))

    // Esta respuesta lleva las rutas del disco del usuario: no se cachea. En
    // loopback no hay caché compartida, pero el navegador guarda en disco una
    // copia de lo que no se le prohíbe. Va aquí y no en `securityHeaders` porque
    // `/api/cover/:providerId/:ref` **quiere** caché larga, y una cabecera puesta
    // después de `next()` la pisaría.
    c.header('cache-control', 'no-store')

    return c.json(
      settingsResponseSchema.parse({
        theme,
        providerPriority,
        adultContent,
        locked: options.locked ?? false,
        paths: pathsOf(options.paths),
        mpv: {
          // En modo restringido las rutas de mpv no se registran: decir que hay
          // reproductor sería ofrecer un botón que contesta 404.
          available: options.locked === true ? false : options.container.mpv.available,
          ...(options.locked === true || options.mpvVersion === undefined
            ? {}
            : { version: options.mpvVersion }),
        },
        providers: [...activos, ...rechazados],
      }),
    )
  })

  app.patch('/api/settings', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = settingsPatchSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    // Cada campo se escribe sólo si vino: un parche parcial no borra lo que no
    // nombra. El orden pierde los ids repetidos —dos veces el mismo proveedor no
    // significa nada y dejaría la lista creciendo sin motivo—.
    if (parsed.data.theme !== undefined) {
      await options.container.store.setSetting(THEME_KEY, parsed.data.theme)
    }

    if (parsed.data.providerPriority !== undefined) {
      await options.container.store.setSetting(PROVIDER_PRIORITY_KEY, [
        ...new Set(parsed.data.providerPriority),
      ])
    }

    if (parsed.data.adultContent !== undefined) {
      await options.container.store.setSetting(ADULT_CONTENT_KEY, parsed.data.adultContent)
    }

    return c.body(null, 204)
  })
}
