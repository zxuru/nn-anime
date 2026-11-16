/**
 * El panel de la sala: crear, unirse y lo que se ve con la sala abierta.
 *
 * Es un `<dialog>` nativo, como el resto de superficies del proyecto: el
 * navegador trae el `Esc`, el fondo inerte y el foco al abrir, y ahí importa
 * porque adentro hay campos de texto. El padre lo monta sólo cuando está
 * abierto; al cerrar, el foco vuelve al botón que lo abrió, que es de quien lo
 * monta.
 *
 * Todo el texto sale de `i18n/es.ts`. Los datos que se enseñan —código, título,
 * nombres del roster— son datos, no interfaz, y se pintan como texto plano.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { PartyParticipant } from '@nn-anime/core/party'
import { formatRoomCode, PARTY_MAX_NAME_LENGTH } from '@nn-anime/core/party'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { syncLabel } from './PartyBar'
import type { PartyHandle } from './useParty'

const LOCALE = DEFAULT_LOCALE

/** La etiqueta del estado de un participante. */
function rosterLabel(participant: PartyParticipant): string {
  if (participant.buffering) return t(LOCALE, 'party.roster.buffering')
  if (participant.ready) return t(LOCALE, 'party.roster.ready')

  return t(LOCALE, 'party.roster.waiting')
}

type Copia = 'si' | 'no' | undefined

export interface PartyPanelProps {
  readonly party: PartyHandle
  /** Si esta instancia sabe qué episodio está viendo, puede abrir sala. */
  readonly canHost: boolean
  /** Con qué pestaña se abre. Por defecto, la de crear. */
  readonly initialTab?: 'crear' | 'unirse' | undefined
  readonly onClose: () => void
}

