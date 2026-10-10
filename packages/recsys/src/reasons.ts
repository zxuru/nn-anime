/**
 * Por qué se recomienda algo.
 *
 * Una recomendación sin razón es una orden. Y una razón **calculada aparte** de la
 * puntuación es peor: acaba diciendo «comparte acción contigo» de un título que
 * subió por una búsqueda. Por eso cada razón la produce la misma señal que sumó
 * puntos, y esta capa sólo las ordena y las escribe.
 *
 * El orden importa: se enseña la razón que más peso tuvo, no la primera que se
 * encuentre. Si alguien ve «está de moda» cuando en realidad lo que mandó fue su
 * búsqueda de ayer, la explicación miente aunque los números estén bien.
 */

import { type ReasonKey, t } from './i18n/es'

/** Lo que aportó cada señal a un candidato, en el mismo orden en que se sumó. */
export interface ReasonEvidence {
  /** Peso con el que contribuyó. Decide cuál se enseña. */
  readonly weight: number
  /** Con qué se justifica: el término, el género, el estudio, el título visto. */
  readonly value?: string | undefined
}

export interface Reason {
  readonly kind: string
  readonly text: string
  readonly evidence: ReasonEvidence
}

export interface ReasonCandidate {
  readonly kind: string
  readonly key: ReasonKey
  readonly evidence: ReasonEvidence
  readonly values: Readonly<Record<string, string | number>>
}

/**
 * Construye las razones de un candidato a partir de lo que aportó cada señal.
 *
 * Se descartan las de peso cero: una señal que no sumó nada no explica nada. Y se
 * ordenan de mayor a menor peso, que es el orden en que se enseñan.
 */
export function buildReasons(candidatas: readonly ReasonCandidate[]): readonly Reason[] {
  return candidatas
    .filter((candidata) => candidata.evidence.weight > 0)
    .sort((a, b) => b.evidence.weight - a.evidence.weight)
    .map((candidata) => ({
      kind: candidata.kind,
      text: t(candidata.key, candidata.values),
      evidence: candidata.evidence,
    }))
}

/**
 * La razón que se enseña: la de más peso.
 *
 * Si no hay ninguna, se devuelve la genérica **con texto**: una recomendación sin
 * explicación es lo que el spec prohíbe, y una razón con `text` vacío es peor que
 * no tener ninguna porque parece que la hay.
 */
export function mainReason(razones: readonly Reason[]): Reason {
  return (
    razones[0] ?? {
      kind: 'fallback',
      text: t('reason.fallback'),
      evidence: { weight: 0 },
    }
  )
}
