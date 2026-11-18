/**
 * El perfil de gustos y la encuesta de arranque en frío.
 *
 * RoNa es de un solo usuario local, así que el perfil lleva `userId` para que el
 * modelo no mienta: hoy siempre vale `local`, pero el día que haya más de uno la
 * forma ya está. La encuesta es **opcional**: sus respuestas son señales
 * declaradas y el motor las mezcla con lo que el usuario ve de verdad.
 *
 * Cada señal guarda **de dónde salió** (`survey` o `behavior`) y **cuándo se
 * actualizó**. Sin eso no se puede explicar una recomendación ni decidir qué
 * peso tiene lo declarado frente a lo observado.
 */

import { z } from 'zod'
import { animeSummarySchema } from './schema'

/** El único usuario que existe hoy. El día que haya cuentas, esto será su id. */
export const LOCAL_TASTE_USER = 'local'

/** De dónde salió una señal del perfil. */
export const TASTE_SIGNAL_SOURCES = ['survey', 'behavior'] as const
export const tasteSourceSchema = z.enum(TASTE_SIGNAL_SOURCES)
export type TasteSource = z.infer<typeof tasteSourceSchema>

/** Una marca de tiempo ISO-8601, como el resto de fechas que cruzan la API. */
const stampSchema = z.string().min(1)

/** Un género que al usuario le gusta, con su peso. */
export const tasteGenreSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  weight: z.number().min(0).max(1),
  source: tasteSourceSchema,
  updatedAt: stampSchema,
})
export type TasteGenre = z.infer<typeof tasteGenreSchema>

/** Un género que no quiere ver. Excluye, no sólo resta. */
export const tasteExcludedGenreSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  source: tasteSourceSchema,
  updatedAt: stampSchema,
})
export type TasteExcludedGenre = z.infer<typeof tasteExcludedGenreSchema>

/** Si un título marcado en la encuesta es favorito o «ya visto y me gustó». */
export const tasteTitleRelationSchema = z.enum(['liked', 'watched'])
export type TasteTitleRelation = z.infer<typeof tasteTitleRelationSchema>

/**
 * Un título que el usuario marcó en la encuesta.
 *
 * Es la señal más fuerte: permite recomendar por similitud aunque el usuario no
 * haya visto nada todavía. `providerId` + `ref` identifican la obra; `title` está
 * para que el perfil se pueda leer a ojo y para poder explicar la recomendación
 * sin resolver la ficha.
 */
export const tasteTitleSchema = z.strictObject({
  providerId: z.string().min(1),
  ref: z.string().min(1),
  title: z.string().min(1),
  relation: tasteTitleRelationSchema,
  source: tasteSourceSchema,
  updatedAt: stampSchema,
})
export type TasteTitle = z.infer<typeof tasteTitleSchema>

/** El formato que prefiere: series largas, temporadas cortas o películas. */
export const tasteFormatSchema = z.enum(['long-series', 'short-series', 'movies'])
export type TasteFormat = z.infer<typeof tasteFormatSchema>

/** El tono que busca. */
export const tasteToneSchema = z.enum(['dark', 'light', 'emotional'])
export type TasteTone = z.infer<typeof tasteToneSchema>

/** El idioma: subtitulado, doblado o le da igual. */
export const tasteAudioSchema = z.enum(['sub', 'dub', 'either'])
export type TasteAudio = z.infer<typeof tasteAudioSchema>

/** Qué catálogo prefiere: emisión actual, clásicos o los dos. */
export const tasteCatalogSchema = z.enum(['airing', 'classic', 'either'])
export type TasteCatalog = z.infer<typeof tasteCatalogSchema>

/** Una preferencia cerrada, con su origen y su fecha. */
function preferencia<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value,
    source: tasteSourceSchema,
    updatedAt: stampSchema,
  })
}

