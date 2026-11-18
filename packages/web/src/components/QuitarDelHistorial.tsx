/**
 * El mando de quitar una tarjeta del historial.
 *
 * Lo usan las tres superficies que pintan la misma tarjeta —«continuar viendo»
 * de la home, el Historial y su vista previa del Perfil—, porque una acción que
 * sólo existiera en una de ellas dejaría dos verdades distintas de lo que se
 * puede quitar. El cuerpo es el mismo en las tres: confirmar con `Confirmacion`
 * y pedir la baja al servidor.
 *
 * **Vive fuera del enlace de la tarjeta**: `Pieza` pinta el cuerpo como un `<a>`,
 * y un botón dentro de un enlace no es un botón. Por eso el mando se ruega a la
 * pieza como un nodo aparte y no depende de `hover`: se alcanza con el tabulador
 * y se ve sin pasar el puntero.
 *
 * La baja es **por episodio**, no por la fila que se pintó: el servidor borra
 * todas las reproducciones de ese episodio y sólo las de ese. Si falla, la
 * tarjeta se queda y se dice; quitar de la pantalla lo que sigue en la base sería
 * una mentira que la relectura siguiente descubriría.
 */

import { watchEpisodePath } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ProviderRef } from '@rona/core/models'
import { Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { apiDelete } from '../api/client'
import { t } from '../i18n'
import { Confirmacion } from './Confirmacion'

/** La clave de un episodio en una lista: proveedor y referencia, sin el número. */
export function claveDeEpisodio(ref: ProviderRef): string {
  return `${ref.providerId}\u0000${ref.value}`
}

/**
 * Los episodios que esta superficie ha quitado ya.
 *
 * La tarjeta desaparece al confirmar, sin esperar a la relectura; el servidor ya
 * no la devuelve, así que el filtro sólo cubre el rato entre una cosa y la otra.
 * La clave es la referencia del episodio: el mismo episodio es la misma tarjeta
 * en la home y en el Historial aunque cada uno pinte su fila.
 */
export function useQuitadosDelHistorial(): {
  readonly quitados: ReadonlySet<string>
  readonly quitar: (ref: ProviderRef) => void
} {
  const [quitados, setQuitados] = useState<ReadonlySet<string>>(() => new Set())

  return {
    quitados,
    quitar: (ref) => {
      setQuitados((previos) => new Set(previos).add(claveDeEpisodio(ref)))
    },
  }
}

export interface QuitarDelHistorialProps {
  /** El título de la obra, para el nombre accesible y la confirmación. */
  readonly title: string
  /** El episodio ya escrito —«Episodio 3»—, no un número suelto. */
  readonly episode: string
  readonly episodeRef: ProviderRef
  /** Cuando el servidor ya borró: la superficie filtra la tarjeta. */
  readonly onQuitado: () => void
}

export function QuitarDelHistorial(props: QuitarDelHistorialProps): ReactNode {
  const [abierta, setAbierta] = useState(false)
  const [fallo, setFallo] = useState(false)

  const quitar = async (): Promise<void> => {
    setFallo(false)

    try {
      await apiDelete(watchEpisodePath(props.episodeRef))
      props.onQuitado()
    } catch {
      setFallo(true)
    }
  }

  return (
    <>
      <button
        type="button"
        className="pz__quitar"
        aria-label={t(DEFAULT_LOCALE, 'history.remove.aria', {
          title: props.title,
          episode: props.episode,
        })}
        title={t(DEFAULT_LOCALE, 'history.remove')}
        onClick={() => setAbierta(true)}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
      </button>

      {fallo ? (
        <p className="pz__quitar-fallo" role="alert">
          {t(DEFAULT_LOCALE, 'history.remove.error')}
        </p>
      ) : null}

      {abierta ? (
        <Confirmacion
          open
          titulo={t(DEFAULT_LOCALE, 'history.remove.title')}
          cuerpo={t(DEFAULT_LOCALE, 'history.remove.body', {
            title: props.title,
            episode: props.episode,
          })}
          confirmar={t(DEFAULT_LOCALE, 'history.remove.confirm')}
          cancelar={t(DEFAULT_LOCALE, 'library.delete.cancel')}
          onCerrar={() => setAbierta(false)}
          onConfirmar={() => {
            void quitar()
          }}
        />
      ) : null}
    </>
  )
}
