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
  'reason.trending': 'Es de lo más visto de la fuente.',
  'reason.taste-genre': 'Porque te gusta {genre}, que elegiste en tus gustos.',
  'reason.taste-title': 'Se parece a «{title}», que marcaste como favorito.',
  'reason.taste-format': 'Encaja con el formato que prefieres.',
  'reason.taste-tone': 'Tiene el tono que elegiste en tu encuesta.',
  'reason.taste-catalog': 'Está en el catálogo que preferiste.',
  'reason.taste-audio': 'Está disponible en el idioma que preferiste.',
  'reason.fallback': 'Encaja con lo que has visto hasta ahora.',
} as const

export type ReasonKey = keyof typeof es

/** Los textos, con sus huecos rellenos. */
export function t(key: ReasonKey, valores: Readonly<Record<string, string | number>> = {}): string {
  const plantilla: string = es[key]

  return plantilla.replace(/\{(\w+)\}/g, (_todo, nombre: string) => String(valores[nombre] ?? ''))
}
