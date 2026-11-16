/**
 * La ayuda del teclado, en un diálogo y no siempre a la vista.
 *
 * Eran tres filas de teclas debajo del reproductor para algo que se mira una vez:
 * ahora se abre desde los ajustes o con `?`, el navegador se encarga del `Esc` y
 * del encierro del foco, y el contenido sigue siendo el mismo —cada tecla dibujada
 * como una tecla y su frase al lado—.
 *
 * El diálogo se abre y se cierra desde fuera con `showModal()`/`close()` sobre su
 * referencia: es lo que trae el fondo inerte, y por eso el componente no guarda el
 * estado de si está abierto.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode, RefObject } from 'react'
import { t } from '../../i18n'

/**
 * Los atajos que el reproductor escucha, con su tecla y lo que hace.
 *
 * Está en dos piezas —la tecla, que se dibuja como una tecla, y su frase— porque
 * antes era una sola línea de texto corrido y no se leía como lo que es: teclas
 * que se pueden pulsar.
 *
 * El orden es el que se aprende, no el del `switch` de `keyAction`: primero lo que
 * hace todo el mundo, y al final lo que se busca una vez.
 */
const ATAJOS: readonly { readonly teclas: readonly string[]; readonly hace: string }[] = [
  { teclas: ['player.key.space', 'player.key.enter', 'player.key.k'], hace: 'player.key.toggle' },
  { teclas: ['player.key.left', 'player.key.right'], hace: 'player.key.seek' },
  { teclas: ['player.key.up', 'player.key.down'], hace: 'player.key.volume' },
  { teclas: ['player.key.m'], hace: 'player.key.mute' },
  { teclas: ['player.key.f'], hace: 'player.key.fullscreen' },
  { teclas: ['player.key.t'], hace: 'player.key.extended' },
]

export interface PlayerShortcutsProps {
  readonly dialogRef: RefObject<HTMLDialogElement | null>
  /** El navegador cerró el diálogo —con `Esc`—: hay que apuntarlo fuera. */
  readonly onClose: () => void
}

export function PlayerShortcuts(props: PlayerShortcutsProps): ReactNode {
  return (
    <dialog
      className="player__dialog"
      ref={props.dialogRef}
      aria-label={t(DEFAULT_LOCALE, 'player.keys')}
      onClose={props.onClose}
    >
      <div className="player__keys">
        <p className="player__keys-title">{t(DEFAULT_LOCALE, 'player.keys')}</p>
        <ul className="player__keys-list">
          {ATAJOS.map((atajo) => (
            <li className="player__key" key={atajo.hace}>
              <span className="player__key-caps">
                {atajo.teclas.map((tecla) => (
                  <kbd className="player__key-cap" key={tecla}>
                    {t(DEFAULT_LOCALE, tecla)}
                  </kbd>
                ))}
              </span>
              <span className="player__key-does">{t(DEFAULT_LOCALE, atajo.hace)}</span>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" className="button player__dialog-close" onClick={props.onClose}>
        {t(DEFAULT_LOCALE, 'player.keys.close')}
      </button>
    </dialog>
  )
}
