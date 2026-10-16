/**
 * Qué piezas de una fila son para adultos.
 *
 * Vive fuera de las rutas porque lo comparten dos —las novedades del feed y las
 * tendencias— y porque es la pieza que hace posible el filtro **donde no hay señal**:
 * ni el feed de una fuente ni una lista de tendencias publican la edad de lo que traen,
 * así que la única forma de saber que una entrada es para adultos es preguntarle a
 * AniList por ella.
 *
 * Tres reglas, y las tres importan:
 *
 * 1. **Lo que ya consta no se pregunta.** Una referencia marcada no gasta una petición
 *    nunca más: la marca es local y no caduca.
 * 2. **Se pregunta en lote**, con el mismo `matchMany` del enriquecido y su caché de un
 *    mes por título y año: una fila de veinte piezas no son veinte viajes.
 * 3. **De lo marcado se guarda el booleano y nada más.** La entrada de AniList no se
 *    escribe con el interruptor apagado —eso lo decide el catálogo—, así que la caché no
 *    llega a tener la portada ni la sinopsis de lo que se quiere esconder.
 */

import { refKey } from '@nn-anime/catalog-store'
import { type LocalWork, localWork, type ProviderRef } from '@nn-anime/core'
import { type AniListCatalog, matchKey } from './anilist/catalog'
import type { ServerContainer } from './container'

/** Cuántas piezas de más se verifican por encima del tope de la fila. */
export const MARGEN_DE_VERIFICACION = 8

/**
 * El tope de verificación de una fila que no tiene tope propio.
 *
 * Las tendencias sirven lo que la fuente publica, y la caché del feed guarda hasta
 * doscientas entradas: verificar doscientas serían veinticinco consultas que nadie va a
 * mirar. Por encima de este tope la pieza se sirve **sin verificar**, y eso se declara
 * en `SECURITY.md`: la primera carga paga lo que se verifica una vez, y después la marca
 * y la caché de emparejamiento contestan sin salir a la red.
 */
export const TOPE_DE_VERIFICACION = 30

/** Lo mínimo que una pieza trae para poder preguntar por ella. */
export interface PiezaConTitulo {
  readonly ref: ProviderRef
  readonly title: string
  readonly titleAlt?: string | undefined
  readonly year?: number | undefined
}

export interface AdultosOptions {
  readonly container: ServerContainer
  readonly catalog: AniListCatalog
}

/**
 * Los nombres comparables de un título local, con lo que el listado sabe.
 *
 * `titleAlt` entra: es el otro nombre con el que la fuente reconoce la obra —el
 * original, o el corto— y es exactamente lo que junta «Danmachi» con «Dungeon ni Deai
 * wo Motomeru no wa Machigatteiru Darou ka».
 */
export function localWorkOf(
  title: string,
  year: number | undefined,
  titleAlt?: string | undefined,
): LocalWork {
  return localWork({ title, ...(titleAlt === undefined ? {} : { titleAlt }) }, year)
}

/**
 * Las referencias de estas piezas que constan como para adultos.
 *
 * Con el interruptor **encendido** no hay nada que esconder: devuelve lo que ya consta
 * —para que la pieza pueda enseñar su `+18`— y no pregunta nada. Con el **apagado**,
 * verifica lo que no consta y apunta lo que encuentra, que es lo único que puede
 * esconder una entrada de la que nadie publica la edad.
 */
export async function adultosDeLaFila(
  options: AdultosOptions,
  piezas: readonly PiezaConTitulo[],
  conAdultos: boolean,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const marcadas = new Set(
    (await options.container.store.listAdultRefs(piezas.map((pieza) => pieza.ref))).map((ref) =>
      refKey(ref),
    ),
  )

  if (conAdultos) return marcadas

  const porVerificar = piezas.filter((pieza) => !marcadas.has(refKey(pieza.ref)))
  if (porVerificar.length === 0) return marcadas

  const emparejados = await options.catalog.matchMany(
    porVerificar.map((pieza) => ({
      key: matchKey(pieza.title, pieza.year),
      local: localWorkOf(pieza.title, pieza.year, pieza.titleAlt),
    })),
    false,
    signal,
  )

  const confirmadas = porVerificar.filter((pieza) => {
    const obra = emparejados.get(matchKey(pieza.title, pieza.year))

    return obra?.adult === true
  })

  // Se apunta lo visto: sin la marca, cada carga de la home volvería a preguntar por lo
  // mismo, porque de una obra marcada no se guarda la entrada en la caché.
  await Promise.all(confirmadas.map((pieza) => options.container.store.markAdult(pieza.ref)))

  for (const pieza of confirmadas) marcadas.add(refKey(pieza.ref))

  return marcadas
}

/**
 * Fuera las piezas marcadas, con el interruptor apagado.
 *
 * Es la versión **local** del filtro: no pregunta nada a AniList —son las filas del usuario,
 * y abrir su historial no justifica una consulta— y sólo descarta lo que ya consta marcado.
 * La tabla de marcas se lee entera porque es pequeña por construcción: una fila por obra
 * marcada.
 */
export async function sinMarcadas<T>(
  store: Pick<ServerContainer['store'], 'listAdultRefs'>,
  piezas: readonly T[],
  conAdultos: boolean,
  referencia: (pieza: T) => ProviderRef,
): Promise<readonly T[]> {
  if (conAdultos) return piezas

  const marcas = new Set((await store.listAdultRefs()).map((ref) => refKey(ref)))

  return piezas.filter((pieza) => !marcas.has(refKey(referencia(pieza))))
}
