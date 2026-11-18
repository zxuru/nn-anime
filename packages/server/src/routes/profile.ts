/**
 * Las rutas del Perfil: `GET /api/profile` y su copia portátil
 * —`GET /api/profile/export` y `POST /api/profile/import`—.
 *
 * La lectura de la pantalla es **una** petición y no cuatro desde la interfaz, y es una decisión, no una
 * comodidad: una pantalla que enseña el estado del único usuario no puede pintar
 * tres secciones y callar la cuarta porque una lectura falló. Con cuatro peticiones
 * en paralelo, la que falla deja un hueco que nadie explica; con una, o está el
 * Perfil entero o está en error y se puede reintentar.
 *
 * Las cuatro listas se leen **en paralelo** y se filtran por contenido adulto con
 * `sinMarcadas`, que es local: abrir el Perfil no justifica preguntarle nada a
 * AniList. El historial llega con la forma paginada de su propia ruta —la página
 * 1— para que el enlace al Historial hable el mismo contrato y no haya dos formas
 * del mismo dato.
 */

import {
  errorResponseSchema,
  PROFILE_EXPORT_VERSION,
  type ProfileExportEntry,
  type ProviderRef,
  profileExportSchema,
  profileImportResponseSchema,
  profileResponseSchema,
  StoreError,
} from '@rona/core'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { sinMarcadas } from '../adultos'
import type { ServerContainer } from '../container'
import { adultContentOf } from './settings'
import { historyItems } from './watch'

/**
 * Cuántos visionados enseña el Perfil antes de mandar al Historial.
 *
 * Una fila de tarjetas, no la lista entera: el Perfil es un resumen y el Historial
 * es la pantalla que pagina. Se pide **una fila de más** para saber si queda algo
 * detrás sin contar el total.
 */
export const PROFILE_HISTORY_PREVIEW = 6

/** El nombre con el que el navegador guarda el archivo exportado. */
export const PROFILE_EXPORT_FILENAME = 'rona-perfil.json'

/**
 * El tope del cuerpo que se acepta al importar: 1 MB.
 *
 * Un perfil de marcas no se acerca a ese tamaño —una entrada son unas decenas de
 * bytes—, así que el tope no limita un uso legítimo: frena un archivo equivocado
 * o uno construido para que el servidor lo recorra entero. Se aplica **mientras
 * se lee**, no cuando ya está en memoria.
 */
export const PROFILE_IMPORT_MAX_BYTES = 1024 * 1024

export interface ProfileRouteOptions {
  readonly container: ServerContainer
}

/** Una entrada del archivo, sin portada ni año: lo que el importador necesita. */
function aEntrada(resumen: {
  readonly ref: ProviderRef
  readonly title: string
}): ProfileExportEntry {
  return {
    providerId: resumen.ref.providerId,
    ref: resumen.ref.value,
    title: resumen.title,
  }
}

/** La clave con la que se comparan dos referencias dentro de la importación. */
function claveDe(ref: ProviderRef): string {
  // El separador no puede aparecer en un identificador de proveedor ni en una
  // referencia, así que «a» + «b» y «ab» + «» no se confunden.
  return `${ref.providerId}\u0000${ref.value}`
}

function clavesDe(items: readonly { readonly ref: ProviderRef }[]): ReadonlySet<string> {
  return new Set(items.map((item) => claveDe(item.ref)))
}

interface Fusion {
  /** Marcas que no estaban y quedaron puestas. */
  readonly nuevas: number
  /** Referencias que la base local no conoce. */
  readonly omitidas: number
}

/**
 * Deja puestas las entradas de una lista y cuenta el resultado.
 *
 * Se aplica `true` a cada referencia única: la operación del store es «dejar en
 * este estado», así que repetirla no duplica ni borra nada. Las que ya estaban no
 * cuentan como nuevas —importar dos veces el mismo archivo devuelve ceros— y las
 * que la base no conoce se cuentan como omitidas: no se piden a un proveedor ni
 * se escriben en la caché, porque importar un perfil es fusionar marcas, no
 * llenar el catálogo.
 */
async function fusionar(
  entradas: readonly ProfileExportEntry[],
  existentes: ReadonlySet<string>,
  aplicar: (ref: ProviderRef) => Promise<void>,
): Promise<Fusion> {
  const vistas = new Set<string>()
  let nuevas = 0
  let omitidas = 0

  for (const entrada of entradas) {
    const ref = { providerId: entrada.providerId, value: entrada.ref }
    const clave = claveDe(ref)

    // Dos entradas iguales en el mismo archivo son una sola marca. Sin esto, el
    // resumen contaría dos veces algo que la tabla guarda una vez.
    if (vistas.has(clave)) continue
    vistas.add(clave)

    try {
      await aplicar(ref)
      if (!existentes.has(clave)) nuevas += 1
    } catch (cause) {
      // El caso normal: la ficha no está en la base porque nadie la abrió en
      // esta instalación. Se cuenta y se sigue; abortar dejaría el resto del
      // archivo sin fusionar por una referencia ausente.
      if (cause instanceof StoreError) {
        omitidas += 1
        continue
      }

      throw cause
    }
  }

  return { nuevas, omitidas }
}

