/**
 * Alta de un proveedor declarativo desde la interfaz: `POST /api/providers`.
 *
 * Esta ruta es la que convierte el camino difícil —escribir un archivo y
 * copiarlo a mano— en un formulario, y por eso mismo es la que hay que mirar con
 * más cuidado. Tres decisiones sostienen que sea segura:
 *
 * 1. **No escribe lo que le mandan.** El cuerpo es una descripción, la valida un
 *    schema y el texto del plugin lo produce el generador. Un `id` con `../`
 *    muere en el schema, y si no muriera, muere en la comprobación del nombre de
 *    archivo que hay aquí debajo: no es redundancia por gusto, es la misma
 *    defensa puesta donde el schema no llega.
 * 2. **No pisa nada.** Si ya hay un archivo con ese identificador, es un 409. Un
 *    alta que sobrescribe en silencio es un alta que borra el trabajo de alguien.
 * 3. **Si el plugin no carga, se retira.** Se escribe, se recarga y se mira el
 *    informe. Un archivo que deja de conformar se borra y la respuesta dice por
 *    qué: lo contrario es dejar en Ajustes un rechazado que el usuario no pidió.
 */

import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import {
  errorResponseSchema,
  providerDraftSchema,
  providerRegisterResponseSchema,
} from '@nn-anime/core'
import type { Hono } from 'hono'
import type { ProviderHub } from '../provider-hub'
import { pluginFileName, renderProviderModule } from '../provider-template'

export interface RegisterProviderOptions {
  readonly hub: ProviderHub
  /** Directorio de plugins del usuario. */
  readonly directory: string
}

function badRequest(message: string): { readonly error: string } {
  return errorResponseSchema.parse({ error: message })
}

/** ¿Hay algo ya en esta ruta? Un `ENOENT` es un no; cualquier otra cosa, un sí. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function registerProviderRoute(app: Hono, options: RegisterProviderOptions): void {
  const directory = resolve(options.directory)

  app.post('/api/providers', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(badRequest('el cuerpo no es JSON válido'), 400)
    }

    const parsed = providerDraftSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(badRequest(`descripción inválida: ${parsed.error.message}`), 400)
    }

    const draft = parsed.data
    const name = pluginFileName(draft.id)
    const file = join(directory, name)

    // El `id` ya viene limitado a minúsculas, dígitos y guiones. Esta línea
    // existe para que esa garantía se pueda leer aquí y no sólo en el schema.
    if (basename(file) !== name || !file.startsWith(`${directory}${sep}`)) {
      return c.json(badRequest(`identificador no válido: ${draft.id}`), 400)
    }

    if (await exists(file)) {
      return c.json(badRequest(`ya hay un proveedor con ese identificador: ${draft.id}`), 409)
    }

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(file, renderProviderModule(draft), { mode: 0o600 })
    } catch (cause) {
      return c.json(badRequest(`no se pudo escribir el plugin: ${reasonOf(cause)}`), 500)
    }

    const report = await options.hub.reload()
    const cargado = report.active.find((entry) => entry.provider.id === draft.id)

    if (cargado === undefined) {
      const motivo =
        report.rejected.find((entry) => resolve(entry.file) === file)?.reason.message ??
        'el plugin no se cargó y el informe no dice por qué'
      await rm(file, { force: true })
      await options.hub.reload()

      return c.json(badRequest(`el plugin no cargó: ${motivo}`), 400)
    }

    return c.json(
      providerRegisterResponseSchema.parse({
        provider: {
          id: cargado.provider.id,
          name: cargado.provider.name,
          capabilities: cargado.provider.capabilities,
          status: 'active',
        },
      }),
      201,
    )
  })
}
