/**
 * El estado de la pantalla de reproducción.
 *
 * Aquí vive todo lo que la pantalla de reproducción sabe: la posición, el error,
 * los vecinos, el nombre del título y la sala. La pantalla —`WatchPage`— sólo
 * pinta: compone el marcado y decide qué estado se ve, pero no guarda nada.
 *
 * El motivo es el mismo por el que `useDetail` agrupa lo de la ficha y `useParty`
 * lo de la sala: **el estado de una pantalla es un dominio**, y un dominio se
 * lee, se prueba y se cambia en un sitio. Con el estado repartido por el
 * componente, cualquier arreglo —un reintento, un modo, una posición— tenía que
 * tocar un archivo de mil líneas, y buscar dónde estaba el estado era la parte
 * difícil.
 *
 * Lo que sale de aquí no cambia: los mismos nombres, los mismos valores y las
 * mismas reglas. Lo que cambia es dónde están. Las dos lecturas de la pantalla
 * —el stream y la ficha del título— viven en `useWatchLecturas`.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { PartyMedia } from '@nn-anime/core/party'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import {
  composeTitle,
  episodeLabel,
  useDocumentTitle,
  watchTitleParts,
} from '../../lib/document-title'
import { useNavigate, usePath } from '../../router'
import { type DetailNavState, navStateDeTarjeta } from '../detail/nav-state'
import { buildPartyMedia } from '../party/media'
import { type PartyHandle, useParty } from '../party/useParty'
import { SEGUNDOS_DEL_SIGUIENTE } from './controls'
import {
  almacenLocal,
  claveDeProgreso,
  guardarAutoplay,
  guardarProgreso,
  leerAutoplay,
  leerProgreso,
  olvidarProgreso,
  reanudarEn,
} from './storage'
import { type MpvHandoff, useMpvHandoff } from './useMpvHandoff'
import { useWatchEvents, type WatchEvents } from './useWatchEvents'
import {
  useWatchFuente,
  useWatchTitulo,
  type WatchFuente,
  type WatchFuenteHandle,
  type WatchTituloHandle,
} from './useWatchLecturas'
import { useWatchNeighbours, type WatchNeighbours, type WatchPosition } from './watch-neighbours'
import {
  animeRefFromPath,
  animeRefOf,
  numberFromPath,
  type PlayMode,
  seasonFromPath,
  startAtFromPath,
  type WatchPathOptions,
  watchPath,
} from './watch-route'

/** Cada cuánto se apunta por dónde va, como mucho. */
const GUARDADO_MS = 5000

/** Lo que la pantalla necesita saber del episodio que se ve. */
export interface WatchPageOptions {
  readonly providerId: string
  readonly ref: string
}

/**
 * Todo lo que la pantalla de reproducción sabe, en una sola pieza.
 *
 * Los nombres son los que tenía la pantalla, y los que tienen los otros hooks de
 * dominio del repositorio: lo que se puede hacer y lo que se puede leer.
 */
