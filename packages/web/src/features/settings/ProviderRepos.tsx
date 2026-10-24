/**
 * La sección de repositorios de proveedores.
 *
 * Es la pantalla donde se decide **qué código se ejecuta**. Por eso el flujo está
 * partido en dos gestos y no en uno: añadir un repositorio lo descarga y enseña
 * lo que trae —leer el texto no ejecuta nada—, y activar un proveedor es marcar
 * una casilla y guardar. Hasta que no se guarda una marca, el repositorio está en
 * el disco y no se ha importado ni un archivo suyo.
 *
 * Tres cosas que se ven en el código y son decisiones:
 *
 * 1. **El aviso de seguridad se repite aquí.** Está arriba de la página, y esto
 *    es donde se pulsa el botón que ejecuta: un aviso a un clic de distancia del
 *    gesto no es un aviso.
 * 2. **Sólo se puede marcar lo que el escáner reconoció.** La lista de casillas
 *    es la lista de candidatos; no hay campo para escribir una ruta. El servidor
 *    lo comprueba igualmente, pero la pantalla no ofrece lo que va a rechazar.
 * 3. **La selección se guarda a mano.** Marcar casillas que se guardan solas
 *    convierte un descuido en código ejecutándose; un botón que dice «Guardar
 *    selección» es la diferencia entre mirar y decidir.
 *
 * Los datos llegan por props y no de un hook propio: el que sabe qué repositorios
 * hay es `useProviderRepos`, y separarlos es lo que permite probar esta pantalla
 * —lo que enseña y lo que ofrece— sin montar la red.
 */

import type { ProviderRepoCandidate, ProviderRepoView } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { RECOMMENDED_PROVIDER_REPO } from '@nn-anime/core/repos'
import { type ReactNode, useState } from 'react'
import { describirFallo } from '../../api/fallo'
import { resumenDeFallo } from '../../components/ErrorNotice'
import { t } from '../../i18n'
import type { ProviderReposData } from './useProviderRepos'

/** La etiqueta de un candidato: su nombre, o su `id`, o la ruta. */
export function candidateLabel(candidate: ProviderRepoCandidate): string {
  return candidate.name ?? candidate.id ?? candidate.path
}

/**
 * Marca o desmarca una ruta.
 *
 * Se ordena al final para que dos selecciones iguales sean la misma lista: la
 * comparación con lo guardado —«¿hay cambios que guardar?»— se hace sobre esta
 * lista, y sin ordenar, marcar y desmarcar la misma casilla parecería un cambio.
 */
export function toggled(
  enabled: readonly string[],
  path: string,
  marked: boolean,
): readonly string[] {
  const resto = enabled.filter((it) => it !== path)

  return marked ? [...resto, path].sort() : resto
}

/** En qué estado está un repositorio, para poder decirlo con una frase. */
export function repoState(repo: ProviderRepoView): 'missing' | 'empty' | 'ok' {
  if (!repo.present) return 'missing'

  return repo.candidates.length === 0 ? 'empty' : 'ok'
}

/** La selección de un repositorio: lo que se está editando o lo guardado. */
export function selectionOf(
  repo: ProviderRepoView,
  draft: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  return draft[repo.url] ?? repo.enabled
}

/** ¿La selección editada es distinta de la guardada? */
export function changed(enabled: readonly string[], seleccion: readonly string[]): boolean {
  return seleccion.length !== enabled.length || seleccion.some((path) => !enabled.includes(path))
}

/** El mensaje de un fallo: primero lo que dijo el servidor. */
function messageOf(cause: unknown): string {
  const fallo = describirFallo(cause)

  return fallo.detalle ?? resumenDeFallo(fallo)
}

/** Un candidato: su casilla, su etiqueta y su ruta cuando no son lo mismo. */
function CandidateRow(props: {
  readonly repo: ProviderRepoView
  readonly candidate: ProviderRepoCandidate
  readonly marked: boolean
  readonly onToggle: (path: string, marked: boolean) => void
}): ReactNode {
  const etiqueta = candidateLabel(props.candidate)
  const id = `repo-${props.repo.url}-${props.candidate.path}`

  return (
    <label className="field field--check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={props.marked}
        aria-label={t(DEFAULT_LOCALE, 'settings.repos.candidate', { path: props.candidate.path })}
        onChange={(event) => props.onToggle(props.candidate.path, event.target.checked)}
      />
      <span>{etiqueta}</span>
      {etiqueta === props.candidate.path ? null : (
        <span className="card__meta">{props.candidate.path}</span>
      )}
    </label>
  )
}

