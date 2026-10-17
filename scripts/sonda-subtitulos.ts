#!/usr/bin/env bun
/**
 * Sonda de un manifiesto: qué variantes y qué pistas trae.
 *
 * La pregunta que contesta: cuando un proveedor resuelve una fuente, ¿el
 * manifiesto trae pistas de subtítulos incrustadas (`#EXT-X-MEDIA` con
 * `TYPE=SUBTITLES`) y cuántas calidades distintas (`#EXT-X-STREAM-INF`)? De eso
 * depende que el reproductor pueda ofrecerlas aunque el plugin no las declare, y
 * sin mirarlo se implementa a ciegas: el mismo motor devuelve manifiestos con
 * pistas para un título y sin ellas para el de al lado.
 *
 * Resuelve el stream con el plugin que se le pase —validado con el mismo
 * `validateProvider` que usa el motor, para no fiarse de un archivo cualquiera—,
 * pide el manifiesto al upstream y cuenta lo que hay dentro.
 *
 * **No imprime direcciones ni valores de cabecera.** El manifiesto de estos
 * sitios va firmado en la consulta y una captura con el token dentro es una
 * credencial regalada; las cabeceras que el upstream exige pueden llevar
 * también su testigo. Se imprimen sus **nombres**, y de las líneas de etiqueta
 * se vela el valor de `URI`.
 *
 * Uso:
 *   bun run scripts/sonda-subtitulos.ts --buscar "El Faro"
 *   bun run scripts/sonda-subtitulos.ts --plugin <ruta.ts> --buscar "El Faro" --episodio 1
 *   bun run scripts/sonda-subtitulos.ts --buscar "El Faro" --crudo
 */

import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Provider, validateProvider } from '@nn-anime/provider-sdk'

/** El mismo tope que el proxy: una playlist de verdad no llega ni de lejos. */
const TOPE_BYTES = 4 * 1024 * 1024

/**
 * Plazo del resolutor y de la descarga.
 *
 * Más largo que el de una búsqueda porque resolver un enlace son varias
 * peticiones encadenadas y el contrato trata el `timeoutMs` como sugerencia.
 */
const TIMEOUT_MS = 30_000

/** Profundidad a la que se busca el plugin dentro del directorio de repos. */
const PROFUNDIDAD_MAX = 4

export interface Opciones {
  readonly plugin: string | undefined
  readonly archivo: string
  readonly dir: string
  readonly buscar: string
  readonly indice: number
  readonly episodio: number | undefined
  readonly crudo: boolean
}

/**
 * Dónde viven los plugins instalados, según el sistema.
 *
 * Es la misma decisión que toma `loadConfig` en `core`: en Windows los datos van
 * a `%LOCALAPPDATA%` y en el resto a `~/.local/share`, con `XDG_DATA_HOME` por
 * delante si está puesto.
 */
export function dirDeRepos(entorno: Readonly<Record<string, string | undefined>>): string {
  const local = entorno.LOCALAPPDATA ?? entorno.APPDATA
  if (local !== undefined && local !== '') return join(local, 'nn-anime', 'repos')

  const xdg = entorno.XDG_DATA_HOME
  if (xdg !== undefined && xdg !== '') return join(xdg, 'nn-anime', 'repos')

  return join(entorno.HOME ?? entorno.USERPROFILE ?? '.', '.local', 'share', 'nn-anime', 'repos')
}

