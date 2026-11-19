/**
 * El mando de transmitir, de la interfaz al SDK.
 *
 * Pregunta una vez si el servidor puede emitir; no carga el guion hasta que
 * alguien pulsa. Al empezar, pide la sesión al servidor con el ticket que el
 * reproductor ya está usando y manda la URL absoluta al receptor. Al parar,
 * revoca la sesión y devuelve la posición para que el video local siga ahí.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { abrirCastSesion, cerrarCastSesion, leerCastInfo } from '../../../api/cast'
import { adaptarCastSdk } from './cast-adapter'
import { cargarCastSdk } from './cast-sdk'
import { type CastSesion, crearCastSesion } from './cast-session'
import { CAST_ESTADO_INICIAL, type CastEstado, type CastKind } from './cast-types'

export interface UseCastControlOptions {
  /** El ticket del proxy que el reproductor tiene cargado. */
  readonly url: string
  readonly kind: CastKind
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
  readonly poster?: string | undefined
  /** La posición desde la que empieza la TV. */
  readonly positionS: number
}

export interface CastControlHandle {
  readonly disponible: boolean
  readonly conectado: boolean
  readonly estado: CastEstado
  readonly cargando: boolean
  readonly error: string | undefined
  readonly sesion: CastSesion | undefined
  iniciar: () => Promise<boolean>
  /** Para la emisión y devuelve la posición en la que se quedó. */
  detener: () => Promise<number>
}

export function useCastControl(options: UseCastControlOptions): CastControlHandle {
  const [disponible, setDisponible] = useState(false)
  const [estado, setEstado] = useState<CastEstado>(CAST_ESTADO_INICIAL)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [sesion, setSesion] = useState<CastSesion | undefined>(undefined)

  const sesionRef = useRef<CastSesion | undefined>(undefined)
  const idRef = useRef<string | undefined>(undefined)
  const estadoRef = useRef(estado)
  const urlRef = useRef(options.url)
  const kindRef = useRef(options.kind)
  const titleRef = useRef(options.title)
  const subtitleRef = useRef(options.subtitle)
  const posterRef = useRef(options.poster)
  const positionRef = useRef(options.positionS)

  urlRef.current = options.url
  kindRef.current = options.kind
  titleRef.current = options.title
  subtitleRef.current = options.subtitle
  posterRef.current = options.poster
  positionRef.current = options.positionS
  estadoRef.current = estado

  useEffect(() => {
    let vigente = true

    leerCastInfo()
      .then((info) => {
        if (vigente) setDisponible(info.available)
      })
      .catch(() => {
        if (vigente) setDisponible(false)
      })

    return () => {
      vigente = false
    }
  }, [])

  const detener = useCallback(async (): Promise<number> => {
    const posicion = estadoRef.current.positionS

    sesionRef.current?.detener()
    sesionRef.current = undefined
    setSesion(undefined)

    const id = idRef.current
    idRef.current = undefined
    if (id !== undefined) {
      await cerrarCastSesion(id).catch(() => {})
    }

    setCargando(false)

    return posicion
  }, [])

  useEffect(() => {
    return () => {
      // Al desmontar no se deja una TV reproduciendo sin control: se cierra la
      // sesión y se revoca el ticket. T390 podrá reconectar si se quiere.
      void detener()
    }
  }, [detener])

  const iniciar = useCallback(async (): Promise<boolean> => {
    if (!disponible || cargando) return false

    setCargando(true)
    setError(undefined)

    let id: string | undefined

    try {
      await cargarCastSdk()

      const sdk = adaptarCastSdk()
      if (sdk === undefined) throw new Error('el SDK de Cast no está disponible')

      const alta = await abrirCastSesion({
        url: urlRef.current,
        kind: kindRef.current,
        ...(titleRef.current === undefined ? {} : { title: titleRef.current }),
        ...(posterRef.current === undefined ? {} : { poster: posterRef.current }),
        startAtS: positionRef.current,
      })
      id = alta.id
      idRef.current = id

      const nueva = crearCastSesion(sdk, setEstado)
      sesionRef.current = nueva
      setSesion(nueva)

      await nueva.iniciar(
        alta.urls[0] ?? '',
        alta.kind,
        {
          ...(titleRef.current === undefined ? {} : { title: titleRef.current }),
          ...(subtitleRef.current === undefined ? {} : { subtitle: subtitleRef.current }),
          ...(posterRef.current === undefined ? {} : { poster: posterRef.current }),
        },
        positionRef.current,
      )

      return true
    } catch (cause) {
      const mensaje = cause instanceof Error ? cause.message : String(cause)
      setError(mensaje)

      // Si la sesión ya se había abierto, no se deja el ticket vivo.
      if (id !== undefined) {
        idRef.current = undefined
        await cerrarCastSesion(id).catch(() => {})
      }

      sesionRef.current?.cerrar()
      sesionRef.current = undefined
      setSesion(undefined)

      return false
    } finally {
      setCargando(false)
    }
  }, [disponible, cargando])

  return {
    disponible,
    conectado: estado.conectado,
    estado,
    cargando,
    error,
    sesion,
    iniciar,
    detener,
  }
}
