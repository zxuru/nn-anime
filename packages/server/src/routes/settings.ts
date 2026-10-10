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
 */

import type { ConfigPaths } from '@nn-anime/core'
import { errorResponseSchema, settingsPatchSchema, settingsResponseSchema } from '@nn-anime/core'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ServerContainer } from '../container'
import type { PluginReport } from './providers'

/** Clave del tema en la tabla de ajustes. */
export const THEME_KEY = 'theme'

const themeSchema = z.enum(['dark', 'light', 'system'])
const DEFAULT_THEME = 'system' as const

export interface SettingsRouteOptions {
  readonly container: ServerContainer
  readonly plugins: PluginReport
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

    return c.json(
      settingsResponseSchema.parse({
        theme,
        paths: pathsOf(options.paths),
        mpv: {
          available: options.container.mpv.available,
          ...(options.mpvVersion === undefined ? {} : { version: options.mpvVersion }),
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

    await options.container.store.setSetting(THEME_KEY, parsed.data.theme)

    return c.body(null, 204)
  })
}