/** Un número entero no negativo, o el motivo por el que no lo es. */
function entero(texto: string, nombre: string): number {
  const valor = Number(texto)
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${nombre} espera un entero no negativo, no «${texto}»`)
  }

  return valor
}

/**
 * Las opciones de la línea de órdenes.
 *
 * `--buscar` no tiene valor por defecto a propósito: una sonda que resuelve el
 * primer título del catálogo cuando nadie le dice cuál medir mide otra cosa.
 */
export function leerOpciones(
  argv: readonly string[],
  entorno: Readonly<Record<string, string | undefined>>,
): Opciones {
  let plugin: string | undefined
  let archivo = 'cuevana3.ts'
  let dir = dirDeRepos(entorno)
  let buscar: string | undefined
  let indice = 0
  let episodio: number | undefined
  let crudo = false

  for (let posicion = 0; posicion < argv.length; posicion++) {
    const orden = argv[posicion] ?? ''
    const valor = (): string => {
      const siguiente = argv[posicion + 1]
      if (siguiente === undefined) throw new Error(`${orden} necesita un valor`)

      posicion += 1

      return siguiente
    }

    switch (orden) {
      case '--plugin':
        plugin = valor()
        break
      case '--archivo':
        archivo = valor()
        break
      case '--dir':
        dir = valor()
        break
      case '--buscar':
        buscar = valor()
        break
      case '--indice':
        indice = entero(valor(), '--indice')
        break
      case '--episodio':
        episodio = entero(valor(), '--episodio')
        break
      case '--crudo':
        crudo = true
        break
      default:
        throw new Error(`orden desconocida: «${orden}»`)
    }
  }

  if (buscar === undefined || buscar.trim() === '') {
    throw new Error(
      'falta --buscar: la sonda resuelve un título concreto, no el primero del catálogo',
    )
  }

  return { plugin, archivo, dir, buscar, indice, episodio, crudo }
}

/* ------------------------------------------------------------------ el archivo */

/** Los archivos con ese nombre que hay bajo un directorio, hasta cierta hondura. */
export async function buscarArchivos(
  dir: string,
  nombre: string,
  profundidad = PROFUNDIDAD_MAX,
): Promise<readonly string[]> {
  if (profundidad < 0) return []

  // Un directorio que no existe no es un fallo de la sonda: es que este sistema no
  // tiene plugins instalados ahí, y quien lee el resultado lo tiene que saber. El
  // tipo se deja deducir: anotarlo elige la sobrecarga del `Buffer` y `name` pasa
  // a ser un búfer en vez de una cadena.
  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => undefined)
  if (entradas === undefined) return []

  const encontrados: string[] = []

  for (const entrada of entradas) {
    const ruta = join(dir, entrada.name)

    if (entrada.isDirectory()) {
      encontrados.push(...(await buscarArchivos(ruta, nombre, profundidad - 1)))
      continue
    }

    if (entrada.isFile() && basename(entrada.name) === nombre) encontrados.push(ruta)
  }

  return encontrados
}

/** El más reciente de los candidatos: un repo se instala con marca de fecha. */
async function masReciente(candidatos: readonly string[]): Promise<string | undefined> {
  let elegido: string | undefined
  let cuando = 0

  for (const candidato of candidatos) {
    const info = await stat(candidato).catch(() => undefined)
    if (info === undefined) continue

    if (info.mtimeMs > cuando) {
      cuando = info.mtimeMs
      elegido = candidato
    }
  }

  return elegido
}

/* --------------------------------------------------------------- el manifiesto */

export interface Variante {
  readonly bandaAncha: string | undefined
  readonly resolucion: string | undefined
  readonly codecs: string | undefined
  readonly fotogramas: string | undefined
}

export interface Pista {
  readonly tipo: string
  readonly grupo: string | undefined
  readonly idioma: string | undefined
  readonly nombre: string | undefined
  readonly porDefecto: boolean
  readonly autoseleccionable: boolean
  readonly forzada: boolean
  readonly canales: string | undefined
}

export interface ResumenPlaylist {
  /** Una lista con segmentos es una lista de medios; sin ellos, es la maestra. */
  readonly tipo: 'maestra' | 'multimedia'
  readonly variantes: readonly Variante[]
  readonly pistas: readonly Pista[]
  readonly claves: number
  readonly segmentos: number
}

/** Los atributos de una etiqueta `#EXT-X-…`, sin las comillas de los valores. */
export function atributos(linea: string): ReadonlyMap<string, string> {
  const salida = new Map<string, string>()
  const dosPuntos = linea.indexOf(':')
  if (dosPuntos < 0) return salida

  // El valor entre comillas se toma entero: `CODECS="avc1.4d401f,mp4a.40.2"` lleva
  // una coma dentro, y cortar por comas partiría ese atributo en dos.
  const patron = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g
  for (const encontrado of linea.slice(dosPuntos + 1).matchAll(patron)) {
    const clave = encontrado[1]
    const crudo = encontrado[2]
    if (clave === undefined || crudo === undefined) continue

    salida.set(
      clave,
      crudo.startsWith('"') && crudo.endsWith('"') ? crudo.slice(1, -1) : crudo.trim(),
    )
  }

  return salida
}

/** Cuenta variantes, pistas, claves y segmentos de un manifiesto. */
export function analizarPlaylist(texto: string): ResumenPlaylist {
  const variantes: Variante[] = []
  const pistas: Pista[] = []
  let claves = 0
  let segmentos = 0

  for (const linea of texto.split('\n')) {
    const limpia = linea.trim()

    if (limpia.startsWith('#EXT-X-STREAM-INF:')) {
      const campos = atributos(limpia)
      variantes.push({
        bandaAncha: campos.get('BANDWIDTH') ?? campos.get('AVERAGE-BANDWIDTH'),
        resolucion: campos.get('RESOLUTION'),
        codecs: campos.get('CODECS'),
        fotogramas: campos.get('FRAME-RATE'),
      })
      continue
    }

    if (limpia.startsWith('#EXT-X-MEDIA:')) {
      const campos = atributos(limpia)
      pistas.push({
        tipo: campos.get('TYPE') ?? 'SIN-TIPO',
        grupo: campos.get('GROUP-ID'),
        idioma: campos.get('LANGUAGE'),
        nombre: campos.get('NAME'),
        porDefecto: campos.get('DEFAULT') === 'YES',
        autoseleccionable: campos.get('AUTOSELECT') === 'YES',
        forzada: campos.get('FORCED') === 'YES',
        canales: campos.get('CHANNELS'),
      })
      continue
    }

    if (limpia.startsWith('#EXT-X-KEY:') || limpia.startsWith('#EXT-X-SESSION-KEY:')) claves += 1
    if (limpia.startsWith('#EXTINF:')) segmentos += 1
  }

  return { tipo: segmentos > 0 ? 'multimedia' : 'maestra', variantes, pistas, claves, segmentos }
}

/**
 * Las líneas de etiqueta, con el valor de `URI` velado.
 *
 * Es lo que se imprime con `--crudo`: sin las etiquetas no se ve el `LANGUAGE`
 * ni el `NAME` —que es lo que decide si una pista sirve—, y con los `URI` tal
 * cual se estaría imprimiendo la dirección firmada del upstream.
 */
export function lineasVeladas(texto: string): readonly string[] {
  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter(
      (linea) =>
        linea.startsWith('#EXT-X-') &&
        !linea.startsWith('#EXTINF') &&
        !linea.startsWith('#EXT-X-BYTERANGE'),
    )
    .map((linea) => linea.replace(/URI=("[^"]*"|'[^']*')/g, 'URI="[velado]"'))
}

/** Sólo el host: la consulta lleva la firma del upstream. */
function hostDe(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(dirección ilegible)'
  }
}

/** El texto de una respuesta, cortando mientras llega y no después. */
async function leerConTope(respuesta: Response): Promise<string> {
  const lector = respuesta.body?.getReader()
  if (lector === undefined) return ''

  const trozos: Uint8Array[] = []
  let visto = 0

  for (;;) {
    const { done, value } = await lector.read()
    if (done === true) break
    if (value === undefined) continue

    visto += value.byteLength
    if (visto > TOPE_BYTES) {
      await lector.cancel().catch(() => undefined)
      throw new Error(`el manifiesto pasa de ${TOPE_BYTES} bytes y se corta`)
    }

    trozos.push(value)
  }

  const unido = new Uint8Array(visto)
  let desplazamiento = 0

  for (const trozo of trozos) {
    unido.set(trozo, desplazamiento)
    desplazamiento += trozo.byteLength
  }

  return new TextDecoder().decode(unido)
}

/* ------------------------------------------------------------------- la sonda */

/*
 * Los tipos salen del propio contrato —lo que devuelve cada método— y no del
 * schema: `ProviderResponse` describe la respuesta ya validada y con arrays
 * mutables, y una fuente del contrato lleva las listas de sólo lectura. Mezclar
 * los dos da un error que habla de `readonly` y esconde que son dos cosas.
 */
type Acierto = Awaited<ReturnType<Provider['search']>>[number]
type Episodio = Awaited<ReturnType<Provider['getEpisodes']>>[number]
type Fuente = Awaited<ReturnType<Provider['resolveStream']>>[number]

/** El plugin validado, visto sólo por lo que esta sonda usa. */
type Proveedor = Pick<Provider, 'id' | 'name' | 'search' | 'getEpisodes' | 'resolveStream'>

function informar(mensaje: string): void {
  console.log(mensaje)
}

function paso(numero: number, titulo: string): void {
  console.log(`\n${numero}. ${titulo}`)
}

/** La lista de resultados, numerada para poder elegir con `--indice`. */
function pintarAciertos(aciertos: readonly Acierto[]): void {
  for (const [posicion, acierto] of aciertos.entries()) {
    const anio = acierto.year === undefined ? '' : ` (${acierto.year})`
    const tipo = acierto.kind === undefined ? '' : ` [${acierto.kind}]`
    informar(`  ${posicion}. ${acierto.title}${anio}${tipo}`)
  }
}

async function resolverFuentes(
  proveedor: Proveedor,
  opciones: Opciones,
  senal: AbortSignal,
): Promise<readonly Fuente[]> {
  paso(1, `búsqueda: ${opciones.buscar}`)
  const aciertos = await proveedor.search(opciones.buscar, { signal: senal, timeoutMs: TIMEOUT_MS })
  if (aciertos.length === 0) throw new Error('la búsqueda no devolvió nada')

  pintarAciertos(aciertos)

  const elegido = aciertos[opciones.indice]
  if (elegido === undefined) {
    throw new Error(`no hay un resultado en la posición ${opciones.indice}`)
  }

  informar(`  → se mide «${elegido.title}»`)

  paso(2, 'episodios')
  const episodios = await proveedor.getEpisodes(elegido.ref, {
    signal: senal,
    timeoutMs: TIMEOUT_MS,
  })
  if (episodios.length === 0) throw new Error('el título no tiene ningún episodio')

  informar(`  ${episodios.length} episodio(s)`)
  const episodio =
    opciones.episodio === undefined
      ? episodios[0]
      : (episodios.find((uno: Episodio) => uno.number === opciones.episodio) ??
        episodios[opciones.episodio])

  if (episodio === undefined)
    throw new Error(`no hay un episodio que medir con ${opciones.episodio}`)

  informar(`  → se mide el episodio ${episodio.number}${episodio.title ?? ''}`)

  paso(3, 'fuentes que declara el plugin')
  const fuentes = await proveedor.resolveStream(
    { episodeRef: episodio.ref, mode: 'sub' },
    { signal: senal, timeoutMs: TIMEOUT_MS },
  )

  informar(`  ${fuentes.length} fuente(s)`)

  return [...fuentes]
}

/** Lo que se cuenta de cada fuente y de su manifiesto. */
async function medirFuente(
  fuente: Fuente,
  numero: number,
  senal: AbortSignal,
  crudo: boolean,
): Promise<{ readonly subtitulos: number; readonly variantes: number } | undefined> {
  console.log(`\n— Fuente ${numero + 1} —`)
  informar(`  tipo          ${fuente.kind}`)
  informar(`  host          ${hostDe(fuente.url)}`)
  informar(`  calidad       ${fuente.quality ?? '(sin declarar)'}`)
  informar(
    `  cabeceras     ${
      Object.keys(fuente.headers ?? {}).join(', ') || '(ninguna: no se imprimen los valores)'
    }`,
  )
  informar(`  subtítulos declarados  ${fuente.subtitles?.length ?? 0}`)

  const respuesta = await fetch(fuente.url, {
    headers: { ...fuente.headers },
    signal: senal,
  })

  if (!respuesta.ok) {
    informar(`  el upstream respondió ${respuesta.status}`)

    return undefined
  }

  if (fuente.kind === 'file') {
    informar(`  content-type  ${respuesta.headers.get('content-type') ?? '(sin declarar)'}`)
    informar(`  bytes         ${respuesta.headers.get('content-length') ?? '(sin declarar)'}`)
    informar(`  rangos        ${respuesta.headers.get('accept-ranges') ?? '(sin declarar)'}`)
    await respuesta.body?.cancel().catch(() => undefined)

    return { subtitulos: fuente.subtitles?.length ?? 0, variantes: 0 }
  }

  const texto = await leerConTope(respuesta)
  const resumen = analizarPlaylist(texto)
  const subtitulos = resumen.pistas.filter((pista) => pista.tipo === 'SUBTITLES')
  const audio = resumen.pistas.filter((pista) => pista.tipo === 'AUDIO')

  informar(`  lista         ${resumen.tipo}`)
  informar(`  variantes     ${resumen.variantes.length}`)
  for (const [posicion, variante] of resumen.variantes.entries()) {
    informar(
      `    ${posicion}. ${variante.resolucion ?? '?'} · ${
        variante.bandaAncha ?? '?'
      } bps · ${variante.codecs ?? 'códec sin declarar'}`,
    )
  }

  informar(
    `  pistas        ${resumen.pistas.length} (audio ${audio.length}, subtítulos ${subtitulos.length})`,
  )
  for (const pista of subtitulos) {
    informar(
      `    subtítulos: ${pista.idioma ?? 'sin idioma'} · «${pista.nombre ?? 'sin nombre'}»` +
        `${pista.porDefecto ? ' · por defecto' : ''}${pista.forzada ? ' · forzada' : ''}` +
        `${pista.autoseleccionable ? ' · autoseleccionable' : ''}`,
    )
  }

  for (const pista of audio) {
    informar(
      `    audio: ${pista.idioma ?? 'sin idioma'} · «${pista.nombre ?? 'sin nombre'}»` +
        `${pista.canales === undefined ? '' : ` · ${pista.canales}`}`,
    )
  }

  informar(`  claves        ${resumen.claves}`)
  informar(`  segmentos     ${resumen.segmentos}`)

  if (crudo) {
    console.log('\n  etiquetas (URI velado):')
    for (const linea of lineasVeladas(texto)) informar(`    ${linea}`)
  }

  return { subtitulos: subtitulos.length, variantes: resumen.variantes.length }
}

async function principal(argumentos: readonly string[]): Promise<number> {
  const opciones = leerOpciones(argumentos, process.env)

  const ruta =
    opciones.plugin ?? (await masReciente(await buscarArchivos(opciones.dir, opciones.archivo)))

  if (ruta === undefined) {
    console.error(
      `no se encontró ningún «${opciones.archivo}» bajo ${opciones.dir}; ` +
        'pasa la ruta del plugin con --plugin',
    )

    return 1
  }

  informar(`plugin: ${ruta}`)

  const modulo: unknown = await import(pathToFileURL(ruta).href)
  const validado = validateProvider((modulo as { default?: unknown }).default)

  if (!validado.ok) {
    console.error(`el plugin no cumple el contrato: ${JSON.stringify(validado.error)}`)

    return 1
  }

  const proveedor: Proveedor = validado.value
  informar(`proveedor: ${proveedor.name ?? proveedor.id}`)

  const senal = AbortSignal.timeout(TIMEOUT_MS * 4)
  const fuentes = await resolverFuentes(proveedor, opciones, senal)

  const medidas = []
  for (const [posicion, fuente] of fuentes.entries()) {
    medidas.push(await medirFuente(fuente, posicion, senal, opciones.crudo))
  }

  const conPistas = medidas.filter((medida) => medida !== undefined && medida.subtitulos > 0).length
  const conVariantes = medidas.filter(
    (medida) => medida !== undefined && medida.variantes > 1,
  ).length

  console.log('\n== Conclusión ==')
  informar(
    conPistas > 0
      ? `subtítulos: ${conPistas} de ${medidas.length} fuente(s) traen pistas incrustadas en el manifiesto`
      : 'subtítulos: ninguna fuente trae pistas incrustadas en el manifiesto',
  )
  informar(
    conVariantes > 0
      ? `calidades: ${conVariantes} de ${medidas.length} fuente(s) traen más de una variante`
      : 'calidades: ninguna fuente trae más de una variante',
  )

  return 0
}

if (import.meta.main) {
  process.exitCode = await principal(Bun.argv.slice(2)).catch((causa: unknown) => {
    console.error(causa instanceof Error ? causa.message : String(causa))

    return 1
  })
}