export interface WatchPageHandle {
  /** En qué punto está la pantalla: cargando, con fuente o con fallo. */
  readonly estado: WatchFuenteHandle['estado']
  /** El fallo, si lo hubo. */
  readonly error: WatchFuenteHandle['error']
  /** La fuente resuelta, si la hay. */
  readonly fuente: WatchFuente | undefined
  /** El modo de audio con el que se está viendo. */
  readonly modo: PlayMode
  readonly cambiarModo: (modo: PlayMode) => void
  /** El segundo por el que se está viendo. */
  readonly posicion: number
  /** Fija el segundo por el que se está viendo: lo que avisa el reproductor. */
  readonly setPosicion: (segundos: number) => void
  /**
   * La posición y la duración de ahora mismo, leídas en el momento.
   *
   * Se leen cuando pasa algo —una pausa— y no en el render: entre un aviso y
   * otro la posición se ha movido, y apuntar la de hace una vuelta perdería el
   * segundo en el que se pausó.
   */
  readonly posicionActual: () => { readonly positionS: number; readonly durationS: number }
  /** Si el episodio siguiente empieza solo. */
  readonly autoplay: boolean
  readonly cambiarAutoplay: (valor: boolean) => void
  /** Los vecinos del episodio, si ya se han pedido. */
  readonly vecinos: WatchNeighbours | undefined
  /** Dónde está el episodio, según lo que dijo el proveedor. */
  readonly posicionEpisodio: WatchPosition | undefined
  /** El nombre del título, si ya llegó. */
  readonly tituloAnime: WatchTituloHandle['tituloAnime']
  /** El formato del título: lo que decide si esto es una película. */
  readonly tipo: WatchTituloHandle['tipo']
  /** La portada del título, servida por el proxy. */
  readonly portada: WatchTituloHandle['portada']
  /** La referencia del título, deducida de la dirección o del episodio. */
  readonly animeValue: string
  readonly animeRef: { readonly providerId: string; readonly value: string }
  readonly episodeRef: { readonly providerId: string; readonly value: string }
  /** El número y la temporada que la dirección trae escritos, si los trae. */
  readonly numero: number | undefined
  readonly temporada: number | undefined
  /** El `<video>` montado, que es lo que la sala necesita para sincronizar. */
  readonly elementoVideo: HTMLVideoElement | null
  readonly setElementoVideo: (elemento: HTMLVideoElement | null) => void
  /** El panel de la sala, abierto o no. */
  readonly panelSala: boolean
  readonly setPanelSala: (abierto: boolean) => void
  /** El botón que abre el panel, para devolverle el foco al cerrarlo. */
  readonly botonSala: RefObject<HTMLButtonElement | null>
  readonly cerrarPanelSala: () => void
  /** La sala: la barra y el panel se montan en la pantalla. */
  readonly party: PartyHandle
  /** Lo que esta instancia está viendo, en la forma pequeña que viaja en la sala. */
  readonly mediaDeLaSala: PartyMedia | undefined
  /** El registro del visionado. */
  readonly visionado: WatchEvents
  /** El reproductor externo. */
  readonly mpv: MpvHandoff
  /** Pedir la fuente otra vez. */
  readonly recargar: () => void
  /** Pedir una fuente nueva saltándose la caché del servidor. */
  readonly renovarFuente: () => Promise<string | undefined>
  /** Apuntar por dónde va, sin apuntarlo en cada aviso. */
  readonly anotarProgreso: (positionS: number, durationS: number, forzar: boolean) => void
  /** El episodio llegó al final. */
  readonly alTerminar: () => void
  /** La cuenta atrás del episodio siguiente, si está corriendo. */
  readonly cuenta: number | undefined
  readonly cancelarCuenta: () => void
  /** A dónde va el episodio siguiente, si lo hay. */
  readonly rutaSiguiente: string | undefined
  /** Una película no tiene episodios: ni etiqueta, ni flechas, ni lista. */
  readonly esPelicula: boolean
  /** Cómo se llama el episodio que se está viendo. */
  readonly etiquetaEpisodio: string | undefined
  /** La línea del episodio, con el número una sola vez. */
  readonly lineaEpisodio: string | undefined
  /** El título propio del episodio, si lo trae y no repite la etiqueta. */
  readonly tituloUtil: string | undefined
  /** El nombre del título y el episodio, para lo que no es texto de interfaz. */
  readonly nombreCompleto: string
  /** El estado que la ficha puede recoger al volver. */
  readonly estadoFicha: DetailNavState | undefined
}

