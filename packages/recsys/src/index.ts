/**
 * Superficie pública de `@nn-anime/recsys`.
 *
 * El motor de recomendación: afinidad, co-visita, señal de búsqueda, filtros,
 * diversidad y razones. La puerta es `recommend()`; lo demás se exporta para
 * poder probarlo y para quien necesite una señal suelta.
 */

export {
  type AffinityEvent,
  type AffinityOptions,
  type AffinityVector,
  affinityScore,
  buildAffinity,
  buildIdfIndex,
  candidateFeatures,
  candidateVector,
  cosine,
  decay,
  EMPTY_VECTOR,
  eventWeight,
  HALF_LIFE_DAYS,
  type IdfIndex,
  idf,
  idfOf,
  normalize,
  STUDIO_BONUS,
  sharedStudios,
  studioKey,
  tagKey,
  yearKey,
} from './affinity'
export {
  type CoVisit,
  type CoVisitIndex,
  type CoVisitOptions,
  coVisitScore,
  coVisits,
  indexBySeen,
  MIN_SUPPORT,
  SESSION_GAP_HOURS,
  sessions,
  type Visit,
  visitKey,
} from './covisit'
export {
  BARELY_STARTED_RATIO,
  FINISHED_RATIO,
  type FilterOptions,
  type FilterOutcome,
  type FilterReason,
  filterCandidate,
  filterCandidates,
  indexWatchState,
  REDISCOVERY_DAYS,
  type WatchState,
} from './filters'
export { es as reasonTexts, type ReasonKey, t as reasonText } from './i18n/es'
export {
  DEFAULT_LAMBDA,
  type MmrOptions,
  mmr,
  type RankedCandidate,
  similarity,
} from './mmr'
export {
  buildReasons,
  mainReason,
  type Reason,
  type ReasonCandidate,
  type ReasonEvidence,
} from './reasons'
export {
  type Components,
  MMR_PRESELECTION,
  type Recommendation,
  type RecommendOptions,
  type RecommendResult,
  type RecommendSignals,
  recommend,
  SIGNAL_WEIGHTS,
  type SignalWeights,
  tieBreak,
} from './recommend'
export {
  MAX_SEARCH_WEIGHT,
  matchScore,
  SEARCH_HALF_LIFE_DAYS,
  type SearchSignalOptions,
  type SearchSignalRecord,
  searchReason,
  searchScore,
  searchWeight,
  terms,
} from './search-signal'