export function registerProfileRoutes(app: Hono, options: ProfileRouteOptions): void {
  app.get('/api/profile', async (c) => {
    const store = options.container.store

    const [conAdultos, favoritos, vistos, pendientes, filas] = await Promise.all([
      adultContentOf(store),
      store.listFavorites(),
      store.listWatchedTitles(),
      store.listPlanToWatch(),
      store.listWatchHistory(PROFILE_HISTORY_PREVIEW + 1, 0),
    ])

    const hasMore = filas.length > PROFILE_HISTORY_PREVIEW

    // Las cuatro en paralelo: la marca de adultos se lee una vez por lista y no hay
    // ninguna que dependa de otra.
    const [favoritosOk, vistosOk, pendientesOk, historialOk] = await Promise.all([
      sinMarcadas(store, favoritos, conAdultos, (item) => item.ref),
      sinMarcadas(store, vistos, conAdultos, (item) => item.ref),
      sinMarcadas(store, pendientes, conAdultos, (item) => item.ref),
      sinMarcadas(
        store,
        filas.slice(0, PROFILE_HISTORY_PREVIEW),
        conAdultos,
        (fila) => fila.anime.ref,
      ),
    ])

    /*
      Las dos fechas de marca se quitan a mano.

      `WatchedTitle` lleva `watchedAt` y `PlanToWatchTitle` lleva `createdAt`, y los
      dos son para el motor —que desempata con ellas—, no para la pantalla. El
      schema del contrato es estricto, así que dejarlas dentro no es un campo de más
      que se ignora: es un `ApiShapeError` en el navegador.
    */
    const watched = vistosOk.map(({ watchedAt: _watchedAt, ...resumen }) => resumen)
    const planToWatch = pendientesOk.map(({ createdAt: _createdAt, ...resumen }) => resumen)

    return c.json(
      profileResponseSchema.parse({
        favorites: favoritosOk,
        watched,
        planToWatch,
        history: {
          items: historyItems(historialOk),
          page: 1,
          hasMore,
        },
      }),
    )
  })

  /**
   * El archivo portátil del perfil.
   *
   * Va en una ruta propia —`/api/profile/export`— y no en `/api/profile` porque
   * esa es la lectura de la pantalla del Perfil: la misma dirección no puede
   * contestar un resumen para pintar y un adjunto para guardar. El
   * `content-disposition` hace que el navegador lo descargue y `no-store` evita
   * que quede una copia en la caché de disco: es un archivo del usuario, no una
   * respuesta que se pueda reutilizar.
   *
   * No filtra por contenido adulto: es el respaldo de lo que el usuario marcó, y
   * esconder una marca en su propia copia la perdería al restaurarla. Tampoco
   * toca la caché ni pregunta a un proveedor: lee las tres tablas y nada más.
   */
  app.get('/api/profile/export', async (c) => {
    const store = options.container.store

    const [favoritos, vistos, pendientes] = await Promise.all([
      store.listFavorites(),
      store.listWatchedTitles(),
      store.listPlanToWatch(),
    ])

    const perfil = profileExportSchema.parse({
      version: PROFILE_EXPORT_VERSION,
      favorites: favoritos.map(aEntrada),
      watched: vistos.map(aEntrada),
      planToWatch: pendientes.map(aEntrada),
    })

    c.header('cache-control', 'no-store')
    c.header('content-disposition', `attachment; filename="${PROFILE_EXPORT_FILENAME}"`)

    // El salto de línea final no es decorativo: hace que el archivo termine como
    // un texto y no a mitad de una línea, que es lo que espera cualquier editor.
    return c.body(`${JSON.stringify(perfil, null, 2)}\n`, 200, {
      'content-type': 'application/json; charset=utf-8',
    })
  })

  /**
   * Fusiona un perfil exportado en esta instalación.
   *
   * Es un `POST` y no un `PUT`: no reemplaza el perfil, lo fusiona. Nada de lo
   * que ya estaba se borra, y las tres listas se tratan por separado. La
   * respuesta cuenta lo que se añadió y lo que se omitió para que la pantalla
   * pueda decir qué pasó en vez de un «hecho» que no informa de nada.
   */
  app.post(
    '/api/profile/import',
    bodyLimit({
      maxSize: PROFILE_IMPORT_MAX_BYTES,
      onError: (c) =>
        c.json(errorResponseSchema.parse({ error: 'el archivo del perfil supera 1 MB' }), 413),
    }),
    async (c) => {
      let crudo: unknown
      try {
        crudo = await c.req.json()
      } catch {
        return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
      }

      const parsed = profileExportSchema.safeParse(crudo)
      if (!parsed.success) {
        return c.json(
          errorResponseSchema.parse({ error: `perfil inválido: ${parsed.error.message}` }),
          400,
        )
      }

      const store = options.container.store

      // Las tres listas se leen antes de escribir: `nuevas` significa «no estaba
      // al empezar», y leerlas después contaría como nuevas las que acaba de
      // poner esta misma importación.
      const [favoritosActuales, vistosActuales, pendientesActuales] = await Promise.all([
        store.listFavorites(),
        store.listWatchedTitles(),
        store.listPlanToWatch(),
      ])

      const favoritos = await fusionar(parsed.data.favorites, clavesDe(favoritosActuales), (ref) =>
        store.setFavorite(ref, true),
      )
      const vistos = await fusionar(parsed.data.watched, clavesDe(vistosActuales), (ref) =>
        store.setWatchedTitle(ref, true),
      )
      const pendientes = await fusionar(
        parsed.data.planToWatch,
        clavesDe(pendientesActuales),
        (ref) => store.setPlanToWatch(ref, true),
      )

      return c.json(
        profileImportResponseSchema.parse({
          favorites: favoritos.nuevas,
          watched: vistos.nuevas,
          planToWatch: pendientes.nuevas,
          skipped: favoritos.omitidas + vistos.omitidas + pendientes.omitidas,
        }),
      )
    },
  )
}
