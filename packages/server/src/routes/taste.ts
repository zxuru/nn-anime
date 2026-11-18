/**
 * Las rutas de la encuesta de gustos.
 *
 * Una encuesta opcional que sólo se puede contestar desde esta aplicación: no
 * hay cuentas, así que el perfil es el del único usuario local. El servidor es
 * quien pone pesos, origen y fechas; la interfaz sólo manda lo que se marcó.
 *
 * `skipLimit` llega del entorno (`RONA_TASTE_SKIP_LIMIT`) y se devuelve con el
 * perfil para que la interfaz no tenga que conocer la configuración del
 * servidor. Es la única decisión que la pantalla no puede tomar sola: cuántas
 * veces se insiste es una política, no un detalle de presentación.
 */

import {
  emptyTasteProfile,
  errorResponseSchema,
  LOCAL_TASTE_USER,
  normalizeGenreName,
  type TasteProfile,
  tasteAutoOpenFromEnv,
  tasteResponseSchema,
  tasteRowsResponseSchema,
  tasteSkipLimitFromEnv,
  tasteSurveyRequestSchema,
  tasteTitlesResponseSchema,
} from '@rona/core'
import type { Provider } from '@rona/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { gatherSignals } from '../recommend/signals'
import { popularTitles, providerAudio, tasteRowsFrom } from '../recommend/taste'
import { enMedia, mediaFrom, mediaPorProveedor } from './media'
import { adultContentOf } from './settings'

export interface TasteRouteOptions {
  readonly container: ServerContainer
  readonly providers: readonly Provider[]
  /** Límite de omisiones; en pruebas se fija sin tocar el entorno. */
  readonly skipLimit?: number | undefined
  /** Abertura automática; el arnés la apaga sin tocar el entorno. */
  readonly autoOpen?: boolean | undefined
}

/** Un nombre de género, una sola vez, sin depender de tildes ni mayúsculas. */
function generosUnicos(nombres: readonly string[]): readonly string[] {
  const vistos = new Set<string>()
  const salida: string[] = []

  for (const nombre of nombres) {
    const limpio = nombre.trim()
    const clave = normalizeGenreName(limpio)
    if (limpio === '' || vistos.has(clave)) continue

    vistos.add(clave)
    salida.push(limpio)
  }

  return salida
}

/** El perfil que se guarda a partir de las respuestas de la encuesta. */
export function profileFromSurvey(
  crudo: unknown,
  previous: TasteProfile | undefined,
  now: Date = new Date(),
): TasteProfile {
  const respuestas = tasteSurveyRequestSchema.parse(crudo)
  const base = previous ?? emptyTasteProfile(LOCAL_TASTE_USER, now)
  const stamp = now.toISOString()
  const completada = respuestas.status === 'completed'

  /*
    Omitir sin marcar nada no borra lo que ya había.

    El botón «Ahora no» del aviso manda una omisión vacía; si esa omisión
    sustituyera el perfil, un clic en el aviso borraría la encuesta de quien ya
    la había contestado. Completar sí sustituye: ahí el usuario está diciendo
    qué quiere, y dejar atrás un género que desmarcó sería no hacerle caso.
  */
  const traeRespuestas =
    respuestas.genres.length > 0 ||
    respuestas.excludedGenres.length > 0 ||
    respuestas.titles.length > 0 ||
    respuestas.format !== null ||
    respuestas.tone !== null ||
    respuestas.audio !== null ||
    respuestas.catalog !== null

  const conservar = !completada && !traeRespuestas

  const preferred = conservar
    ? base.genres.map((genre) => genre.name)
    : generosUnicos(respuestas.genres)
  const excluded = conservar
    ? base.excludedGenres.map((genre) => genre.name)
    : generosUnicos(respuestas.excludedGenres)

  const titles = conservar
    ? base.titles
    : respuestas.titles.map((title) => ({
        providerId: title.providerId,
        ref: title.ref,
        title: title.title,
        relation: title.relation,
        source: 'survey' as const,
        updatedAt: stamp,
      }))

  type Preferencia<T> = {
    readonly value: T
    readonly source: 'survey' | 'behavior'
    readonly updatedAt: string
  }

  const preferencia = <T>(
    value: T | null,
    previousValue: Preferencia<T> | null,
  ): Preferencia<T> | null => {
    if (conservar) return previousValue
    if (value === null) return null

    return { value, source: 'survey', updatedAt: stamp }
  }

  return {
    userId: base.userId,
    genres: preferred.map((name) => ({
      name,
      // Todas las respuestas valen lo mismo: la encuesta no pide ordenar los
      // géneros. El peso existe para que el motor pueda mezclar fuentes y para
      // que un día el comportamiento pueda subir o bajar uno concreto.
      weight: 1,
      source: 'survey',
      updatedAt: stamp,
    })),
    excludedGenres: excluded.map((name) => ({
      name,
      source: 'survey',
      updatedAt: stamp,
    })),
    titles,
    format: preferencia(respuestas.format, base.format),
    tone: preferencia(respuestas.tone, base.tone),
    audio: preferencia(respuestas.audio, base.audio),
    catalog: preferencia(respuestas.catalog, base.catalog),
    survey: {
      status: completada ? 'completed' : 'skipped',
      // Completar reinicia la cuenta; omitir suma. Abrir y cerrar sin contestar
      // también es omitir, que es justo lo que el límite debe recordar.
      skips: completada ? 0 : base.survey.skips + 1,
      updatedAt: stamp,
    },
    updatedAt: stamp,
  }
}

