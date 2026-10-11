/**
 * Cómo se cuenta un fallo de una petición.
 *
 * «GET /api/anime/jkanime/mashle-2nd-season respondió 502» es un mensaje para
 * quien lee registros: dice el método, la ruta y el código, y ninguna de las tres
 * cosas explica qué pasó ni qué hacer. Aquí se traduce a una **clase** de fallo
 * —sin conexión, el proveedor no responde, la sesión no vale— y se guardan aparte
 * las dos cosas que sí se pueden enseñar:
 *
 * - **`detalle`**: lo que contó el servidor, en sus palabras. Es el mensaje del
 *   cuerpo del error —«el sitio respondió 500»— y manda sobre cualquier texto
 *   nuestro: quien falló sabe más de por qué falló.
 * - **`tecnico`**: el mensaje crudo, para el desplegable de detalles. Sin él, un
 *   informe de fallo se queda sin el dato que lo identifica.
 *
 * La clase no elige el texto: elige la clave del catálogo. El texto vive en
 * `i18n/es.ts`, como el de cualquier otra parte de la interfaz, así que añadir un
 * idioma no toca este archivo.
 *
 * **El orden de las comprobaciones importa.** Un `ApiError` va primero porque el
 * estado HTTP es el dato más específico que hay, y un 502 de un proveedor no se
 * cuenta como un `TypeError` de red: el primero es culpa del sitio de origen y el
 * segundo del navegador.
 */

import { ApiError, ApiShapeError } from './client'

export type ClaseDeFallo =
  /** El navegador no llegó a hablar con el servidor. */
  | 'sinConexion'
  /** La petición pasó del tiempo límite. */
  | 'lento'
  /** La sesión no vale: hay que volver a entrar por la dirección de arranque. */
  | 'sesion'
  /** El proveedor no conoce esa referencia. */
  | 'noExiste'
  /** El sitio de origen falló o no contestó: el 502 y sus hermanos. */
  | 'proveedor'
  /** Fallo del propio nn-anime. */
  | 'servidor'
  /** La petición no valía: un 4xx que no es ninguno de los de arriba. */
  | 'peticion'
  /** La respuesta llegó y no tenía la forma prometida. */
  | 'forma'
  /** Cualquier otra cosa. */
  | 'desconocido'

export interface Fallo {
  readonly clase: ClaseDeFallo
  /** El código HTTP, si lo hubo. */
  readonly estado: number | undefined
  /** Lo que dijo el servidor, si dijo algo. */
  readonly detalle: string | undefined
  /** El mensaje crudo. Va plegado, para copiarlo en un informe. */
  readonly tecnico: string
}

function claseDeEstado(estado: number): ClaseDeFallo {
  if (estado === 401 || estado === 403) return 'sesion'
  if (estado === 404 || estado === 410) return 'noExiste'
  // 502 y 503 son del proveedor y no del servidor propio: `server` los usa para
  // decir «el sitio de origen falló», y contarlos como fallo de nn-anime mandaría
  // a mirar los registros equivocados. El 504 es la puerta de enlace que no
  // contestó a tiempo, que es el mismo caso visto desde el otro lado.
  if (estado === 502 || estado === 503 || estado === 504) return 'proveedor'
  if (estado >= 500) return 'servidor'

  return 'peticion'
}

/** El `name` de la causa, mire donde mire: `DOMException` no hereda de `Error`. */
function nombreDe(causa: unknown): string | undefined {
  if (causa instanceof Error) return causa.name
  if (typeof DOMException !== 'undefined' && causa instanceof DOMException) return causa.name

  return undefined
}

/**
 * El fallo sin causa.
 *
 * Un estado de error sin excepción no debería existir —los ganchos ponen los dos
 * a la vez—, pero el tipo del gancho no puede prometerlo sin volverse una unión
 * discriminada en cada pantalla. Cuando pasa, se dice lo que se sabe: que algo
 * falló y que no hay causa registrada. Inventar un «sin conexión» ahí sería
 * mentir sobre lo único que importa, que es de quién es la culpa.
 */
export const FALLO_SIN_CAUSA: Fallo = {
  clase: 'desconocido',
  estado: undefined,
  detalle: undefined,
  tecnico: 'sin causa registrada',
}

/**
 * El fallo de un proveedor que contesta, pero sin ninguna fuente.
 *
 * No es un fallo de red: la respuesta llegó y dijo que ese sitio no tiene el
 * episodio. La clase es la del proveedor —el problema es suyo— y el detalle va en
 * palabras, porque aquí sí se sabe exactamente qué pasó y un «algo falló» sería
 * tirar el único dato que hay.
 */
export function falloSinFuente(detalle: string): Fallo {
  return { clase: 'proveedor', estado: undefined, detalle, tecnico: detalle }
}

/**
 * Los textos con los que los motores dicen «no hay red».
 *
 * `fetch` no tiene un error propio para esto: rechaza con un `TypeError` y un
 * mensaje distinto en cada motor. Medido en este repositorio, contra un puerto
 * cerrado: Bun —el que sirve esta aplicación— dice «Unable to connect. Is the
 * computer able to access the url?», Chrome «Failed to fetch» y Safari «Load
 * failed».
 *
 * La lista es cerrada a propósito. Un `TypeError` que no diga ninguna de estas
 * cosas es un fallo de la aplicación, y contarlo como «sin conexión» mandaría a
 * mirar el cable cuando el fallo está en el código.
 */
const SIN_RED = /failed to fetch|load failed|unable to connect|networkerror|network request failed/i

export function describirFallo(causa: unknown): Fallo {
  const tecnico = causa instanceof Error ? causa.message : String(causa)

  if (causa instanceof ApiError) {
    return {
      clase: claseDeEstado(causa.status),
      estado: causa.status,
      detalle: causa.detail,
      tecnico,
    }
  }

  if (causa instanceof ApiShapeError) {
    return { clase: 'forma', estado: undefined, detalle: undefined, tecnico }
  }

  // `AbortSignal.timeout` rechaza con un `TimeoutError` y una cancelación a mano
  // con un `AbortError`. Las dos son «tardó demasiado» desde la pantalla: la
  // cancelación que provoca el propio usuario no llega aquí, porque quien la pide
  // comprueba `signal.aborted` antes de pintar nada.
  const nombre = nombreDe(causa)
  if (nombre === 'AbortError' || nombre === 'TimeoutError') {
    return { clase: 'lento', estado: undefined, detalle: undefined, tecnico }
  }

  if (causa instanceof TypeError && SIN_RED.test(tecnico)) {
    return { clase: 'sinConexion', estado: undefined, detalle: undefined, tecnico }
  }

  return { clase: 'desconocido', estado: undefined, detalle: undefined, tecnico }
}
