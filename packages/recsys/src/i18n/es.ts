/**
 * Textos de las razones, en español.
 *
 * Están en un catálogo y no incrustados en el código por la misma razón que los
 * de la interfaz: una frase que se escribe en dos sitios acaba diciendo dos cosas
 * distintas, y traducirla obliga a tocar la lógica.
 *
 * Cada clave lleva su hueco `{...}` y ninguna frase se construye concatenando:
 * concatenar es la forma de que una traducción acabe con el orden de palabras de
 * otro idioma.
 */

export const es = {
  'reason.matches-search': 'Coincide con «{term}», que buscaste hace poco.',
  'reason.same-genre': 'Comparte {genre} con lo que sueles ver.',
  'reason.same-studio': 'Es de {studio}, un estudio que ya te ha gustado.',
  'reason.covisit': 'Lo suele ver quien ve {seen}.',
  'reason.rediscovery': 'Lo dejaste a medias y ha pasado tiempo: puede que ahora encaje.',
  'reason.trending': 'Está de moda entre quienes usan este catálogo.',
  'reason.fallback': 'Encaja con lo que has visto hasta ahora.',
} as const

export type ReasonKey = keyof typeof es

/** Los textos, con sus huecos rellenos. */
export function t(key: ReasonKey, valores: Readonly<Record<string, string | number>> = {}): string {
  const plantilla: string = es[key]

  return plantilla.replace(/\{(\w+)\}/g, (_todo, nombre: string) => String(valores[nombre] ?? ''))
}
