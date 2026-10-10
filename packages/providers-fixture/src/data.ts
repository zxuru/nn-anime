/**
 * Catálogo del proveedor de prueba.
 *
 * Es el único contenido que trae el repositorio y es **inventado**: ningún
 * título corresponde a una obra real y todas las direcciones apuntan a
 * `fixture.invalid`, un dominio reservado que no resuelve. Un test que se equivoque
 * y salga a la red falla por conexión, no por accidente afortunado.
 *
 * El archivo JSON se valida con Zod al cargarlo. Es datos escritos a mano, uno por
 * título y con doce títulos: exactamente el sitio donde un campo que falta se
 * descubre tres tareas más tarde, en un test que habla de otra cosa.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AnimeDetail,
  Episode,
  SearchResult,
  StreamMode,
  StreamSource,
  SubtitleTrack,
} from '@nn-anime/core'
import { z } from 'zod'

const tituloSchema = z.strictObject({
  ref: z.string().min(1),
  title: z.string().min(1),
  titleAlt: z.string().min(1).optional(),
  year: z.number().int(),
  kind: z.enum(['tv', 'movie', 'ova', 'ona', 'special']),
  status: z.enum(['airing', 'finished', 'upcoming', 'unknown']),
  episodeCount: z.number().int().nonnegative(),
  genres: z.array(z.string().min(1)),
  studios: z.array(z.string().min(1)),
  popularity: z.number().min(0).max(1),
  streams: z.array(z.enum(['file', 'hls'])).min(1),
  subs: z.array(z.enum(['vtt', 'srt', 'ass'])).min(1),
  synopsis: z.string().min(1),
})

export const catalogoSchema = z.strictObject({
  titulos: z.array(tituloSchema).min(1),
})

export type TituloFixture = Readonly<z.infer<typeof tituloSchema>>

/** Origen de todo lo que devuelve el proveedor. Dominio reservado: no resuelve. */
export const FIXTURE_ORIGIN = 'https://fixture.invalid'

/**
 * El título cuyo stream exige `Referer`.
 *
 * Existe porque un proveedor real casi siempre lo pide, y el proxy tiene que
 * reenviarlo sin que ese header llegue nunca al navegador. Sin un caso así, esa
 * parte del sistema sólo se probaría con datos inventados en cada test.
 */
export const TITULO_CON_REFERER = 'selva-de-hormigon'

const RUTA_CATALOGO = join(import.meta.dir, '..', 'fixtures', 'catalogo.json')

/**
 * Carga y valida el catálogo. La ruta se puede cambiar para probar un archivo
 * roto sin tocar el del repositorio.
 */
export function cargarCatalogo(ruta: string = RUTA_CATALOGO): readonly TituloFixture[] {
  const texto = readFileSync(ruta, 'utf8')

  return catalogoSchema.parse(JSON.parse(texto)).titulos
}

export const CATALOGO: readonly TituloFixture[] = cargarCatalogo()

/** Normaliza para buscar: sin espacios de sobra, en minúsculas y en NFC. */
export function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFC')
}

export function porRef(ref: string): TituloFixture | undefined {
  return CATALOGO.find((titulo) => titulo.ref === ref)
}

function portada(titulo: TituloFixture): string {
  return `${FIXTURE_ORIGIN}/portada/${titulo.ref}.webp`
}

function aResultado(titulo: TituloFixture): SearchResult {
  return {
    ref: { providerId: 'fixture', value: titulo.ref },
    title: titulo.title,
    ...(titulo.titleAlt === undefined ? {} : { titleAlt: titulo.titleAlt }),
    coverUrl: portada(titulo),
    year: titulo.year,
    kind: titulo.kind,
  }
}

/**
 * Búsqueda por título. Sin consulta devuelve el catálogo entero, ordenado por
 * popularidad: es lo que la interfaz usa como arranque en frío.
 */
export function buscar(consulta: string): readonly SearchResult[] {
  const buscado = normalizar(consulta)

  const coincidencias =
    buscado === ''
      ? [...CATALOGO]
      : CATALOGO.filter((titulo) => {
          const campos = [titulo.title, titulo.titleAlt ?? ''].map(normalizar)
          return campos.some((campo) => campo.includes(buscado))
        })

  return coincidencias
    .sort((a, b) => b.popularity - a.popularity)
    .map((titulo) => aResultado(titulo))
}

export function detalle(titulo: TituloFixture): AnimeDetail {
  return {
    ...aResultado(titulo),
    synopsis: titulo.synopsis,
    status: titulo.status,
    episodeCount: titulo.episodeCount,
    genres: titulo.genres,
    studios: titulo.studios,
  }
}

function refEpisodio(titulo: TituloFixture, numero: number) {
  return { providerId: 'fixture', value: `${titulo.ref}#${numero}` }
}

export function episodios(titulo: TituloFixture): readonly Episode[] {
  const lista: Episode[] = []
  for (let numero = 1; numero <= titulo.episodeCount; numero++) {
    lista.push({
      ref: refEpisodio(titulo, numero),
      animeRef: { providerId: 'fixture', value: titulo.ref },
      number: numero,
      title: `Episodio ${numero}`,
      durationS: 1440,
      mode: 'sub',
    })
  }

  return lista
}

/** El número de episodio que lleva una referencia, o `undefined` si no lo lleva. */
export function numeroDeEpisodio(valor: string): number | undefined {
  const partes = valor.split('#')
  const numero = Number(partes[1])
  if (partes.length !== 2 || !Number.isInteger(numero) || numero < 1) return undefined

  return numero
}

function pistas(titulo: TituloFixture, numero: number): readonly SubtitleTrack[] {
  return titulo.subs.map((formato) => ({
    lang: 'es',
    label: formato === 'vtt' ? 'Español' : 'Español (conversión)',
    url: `${FIXTURE_ORIGIN}/${titulo.ref}/${numero}.es.${formato}`,
    format: formato,
    default: formato === titulo.subs[0],
  }))
}

/**
 * Los streams de un episodio.
 *
 * `hls` y `file` cuando el título declara las dos, porque son caminos distintos
 * del proxy: uno se reescribe y el otro se reenvía por rangos.
 */
export function streams(
  titulo: TituloFixture,
  numero: number,
  modo: StreamMode,
): readonly StreamSource[] {
  const fuentes: StreamSource[] = []

  for (const tipo of titulo.streams) {
    const url =
      tipo === 'hls'
        ? `${FIXTURE_ORIGIN}/${titulo.ref}/${numero}/${modo}/master.m3u8`
        : `${FIXTURE_ORIGIN}/${titulo.ref}/${numero}/${modo}.mp4`

    fuentes.push({
      url,
      kind: tipo,
      quality: modo === 'dub' ? '720p' : '1080p',
      ...(titulo.ref === TITULO_CON_REFERER && tipo === 'hls'
        ? { headers: { Referer: `${FIXTURE_ORIGIN}/${titulo.ref}` } }
        : {}),
      subtitles: pistas(titulo, numero),
    })
  }

  return fuentes
}

/** Los más populares, para el arranque en frío de `recsys`. */
export function destacados(cantidad: number): readonly SearchResult[] {
  return buscar('').slice(0, cantidad)
}
