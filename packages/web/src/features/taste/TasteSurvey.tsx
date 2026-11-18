/**
 * La encuesta, en cinco pasos.
 *
 * **Omitir está siempre a la vista.** La encuesta es opcional de verdad: no hay
 * un paso que haya que atravesar para llegar al botón de salir. Lo mismo vale
 * para «Atrás»: volver a corregir un paso no pierde lo marcado.
 *
 * Las tarjetas son `<button aria-pressed>` o `<input>` de verdad, no `div` con
 * `onClick`: así el teclado las recorre, el lector de pantalla anuncia si están
 * elegidas y el foco se ve. El estado nunca depende sólo del color —cada tarjeta
 * marcada lleva su check y su texto—.
 *
 * El foco viaja al titular del paso al avanzar, para que quien navega con
 * teclado no vuelva a recorrer los mandos de la cabecera en cada paso.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { AnimeSummary } from '@rona/core/models'
import type {
  TasteAudio,
  TasteCatalog,
  TasteFormat,
  TasteProfile,
  TasteSurveyRequest,
  TasteTone,
} from '@rona/core/taste'
import {
  Ban,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  Heart,
  Languages,
  Moon,
  Sparkles,
  Sun,
  Tv,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { safeUrl } from '../../lib/safe-url'
import {
  answersFromProfile,
  canGoBack,
  EMPTY_ANSWERS,
  isTitleSelected,
  nextStep,
  previousStep,
  SURVEY_STEPS,
  type SurveyAnswers,
  type SurveyTitle,
  surveyProgress,
  toggleInList,
  toggleSingle,
  toggleTitle,
  toSurveyRequest,
} from './model'

/**
 * Los géneros que ofrece la encuesta.
 *
 * Es una lista de arranque, no el catálogo: el paso 2 y las filas del inicio sí
 * salen del catálogo real. Si el perfil guardado tiene un género que no está
 * aquí, se añade al final para que reabrir la encuesta no lo pierda.
 */
export const SURVEY_GENRES = [
  'Acción',
  'Aventura',
  'Comedia',
  'Drama',
  'Fantasía',
  'Ciencia ficción',
  'Misterio',
  'Romance',
  'Terror',
  'Recuentos de la vida',
  'Deportes',
  'Mecha',
  'Psicológico',
  'Sobrenatural',
  'Música',
  'Suspense',
] as const

export interface TasteSurveyProps {
  readonly profile: TasteProfile
  readonly titles?: readonly AnimeSummary[]
  readonly titlesLoading?: boolean
  /** Recibe el contrato ya compuesto; el servidor pone pesos y fechas. */
  readonly onSave: (request: TasteSurveyRequest) => Promise<unknown>
  /** Vuelve a la pantalla de la que se vino. */
  readonly onDone: () => void
  readonly onSkip?: ((request: TasteSurveyRequest) => Promise<unknown>) | undefined
  /**
   * En qué paso se abre. Es una ayuda de prueba y de enlace profundo; sin ella,
   * la encuesta empieza por el principio, que es lo normal.
   */
  readonly initialStep?: number | undefined
}

/** La lista de géneros que se pinta, con los extra del perfil al final. */
export function genresFor(profile: TasteProfile): readonly string[] {
  const base: string[] = [...SURVEY_GENRES]

  for (const genre of [...profile.genres, ...profile.excludedGenres]) {
    if (!base.includes(genre.name)) base.push(genre.name)
  }

  return base
}

/** Un icono y una descripción por tarjeta: el texto no es el único significado. */
const FORMATS: readonly {
  readonly value: TasteFormat
  readonly label: string
  readonly hint: string
  readonly icon: typeof Tv
}[] = [
  {
    value: 'long-series',
    label: 'taste.format.long',
    hint: 'taste.format.long.hint',
    icon: Tv,
  },
  {
    value: 'short-series',
    label: 'taste.format.short',
    hint: 'taste.format.short.hint',
    icon: Clapperboard,
  },
  {
    value: 'movies',
    label: 'taste.format.movies',
    hint: 'taste.format.movies.hint',
    icon: Film,
  },
]

const TONES: readonly {
  readonly value: TasteTone
  readonly label: string
  readonly hint: string
  readonly icon: typeof Moon
}[] = [
  { value: 'dark', label: 'taste.tone.dark', hint: 'taste.tone.dark.hint', icon: Moon },
  { value: 'light', label: 'taste.tone.light', hint: 'taste.tone.light.hint', icon: Sun },
  {
    value: 'emotional',
    label: 'taste.tone.emotional',
    hint: 'taste.tone.emotional.hint',
    icon: Heart,
  },
]

