/**
 * Las lecturas y mutaciones del cast.
 *
 * La información se pregunta al servidor y se valida en la frontera, como el
 * resto: si el server deja de mandar `urls`, la interfaz lo sabe aquí y no en
 * mitad de un componente. El cuerpo de la sesión no lleva una URL, sólo la
 * referencia del episodio y los metadatos que el receptor pinta.
 */

import {
  type CastInfoResponse,
  type CastSessionRequest,
  type CastSessionResponse,
  castInfoResponseSchema,
  castSessionResponseSchema,
} from '@rona/core'
import { apiDelete, apiGet, apiPostJson, type RequestDeps } from './client'

export function leerCastInfo(deps?: RequestDeps): Promise<CastInfoResponse> {
  return apiGet('/api/cast/info', castInfoResponseSchema, {}, deps)
}

export function abrirCastSesion(
  peticion: CastSessionRequest,
  deps?: RequestDeps,
): Promise<CastSessionResponse> {
  return apiPostJson('/api/cast/session', peticion, castSessionResponseSchema, {}, deps)
}

export function cerrarCastSesion(id: string, deps?: RequestDeps): Promise<void> {
  return apiDelete(`/api/cast/session/${encodeURIComponent(id)}`, {}, deps)
}
