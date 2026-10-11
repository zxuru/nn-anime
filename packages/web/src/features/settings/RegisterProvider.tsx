/**
 * El alta de un proveedor desde Ajustes.
 *
 * Escribe tres datos y guarda: el servidor genera el plugin, lo carga y lo deja
 * activo sin reiniciar. Lo que no hace, y es lo importante, es **ejecutar lo que
 * se teclea**: el cuerpo que sale de aquí es una descripción de endpoints, y el
 * código lo escribe el servidor. Ver `provider-template.ts`.
 *
 * El aviso de seguridad de la página sigue estando arriba porque esto no lo
 * sustituye: un plugin que se copia a mano sigue corriendo sin sandbox. Lo que
 * cambia es que este camino no deja escribir código, así que el aviso no hace
 * falta repetirlo aquí con las mismas palabras.
 */

import type { ProviderSummary } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type ReactNode, useState } from 'react'
import { describirFallo } from '../../api/fallo'
import { resumenDeFallo } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import {
  type CapabilityKey,
  EMPTY_FORM,
  type EndpointKey,
  type FieldKey,
  type ProviderForm,
  toProviderDraft,
} from './draft'

/** Lo que el alta puede pedirle a la página: guardar y quedarse con el resultado. */
export type Register = (draft: unknown) => Promise<ProviderSummary>

export interface RegisterProviderProps {
  readonly register: Register
}

type Status = 'idle' | 'saving' | 'ok' | 'error'

const TEXT_FIELDS = [
  { key: 'id', label: 'settings.register.id', hint: 'settings.register.idHint' },
  { key: 'name', label: 'settings.register.name', hint: undefined },
  { key: 'baseUrl', label: 'settings.register.baseUrl', hint: undefined },
] as const

const ENDPOINT_FIELDS = [
  { key: 'search', label: 'settings.register.endpoint.search' },
  { key: 'anime', label: 'settings.register.endpoint.anime' },
  { key: 'episodes', label: 'settings.register.endpoint.episodes' },
  { key: 'stream', label: 'settings.register.endpoint.stream' },
  { key: 'trending', label: 'settings.register.endpoint.trending' },
] as const

const FIELD_FIELDS = [
  { key: 'searchItems', label: 'settings.register.field.searchItems' },
  { key: 'searchId', label: 'settings.register.field.searchId' },
  { key: 'searchTitle', label: 'settings.register.field.searchTitle' },
  { key: 'animeTitle', label: 'settings.register.field.animeTitle' },
  { key: 'animeGenres', label: 'settings.register.field.animeGenres' },
  { key: 'animeStudios', label: 'settings.register.field.animeStudios' },
  { key: 'episodeItems', label: 'settings.register.field.episodeItems' },
  { key: 'episodeNumber', label: 'settings.register.field.episodeNumber' },
  { key: 'episodeTitle', label: 'settings.register.field.episodeTitle' },
  { key: 'streamUrl', label: 'settings.register.field.streamUrl' },
] as const

const CAPABILITY_FIELDS = [
  { key: 'sub', label: 'settings.register.cap.sub' },
  { key: 'dub', label: 'settings.register.cap.dub' },
] as const

/**
 * Lo que se enseña cuando el intento no salió.
 *
 * Manda lo que contó el servidor —«ya hay un proveedor con ese identificador»—,
 * que es lo único que dice qué corregir del formulario. Cuando no lo hay, se usa
 * el resumen de la clase del fallo y no el mensaje crudo: aquí no cabe un aviso
 * entero, pero «sin conexión con el servidor» sí cabe y dice más que el
 * «Failed to fetch» del navegador.
 */
function messageOf(cause: unknown): string {
  const fallo = describirFallo(cause)

  return fallo.detalle ?? resumenDeFallo(fallo)
}

interface TextFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onValue: (value: string) => void
  readonly hint?: string | undefined
  readonly required?: boolean | undefined
}

function TextField(props: TextFieldProps): ReactNode {
  return (
    <div className="field">
      <label className="field__label" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        className="field__input"
        id={props.id}
        type="text"
        value={props.value}
        required={props.required ?? false}
        onChange={(event) => props.onValue(event.target.value)}
      />
      {props.hint === undefined ? null : <span className="field__hint">{props.hint}</span>}
    </div>
  )
}

