/**
 * Lectura del stream de búsqueda.
 *
 * El formato SSE no llega en trozos alineados con los eventos: un corte puede
 * caer en mitad de un `data:`. Por eso el analizador **acumula** y sólo entrega
 * los eventos completos, en vez de intentar leer cada trozo por su cuenta —que
 * es como se pierde el primer evento de cada búsqueda y nadie sabe por qué—.
 *
 * Cada evento se valida con el schema compartido de `core`. No hay uno local a
 * propósito: el día que el server cambie una forma, esto falla aquí en vez de
 * pintar tres pantallas más adelante con un campo en `undefined`.
 */

import { type SearchEventPayload, searchEventSchema } from '@nn-anime/core/api'
import type { MediaFilter } from '@nn-anime/core/media'

/**
 * Ruta de la búsqueda. El filtro de proveedor se repite, como en el server.
 *
 * El tipo viaja **en la petición**, y eso no es un detalle de la interfaz: una
 * búsqueda de películas no puede preguntarle a las fuentes de anime. Filtrar los
 * resultados al llegar dejaría el gasto hecho —son sitios de terceros— y además el
 * catálogo cacheado se filtra por los proveedores seleccionados, así que la mitad
 * de la base que no toca tampoco aparecería.
 */
export function searchRequestPath(
  query: string,
  providers: readonly string[] = [],
  media: MediaFilter | undefined = undefined,
): string {
  const partes: string[] = []
  const limpio = query.trim()
  if (limpio !== '') partes.push(`q=${encodeURIComponent(limpio)}`)
  for (const provider of providers) partes.push(`provider=${encodeURIComponent(provider)}`)
  if (media !== undefined) partes.push(`media=${media}`)

  // `%20` y no `+`: es lo que escribe la dirección de arranque del CLI, y dos
  // convenciones para la misma consulta darían dos claves de caché distintas.
  return partes.length === 0 ? '/api/search' : `/api/search?${partes.join('&')}`
}

export interface SseParser {
  /** Añade un trozo y devuelve los eventos que quedaron completos. */
  push(chunk: string): readonly SearchEventPayload[]
}

/** Un bloque SSE a un evento, o `undefined` si no hay nada legible. */
function parseBlock(block: string): SearchEventPayload | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')

  if (data === '') return undefined

  let crudo: unknown
  try {
    crudo = JSON.parse(data)
  } catch {
    return undefined
  }

  const parsed = searchEventSchema.safeParse(crudo)

  return parsed.success ? parsed.data : undefined
}

export function createSseParser(): SseParser {
  let buffer = ''

  return {
    push(chunk) {
      buffer += chunk
      const eventos: SearchEventPayload[] = []

      let corte = buffer.indexOf('\n\n')
      while (corte !== -1) {
        const evento = parseBlock(buffer.slice(0, corte))
        if (evento !== undefined) eventos.push(evento)
        buffer = buffer.slice(corte + 2)
        corte = buffer.indexOf('\n\n')
      }

      return eventos
    },
  }
}

/**
 * Todos los eventos de un cuerpo ya recibido.
 *
 * Sirve para una respuesta corta —un test, un `curl` guardado—, no para el
 * navegador: ahí el cuerpo llega por trozos y se lee con `readEventStream`.
 */
export function parseEventText(text: string): readonly SearchEventPayload[] {
  const parser = createSseParser()

  return [...parser.push(text), ...parser.push('\n\n')]
}

/**
 * Los eventos de una respuesta, según van llegando.
 *
 * El cuerpo se lee trozo a trozo y **nunca entero**: una búsqueda que tarda
 * tiene que poder pintar lo primero que llegue, y esperar al `done` es
 * exactamente lo que el spec prohíbe.
 */
export async function* readEventStream(response: Response): AsyncGenerator<SearchEventPayload> {
  const body = response.body
  if (body === null) return

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    for (const evento of parser.push(decoder.decode(value, { stream: true }))) yield evento
  }
}