export function PartyPanel(props: PartyPanelProps): ReactNode {
  const { party } = props
  const dialogo = useRef<HTMLDialogElement | null>(null)
  const [pestana, setPestana] = useState<'crear' | 'unirse'>(props.initialTab ?? 'crear')
  const [direccion, setDireccion] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [copia, setCopia] = useState<Copia>(undefined)

  // El diálogo se abre con su API y no con el atributo `open`: `showModal` es lo
  // que trae el fondo inerte y el `Esc`. El componente se monta ya abierto, así
  // que el efecto corre una sola vez.
  useEffect(() => {
    const elemento = dialogo.current
    if (elemento !== null && !elemento.open) elemento.showModal()
  }, [])

  const enVuelo = party.connection === 'connecting'
  const activa = party.phase !== 'idle'
  const esAnfitrion = party.phase === 'host'
  const codigoDeLaSala = party.room?.code ?? ''

  const copiar = (texto: string): void => {
    const portapapeles = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (portapapeles === undefined) {
      setCopia('no')

      return
    }

    void portapapeles.writeText(texto).then(
      () => setCopia('si'),
      () => setCopia('no'),
    )
  }

  const unirse = (): void => {
    setPestana('unirse')
    void party.joinRoom({ baseUrl: direccion, code: codigo, name: nombre })
  }

  return (
    <dialog
      className="party-panel"
      ref={dialogo}
      aria-label={t(LOCALE, 'party.panel.title')}
      onClose={props.onClose}
    >
      <div className="party-panel__head">
        <h2 className="party-panel__title">{t(LOCALE, 'party.panel.title')}</h2>
        <button type="button" className="button party-panel__close" onClick={props.onClose}>
          {t(LOCALE, 'party.panel.close')}
        </button>
      </div>

      {party.error === undefined ? null : (
        <p className="party-panel__error" role="alert">
          {t(LOCALE, party.error)}
        </p>
      )}

      {activa ? (
        <div className="party-panel__room">
          <div className="party-panel__code-block">
            <span className="party-panel__label">{t(LOCALE, 'party.panel.roomCode')}</span>
            <p className="party-panel__code">{formatRoomCode(codigoDeLaSala)}</p>
            <button
              type="button"
              className="button party-panel__copy"
              aria-label={t(LOCALE, 'party.panel.copyCode')}
              onClick={() => copiar(codigoDeLaSala)}
            >
              {t(LOCALE, 'party.panel.copy')}
            </button>
            {copia === undefined ? null : (
              <p className="party-panel__hint">
                {t(LOCALE, copia === 'si' ? 'party.panel.copied' : 'party.panel.copyFailed')}
              </p>
            )}
          </div>

          <p className="party-panel__privacy">{t(LOCALE, 'party.panel.privacy')}</p>

          {party.phase !== 'guest' ? null : (
            <p className="party-panel__sync">
              <span className="party-panel__pill" data-sync={party.sync}>
                {syncLabel(party.sync)}
              </span>
              <span className="party-panel__hint">
                {t(LOCALE, 'party.bar.drift', { seconds: party.driftS.toFixed(1) })}
              </span>
            </p>
          )}

          {esAnfitrion ? (
            <div className="party-panel__urls">
              <p className="party-panel__label">{t(LOCALE, 'party.panel.addresses')}</p>
              {party.room === undefined || party.room.urls.length === 0 ? (
                <p className="party-panel__hint">{t(LOCALE, 'party.panel.noUrls')}</p>
              ) : (
                <ul className="party-panel__url-list">
                  {party.room.urls.map((url) => (
                    <li className="party-panel__url" key={url}>
                      <code className="party-panel__url-text">{url}</code>
                      <button
                        type="button"
                        className="button party-panel__copy"
                        aria-label={t(LOCALE, 'party.panel.copyUrl', { url })}
                        onClick={() => copiar(url)}
                      >
                        {t(LOCALE, 'party.panel.copy')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className="party-panel__roster">
            <p className="party-panel__label">{t(LOCALE, 'party.panel.roster')}</p>
            <ul className="party-panel__roster-list">
              {party.roster.map((participante) => (
                <li className="party-panel__roster-item" key={participante.id}>
                  <span className="party-panel__roster-name">{participante.name}</span>
                  <span
                    className="party-panel__badge"
                    data-state={
                      participante.buffering
                        ? 'buffering'
                        : participante.ready
                          ? 'ready'
                          : 'waiting'
                    }
                  >
                    {rosterLabel(participante)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="party-panel__actions">
            {esAnfitrion ? (
              <button
                type="button"
                className="button button--destructivo"
                onClick={() => void party.closeRoom()}
              >
                {t(LOCALE, 'party.panel.closeRoom')}
              </button>
            ) : (
              <button
                type="button"
                className="button button--destructivo"
                onClick={() => void party.leave()}
              >
                {t(LOCALE, 'party.panel.leave')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="party-panel__idle">
          <div className="party-panel__tabs">
            <button
              type="button"
              className="button party-panel__tab"
              aria-pressed={pestana === 'crear'}
              onClick={() => setPestana('crear')}
            >
              {t(LOCALE, 'party.panel.tab.host')}
            </button>
            <button
              type="button"
              className="button party-panel__tab"
              aria-pressed={pestana === 'unirse'}
              onClick={() => setPestana('unirse')}
            >
              {t(LOCALE, 'party.panel.tab.guest')}
            </button>
          </div>

          {pestana === 'crear' ? (
            <div className="party-panel__section">
              <p className="party-panel__lead">{t(LOCALE, 'party.panel.hostIntro')}</p>
              <p className="party-panel__warning">{t(LOCALE, 'party.panel.hostWarning')}</p>
              <p className="party-panel__privacy">{t(LOCALE, 'party.panel.privacy')}</p>
              {props.canHost ? null : (
                <p className="party-panel__hint">{t(LOCALE, 'party.panel.noMedia')}</p>
              )}
              <button
                type="button"
                className="button button--primary party-panel__submit"
                disabled={!props.canHost || enVuelo}
                onClick={() => void party.createRoom()}
              >
                {t(LOCALE, enVuelo ? 'party.panel.creating' : 'party.panel.create')}
              </button>
            </div>
          ) : (
            <form
              className="party-panel__section"
              onSubmit={(evento) => {
                evento.preventDefault()
                unirse()
              }}
            >
              <p className="party-panel__lead">{t(LOCALE, 'party.panel.joinIntro')}</p>
              <label className="party-panel__field">
                <span className="party-panel__label">{t(LOCALE, 'party.panel.address')}</span>
                <input
                  className="party-panel__input"
                  value={direccion}
                  onChange={(evento) => setDireccion(evento.target.value)}
                  placeholder={t(LOCALE, 'party.panel.addressHint')}
                  autoComplete="off"
                  inputMode="url"
                  required
                />
              </label>
              <label className="party-panel__field">
                <span className="party-panel__label">{t(LOCALE, 'party.panel.code')}</span>
                <input
                  className="party-panel__input"
                  value={codigo}
                  onChange={(evento) => setCodigo(evento.target.value)}
                  placeholder={t(LOCALE, 'party.panel.codeHint')}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="party-panel__field">
                <span className="party-panel__label">{t(LOCALE, 'party.panel.name')}</span>
                <input
                  className="party-panel__input"
                  value={nombre}
                  onChange={(evento) => setNombre(evento.target.value)}
                  placeholder={t(LOCALE, 'party.panel.nameHint')}
                  autoComplete="off"
                  maxLength={PARTY_MAX_NAME_LENGTH}
                  required
                />
              </label>
              <button
                type="submit"
                className="button button--primary party-panel__submit"
                disabled={enVuelo}
              >
                {t(LOCALE, enVuelo ? 'party.panel.joining' : 'party.panel.join')}
              </button>
            </form>
          )}
        </div>
      )}
    </dialog>
  )
}
