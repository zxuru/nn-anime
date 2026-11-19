/**
 * El botón de descargar de un episodio.
 *
 * No le pregunta nada a la fuente. Descargar no es un permiso que ella conceda:
 * lo hace la aplicación, que resuelve el mismo stream que la reproducción —un
 * archivo directo o un HLS— y lo baja a la carpeta de descargas. Por eso el botón
 * está siempre que hay episodio, declare lo que declare el plugin.
 *
 * **El audio se elige antes de descargar.** Una descarga no se puede cambiar de
 * modo después sin volver a bajarla entera, así que cuando la fuente declara las
 * dos capacidades el botón puede ofrecer el conmutador. En el reproductor no lo
 * ofrece: la pantalla ya tiene el suyo bajo el vídeo y dos selectores con el
 * mismo dato se contradicen en cuanto se toca uno. Ahí el botón hereda el modo
 * con `mode` y descarga exactamente lo que se está viendo. Si la fuente sólo
 * declara una capacidad —o si no se pudo leer el catálogo de proveedores— no se
 * pregunta: se manda la que hay, y el servidor resuelve con ella.
 *
 * Lo que falle se cuenta en el `title` del botón —el tooltip del navegador— y no
 * en un párrafo al lado: el botón vive anclado al encabezado del reproductor y un
 * texto de error ahí empujaba la sala, que se mide contra el alto de la ventana.
 * Para quien no ve el tooltip, el mismo texto va en un `solo-lectores`.
 */

import { downloadStartResponseSchema, providersResponseSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ProviderCapabilities, ProviderRef } from '@rona/core/models'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { apiGet, apiPostJson, type RequestDeps } from '../../api/client'
import { t } from '../../i18n'
import { AudioModeSwitch } from '../player/AudioModeSwitch'
import { PLAY_MODES, type PlayMode } from '../player/watch-route'

const LOCALE = DEFAULT_LOCALE

export interface DownloadButtonProps {
  readonly providerId: string
  readonly animeRef: ProviderRef
  readonly episodeRef: ProviderRef
  /**
   * El modo que manda la pantalla, cuando ya tiene uno.
   *
   * El reproductor resuelve un solo modo para todo lo que se ve —el del stream—
   * y la descarga no puede tener su propia copia: bajaría el contrario de lo que
   * suena. Con `mode` y sin `onMode`, el botón no pinta conmutador; el dueño del
   * dato lo pone fuera.
   */
  readonly mode?: PlayMode | undefined
  /**
   * Si el botón ofrece el conmutador, a quién avisa de la elección.
   *
   * Sin esto no hay selector: es lo que distingue un botón que pregunta de uno
   * que sólo descarga lo que le dicen.
   */
  readonly onMode?: ((mode: PlayMode) => void) | undefined
}

type Estado = 'listo' | 'guardando' | 'hecho' | 'error'

/**
 * Los modos que la fuente declara, en el orden en que se ofrecen.
 *
 * `sub` antes que `dub` porque es el modo por defecto de la aplicación y el que
 * tiene la fuente que no dobla. Una capacidad que no está —o un proveedor que ya
 * no existe— no inventa un modo: se devuelve la lista vacía y quien elige decide
 * el respaldo.
 *
 * Es la misma regla que `modesFor` de la ficha; se repite aquí para no arrastrar
 * el módulo de detalle —con su estado y sus lecturas— al botón del reproductor.
 */
export function modosDelProveedor(
  capabilities: ProviderCapabilities | undefined,
): readonly PlayMode[] {
  if (capabilities === undefined) return []

  return PLAY_MODES.filter((modo) => capabilities[modo])
}

/**
 * El modo que viaja en el alta.
 *
 * Manda lo que se eligió si sigue disponible; si no —o mientras la lectura de
 * proveedores no ha contestado— el primero que haya. Sin ninguno, `sub`, que es
 * lo que el servidor hacía por defecto antes de que se pudiera elegir.
 */
export function modoDeAudio(
  disponibles: readonly PlayMode[],
  preferido: PlayMode | undefined,
): PlayMode {
  if (preferido !== undefined && disponibles.includes(preferido)) return preferido

  return disponibles[0] ?? 'sub'
}

/** El cuerpo que el alta manda al servidor. Exportado para medirlo tal cual. */
export interface PeticionDeDescarga {
  readonly providerId: string
  readonly animeRef: ProviderRef
  readonly episodeRef: ProviderRef
  readonly mode: PlayMode
}

export function peticionDeDescarga(props: DownloadButtonProps, mode: PlayMode): PeticionDeDescarga {
  return {
    providerId: props.providerId,
    animeRef: props.animeRef,
    episodeRef: props.episodeRef,
    mode,
  }
}

/**
 * Pide la descarga con el modo elegido.
 *
 * Las dependencias se pueden pasar para probar el cuerpo sin red: lo que hay que
 * medir no es el `fetch` de la plataforma, sino que el `mode` salga en la
 * petición que de verdad se manda.
 */
