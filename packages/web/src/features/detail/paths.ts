/**
 * Las rutas de la ficha que no son episodios.
 *
 * Viven aquí y no en `useDetail` porque las usan los dos lados: el cargador de la
 * ficha —que ahora vive en `load-detail.ts`, para que la precarga y la pantalla
 * pidan exactamente lo mismo— y el reproductor, que pide las fuentes de un
 * título. Con dos copias, la primera que cambie deja a la otra pidiendo una ruta
 * que ya no existe.
 */

/** La ruta de los hermanos, con su alcance. */
export function relatedPath(
  providerId: string,
  ref: string,
  scope: 'saga' | 'franchise' = 'saga',
): string {
  const base = `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/related`

  return scope === 'saga' ? base : `${base}?scope=${scope}`
}

/** La ruta de las otras fuentes de la misma obra. */
export function sourcesPath(providerId: string, ref: string): string {
  return `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/sources`
}

/** La ruta de lo que AniList relaciona con esta obra. */
export function anilistRelatedPath(providerId: string, ref: string): string {
  return `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/anilist-related`
}