export function RegisterProvider(props: RegisterProviderProps): ReactNode {
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  function setText(key: 'id' | 'name' | 'baseUrl', value: string): void {
    setForm((actual) => ({ ...actual, [key]: value }))
  }

  function setEndpoint(key: EndpointKey, value: string): void {
    setForm((actual) => ({ ...actual, endpoints: { ...actual.endpoints, [key]: value } }))
  }

  function setField(key: FieldKey, value: string): void {
    setForm((actual) => ({ ...actual, fields: { ...actual.fields, [key]: value } }))
  }

  function setCapability(key: CapabilityKey, value: boolean): void {
    setForm((actual) => ({ ...actual, capabilities: { ...actual.capabilities, [key]: value } }))
  }

  function onSubmit(event: { preventDefault: () => void }): void {
    event.preventDefault()
    setStatus('saving')
    setMessage('')

    void props.register(toProviderDraft(form)).then(
      (provider) => {
        setStatus('ok')
        setMessage(t(DEFAULT_LOCALE, 'settings.register.ok', { name: provider.name }))
        // Se limpia sólo lo que identifica al proveedor: el identificador ya está
        // ocupado, así que dejarlo puesto invitaría a repetir el intento y a
        // llevarse un 409. Las rutas se quedan, que es lo que se acaba de ajustar.
        setForm((actual) => ({ ...actual, id: '', name: '' }))
      },
      (cause: unknown) => {
        setStatus('error')
        setMessage(t(DEFAULT_LOCALE, 'settings.register.failed', { message: messageOf(cause) }))
      },
    )
  }

  return (
    <form className="settings__form" onSubmit={onSubmit}>
      <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.register.body')}</p>

      <fieldset className="settings__group">
        <legend className="field__label">{t(DEFAULT_LOCALE, 'settings.register.identity')}</legend>
        <div className="settings__grid">
          {TEXT_FIELDS.map((entry) => (
            <TextField
              key={entry.key}
              id={`provider-${entry.key}`}
              label={t(DEFAULT_LOCALE, entry.label)}
              hint={entry.hint === undefined ? undefined : t(DEFAULT_LOCALE, entry.hint)}
              required
              value={form[entry.key]}
              onValue={(value) => setText(entry.key, value)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="settings__group">
        <legend className="field__label">{t(DEFAULT_LOCALE, 'settings.register.endpoints')}</legend>
        <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.register.endpointsHint')}</p>
        <div className="settings__grid">
          {ENDPOINT_FIELDS.map((entry) => (
            <TextField
              key={entry.key}
              id={`provider-endpoint-${entry.key}`}
              label={t(DEFAULT_LOCALE, entry.label)}
              value={form.endpoints[entry.key]}
              onValue={(value) => setEndpoint(entry.key, value)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="settings__group">
        <legend className="field__label">
          {t(DEFAULT_LOCALE, 'settings.register.capabilities')}
        </legend>
        <div className="settings__checks">
          {CAPABILITY_FIELDS.map((entry) => (
            <label
              className="field field--check"
              key={entry.key}
              htmlFor={`provider-cap-${entry.key}`}
            >
              <input
                id={`provider-cap-${entry.key}`}
                type="checkbox"
                checked={form.capabilities[entry.key]}
                onChange={(event) => setCapability(entry.key, event.target.checked)}
              />
              <span>{t(DEFAULT_LOCALE, entry.label)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <details className="settings__advanced">
        <summary>{t(DEFAULT_LOCALE, 'settings.register.advanced')}</summary>
        <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.register.advancedHint')}</p>
        <div className="settings__grid">
          {FIELD_FIELDS.map((entry) => (
            <TextField
              key={entry.key}
              id={`provider-field-${entry.key}`}
              label={t(DEFAULT_LOCALE, entry.label)}
              value={form.fields[entry.key]}
              onValue={(value) => setField(entry.key, value)}
            />
          ))}
        </div>
      </details>

      <div className="settings__actions">
        <button className="button button--primary" type="submit" disabled={status === 'saving'}>
          {status === 'saving'
            ? t(DEFAULT_LOCALE, 'settings.register.saving')
            : t(DEFAULT_LOCALE, 'settings.register.submit')}
        </button>
      </div>

      {/* `aria-live` porque el resultado es lo único que confirma que se guardó:
          sin esto, quien use un lector de pantalla pulsa y no oye nada. */}
      <p
        className={status === 'error' ? 'search__error' : 'field__hint'}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
    </form>
  )
}
