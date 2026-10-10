/**
 * Alta y consulta de proveedores.
 *
 * El registro es la única puerta por la que un plugin entra en la aplicación, y
 * por eso valida: quien llama entrega lo que encontró en el archivo —`unknown`—
 * y aquí se decide si es un proveedor. Un plugin roto no puede dejar el registro
 * a medias: `add` devuelve un `Result` y no toca nada cuando falla.
 *
 * El conflicto de identificadores gana el primero. Es una regla del spec y es la
 * única que no depende del orden en que el sistema de archivos devuelva los
 * archivos: el segundo plugin se reporta como conflicto y el usuario decide cuál
 * borrar.
 */

import { err, ok, type ProviderError, type Result } from '@nn-anime/core'
import { apiVersionMismatch, duplicateId, invalidShape } from './errors'
import { providerSchema } from './schema'
import { PROVIDER_API_VERSION, type Provider } from './types'

export interface ProviderRegistry {
  /**
   * Valida e incorpora un plugin. Un `id` repetido no reemplaza al primero: se
   * devuelve el conflicto para poder informarlo.
   */
  add(candidate: unknown): Result<Provider, ProviderError>
  get(id: string): Provider | undefined
  has(id: string): boolean
  list(): readonly Provider[]
  /** Cuántos proveedores hay registrados. */
  size(): number
}

/** El `id` declarado, si se puede leer sin validar el resto. Para los mensajes. */
export function readProviderId(candidate: unknown): string {
  if (typeof candidate === 'object' && candidate !== null && 'id' in candidate) {
    const id = candidate.id
    if (typeof id === 'string' && id !== '') return id
  }

  return '(sin id)'
}

/** La `apiVersion` declarada, si se puede leer. Para el mensaje del rechazo. */
export function readApiVersion(candidate: unknown): string | undefined {
  if (typeof candidate === 'object' && candidate !== null && 'apiVersion' in candidate) {
    const version = candidate.apiVersion
    if (typeof version === 'string') return version
  }

  return undefined
}

/**
 * Valida una forma desconocida como `Provider`.
 *
 * El orden importa: primero la versión del contrato, porque un plugin escrito
 * para otra versión falla de formas confusas si se valida campo a campo —sus
 * métodos existen, su forma se parece y el error acaba hablando de un header—.
 * Después la forma, y el mensaje nombra el campo exacto que falla.
 */
export function validateProvider(candidate: unknown): Result<Provider, ProviderError> {
  const version = readApiVersion(candidate)
  if (version !== undefined && version !== PROVIDER_API_VERSION) {
    return err(apiVersionMismatch(readProviderId(candidate), version))
  }

  const parsed = providerSchema.safeParse(candidate)
  if (!parsed.success) {
    return err(invalidShape(readProviderId(candidate), parsed.error.issues))
  }

  return ok(parsed.data)
}

export function createRegistry(initial: readonly unknown[] = []): ProviderRegistry {
  const providers = new Map<string, Provider>()

  const registry: ProviderRegistry = {
    add(candidate) {
      const validated = validateProvider(candidate)
      if (!validated.ok) return validated

      const provider = validated.value
      if (providers.has(provider.id)) return err(duplicateId(provider.id))

      providers.set(provider.id, provider)
      return ok(provider)
    },
    get: (id) => providers.get(id),
    has: (id) => providers.has(id),
    list: () => [...providers.values()],
    size: () => providers.size,
  }

  for (const candidate of initial) registry.add(candidate)

  return registry
}
