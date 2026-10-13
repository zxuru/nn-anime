/**
 * Argumentos de mpv, con validación de cabeceras.
 *
 * Aquí se decide **qué** se le pasa a mpv; lanzarlo es de `mpv.ts`. Están
 * separados porque esto es una función pura —y por tanto la parte que más fácil
 * se prueba— y porque es donde vive la única defensa contra una inyección de
 * argumentos.
 *
 * La defensa es doble y a propósito:
 *
 * 1. **El array.** Los argumentos se pasan a `Bun.spawn` como lista: no hay
 *    shell, así que un espacio o un `;` dentro de un valor no puede crear un
 *    argumento nuevo.
 * 2. **La validación.** El nombre de una cabecera sólo admite letras, dígitos y
 *    guiones, y el valor no admite `\r`, `\n` ni caracteres de control. Un
 *    `\n` en un valor de cabecera es una cabecera nueva, y `--http-header-fields`
 *    las separa por comas y las entiende mpv: un salto de línea ahí dentro es la
 *    forma de colar una cabecera que este programa no pidió.
 *
 * Un header inválido **no se descarta en silencio**: se devuelve el nombre que
 * falló y no se lanza nada. Descartarlo escondería que un plugin está mandando
 * basura, y el usuario vería un video que no arranca sin saber por qué.
 */

import { AppError } from '@nn-anime/core'

/** Nombre de cabecera: lo que el spec admite, ni más ni menos. */
export const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/

/** Argumento de cabeceras de mpv: `--http-header-fields=A: 1,B: 2`. */
export const HEADER_FIELD_FLAG = '--http-header-fields='

/**
 * ¿Hay algún carácter de control, incluidos `\r` y `\n`?
 *
 * Se comparan puntos de código y no una expresión regular: una clase con
 * `\u0000-\u001f` dentro es exactamente esto, pero escrita de forma que el
 * analizador la lee como caracteres de control sueltos en el código fuente y la
 * marca. Aquí el rango se ve en los números, que es donde se puede revisar.
 */
function hasControlChars(value: string): boolean {
  for (const caracter of value) {
    const punto = caracter.codePointAt(0) ?? 0
    if (punto <= 0x1f || punto === 0x7f) return true
  }

  return false
}

export interface MpvArgsOptions {
  /** URL absoluta del proxy. mpv no sabe de rutas relativas. */
  readonly url: string
  /** Cabeceras que el upstream exige. */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** Segundo en el que empezar, si se reanuda una posición. */
  readonly startAtS?: number | undefined
  /** Argumentos extra, para pruebas o para el usuario. */
  readonly extraArgs?: readonly string[] | undefined
}

export type MpvArgsOutcome =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly header: string }

/** ¿Sirve como nombre de cabecera? */
export function validHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name)
}

/** ¿Sirve como valor? Sin caracteres de control, que es lo que importa. */
export function validHeaderValue(value: string): boolean {
  return !hasControlChars(value)
}

/**
 * La línea de comandos de mpv.
 *
 * Devuelve `ok: false` con el nombre del header ofensor si alguno no vale: el
 * proceso no se lanza y quien llama puede decir cuál fue.
 */
export function mpvArgs(options: MpvArgsOptions): MpvArgsOutcome {
  const args: string[] = ['--no-config', '--force-window=yes', '--keep-open=no']
  const campos: string[] = []

  for (const [nombre, valor] of Object.entries(options.headers ?? {})) {
    if (!validHeaderName(nombre) || !validHeaderValue(valor)) {
      return { ok: false, header: nombre }
    }

    campos.push(`${nombre}: ${valor}`)
  }

  if (campos.length > 0) args.push(`${HEADER_FIELD_FLAG}${campos.join(',')}`)

  if (options.startAtS !== undefined && options.startAtS > 0) {
    args.push(`--start=${options.startAtS}`)
  }

  args.push(...(options.extraArgs ?? []))

  // `--` cierra el análisis de opciones: de aquí en adelante todo lo que empiece
  // por guion es un dato, no una opción. La URL la elige un plugin y sale del
  // sitio raspado; el esquema la acota a http(s) en el contrato y en los seis
  // plugins, pero eso es una comprobación de este lado, y esto es decírselo al
  // reproductor. Va después de `extraArgs` para no romper esa vía.
  args.push('--')

  // La URL va la última y como un argumento entero.
  args.push(options.url)

  return { ok: true, args }
}

/** El error de una cabecera que no se puede pasar a mpv. */
export function invalidHeaderError(header: string): AppError {
  return new AppError({
    code: 'provider',
    message: `el proveedor declaró una cabecera que no se puede usar: ${header}`,
    // El nombre sí, el valor no: un valor puede llevar un token de referencia.
    context: { header },
    scope: 'media-proxy',
    op: 'mpvArgs',
  })
}
