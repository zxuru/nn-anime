/**
 * La capacidad de red que el motor le da a un plugin.
 *
 * Vive en `core` y no en `provider-sdk` por una razón de dependencias: quien la
 * implementa es `media-proxy`, que depende de `core`; si los tipos vivieran en el
 * SDK, el proxy tendría que depender del contrato que miran los plugins y el
 * orden se invertiría. El SDK los reexporta, que es lo que necesita el autor de un
 * plugin: un solo módulo que nombrar.
 *
 * Todo lo que cruza es **clonable** —números, cadenas y objetos, ninguna
 * función— y a propósito: el día que el plugin corra en otro hilo o en otro
 * proceso, esta misma forma viaja por un socket sin cambiar el contrato.
 */

/** Lo que un plugin pide. */
export interface PluginRequest {
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  /** Tope que pide el plugin. El motor impone el suyo por debajo. */
  readonly maxBytes?: number
}

/**
 * Lo que recibe.
 *
 * `set-cookie` va aparte de `headers` porque es la única cabecera que se repite y
 * no se puede juntar con comas —una fecha de caducidad las lleva—, y porque hay
 * flujos que la necesitan: el token CSRF de un paginador se pide con la cookie de
 * la ficha.
 */
export interface PluginResponse {
  readonly status: number
  /** La dirección final, después de los saltos revalidados. */
  readonly url: string
  /** Cabeceras de la respuesta, en minúsculas. Sin `set-cookie`. */
  readonly headers: Readonly<Record<string, string>>
  readonly setCookie: readonly string[]
  /** El cuerpo, ya descomprimido y ya acotado por el motor. */
  readonly body: string
}

/** La única puerta a la red que tiene un plugin. */
export type PluginFetch = (url: string, request?: PluginRequest) => Promise<PluginResponse>

/** Lo que el motor necesita de la llamada para construir la capacidad. */
export interface PluginFetchCall {
  readonly signal: AbortSignal
  readonly timeoutMs: number
}

/** Cómo se construye la capacidad: una vez por llamada, no una por proceso. */
export type PluginFetchFactory = (call: PluginFetchCall) => PluginFetch