const AUDIO: readonly { readonly value: TasteAudio; readonly label: string }[] = [
  { value: 'sub', label: 'taste.audio.sub' },
  { value: 'dub', label: 'taste.audio.dub' },
  { value: 'either', label: 'taste.audio.either' },
]

const CATALOG: readonly { readonly value: TasteCatalog; readonly label: string }[] = [
  { value: 'airing', label: 'taste.catalog.airing' },
  { value: 'classic', label: 'taste.catalog.classic' },
  { value: 'either', label: 'taste.catalog.either' },
]

/** Una tarjeta de una sola elección. */
function TarjetaUnica<T>(props: {
  readonly value: T
  readonly actual: T | null
  readonly label: string
  readonly hint?: string | undefined
  readonly icon?: typeof Tv | undefined
  readonly onSelect: (value: T) => void
}): ReactNode {
  const elegida = props.actual === props.value
  const Icono = props.icon

  return (
    <button
      type="button"
      className="gusto-card"
      aria-pressed={elegida}
      onClick={() => props.onSelect(props.value)}
    >
      <span className="gusto-card__marca" aria-hidden="true">
        {elegida ? <Check size={18} strokeWidth={3} /> : null}
      </span>
      {Icono === undefined ? null : (
        <Icono className="gusto-card__icono" size={28} strokeWidth={1.7} aria-hidden="true" />
      )}
      <span className="gusto-card__titulo">{t(DEFAULT_LOCALE, props.label)}</span>
      {props.hint === undefined ? null : (
        <span className="gusto-card__pista">{t(DEFAULT_LOCALE, props.hint)}</span>
      )}
    </button>
  )
}

/** Una tarjeta de género: el cuerpo elige «me gusta» y la esquina «no quiero». */
function TarjetaGenero(props: {
  readonly name: string
  readonly liked: boolean
  readonly excluded: boolean
  readonly onToggle: () => void
  readonly onExclude: () => void
}): ReactNode {
  return (
    <div
      className="gusto-genero"
      data-estado={props.excluded ? 'excluded' : props.liked ? 'liked' : 'none'}
    >
      <button
        type="button"
        className="gusto-genero__cuerpo"
        aria-pressed={props.liked}
        onClick={props.onToggle}
      >
        <span className="gusto-genero__nombre">{props.name}</span>
        <span className="gusto-genero__estado">
          {props.excluded
            ? t(DEFAULT_LOCALE, 'taste.genres.excludedTag')
            : props.liked
              ? t(DEFAULT_LOCALE, 'taste.genres.likedTag')
              : t(DEFAULT_LOCALE, 'taste.genres.noneTag')}
        </span>
      </button>
      <button
        type="button"
        className="gusto-genero__no"
        aria-pressed={props.excluded}
        aria-label={t(DEFAULT_LOCALE, 'taste.genres.excludeOne', { genre: props.name })}
        title={t(DEFAULT_LOCALE, 'taste.genres.excludeOne', { genre: props.name })}
        onClick={props.onExclude}
      >
        <Ban size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  )
}

