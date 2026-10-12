/**
 * Generador del plugin que corresponde a un proveedor declarativo.
 *
 * El formulario de ajustes no manda código: manda una descripción —dirección
 * base, rutas y nombres de campo— y esta función la convierte en un archivo
 * TypeScript. Esa es toda la diferencia de seguridad del camino fácil: la
 * interfaz nunca ejecuta lo que le llega, ejecuta lo que este archivo escribe, y
 * lo que este archivo escribe está fijado aquí, no en la petición.
 *
 * Dos reglas que no son negociables y se ven en el texto generado:
 *
 * 1. **Sin imports en tiempo de ejecución.** Un plugin vive en el directorio de
 *    plugins del usuario —`~/.config/nn-anime/providers/` en Linux y macOS,
 *    `%APPDATA%\nn-anime\providers\` en Windows—, fuera del proyecto, así que
 *    `@nn-anime/provider-sdk` no se puede resolver desde ahí. Lo que se importa
 *    es sólo `import type`, que se borra al compilar: por eso el archivo
 *    funciona igual con Bun, con Node o copiado a otra máquina.
 * 2. **Todo lo que viene de fuera va citado.** Los textos se insertan con
 *    `JSON.stringify` y el nombre visible se limpia antes de entrar en un
 *    comentario: un salto de línea o la secuencia que cierra un comentario de
 *    bloque en el nombre cerrarían el bloque, y lo que viniera detrás sería
 *    código. El `id` no necesita esta cautela porque el schema ya lo limita a
 *    minúsculas, dígitos y guiones.
 */

import type { ProviderDraft } from '@nn-anime/core'

/** El nombre del archivo de un proveedor. La `id` ya es kebab-case. */
export function pluginFileName(id: string): string {
  return `${id}.ts`
}

/**
 * El nombre, reducido a algo que puede vivir dentro de un comentario de bloque.
 *
 * Se quitan los caracteres de control y la secuencia que cerraría el comentario.
 * No se escapa nada más: un nombre con acentos o comillas se lee tal cual, que es
 * lo que el usuario escribió.
 */
function commentSafe(name: string): string {
  return name.replace(/[\r\n\0]/g, ' ').replaceAll('*/', '* /')
}

function literals(draft: ProviderDraft): string {
  const endpoints: Record<string, string> = {
    search: draft.endpoints.search,
    anime: draft.endpoints.anime,
    episodes: draft.endpoints.episodes,
    stream: draft.endpoints.stream,
  }
  if (draft.endpoints.trending !== undefined) endpoints.trending = draft.endpoints.trending

  return [
    `const ID = ${JSON.stringify(draft.id)}`,
    `const NAME = ${JSON.stringify(draft.name)}`,
    `const BASE_URL = ${JSON.stringify(draft.baseUrl)}`,
    `const CAPABILITIES = ${JSON.stringify(draft.capabilities)}`,
    `const ENDPOINTS = ${JSON.stringify(endpoints, null, 2)}`,
    `const FIELDS = ${JSON.stringify(draft.fields, null, 2)}`,
  ].join('\n')
}

/**
 * El método de tendencias, sólo si el usuario declaró su ruta.
 *
 * Se genera siempre con la misma forma que la búsqueda: una lista de tendencias
 * es, para la interfaz, una lista de resultados.
 */
function trendingMethod(draft: ProviderDraft): string {
  if (draft.endpoints.trending === undefined) return ''

  return `
  async getTrending(options) {
    return resultsOf(await getJson(urlFor(ENDPOINTS.trending), options))
  },

`
}

/**
 * El archivo completo de un proveedor.
 *
 * Es determinista: la misma descripción produce el mismo texto. Eso es lo que
 * permite probar el generador con una comparación y lo que hace que el archivo
 * se pueda revisar como se revisa cualquier otro cambio.
 */
