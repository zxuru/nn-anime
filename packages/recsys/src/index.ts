/**
 * Superficie pública de `@nn-anime/recsys`.
 *
 * El motor de recomendación: afinidad del usuario, co-visita, ranking y
 * sorpresa. Hoy expone la afinidad (T33); el resto llega en T34–T37.
 */

export {
  type AffinityEvent,
  type AffinityOptions,
  type AffinityVector,
  affinityScore,
  buildAffinity,
  candidateFeatures,
  candidateVector,
  cosine,
  decay,
  EMPTY_VECTOR,
  eventWeight,
  HALF_LIFE_DAYS,
  idf,
  normalize,
  STUDIO_BONUS,
  sharedStudios,
  studioKey,
  tagKey,
  yearKey,
} from './affinity'