export function ProviderRepos(props: ProviderReposData): ReactNode {
  /*
    La dirección que se enseña no es un `useState` con el recomendado de valor
    inicial: el hook de repositorios monta en `loading`, así que el estado nacería
    vacío y no se volvería a inicializar. Se deriva de lo que el servidor dijo.
    `editado` manda en cuanto el usuario toca el campo, y limpiarlo deja el campo
    vacío en vez de resucitar la recomendación.
  */
  const [editado, setEditado] = useState<string | undefined>(undefined)
  const sinRepos = props.state === 'ready' && props.repos.length === 0
  const valor = editado ?? (sinRepos ? RECOMMENDED_PROVIDER_REPO : '')
  const [draft, setDraft] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [ocupado, setOcupado] = useState<string>('')
  const [aviso, setAviso] = useState<string>('')

  function toggle(repo: ProviderRepoView, path: string, marked: boolean): void {
    const actual = selectionOf(repo, draft)
    setDraft((previo) => ({ ...previo, [repo.url]: toggled(actual, path, marked) }))
  }

  /** Quita del borrador la selección de un repositorio: ya no hay nada que editar. */
  function olvidar(clave: string): void {
    setDraft((previo) => {
      const copia = { ...previo }
      delete copia[clave]

      return copia
    })
  }

  function intentar(etiqueta: string, work: () => Promise<void>): void {
    setOcupado(etiqueta)
    setAviso('')

    void work().then(
      () => {
        setOcupado('')
      },
      (cause: unknown) => {
        setOcupado('')
        setAviso(messageOf(cause))
      },
    )
  }

  function onInstall(event: { preventDefault: () => void }): void {
    event.preventDefault()
    const destino = valor.trim()
    if (destino === '') return

    intentar('install', async () => {
      await props.install(destino)
      setEditado('')
      setAviso(t(DEFAULT_LOCALE, 'settings.repos.installed'))
    })
  }

  return (
    <section>
      <h2>{t(DEFAULT_LOCALE, 'settings.repos')}</h2>
      <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.repos.body')}</p>
      <p className="search__error">{t(DEFAULT_LOCALE, 'settings.repos.warning')}</p>

      <form className="settings__form" onSubmit={onInstall}>
        <div className="field">
          <label className="field__label" htmlFor="repo-url">
            {t(DEFAULT_LOCALE, 'settings.repos.url')}
          </label>
          <input
            className="field__input"
            id="repo-url"
            type="text"
            value={valor}
            onChange={(event) => setEditado(event.target.value)}
          />
          <span className="field__hint">{t(DEFAULT_LOCALE, 'settings.repos.urlHint')}</span>
          {sinRepos ? (
            <span className="field__hint">
              {t(DEFAULT_LOCALE, 'settings.repos.recommended', {
                url: RECOMMENDED_PROVIDER_REPO,
              })}
            </span>
          ) : null}
        </div>
        <div className="settings__actions">
          <button className="button button--primary" type="submit" disabled={ocupado !== ''}>
            {ocupado === 'install'
              ? t(DEFAULT_LOCALE, 'settings.repos.installing')
              : t(DEFAULT_LOCALE, 'settings.repos.install')}
          </button>
        </div>
      </form>

      {props.state === 'loading' ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'settings.repos.loading')}</p>
      ) : null}

      {props.state === 'error' ? (
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'settings.repos.failed', {
            message:
              props.error === undefined ? '' : (props.error.detalle ?? resumenDeFallo(props.error)),
          })}
        </p>
      ) : null}

      {props.state === 'ready' && props.repos.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'settings.repos.empty')}</p>
      ) : null}

      {props.repos.map((repo) => {
        const seleccion = selectionOf(repo, draft)
        const estado = repoState(repo)
        const cambiado = changed(repo.enabled, seleccion)

        return (
          <section key={repo.url} className="settings__group">
            <h3 className="field__label">{repo.url}</h3>
            <p className="card__meta">
              {t(DEFAULT_LOCALE, 'settings.repos.ref', { ref: repo.ref })} ·{' '}
              {t(DEFAULT_LOCALE, 'settings.repos.files', { files: repo.files })} ·{' '}
              {t(DEFAULT_LOCALE, 'settings.repos.selected', {
                selected: seleccion.length,
                total: repo.candidates.length,
              })}
            </p>

            {estado === 'missing' ? (
              <p className="search__error">{t(DEFAULT_LOCALE, 'settings.repos.missing')}</p>
            ) : null}
            {estado === 'empty' ? (
              <p className="search__error">{t(DEFAULT_LOCALE, 'settings.repos.none')}</p>
            ) : null}
            {estado === 'ok' ? (
              <>
                <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.repos.detected')}</p>
                <div className="settings__checks">
                  {repo.candidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.path}
                      repo={repo}
                      candidate={candidate}
                      marked={seleccion.includes(candidate.path)}
                      onToggle={(path, marked) => toggle(repo, path, marked)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            <div className="settings__actions">
              <button
                type="button"
                className="button"
                disabled={!cambiado || ocupado !== ''}
                title={cambiado ? undefined : t(DEFAULT_LOCALE, 'settings.repos.unchanged')}
                onClick={() => {
                  intentar(repo.url, async () => {
                    await props.select(repo.url, seleccion)
                    olvidar(repo.url)
                    setAviso(t(DEFAULT_LOCALE, 'settings.repos.saved', { count: seleccion.length }))
                  })
                }}
              >
                {ocupado === repo.url
                  ? t(DEFAULT_LOCALE, 'settings.repos.saving')
                  : t(DEFAULT_LOCALE, 'settings.repos.save')}
              </button>

              <button
                type="button"
                className="settings__link"
                disabled={ocupado !== ''}
                onClick={() => {
                  intentar(repo.url, async () => {
                    await props.install(repo.url)
                  })
                }}
              >
                {t(DEFAULT_LOCALE, 'settings.repos.update')}
              </button>

              <button
                type="button"
                className="settings__link"
                disabled={ocupado !== ''}
                onClick={() => {
                  const pregunta = t(DEFAULT_LOCALE, 'settings.repos.removeConfirm', {
                    repo: repo.url,
                  })
                  if (!confirm(pregunta)) return

                  intentar(repo.url, async () => {
                    await props.remove(repo.url)
                    olvidar(repo.url)
                  })
                }}
              >
                {t(DEFAULT_LOCALE, 'settings.repos.remove')}
              </button>
            </div>
          </section>
        )
      })}

      {/* `aria-live` porque el resultado es lo único que confirma que se guardó. */}
      <p
        className={aviso === '' ? 'field__hint' : 'search__error'}
        role="status"
        aria-live="polite"
      >
        {aviso}
      </p>
    </section>
  )
}
