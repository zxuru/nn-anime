/**
 * Test de conformidad reutilizable.
 *
 * El contrato no sirve de nada si sólo lo cumple el proveedor de ejemplo. Esto
 * existe para que el autor de un plugin pueda comprobar el suyo —y para que
 * `providers-fixture` lo pase en la suite del proyecto—, y **dice qué método
 * incumple**: «no conforme» sin el nombre del método obliga a leer el contrato
 * entero y compararlo a mano.
 *
 * La conformidad se comprueba en dos capas: la forma —están todos los métodos
 * que el contrato exige— y la coherencia entre lo declarado y lo implementado.
 * Lo que no se puede comprobar sin llamar es la firma: eso lo verifica el
 * compilador del autor, que es para lo que existe el paquete de tipos.
 */

import { err, ok, type ProviderError, type Result } from '@nn-anime/core'
import { providerFailure } from './errors'
import { readProviderId, validateProvider } from './registry'
import {
  PROVIDER_METHODS,
  type Provider,
  type ProviderMethod,
  REQUIRED_PROVIDER_METHODS,
} from './types'

export interface MethodReport {
  readonly method: ProviderMethod
  readonly required: boolean
  readonly present: boolean
}

export interface ConformanceReport {
  readonly providerId: string
  readonly methods: readonly MethodReport[]
  readonly problems: readonly string[]
  /** Verdadero cuando no hay ningún problema. */
  readonly ok: boolean
}

function isRequired(method: ProviderMethod): boolean {
  return (REQUIRED_PROVIDER_METHODS as readonly string[]).includes(method)
}

function presentMethods(candidate: unknown): readonly MethodReport[] {
  return PROVIDER_METHODS.map((method) => ({
    method,
    required: isRequired(method),
    present: typeof methodOf(candidate, method) === 'function',
  }))
}

function methodOf(candidate: unknown, method: ProviderMethod): unknown {
  if (typeof candidate !== 'object' || candidate === null) return undefined

  return method in candidate ? Reflect.get(candidate, method) : undefined
}

/**
 * Qué métodos del contrato están y cuáles no.
 *
 * Se puede llamar con cualquier cosa, no sólo con un proveedor válido: es lo que
 * se usa para explicar el rechazo.
 */
export function inspectConformance(candidate: unknown): ConformanceReport {
  const methods = presentMethods(candidate)
  const problems = methods
    .filter((report) => report.required && !report.present)
    .map((report) => `falta el método ${report.method} o no es una función`)

  return {
    providerId: readProviderId(candidate),
    methods,
    problems,
    ok: problems.length === 0,
  }
}

/**
 * Lo que la forma no puede ver: declarar una capacidad que no se implementa.
 *
 * `capabilities.trending` es una promesa al resto del sistema de que existe
 * `getTrending`, y `capabilities.feed` de que existe `getFeed`. Un plugin que la
 * declara y no lo implementa haría fallar el arranque en frío de `recsys` —o la
 * fila de novedades de la home— en el peor momento, que es al principio.
 */
function coherenceProblems(provider: Provider): readonly string[] {
  const problems: string[] = []

  if (provider.capabilities.trending && typeof provider.getTrending !== 'function') {
    problems.push('declara capabilities.trending y no implementa getTrending')
  }

  if (provider.capabilities.feed && typeof provider.getFeed !== 'function') {
    problems.push('declara capabilities.feed y no implementa getFeed')
  }

  // La paginación son tres métodos de una sola capacidad: una promesa a medias
  // ofrece un botón de «último episodio» que no lleva a ninguna parte, y un
  // método de paginación sin la capacidad declarada deja al servidor sin saber
  // que puede pedir páginas.
  const paginacion = [
    provider.getEpisodesPage,
    provider.getEpisode,
    provider.getLatestEpisode,
  ].filter((metodo) => typeof metodo === 'function').length

  if (provider.capabilities.episodePages === true && paginacion < 3) {
    problems.push(
      'declara capabilities.episodePages y no implementa getEpisodesPage, getEpisode y getLatestEpisode',
    )
  }

  if (provider.capabilities.episodePages !== true && paginacion > 0) {
    problems.push(
      'implementa métodos de episodios por página sin declarar capabilities.episodePages',
    )
  }

  return problems
}

/**
 * Comprueba el contrato entero y devuelve el proveedor ya validado.
 *
 * El error nombra el método o la incoherencia concreta; el informe de
 * `inspectConformance` queda para quien necesite la lista completa.
 */
export function assertConforms(candidate: unknown): Result<Provider, ProviderError> {
  const report = inspectConformance(candidate)
  const validated = validateProvider(candidate)

  if (!validated.ok) {
    // El mensaje de la validación de forma ya nombra el campo; se le añaden los
    // métodos que falten para que el autor no tenga que deducirlo.
    const missing = report.problems.join('; ')
    if (missing === '') return validated

    return err(
      providerFailure({
        providerId: report.providerId,
        kind: 'invalid-shape',
        detail: `${missing}; ${validated.error.message}`,
      }),
    )
  }

  const problems = coherenceProblems(validated.value)
  if (problems.length > 0) {
    return err(
      providerFailure({
        providerId: validated.value.id,
        kind: 'invalid-shape',
        detail: problems.join('; '),
      }),
    )
  }

  return ok(validated.value)
}
