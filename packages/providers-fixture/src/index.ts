/**
 * Proveedor de prueba con contrato completo.
 *
 * Es el único proveedor del repositorio y el que se usa para verificar todo de
 * punta a punta: búsqueda, detalle, episodios, streams y subtítulos sin red y sin
 * depender de ningún sitio. Los datos son inventados (ver `data.ts`).
 *
 * **Simula los defectos de un sitio real a propósito.** Un proveedor que sólo
 * funciona no prueba nada: lo que hay que verificar es que un 500, un 404, una
 * respuesta que nunca llega o una excepción suelta no rompen la aplicación. Los
 * modos de fallo se eligen por opciones, por variables de entorno o por una
 * referencia especial, y son los tres caminos que necesitan el test, el arranque
 * manual y el e2e.
 *
 * No toca la red nunca: todo lo que devuelve apunta a `fixture.invalid`.
 */

import {
  type AnimeDetail,
  type Episode,
  type FeedEntry,
  type ProviderError,
  ProviderError as ProviderErrorClass,
  type ProviderRef,
  type SearchResult,
  type StreamMode,
  type StreamRequest,
  type StreamSource,
} from '@nn-anime/core'
import type { CallOptions, Provider, ProviderMethod } from '@nn-anime/provider-sdk'
import {
  buscar,
  destacados,
  detalle,
  episodios,
  novedades,
  numeroDeEpisodio,
  porRef,
  streams,
} from './data'

export const FIXTURE_PROVIDER_ID = 'fixture'

/** Tipos de fallo que el proveedor sabe simular. */
export type FixtureFailure = 'http500' | 'http404' | 'throws' | 'timeout'

export interface FixtureOptions {
  readonly id?: string
  readonly name?: string
  /** Latencia artificial de todas las llamadas, en milisegundos. */
  readonly latencyMs?: number
  /** Fallo por método. Lo que no esté aquí se comporta bien. */
  readonly failures?: Partial<Record<ProviderMethod, FixtureFailure>>
}

export interface FixtureCalls {
  readonly count: (method: ProviderMethod) => number
  readonly total: () => number
  readonly reset: () => void
}

/**
 * El proveedor, con su contador de llamadas.
 *
 * El contador es lo que permite afirmar «la segunda vuelta no llamó al
 * proveedor» sin espiar el sistema de archivos ni la base. Es parte del fixture,
 * no del contrato: quien quiera un `Provider` lo tiene igual, porque esto lo
 * extiende.
 */
export interface FixtureProvider extends Provider {
  readonly calls: FixtureCalls
}

/**
 * Referencias especiales, para forzar un caso desde un test o desde la interfaz
 * sin tocar la configuración: `fixture:no-existe` y `fixture:falla` como
 * referencia, y `fixture:lento` como **consulta** —en una referencia no hay
 * título que devolver, así que acaba en 404 después de la espera.
 */
export const REF_NO_EXISTE = 'fixture:no-existe'
export const REF_FALLA = 'fixture:falla'
export const REF_LENTO = 'fixture:lento'

function falloDeReferencia(valor: string): FixtureFailure | undefined {
  if (valor === REF_FALLA) return 'throws'
  if (valor === REF_NO_EXISTE) return 'http404'

  return undefined
}

/** Espera que respeta la señal: al cancelar, rechaza con el motivo de la señal. */
function dormir(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve()
      return
    }

    const temporizador = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(temporizador)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/** Nunca resuelve: sólo sale por la señal. Es un proveedor que se cuelga. */