export function renderProviderModule(draft: ProviderDraft): string {
  return `/**
 * Proveedor «${commentSafe(draft.name)}» (${draft.id}).
 *
 * Generado desde la página de ajustes de nn-anime a partir de una descripción de
 * endpoints. Es código normal: se puede leer, copiar y editar. Si se edita a
 * mano, la aplicación no lo vuelve a generar sola.
 */

import type { CallOptions, Provider, SearchResult } from '@nn-anime/provider-sdk'

${literals(draft)}

/** El modo de las listas de episodios: el que el proveedor sabe servir. */
const EPISODE_MODE = CAPABILITIES.sub ? 'sub' : 'dub'

type Json = unknown

/** El valor que hay en una ruta con puntos; la cadena vacía es el valor mismo. */
function pick(value: Json, path: string): Json {
  if (path === '') return value

  let current: Json = value
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = Reflect.get(current, part)
  }

  return current
}

function asString(value: Json): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)

  return undefined
}

function asNumber(value: Json): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  return undefined
}

function asStrings(value: Json): readonly string[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const text = asString(item)

    return text === undefined ? [] : [text]
  })
}

function asItems(value: Json): readonly Json[] {
  return Array.isArray(value) ? value : []
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  let out = template
  for (const [key, value] of Object.entries(values)) {
    out = out.split('{' + key + '}').join(encodeURIComponent(value))
  }

  return out
}

function urlFor(template: string, values: Readonly<Record<string, string>> = {}): string {
  const path = fill(template, values)

  return new URL(path.startsWith('/') ? path : '/' + path, BASE_URL).toString()
}

/** Una URL absoluta tal cual; una relativa, contra la dirección base. */
function absolute(value: string): string {
  try {
    return new URL(value).toString()
  } catch {
    return new URL(value, BASE_URL).toString()
  }
}

async function getJson(url: string, options: CallOptions): Promise<Json> {
  const response = await fetch(url, {
    signal: options.signal,
    headers: { accept: 'application/json' },
  })

  // El throw vale: el SDK lo convierte en un Result fallido y la interfaz
  // muestra este mensaje con el nombre del proveedor delante.
  if (!response.ok) throw new Error('el sitio respondió ' + response.status)

  return response.json()
}

/** Un resultado por cada fila que traiga referencia y título. */
function resultsOf(payload: Json): readonly SearchResult[] {
  return asItems(pick(payload, FIELDS.searchItems)).flatMap((item) => {
    const id = asString(pick(item, FIELDS.searchId))
    const title = asString(pick(item, FIELDS.searchTitle))
    if (id === undefined || title === undefined) return []

    return [{ ref: { providerId: ID, value: id }, title }]
  })
}

const provider: Provider = {
  id: ID,
  name: NAME,
  apiVersion: '1',
  capabilities: CAPABILITIES,

  async search(query, options) {
    return resultsOf(await getJson(urlFor(ENDPOINTS.search, { query }), options))
  },

  async getAnime(ref, options) {
    const payload = await getJson(urlFor(ENDPOINTS.anime, { ref: ref.value }), options)
    const title = asString(pick(payload, FIELDS.animeTitle)) ?? ref.value

    return {
      ref,
      title,
      genres: asStrings(pick(payload, FIELDS.animeGenres)),
      studios: asStrings(pick(payload, FIELDS.animeStudios)),
    }
  },

  async getEpisodes(ref, options) {
    const payload = await getJson(urlFor(ENDPOINTS.episodes, { ref: ref.value }), options)

    return asItems(pick(payload, FIELDS.episodeItems)).flatMap((item, index) => {
      const number = asNumber(pick(item, FIELDS.episodeNumber)) ?? index + 1
      const id = asString(pick(item, FIELDS.episodeId)) ?? ref.value + '#' + number
      const title = asString(pick(item, FIELDS.episodeTitle))

      return [
        {
          ref: { providerId: ID, value: id },
          animeRef: ref,
          number,
          mode: EPISODE_MODE,
          ...(title === undefined ? {} : { title }),
        },
      ]
    })
  },

  async resolveStream(request, options) {
    const url = urlFor(ENDPOINTS.stream, { ref: request.episodeRef.value })
    const payload = await getJson(url, options)
    // La respuesta puede ser una lista de fuentes o una sola: se admiten las dos
    // porque los sitios hacen las dos cosas y adivinar cuál toca no tiene sentido.
    const rows = Array.isArray(payload) ? payload : [payload]

    return rows.flatMap((row) => {
      const source = asString(pick(row, FIELDS.streamUrl))
      if (source === undefined) return []

      const kind = asString(pick(row, FIELDS.streamKind)) === 'file' ? 'file' : 'hls'

      return [{ url: absolute(source), kind }]
    })
  },
${trendingMethod(draft)}}

export default provider
`
}