export function useWatchPage(options: WatchPageOptions): WatchPageHandle {
  const path = usePath()

  /**
   * El segundo por el que se empieza.
   *
   * Tres fuentes, por orden: lo que la dirección pide —la tarjeta de «continuar
   * viendo» lo escribe en el enlace—, lo que la pantalla apuntó la última vez que
   * se vio este episodio y, si no hay nada, el principio.
   *
   * Se lee en el arranque y no en un efecto: el reproductor monta con la fuente ya
   * resuelta y su posición de reanudación se decide una sola vez por fuente, así
   * que llegar tarde es llegar al segundo cero.
   */
  const [posicion, setPosicion] = useState(() => {
    const deLaDireccion = startAtFromPath(path)
    if (deLaDireccion !== undefined) return deLaDireccion

    return (
      reanudarEn(leerProgreso(almacenLocal(), claveDeProgreso(options.providerId, options.ref))) ??
      0
    )
  })

  /**
   * Lo último que se supo de la reproducción, en una referencia.
   *
   * El guardado final ocurre al desmontar, y ahí el cierre del efecto ve el estado
   * del primer render: la posición que hay que apuntar es la de ahora, no la del
   * principio.
   */
  const viva = useRef({ positionS: 0, durationS: 0, ultimoGuardado: 0 })

  /**
   * Si el siguiente episodio empieza solo.
   *
   * Lo guardado manda y el valor de fábrica es que sí: quien ve una serie espera
   * que siga. Se puede apagar desde los ajustes del reproductor.
   */
  const [autoplay, setAutoplay] = useState(() => leerAutoplay(almacenLocal()))
  const cambiarAutoplay = useCallback((valor: boolean) => {
    setAutoplay(valor)
    guardarAutoplay(almacenLocal(), valor)
  }, [])

  /**
   * El elemento de video y el panel de la sala.
   *
   * La sala necesita el `<video>` de verdad —posición, pausa y velocidad— y la
   * pantalla no tiene otra forma de llegar a él que la prop nueva del
   * reproductor. El panel se monta sólo cuando está abierto; al cerrarlo, el
   * foco vuelve a su botón, que es de esta pantalla.
   */
  const [elementoVideo, setElementoVideo] = useState<HTMLVideoElement | null>(null)
  const [panelSala, setPanelSala] = useState(false)
  const botonSala = useRef<HTMLButtonElement | null>(null)

  // El número que la dirección trae escrito. Es lo que decide si se piden dos
  // vecinos puntuales o la primera página; sin él no se deduce nada.
  const numero = numberFromPath(path)
  // La temporada, cuando la ficha la escribió. Sin ella, los vecinos buscan en la
  // lista entera y pueden caer en otra temporada.
  const temporada = seasonFromPath(path)

  // El título y el episodio son dos referencias distintas. La del episodio es la
  // de la dirección; la del título viene escrita en la consulta, puesta ahí por
  // quien construyó el enlace —la ficha, que la tiene en `Episode.animeRef`—.
  // Deducirla del episodio queda como último recurso para un enlace viejo o una
  // dirección escrita a mano, y con la convención equivocada escribía en la base
  // la ficha del episodio como si fuera un título.
  const animeValue = animeRefFromPath(path) ?? animeRefOf(options.ref)
  const animeRef = { providerId: options.providerId, value: animeValue }
  const episodeRef = { providerId: options.providerId, value: options.ref }

  const fuente = useWatchFuente({ providerId: options.providerId, ref: options.ref })
  const titulo = useWatchTitulo({ providerId: options.providerId, animeValue })

  const vecinos = useWatchNeighbours({
    providerId: options.providerId,
    titleRef: animeValue,
    episodeRef: options.ref,
    number: numero,
    season: temporada,
    estado: fuente.estado,
  })

  // El registro del visionado: alta al reproducir de verdad, avance cada 15 s y
  // al pausar, y la posición final al desmontar o cerrar la pestaña.
  const visionado = useWatchEvents({
    animeRef,
    episodeRef,
    mode: fuente.modo,
    startAtS: posicion,
  })
  // El reproductor externo: el botón y lo que contestó el servidor. Va aquí y no
  // dentro de `Player` porque es una forma de ver el episodio, no un control del
  // elemento de video.
  const mpv = useMpvHandoff({
    providerId: options.providerId,
    ref: options.ref,
    mode: fuente.modo,
    startAtS: posicion,
  })

  const posicionEpisodio = vecinos?.position

  /** Dónde se apunta el progreso de este episodio. */
  const claveProgreso = claveDeProgreso(options.providerId, options.ref)
  const navegar = useNavigate()

  /**
   * Apuntar por dónde va, sin apuntarlo en cada aviso.
   *
   * El elemento avisa cuatro veces por segundo: escribir el progreso con cada uno
   * serían cuatro escrituras por segundo en el almacén del navegador para un dato
   * que sólo hace falta cuando se vuelve. Se escribe cada cinco segundos, al
   * pausar y al salir, que es cuando de verdad importa.
   */
  const anotarProgreso = useCallback(
    (positionS: number, durationS: number, forzar: boolean) => {
      viva.current = { ...viva.current, positionS, durationS }

      const ahora = Date.now()
      if (!forzar && ahora - viva.current.ultimoGuardado < GUARDADO_MS) return

      viva.current = { ...viva.current, ultimoGuardado: ahora }
      guardarProgreso(almacenLocal(), claveProgreso, { positionS, durationS })
    },
    [claveProgreso],
  )

  // Al salir de la pantalla —o al cambiar de episodio— se apunta dónde se quedó:
  // es el momento en el que el dato sirve, y el último aviso puede ser de hace
  // cinco segundos.
  useEffect(() => {
    const referencia = viva

    return () => {
      const { positionS, durationS } = referencia.current
      if (durationS > 0) guardarProgreso(almacenLocal(), claveProgreso, { positionS, durationS })
    }
  }, [claveProgreso])

  /**
   * El episodio siguiente, cuando el actual termina.
   *
   * La tarjeta se ofrece con cuenta atrás y se puede parar: pasar solo al
   * siguiente es lo que se espera de una serie, pero sin preguntar sería quitarle
   * a alguien el mando. Y se puede apagar del todo desde los ajustes.
   */
  const [cuenta, setCuenta] = useState<number | undefined>(undefined)

  const opcionesDePaso: WatchPathOptions = { mode: fuente.modo, anime: animeValue }
  const siguiente = vecinos?.next
  const rutaSiguiente =
    siguiente === undefined
      ? undefined
      : watchPath(options.providerId, siguiente.ref.value, {
          ...opcionesDePaso,
          n: siguiente.number,
          ...(siguiente.season === undefined ? {} : { s: siguiente.season }),
        })

  const alTerminar = useCallback(() => {
    // El episodio está visto: lo apuntado a medias ya no sirve para reanudar.
    olvidarProgreso(almacenLocal(), claveProgreso)

    if (siguiente === undefined || !autoplay) return

    setCuenta(SEGUNDOS_DEL_SIGUIENTE)
  }, [autoplay, claveProgreso, siguiente])

  useEffect(() => {
    if (cuenta === undefined) return

    if (cuenta <= 0) {
      if (rutaSiguiente !== undefined) navegar.push(rutaSiguiente)

      return
    }

    const reloj = setTimeout(() => setCuenta((valor) => (valor ?? 1) - 1), 1000)

    return () => clearTimeout(reloj)
  }, [cuenta, rutaSiguiente, navegar])

  /**
   * El título propio del episodio, si lo trae.
   *
   * Hay proveedores cuyo nombre de episodio es otra vez el número —«Episodio 3»—,
   * así que repetirlo daría un «Episodio 3 de 12 · Episodio 3». Cuando el nombre ya
   * dice lo mismo que la etiqueta, no se pinta.
   */
  /** Una película no tiene episodios: ni etiqueta, ni flechas, ni lista. */
  const esPelicula = titulo.tipo === 'movie'

  const tituloEpisodio = posicionEpisodio?.title?.trim() ?? ''
  const tituloUtil =
    tituloEpisodio === '' ||
    tituloEpisodio ===
      t(DEFAULT_LOCALE, 'player.episode', { number: posicionEpisodio?.number ?? 0 })
      ? undefined
      : tituloEpisodio

  /**
   * Cómo se llama el episodio que se está viendo.
   *
   * El número sale de los vecinos: con `?n=` es el de la dirección, y sin él el
   * que traía la primera página. Si esa lectura falla, la pantalla sigue
   * reproduciendo y la etiqueta se queda sin número: el episodio es un adorno del
   * título, no al revés.
   */
  const etiquetaEpisodio = esPelicula
    ? undefined
    : episodeLabel(posicionEpisodio?.number, tituloUtil)

  /**
   * La línea del episodio, con el número una sola vez.
   *
   * Antes eran dos textos —«Episodio 3» encima y «Episodio 3 de 12» en medio de
   * las flechas— y el número se leía dos veces. Ahora es una línea: el episodio,
   * de cuántos es —si el proveedor lo dijo— y su título, si lo trae.
   */
  const lineaEpisodio = esPelicula
    ? t(DEFAULT_LOCALE, 'detail.movie')
    : posicionEpisodio === undefined
      ? etiquetaEpisodio
      : composeTitle([
          posicionEpisodio.total === undefined
            ? t(DEFAULT_LOCALE, 'player.episode', { number: posicionEpisodio.number })
            : t(DEFAULT_LOCALE, 'player.episodeOf', {
                number: posicionEpisodio.number,
                total: posicionEpisodio.total,
              }),
          tituloUtil,
        ])

  /**
   * Lo que esta instancia está viendo, en la forma pequeña que viaja en la sala.
   *
   * Se construye en cada render y no se memoriza: la duración llega tarde —el
   * `<video>` la sabe cuando carga los metadatos— y una copia guardada se
   * quedaría sin ella para siempre. Lo que se publica es la diferencia: la sala
   * sólo republica cuando esta forma cambia.
   */
  const mediaDeLaSala = buildPartyMedia({
    title: titulo.tituloAnime,
    kind: esPelicula ? 'movie' : 'episode',
    ...(esPelicula || posicionEpisodio === undefined ? {} : { episode: posicionEpisodio.number }),
    ...(esPelicula || temporada === undefined ? {} : { season: temporada }),
    ...(tituloUtil === undefined ? {} : { episodeTitle: tituloUtil }),
    ...(viva.current.durationS > 0 ? { durationS: viva.current.durationS } : {}),
  })

  const party = useParty({ video: elementoVideo, media: mediaDeLaSala })

  const cerrarPanelSala = useCallback(() => {
    setPanelSala(false)
    botonSala.current?.focus()
  }, [])

  // La pestaña y el encabezado dicen lo mismo: el nombre del título y por qué
  // episodio va. Es lo que distingue dos pestañas de la misma aplicación.
  useDocumentTitle(watchTitleParts(titulo.tituloAnime, etiquetaEpisodio))

  /*
    El regreso a la ficha puede adelantar lo que el reproductor ya sabe: el título
    del anime y, si llegó, su portada. Sin título —la petición del encabezado
    todavía no ha contestado— no hay estado, y la ficha espera al servidor como
    cuando se entra por una URL directa.
  */
  const estadoFicha =
    titulo.tituloAnime === undefined
      ? undefined
      : navStateDeTarjeta({
          title: titulo.tituloAnime,
          providerId: options.providerId,
          ref: animeValue,
          poster: titulo.portada,
        })

  /** El nombre del título y el episodio, para lo que no es texto de interfaz. */
  const nombreCompleto = composeTitle([titulo.tituloAnime, etiquetaEpisodio])

  return {
    estado: fuente.estado,
    error: fuente.error,
    fuente: fuente.fuente,
    modo: fuente.modo,
    cambiarModo: fuente.cambiarModo,
    posicion,
    setPosicion,
    posicionActual: () => ({
      positionS: viva.current.positionS,
      durationS: viva.current.durationS,
    }),
    autoplay,
    cambiarAutoplay,
    vecinos,
    posicionEpisodio,
    tituloAnime: titulo.tituloAnime,
    tipo: titulo.tipo,
    portada: titulo.portada,
    animeValue,
    animeRef,
    episodeRef,
    numero,
    temporada,
    elementoVideo,
    setElementoVideo,
    panelSala,
    setPanelSala,
    botonSala,
    cerrarPanelSala,
    party,
    mediaDeLaSala,
    visionado,
    mpv,
    recargar: fuente.recargar,
    renovarFuente: fuente.renovarFuente,
    anotarProgreso,
    alTerminar,
    cuenta,
    cancelarCuenta: () => setCuenta(undefined),
    rutaSiguiente,
    esPelicula,
    etiquetaEpisodio,
    lineaEpisodio,
    tituloUtil,
    nombreCompleto,
    estadoFicha,
  }
}