function colgarse(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function errorDeFallo(
  fallo: FixtureFailure,
  metodo: ProviderMethod,
  detalle: string,
): ProviderError {
  const estado = fallo === 'http404' ? 404 : 500
  const texto =
    fallo === 'http404'
      ? `no existe ${detalle}`
      : fallo === 'throws'
        ? 'el proveedor de prueba lanza a propósito'
        : `el proveedor de prueba responde ${estado}`

  return new ProviderErrorClass({
    message: texto,
    scope: FIXTURE_PROVIDER_ID,
    op: metodo,
    context: { estado, fallo },
  })
}

export function createFixtureProvider(options: FixtureOptions = {}): FixtureProvider {
  const id = options.id ?? FIXTURE_PROVIDER_ID
  const cuentas = new Map<ProviderMethod, number>()

  const calls: FixtureCalls = {
    count: (metodo) => cuentas.get(metodo) ?? 0,
    total: () => [...cuentas.values()].reduce((suma, valor) => suma + valor, 0),
    reset: () => cuentas.clear(),
  }

  /**
   * Lo que pasa antes de responder: contar, esperar y, si toca, fallar.
   *
   * Está en un solo sitio por el mismo motivo que en el SDK: repetido por método
   * es donde se cuela el que se olvida de contar, y entonces «no llamó al
   * proveedor» deja de ser cierto sin que nadie lo note.
   */
  async function antesDeResponder(
    metodo: ProviderMethod,
    callOptions: CallOptions,
    detalle: string,
  ): Promise<void> {
    cuentas.set(metodo, (cuentas.get(metodo) ?? 0) + 1)

    const fallo = options.failures?.[metodo]
    if (fallo === 'timeout') return colgarse(callOptions.signal)
    if (fallo !== undefined) throw errorDeFallo(fallo, metodo, detalle)

    const lento = detalle.includes(REF_LENTO)
    const latencia = (options.latencyMs ?? 0) * (lento ? 10 : 1)
    if (latencia > 0) await dormir(latencia, callOptions.signal)
  }

  return {
    id,
    name: options.name ?? 'Proveedor de prueba',
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: true, trending: true, feed: true },
    calls,

    async search(query, callOptions) {
      await antesDeResponder('search', callOptions, query)
      return buscar(query)
    },

    async getAnime(ref: ProviderRef, callOptions) {
      await antesDeResponder('getAnime', callOptions, ref.value)

      const fallo = falloDeReferencia(ref.value)
      if (fallo !== undefined) throw errorDeFallo(fallo, 'getAnime', `el título ${ref.value}`)

      const titulo = porRef(ref.value)
      if (titulo === undefined) throw errorDeFallo('http404', 'getAnime', `el título ${ref.value}`)

      return detalle(titulo)
    },

    async getEpisodes(ref: ProviderRef, callOptions) {
      await antesDeResponder('getEpisodes', callOptions, ref.value)

      const fallo = falloDeReferencia(ref.value)
      if (fallo !== undefined) throw errorDeFallo(fallo, 'getEpisodes', `el título ${ref.value}`)

      const titulo = porRef(ref.value)
      if (titulo === undefined) {
        throw errorDeFallo('http404', 'getEpisodes', `el título ${ref.value}`)
      }

      return episodios(titulo)
    },

    async resolveStream(request: StreamRequest, callOptions) {
      await antesDeResponder('resolveStream', callOptions, request.episodeRef.value)

      const fallo = falloDeReferencia(request.episodeRef.value)
      if (fallo !== undefined) {
        throw errorDeFallo(fallo, 'resolveStream', `el episodio ${request.episodeRef.value}`)
      }

      const [refTitulo] = request.episodeRef.value.split('#')
      const numero = numeroDeEpisodio(request.episodeRef.value)
      const titulo = refTitulo === undefined ? undefined : porRef(refTitulo)

      if (titulo === undefined || numero === undefined) {
        throw errorDeFallo('http404', 'resolveStream', `el episodio ${request.episodeRef.value}`)
      }

      const modo: StreamMode = request.mode

      return streams(titulo, numero, modo)
    },

    async getTrending(callOptions) {
      await antesDeResponder('getTrending', callOptions, '')
      return destacados(5)
    },

    async getFeed(callOptions) {
      await antesDeResponder('getFeed', callOptions, '')
      return novedades()
    },
  }
}

const METODOS: readonly string[] = [
  'search',
  'getAnime',
  'getEpisodes',
  'resolveStream',
  'getTrending',
  'getFeed',
]
const FALLOS: readonly string[] = ['http500', 'http404', 'throws', 'timeout']

function esMetodo(valor: string): valor is ProviderMethod {
  return METODOS.includes(valor)
}

function esFallo(valor: string): valor is FixtureFailure {
  return FALLOS.includes(valor)
}

/**
 * Opciones leídas del entorno, para el arranque manual y el e2e.
 *
 * `NN_ANIME_FIXTURE_LATENCY_MS` y `NN_ANIME_FIXTURE_FAIL` (`search=500`,
 * `resolveStream=timeout`). Se leen aquí y no dentro del proveedor para que éste
 * siga siendo inyectable y no dependa de variables globales.
 */
export function fixtureOptionsFromEnv(env: Record<string, string | undefined>): FixtureOptions {
  const latencia = Number(env.NN_ANIME_FIXTURE_LATENCY_MS ?? '0')
  const fallos: Partial<Record<ProviderMethod, FixtureFailure>> = {}

  for (const trozo of (env.NN_ANIME_FIXTURE_FAIL ?? '').split(',')) {
    const [metodo, fallo] = trozo.split('=')
    if (metodo === undefined || fallo === undefined || metodo === '') continue
    if (!esMetodo(metodo) || !esFallo(fallo)) continue
    fallos[metodo] = fallo
  }

  return {
    ...(Number.isFinite(latencia) && latencia > 0 ? { latencyMs: latencia } : {}),
    ...(Object.keys(fallos).length === 0 ? {} : { failures: fallos }),
  }
}

/** Instancia lista para usar, con los fallos que pida el entorno. */
export const fixtureProvider: FixtureProvider = createFixtureProvider(
  fixtureOptionsFromEnv(process.env),
)

export type { AnimeDetail, Episode, FeedEntry, SearchResult, StreamSource }
