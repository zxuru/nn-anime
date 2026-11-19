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
import { CAST_ESTADO_INICIAL, type CastEstado, type CastKind, type CastTrack } from './cast-types'

export interface UseCastControlOptions {
  /** El ticket del proxy que el reproductor tiene cargado. */
  readonly url: string
  readonly kind: CastKind
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
  readonly poster?: string | undefined
  /** La posición desde la que empieza la TV. */
  readonly positionS: number
  /** Pistas de subtítulos que el reproductor local tiene cargadas. */
  readonly tracks?:
    | readonly { readonly url: string; readonly lang: string; readonly label: string }[]
    | undefined
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

/** La emisión recordada para reconectar al recargar la misma pantalla. */
const MARCA = 'rona:cast'

interface MarcaCast {
  readonly id: string
  readonly url: string
}

function leerMarca(): MarcaCast | undefined {
  if (typeof localStorage === 'undefined') return undefined

  try {
    const crudo = localStorage.getItem(MARCA)
    if (crudo === null) return undefined

    const valor: unknown = JSON.parse(crudo)
    if (typeof valor !== 'object' || valor === null) return undefined

    const datos = valor as Record<string, unknown>
    if (typeof datos.id !== 'string' || typeof datos.url !== 'string') return undefined

    return { id: datos.id, url: datos.url }
  } catch {
    return undefined
  }
}

function guardarMarca(id: string, url: string): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(MARCA, JSON.stringify({ id, url } satisfies MarcaCast))
  } catch {
    // Un almacén lleno o prohibido no impide emitir; sólo pierde la reconexión.
  }
}

function borrarMarca(): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.removeItem(MARCA)
  } catch {
    // Igual que guardar: la emisión no depende de esto.
  }
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
  const tracksRef = useRef(options.tracks)

  urlRef.current = options.url
  kindRef.current = options.kind
  titleRef.current = options.title
  subtitleRef.current = options.subtitle
  posterRef.current = options.poster
  positionRef.current = options.positionS
  tracksRef.current = options.tracks
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

  /**
   * Reconectar una emisión que ya existía.
   *
   * Sólo se carga el guion si hay una marca de una emisión anterior **para esta
   * misma URL**: abrir otro episodio no adopta la TV del anterior, la cierra. La
   * marca se escribe al empezar y se borra al parar; recargar no la borra.
   */
  useEffect(() => {
    const marca = leerMarca()
    if (marca === undefined) return

    let vigente = true

    void (async () => {
      if (marca.url !== urlRef.current) {
        await cerrarCastSesion(marca.id).catch(() => {})
        borrarMarca()

        return
      }

      try {
        await cargarCastSdk()

        const sdk = adaptarCastSdk()
        const actual = sdk?.context.getCurrentSession()
        if (!vigente) return

        if (sdk === undefined || actual === null || actual === undefined) {
          borrarMarca()

          return
        }

        const nueva = crearCastSesion(sdk, setEstado)
        nueva.adoptar(actual)
        sesionRef.current = nueva
        idRef.current = marca.id
        setSesion(nueva)
      } catch {
        borrarMarca()
      }
    })()

    return () => {
      vigente = false
    }
  }, [])

  const detener = useCallback(async (): Promise<number> => {
    const posicion = estadoRef.current.positionS

    sesionRef.current?.detener()
    sesionRef.current = undefined
    setSesion(undefined)
    borrarMarca()

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
      // Al desmontar no se apaga la TV: la marca permite reconectar al volver a
      // la misma pantalla. Parar es una acción explícita del mando.
      sesionRef.current?.cerrar()
    }
  }, [])

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
        ...(tracksRef.current === undefined || tracksRef.current.length === 0
          ? {}
          : {
              subtitles: tracksRef.current.map((pista) => ({
                url: pista.url,
                lang: pista.lang,
                label: pista.label,
              })),
            }),
      })
      id = alta.id
      idRef.current = id

      const nueva = crearCastSesion(sdk, setEstado)
      sesionRef.current = nueva
      setSesion(nueva)

      const pistas: CastTrack[] = alta.subtitles.map((subtitulo, indice) => ({
        trackId: indice + 1,
        trackContentId: subtitulo.url,
        trackContentType: 'text/vtt',
        subtype: 'SUBTITLES',
        name: subtitulo.label,
        language: subtitulo.lang,
      }))

      await nueva.iniciar(
        alta.urls[0] ?? '',
        alta.kind,
        {
          ...(titleRef.current === undefined ? {} : { title: titleRef.current }),
          ...(subtitleRef.current === undefined ? {} : { subtitle: subtitleRef.current }),
          ...(posterRef.current === undefined ? {} : { poster: posterRef.current }),
        },
        positionRef.current,
        pistas,
      )

      if (id !== undefined) guardarMarca(id, urlRef.current)

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