export function pedirDescarga(
  props: DownloadButtonProps,
  mode: PlayMode,
  deps?: RequestDeps,
): Promise<{ readonly id: number }> {
  return apiPostJson(
    '/api/downloads',
    peticionDeDescarga(props, mode),
    downloadStartResponseSchema,
    {},
    deps,
  )
}

/**
 * Las capacidades de audio del proveedor, leídas una vez por botón.
 *
 * Es una lectura local de la base, no una llamada al plugin. Si falla se queda
 * en la lista vacía y el botón manda `sub`: no saber qué declara la fuente no
 * puede dejar sin descargar algo que antes se descargaba.
 */
export function useModosDelProveedor(providerId: string): readonly PlayMode[] {
  const [modos, setModos] = useState<readonly PlayMode[]>([])

  useEffect(() => {
    const controlador = new AbortController()
    setModos([])

    apiGet('/api/providers', providersResponseSchema, { signal: controlador.signal }).then(
      (respuesta) => {
        if (controlador.signal.aborted) return

        const proveedor = respuesta.providers.find((uno) => uno.id === providerId)
        setModos(modosDelProveedor(proveedor?.capabilities))
      },
      () => {
        // Sin lectura no hay pregunta: el respaldo lo pone `modoDeAudio`.
      },
    )

    return () => controlador.abort()
  }, [providerId])

  return modos
}

export interface BotonDeDescargaProps {
  readonly estado: Estado
  readonly mensaje?: string | undefined
  readonly onDescargar: () => void
  /** Las capacidades de la fuente. Con menos de dos no se pregunta nada. */
  readonly modes?: readonly PlayMode[] | undefined
  readonly mode?: PlayMode | undefined
  readonly onMode?: ((mode: PlayMode) => void) | undefined
}

/**
 * El botón sin estado ni red, para poder medirlo en cualquier estado.
 *
 * Un fallo no lo deshabilita: volver a pulsar es el reintento, y el motivo espera
 * en el tooltip. Sólo se cierra mientras guarda —para no pedir dos veces— y una
 * vez en cola, porque la descarga ya está apuntada.
 *
 * El conmutador es el mismo `AudioModeSwitch` y no una copia: son los mismos dos
 * botones con `aria-pressed`, y tener dos formas de decir «sub/dub» obligaría a
 * mantener el mismo texto y el mismo comportamiento en dos sitios. Sólo se pinta
 * cuando hay a quién avisar de la elección (`onMode`) y la fuente declara las
 * dos capacidades: con una sola, el botón no pregunta lo que no se puede elegir.
 */
export function BotonDeDescarga(props: BotonDeDescargaProps): ReactNode {
  const { mode, onMode, modes } = props
  const etiqueta =
    props.estado === 'hecho'
      ? t(LOCALE, 'downloads.queued')
      : props.estado === 'guardando'
        ? t(LOCALE, 'downloads.saving')
        : t(LOCALE, 'downloads.download')

  return (
    <div className="downloads__button">
      {mode !== undefined && onMode !== undefined && (modes?.length ?? 0) > 1 ? (
        <AudioModeSwitch mode={mode} onMode={onMode} />
      ) : null}
      <button
        type="button"
        className="button"
        title={props.mensaje}
        disabled={props.estado === 'guardando' || props.estado === 'hecho'}
        onClick={props.onDescargar}
      >
        {etiqueta}
      </button>
      {props.mensaje === undefined ? null : (
        <span className="solo-lectores" role="alert">
          {props.mensaje}
        </span>
      )}
    </div>
  )
}

export function DownloadButton(props: DownloadButtonProps): ReactNode {
  const [estado, setEstado] = useState<Estado>('listo')
  const [mensaje, setMensaje] = useState<string | undefined>()
  const [preferido, setPreferido] = useState<PlayMode | undefined>()
  const modos = useModosDelProveedor(props.providerId)
  /*
    El modo de la pantalla manda sobre la elección local. Si la pantalla lo fija
    pero no ofrece el conmutador —el caso del reproductor—, el botón no pinta uno
    segundo: sería otro mando para el mismo dato, y el que no se ve en el momento
    de pulsar «Descargar» es el que se queda con el valor viejo.
  */
  const modo = modoDeAudio(modos, props.mode ?? preferido)
  const onMode = props.onMode ?? (props.mode === undefined ? setPreferido : undefined)

  const descargar = async (): Promise<void> => {
    setEstado('guardando')
    setMensaje(undefined)
    try {
      await pedirDescarga(props, modo)
      // El clic es el gesto que el navegador exige para pedir el permiso; si ya
      // está decidido, no se vuelve a preguntar.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
      setEstado('hecho')
    } catch (cause) {
      setEstado('error')
      setMensaje(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <BotonDeDescarga
      estado={estado}
      {...(mensaje === undefined ? {} : { mensaje })}
      modes={modos}
      mode={modo}
      onMode={onMode}
      onDescargar={() => void descargar()}
    />
  )
}
