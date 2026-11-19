/**
 * El enganche entre React y la emisión.
 *
 * No guarda el estado en un `ref`: la interfaz tiene que volver a pintar cuando
 * el receptor cambia de posición o se conecta. El SDK se recibe ya adaptado; si
 * es `undefined`, no hay emisión y el estado vuelve al inicial.
 */

import { useEffect, useState } from 'react'
import { type CastSesion, crearCastSesion } from './cast-session'
import { CAST_ESTADO_INICIAL, type CastEstado, type CastSdk } from './cast-types'

export interface UseCastSessionHandle {
  readonly estado: CastEstado
  readonly sesion: CastSesion | undefined
}

export function useCastSession(sdk: CastSdk | undefined): UseCastSessionHandle {
  const [estado, setEstado] = useState<CastEstado>(CAST_ESTADO_INICIAL)
  const [sesion, setSesion] = useState<CastSesion | undefined>(undefined)

  useEffect(() => {
    if (sdk === undefined) {
      setSesion(undefined)
      setEstado(CAST_ESTADO_INICIAL)

      return
    }

    const nueva = crearCastSesion(sdk, setEstado)
    setSesion(nueva)
    setEstado(CAST_ESTADO_INICIAL)

    return () => {
      nueva.cerrar()
      setSesion(undefined)
    }
  }, [sdk])

  return { estado, sesion }
}
