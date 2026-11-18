/**
 * El estado de la encuesta, separado de su pintura.
 *
 * Los cinco pasos, sus respuestas y la conversión al contrato viven aquí para
 * poder probar el flujo —completar, omitir, reabrir— sin un navegador. El
 * componente sólo se ocupa de las tarjetas, el foco y la barra de progreso.
 *
 * La encuesta **reabre con lo que ya había**: `answersFromProfile` es la misma
 * función que usa el primer arranque, con un perfil vacío, y la que precarga el
 * botón «Ajustar mis gustos». Una sola forma de responder evita que la segunda
 * vez se pierda un paso que la primera sí guardaba.
 */

import type {
  TasteAudio,
  TasteCatalog,
  TasteFormat,
  TasteProfile,
  TasteSurveyRequest,
  TasteSurveyStatus,
  TasteTone,
} from '@rona/core/taste'

export interface SurveyTitle {
  readonly providerId: string
  readonly ref: string
  readonly title: string
}

/** Lo que el usuario ha marcado, paso a paso. */
export interface SurveyAnswers {
  readonly genres: readonly string[]
  readonly excludedGenres: readonly string[]
  readonly titles: readonly SurveyTitle[]
  readonly format: TasteFormat | null
  readonly tone: TasteTone | null
  readonly audio: TasteAudio | null
  readonly catalog: TasteCatalog | null
}

export type SurveyStepId = 'genres' | 'titles' | 'format' | 'tone' | 'extras'

/** Los cinco pasos, en el orden en que se piden. */
export const SURVEY_STEPS: readonly {
  readonly id: SurveyStepId
  readonly title: string
  readonly hint: string
}[] = [
  { id: 'genres', title: 'taste.step.genres.title', hint: 'taste.step.genres.hint' },
  { id: 'titles', title: 'taste.step.titles.title', hint: 'taste.step.titles.hint' },
  { id: 'format', title: 'taste.step.format.title', hint: 'taste.step.format.hint' },
  { id: 'tone', title: 'taste.step.tone.title', hint: 'taste.step.tone.hint' },
  { id: 'extras', title: 'taste.step.extras.title', hint: 'taste.step.extras.hint' },
]

/** El estado de partida de una encuesta que no se ha contestado. */
export const EMPTY_ANSWERS: SurveyAnswers = {
  genres: [],
  excludedGenres: [],
  titles: [],
  format: null,
  tone: null,
  audio: null,
  catalog: null,
}

/** Las respuestas guardadas, listas para volver a pintar la encuesta. */
export function answersFromProfile(profile: TasteProfile | undefined): SurveyAnswers {
  if (profile === undefined) return EMPTY_ANSWERS

  return {
    genres: profile.genres.filter((genre) => genre.weight > 0).map((genre) => genre.name),
    excludedGenres: profile.excludedGenres.map((genre) => genre.name),
    titles: profile.titles.map(({ providerId, ref, title }) => ({ providerId, ref, title })),
    format: profile.format?.value ?? null,
    tone: profile.tone?.value ?? null,
    audio: profile.audio?.value ?? null,
    catalog: profile.catalog?.value ?? null,
  }
}

/** Añade o quita un elemento, conservando el orden en que se marcó. */
export function toggleInList(lista: readonly string[], valor: string): readonly string[] {
  return lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor]
}

/**
 * Elige una opción o la quita si ya estaba.
 *
 * Volver a pulsar la tarjeta elegida la desmarca: todos los pasos son opcionales
 * y no hay ningún botón de «ninguno» que ocupe una tarjeta entera.
 */
export function toggleSingle<T>(actual: T | null, valor: T): T | null {
  return actual === valor ? null : valor
}

/** Un título marcado o desmarcado, con su forma mínima. */
export function toggleTitle(
  titles: readonly SurveyTitle[],
  title: SurveyTitle,
): readonly SurveyTitle[] {
  const clave = `${title.providerId}#${title.ref}`
  const existe = titles.some((item) => `${item.providerId}#${item.ref}` === clave)

  return existe
    ? titles.filter((item) => `${item.providerId}#${item.ref}` !== clave)
    : [...titles, title]
}

/** Si un título está marcado. */
export function isTitleSelected(titles: readonly SurveyTitle[], title: SurveyTitle): boolean {
  return titles.some((item) => item.providerId === title.providerId && item.ref === title.ref)
}

/**
 * El contrato que se manda al servidor.
 *
 * `status` decide si la encuesta cuenta como completada o como omitida: el
 * servidor no adivina, porque una encuesta con todo vacío puede ser las dos
 * cosas y la diferencia cambia el estado que se enseña luego.
 */
export function toSurveyRequest(
  answers: SurveyAnswers,
  status: Extract<TasteSurveyStatus, 'completed' | 'skipped'>,
): TasteSurveyRequest {
  return {
    status,
    genres: [...answers.genres],
    excludedGenres: [...answers.excludedGenres],
    titles: answers.titles.map((title) => ({
      providerId: title.providerId,
      ref: title.ref,
      title: title.title,
      relation: 'liked',
    })),
    format: answers.format,
    tone: answers.tone,
    audio: answers.audio,
    catalog: answers.catalog,
  }
}

/** El porcentaje de la barra, con el paso actual base 0. */
export function surveyProgress(step: number, total: number = SURVEY_STEPS.length): number {
  if (total <= 0) return 0

  const actual = Math.min(Math.max(step, 0), total - 1)

  return Math.round(((actual + 1) / total) * 100)
}

/** Si se puede pasar al paso siguiente, o al anterior. */
export function canGoBack(step: number): boolean {
  return step > 0
}

/** El paso siguiente, sin pasarse del último. */
export function nextStep(step: number, total: number = SURVEY_STEPS.length): number {
  return Math.min(step + 1, Math.max(0, total - 1))
}

/** El paso anterior, sin bajar del primero. */
export function previousStep(step: number): number {
  return Math.max(step - 1, 0)
}

/** Los géneros que ya no se pueden marcar como preferidos. */
export function genresNotExcluded(
  genres: readonly string[],
  excluded: readonly string[],
): readonly string[] {
  return genres.filter((genre) => !excluded.includes(genre))
}