export const tasteFormatPreferenceSchema = preferencia(tasteFormatSchema)
export const tasteTonePreferenceSchema = preferencia(tasteToneSchema)
export const tasteAudioPreferenceSchema = preferencia(tasteAudioSchema)
export const tasteCatalogPreferenceSchema = preferencia(tasteCatalogSchema)

export type TasteFormatPreference = z.infer<typeof tasteFormatPreferenceSchema>
export type TasteTonePreference = z.infer<typeof tasteTonePreferenceSchema>
export type TasteAudioPreference = z.infer<typeof tasteAudioPreferenceSchema>
export type TasteCatalogPreference = z.infer<typeof tasteCatalogPreferenceSchema>

/** En qué punto está la encuesta. */
export const tasteSurveyStatusSchema = z.enum(['not_started', 'skipped', 'completed'])
export type TasteSurveyStatus = z.infer<typeof tasteSurveyStatusSchema>

/**
 * El estado de la encuesta.
 *
 * `skips` cuenta las veces que se ha omitido **seguidas**. No se reinicia al
 * abrirla, sino al completarla: abrir y cerrar sin contestar también es una
 * omisión, y volver a insistir cada vez sería justo lo que el límite evita.
 */
export const tasteSurveyStateSchema = z.strictObject({
  status: tasteSurveyStatusSchema,
  skips: z.number().int().nonnegative(),
  updatedAt: stampSchema,
})
export type TasteSurveyState = z.infer<typeof tasteSurveyStateSchema>

/**
 * El perfil de gustos completo.
 *
 * Los campos cerrados son `null` cuando el usuario no contestó ese paso, que es
 * distinto de «contestó que le daba igual» (`either`). El motor trata los dos
 * casos de forma distinta: sin preferencia no ordena por formato; con `either`
 * premia las dos mitades y no penaliza ninguna.
 */
export const tasteProfileSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  genres: z.array(tasteGenreSchema).max(32),
  excludedGenres: z.array(tasteExcludedGenreSchema).max(32),
  titles: z.array(tasteTitleSchema).max(48),
  format: tasteFormatPreferenceSchema.nullable(),
  tone: tasteTonePreferenceSchema.nullable(),
  audio: tasteAudioPreferenceSchema.nullable(),
  catalog: tasteCatalogPreferenceSchema.nullable(),
  survey: tasteSurveyStateSchema,
  updatedAt: stampSchema,
})
export type TasteProfile = z.infer<typeof tasteProfileSchema>

/**
 * Las respuestas de un paso de la encuesta.
 *
 * Llega lo que el usuario marcó, no el perfil compuesto: el servidor es quien
 * decide pesos, origen y fecha. Así la interfaz no puede inventarse señales de
 * comportamiento ni mandar un peso distinto según el navegador.
 */
export const tasteSurveyRequestSchema = z.strictObject({
  /** Completar guarda; omitir guarda lo marcado y cuenta la omisión. */
  status: z.enum(['completed', 'skipped']).default('completed'),
  genres: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  excludedGenres: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  titles: z
    .array(
      z.strictObject({
        providerId: z.string().min(1),
        ref: z.string().min(1),
        title: z.string().min(1),
        relation: tasteTitleRelationSchema.default('liked'),
      }),
    )
    .max(24)
    .default([]),
  format: tasteFormatSchema.nullable().default(null),
  tone: tasteToneSchema.nullable().default(null),
  audio: tasteAudioSchema.nullable().default(null),
  catalog: tasteCatalogSchema.nullable().default(null),
})
export type TasteSurveyRequest = z.infer<typeof tasteSurveyRequestSchema>

/** Lo que devuelve leer o guardar el perfil. */
export const tasteResponseSchema = z.strictObject({
  profile: tasteProfileSchema,
  /** Cuántas omisiones seguidas se aguantan antes de dejar de insistir. */
  skipLimit: z.number().int().nonnegative(),
  /**
   * Si la primera apertura de la home debe llevar sola a la encuesta.
   *
   * El arnés de pruebas lo apaga para que ninguna prueba existente acabe en
   * `/gustos` sin pedirlo. En el uso normal vale `true`: es el equivalente local
   * a ofrecerla «justo después del registro», que aquí no existe.
   */
  autoOpen: z.boolean().default(true),
})
export type TasteResponse = z.infer<typeof tasteResponseSchema>