/** Una tarjeta de título, con portada cuando la hay. */
function TarjetaTitulo(props: {
  readonly item: AnimeSummary
  readonly elegido: boolean
  readonly onToggle: () => void
}): ReactNode {
  const titulo: SurveyTitle = {
    providerId: props.item.ref.providerId,
    ref: props.item.ref.value,
    title: props.item.title,
  }
  // La portada la escribe un plugin: sólo se carga si su esquema está admitido.
  const portada = safeUrl(props.item.coverUrl)

  return (
    <button
      type="button"
      className="gusto-titulo"
      aria-pressed={props.elegido}
      aria-label={t(
        DEFAULT_LOCALE,
        props.elegido ? 'taste.titles.selectedOne' : 'taste.titles.selectOne',
        { title: titulo.title },
      )}
      onClick={props.onToggle}
    >
      <span className="gusto-titulo__portada">
        {portada === null ? (
          <span className="gusto-titulo__vacia" aria-hidden="true">
            <Sparkles size={24} strokeWidth={1.6} />
          </span>
        ) : (
          <img src={portada} alt="" loading="lazy" />
        )}
        <span className="gusto-titulo__marca" aria-hidden="true">
          {props.elegido ? <Check size={18} strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="gusto-titulo__nombre">{titulo.title}</span>
    </button>
  )
}

export function TasteSurvey(props: TasteSurveyProps): ReactNode {
  const [answers, setAnswers] = useState<SurveyAnswers>(() => answersFromProfile(props.profile))
  const [step, setStep] = useState(() =>
    Math.min(Math.max(props.initialStep ?? 0, 0), SURVEY_STEPS.length - 1),
  )
  const [saving, setSaving] = useState(false)
  const [fallo, setFallo] = useState(false)
  const cabecera = useRef<HTMLHeadingElement>(null)
  // El paso 0 siempre existe, pero `noUncheckedIndexedAccess` no lo sabe. El
  // respaldo es el mismo primer paso, no un paso inventado: si el índice se
  // saliera, la pantalla seguiría enseñando la pregunta de los géneros.
  const actual: (typeof SURVEY_STEPS)[number] = SURVEY_STEPS[step] ?? {
    id: 'genres',
    title: 'taste.step.genres.title',
    hint: 'taste.step.genres.hint',
  }
  const progreso = surveyProgress(step)

  // El titular no lee `step`, pero cambiar de paso es justo la señal de que hay
  // que devolverle el foco: sin la dependencia, el efecto sólo correría al
  // montar y el teclado se quedaría en el botón del paso anterior.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cambiar de paso devuelve el foco.
  useEffect(() => {
    cabecera.current?.focus()
  }, [step])

  const guardar = async (status: 'completed' | 'skipped'): Promise<void> => {
    if (saving) return

    setSaving(true)
    setFallo(false)

    try {
      const request = toSurveyRequest(answers, status)
      await (status === 'skipped' && props.onSkip !== undefined
        ? props.onSkip(request)
        : props.onSave(request))
      props.onDone()
    } catch {
      setFallo(true)
      setSaving(false)
    }
  }

  const cambiar = (patch: Partial<SurveyAnswers>): void => {
    setAnswers((previo) => ({ ...previo, ...patch }))
  }

  const alternarGenero = (name: string): void => {
    cambiar({
      genres: toggleInList(answers.genres, name),
      // Un género no puede ser «me gusta» y «no quiero verlo» a la vez: elegir
      // uno retira el otro. Dejar los dos puestos sería una contradicción que el
      // motor tendría que desempatar por su cuenta.
      excludedGenres: answers.excludedGenres.filter((genre) => genre !== name),
    })
  }

  const excluirGenero = (name: string): void => {
    cambiar({
      excludedGenres: toggleInList(answers.excludedGenres, name),
      genres: answers.genres.filter((genre) => genre !== name),
    })
  }

  return (
    <section className="gustos" aria-labelledby="gustos-titulo">
      <header className="gustos__cabecera">
        <p className="gustos__marca">{t(DEFAULT_LOCALE, 'taste.eyebrow')}</p>
        <h1 id="gustos-titulo" className="gustos__titulo">
          {t(DEFAULT_LOCALE, 'taste.title')}
        </h1>
        <p className="gustos__entrada">{t(DEFAULT_LOCALE, 'taste.lead')}</p>
      </header>

      <div className="gustos__progreso-caja">
        <p className="gustos__paso" role="status">
          {t(DEFAULT_LOCALE, 'taste.step', {
            current: step + 1,
            total: SURVEY_STEPS.length,
          })}
        </p>
        <div
          className="gustos__progreso"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progreso}
          aria-valuetext={t(DEFAULT_LOCALE, 'taste.progress', { percent: progreso })}
        >
          <span className="gustos__progreso-relleno" style={{ inlineSize: `${progreso}%` }} />
        </div>
      </div>

      <article className="gustos__panel" aria-labelledby="gustos-paso">
        <h2 id="gustos-paso" className="gustos__paso-titulo" ref={cabecera} tabIndex={-1}>
          {t(DEFAULT_LOCALE, actual.title)}
        </h2>
        <p className="gustos__pista">{t(DEFAULT_LOCALE, actual.hint)}</p>

        {actual.id === 'genres' ? (
          <div className="gustos__generos">
            {genresFor(props.profile).map((genre) => (
              <TarjetaGenero
                key={genre}
                name={genre}
                liked={answers.genres.includes(genre)}
                excluded={answers.excludedGenres.includes(genre)}
                onToggle={() => alternarGenero(genre)}
                onExclude={() => excluirGenero(genre)}
              />
            ))}
          </div>
        ) : null}

        {actual.id === 'titles' ? (
          props.titlesLoading === true ? (
            <p className="gustos__vacio" role="status">
              {t(DEFAULT_LOCALE, 'taste.titles.loading')}
            </p>
          ) : props.titles === undefined || props.titles.length === 0 ? (
            <p className="gustos__vacio">{t(DEFAULT_LOCALE, 'taste.titles.empty')}</p>
          ) : (
            <div className="gustos__titulos">
              {props.titles.map((item) => (
                <TarjetaTitulo
                  key={`${item.ref.providerId}#${item.ref.value}`}
                  item={item}
                  elegido={isTitleSelected(answers.titles, {
                    providerId: item.ref.providerId,
                    ref: item.ref.value,
                    title: item.title,
                  })}
                  onToggle={() =>
                    cambiar({
                      titles: toggleTitle(answers.titles, {
                        providerId: item.ref.providerId,
                        ref: item.ref.value,
                        title: item.title,
                      }),
                    })
                  }
                />
              ))}
            </div>
          )
        ) : null}

        {actual.id === 'format' ? (
          <div className="gustos__tarjetas">
            {FORMATS.map((opcion) => (
              <TarjetaUnica
                key={opcion.value}
                value={opcion.value}
                actual={answers.format}
                label={opcion.label}
                hint={opcion.hint}
                icon={opcion.icon}
                onSelect={(value) => cambiar({ format: toggleSingle(answers.format, value) })}
              />
            ))}
          </div>
        ) : null}

        {actual.id === 'tone' ? (
          <div className="gustos__tarjetas">
            {TONES.map((opcion) => (
              <TarjetaUnica
                key={opcion.value}
                value={opcion.value}
                actual={answers.tone}
                label={opcion.label}
                hint={opcion.hint}
                icon={opcion.icon}
                onSelect={(value) => cambiar({ tone: toggleSingle(answers.tone, value) })}
              />
            ))}
          </div>
        ) : null}

        {actual.id === 'extras' ? (
          <div className="gustos__extras">
            <fieldset className="gustos__grupo">
              <legend className="gustos__leyenda">
                <Languages size={18} strokeWidth={2} aria-hidden="true" />
                {t(DEFAULT_LOCALE, 'taste.extras.audio')}
              </legend>
              <div className="gustos__chips">
                {AUDIO.map((opcion) => (
                  <TarjetaUnica
                    key={opcion.value}
                    value={opcion.value}
                    actual={answers.audio}
                    label={opcion.label}
                    onSelect={(value) => cambiar({ audio: toggleSingle(answers.audio, value) })}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="gustos__grupo">
              <legend className="gustos__leyenda">
                <CalendarDays size={18} strokeWidth={2} aria-hidden="true" />
                {t(DEFAULT_LOCALE, 'taste.extras.catalog')}
              </legend>
              <div className="gustos__chips">
                {CATALOG.map((opcion) => (
                  <TarjetaUnica
                    key={opcion.value}
                    value={opcion.value}
                    actual={answers.catalog}
                    label={opcion.label}
                    onSelect={(value) => cambiar({ catalog: toggleSingle(answers.catalog, value) })}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {fallo ? (
          <p className="gustos__fallo" role="alert">
            {t(DEFAULT_LOCALE, 'taste.error')}
          </p>
        ) : null}

        <footer className="gustos__mandos">
          <div className="gustos__mandos-lado">
            {canGoBack(step) ? (
              <button
                type="button"
                className="button"
                onClick={() => setStep(previousStep(step))}
                disabled={saving}
              >
                <ChevronLeft size={16} strokeWidth={2.4} aria-hidden="true" />
                {t(DEFAULT_LOCALE, 'taste.back')}
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="button gusto__omitir"
            onClick={() => void guardar('skipped')}
            disabled={saving}
          >
            {t(DEFAULT_LOCALE, 'taste.skip')}
          </button>

          <div className="gustos__mandos-lado gustos__mandos-lado--final">
            {step === SURVEY_STEPS.length - 1 ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void guardar('completed')}
                disabled={saving}
              >
                {t(DEFAULT_LOCALE, saving ? 'taste.saving' : 'taste.finish')}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setStep(nextStep(step))}
                disabled={saving}
              >
                {t(DEFAULT_LOCALE, 'taste.next')}
                <ChevronRight size={16} strokeWidth={2.4} aria-hidden="true" />
              </button>
            )}
          </div>
        </footer>
      </article>
    </section>
  )
}

/** Lo que se ve mientras llega el perfil. */
export function TasteSkeleton(): ReactNode {
  return (
    <section className="gustos" aria-busy="true">
      <p className="solo-lectores" role="status">
        {t(DEFAULT_LOCALE, 'taste.loading')}
      </p>
      <header className="gustos__cabecera">
        <p className="gustos__marca">{t(DEFAULT_LOCALE, 'taste.eyebrow')}</p>
        <h1 className="gustos__titulo">{t(DEFAULT_LOCALE, 'taste.title')}</h1>
      </header>
      <div className="gustos__progreso" aria-hidden="true">
        <span className="gustos__progreso-relleno" style={{ inlineSize: '20%' }} />
      </div>
      <div className="gustos__panel">
        <p className="gustos__vacio">{t(DEFAULT_LOCALE, 'taste.loading')}</p>
      </div>
    </section>
  )
}

export { EMPTY_ANSWERS }