export function registerTasteRoutes(app: Hono, options: TasteRouteOptions): void {
  const limite = options.skipLimit ?? tasteSkipLimitFromEnv()
  const autoOpen = options.autoOpen ?? tasteAutoOpenFromEnv()

  const respuesta = async (profile: TasteProfile) =>
    tasteResponseSchema.parse({ profile, skipLimit: limite, autoOpen })

  app.get('/api/taste', async (c) => {
    const store = options.container.store
    const profile = (await store.readTasteProfile()) ?? emptyTasteProfile()

    // Lleva las respuestas del usuario: no se cachea.
    c.header('cache-control', 'no-store')

    return c.json(await respuesta(profile))
  })

  app.post('/api/taste', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const store = options.container.store
    const anterior = await store.readTasteProfile()

    let profile: TasteProfile
    try {
      profile = profileFromSurvey(crudo, anterior)
    } catch (cause) {
      const mensaje = cause instanceof Error ? cause.message : String(cause)

      return c.json(errorResponseSchema.parse({ error: `encuesta inválida: ${mensaje}` }), 400)
    }

    await store.writeTasteProfile(profile)
    c.header('cache-control', 'no-store')

    return c.json(await respuesta(profile))
  })

  /**
   * Borra el perfil y deja la encuesta sin empezar.
   *
   * Es la salida limpia para quien quiera volver a contestar desde cero y la
   * limpieza que usa el e2e entre pruebas. No toca el historial: las señales de
   * comportamiento se derivan de él y siguen ahí.
   */
  app.delete('/api/taste', async (c) => {
    const store = options.container.store
    const profile = emptyTasteProfile()

    await store.writeTasteProfile(profile)
    c.header('cache-control', 'no-store')

    return c.json(await respuesta(profile))
  })

  /**
   * Los títulos del paso 2.
   *
   * Es una lectura aparte y no parte de `GET /api/taste` porque la encuesta
   * puede abrirse sin que el catálogo tenga nada todavía: en ese caso el paso se
   * queda con menos tarjetas y la encuesta sigue siendo contestable.
   */
  app.get('/api/taste/titles', async (c) => {
    const items = await popularTitles(options.container.store)
    c.header('cache-control', 'no-store')

    return c.json(tasteTitlesResponseSchema.parse({ items }))
  })

  /**
   * Las filas del inicio que salen de los géneros declarados.
   *
   * No altera el catálogo: elige, de lo que ya hay, lo que encaja con un gusto y
   * lo agrupa bajo su género. Sin encuesta devuelve una lista vacía y la home
   * sigue siendo la de siempre.
   */
  app.get('/api/taste/rows', async (c) => {
    const pedido = mediaFrom(c.req.query('media'))
    if (!pedido.ok) return c.json(errorResponseSchema.parse({ error: pedido.error }), 400)

    const store = options.container.store
    const conAdultos = await adultContentOf(store)
    const [senales, profile] = await Promise.all([
      gatherSignals(store, {
        includeAdult: conAdultos,
        audioByProvider: providerAudio(options.providers),
      }),
      store.readTasteProfile(),
    ])

    const candidates = enMedia(
      senales.candidates,
      pedido.media,
      mediaPorProveedor(options.providers),
    )
    const rows = tasteRowsFrom(profile, candidates)

    c.header('cache-control', 'no-store')

    return c.json(tasteRowsResponseSchema.parse({ rows }))
  })
}