/**
 * Los títulos populares de la encuesta.
 *
 * Se sirven desde el catálogo que la aplicación ya conoce, sin pedir nada a un
 * proveedor: la encuesta no puede depender de que un tercero conteste justo
 * cuando el usuario acaba de entrar.
 */
export const tasteTitlesResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema).max(12),
})
export type TasteTitlesResponse = z.infer<typeof tasteTitlesResponseSchema>

/**
 * Una fila del inicio basada en un gusto declarado.
 *
 * El servidor manda el género y las piezas; la interfaz compone el titular con
 * su catálogo («Porque te gusta {genre}»). El texto no viaja desde el servidor
 * porque los textos de interfaz viven en `i18n`, no en la API.
 */
export const tasteRowSchema = z.strictObject({
  genre: z.string().min(1),
  items: z.array(animeSummarySchema),
})
export type TasteRow = z.infer<typeof tasteRowSchema>

export const tasteRowsResponseSchema = z.strictObject({
  rows: z.array(tasteRowSchema).max(3),
})
export type TasteRowsResponse = z.infer<typeof tasteRowsResponseSchema>

/**
 * Cuántas omisiones seguidas se aguantan por defecto.
 *
 * Tres es el mismo número que usa cualquier aviso de una aplicación: la primera
 * vez se ofrece, la segunda se recuerda y a la tercera se deja en paz. Se puede
 * cambiar con `RONA_TASTE_SKIP_LIMIT` sin tocar código.
 */
export const TASTE_SKIP_LIMIT_DEFAULT = 3

/** El límite configurado en el entorno, acotado a un rango sensato. */
export function tasteSkipLimitFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const texto = (env.RONA_TASTE_SKIP_LIMIT ?? '').trim()
  // `Number('')` es cero, y una variable sin poner no puede significar «no
  // insistas nunca»: el vacío es la ausencia de configuración, no un valor.
  if (texto === '') return TASTE_SKIP_LIMIT_DEFAULT

  const crudo = Number(texto)
  if (!Number.isInteger(crudo) || crudo < 0) return TASTE_SKIP_LIMIT_DEFAULT

  return Math.min(crudo, 20)
}

/**
 * Si la encuesta se abre sola en la primera home.
 *
 * Se puede apagar con `RONA_TASTE_AUTO_OPEN=0`; el e2e lo hace para que las
 * pruebas que ya existían no terminen en la encuesta. El banner sigue
 * funcionando aunque la abertura automática esté apagada: son dos cosas
 * distintas y apagar una no debe esconder la otra.
 */
export function tasteAutoOpenFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const crudo = (env.RONA_TASTE_AUTO_OPEN ?? '').trim().toLowerCase()

  return crudo !== '0' && crudo !== 'false' && crudo !== 'no'
}

/**
 * El nombre de un género, plegado para comparar.
 *
 * Misma regla que usa el catálogo: minúsculas, sin diacríticos y en NFC. El
 * mismo género puede llegar como «Acción», «accion» o «ACCIÓN», y para el motor
 * son el mismo.
 */
export function normalizeGenreName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
}

/** Un perfil vacío, con la encuesta sin empezar. */
export function emptyTasteProfile(
  userId: string = LOCAL_TASTE_USER,
  now: Date = new Date(),
): TasteProfile {
  const updatedAt = now.toISOString()

  return {
    userId,
    genres: [],
    excludedGenres: [],
    titles: [],
    format: null,
    tone: null,
    audio: null,
    catalog: null,
    survey: { status: 'not_started', skips: 0, updatedAt },
    updatedAt,
  }
}
