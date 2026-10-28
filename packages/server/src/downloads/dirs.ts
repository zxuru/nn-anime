/**
 * El listado de carpetas que alimenta el selector de destino.
 *
 * El navegador no puede dar una ruta absoluta —`showDirectoryPicker` devuelve un
 * identificador sin ruta y `<input webkitdirectory>` nombres relativos—, así que
 * el selector lo sirve el servidor: enumera las carpetas de una ruta y la
 * interfaz navega con eso. Es una superficie nueva y va declarada en
 * `SECURITY.md`: se leen **nombres de carpeta**, nunca el contenido de un
 * archivo, y la petición pasa por los mismos guardianes de sesión, origen y
 * `Host` que el resto de `/api/`.
 *
 * Un fallo no se lanza: se devuelve con su motivo, porque el motivo es lo que la
 * ruta traduce a un estado HTTP y lo que la pantalla puede contar.
 */

import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Tope de carpetas por respuesta: una raíz con miles de entradas no es una lista. */
export const MAX_DIRS = 500

export interface DirectoryEntry {
  readonly name: string
  readonly path: string
}

export interface DirectoryListing {
  readonly path: string
  readonly parent: string | null
  readonly dirs: readonly DirectoryEntry[]
  readonly volumes: readonly string[]
}

export type ListarMotivo = 'invalida' | 'no-existe' | 'sin-permiso'

export type ListarResultado =
  | { readonly ok: true; readonly listado: DirectoryListing }
  | { readonly ok: false; readonly motivo: ListarMotivo; readonly detalle: string }

export interface ListarOpciones {
  /** Tope de entradas; las pruebas lo bajan para no crear cientos de carpetas. */
  readonly limit?: number
  /** Inyectables para probar las unidades sin depender del sistema. */
  readonly platform?: NodeJS.Platform
  readonly unidades?: () => Promise<readonly string[]>
}

/** El `code` de un error del sistema, sin convertir el `unknown` a mano. */
function codigoDe(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined

  const codigo = Reflect.get(cause, 'code')

  return typeof codigo === 'string' ? codigo : undefined
}

/**
 * Las unidades de Windows.
 *
 * Se saltan `A:` y `B:`: son las letras que quedan para las disqueteras, y un
 * `stat` sobre una unidad vacía puede quedarse esperando al hardware.
 */
async function unidadesWindows(): Promise<readonly string[]> {
  const letras = 'CDEFGHIJKLMNOPQRSTUVWXYZ'
  const encontradas: string[] = []

  await Promise.all(
    [...letras].map(async (letra) => {
      const raiz = `${letra}:\\`
      const info = await stat(raiz).catch(() => undefined)
      if (info?.isDirectory() === true) encontradas.push(raiz)
    }),
  )

  return encontradas.sort()
}

function tieneControl(texto: string): boolean {
  return [...texto].some((letra) => letra.charCodeAt(0) < 0x20)
}

/**
 * Una entrada se ofrece si es una carpeta. Un enlace simbólico lo es sólo si su
 * destino lo es: ofrecer uno roto llevaría a una pantalla de error al pulsarlo.
 * Un archivo nunca: la lista es de carpetas y de nada más.
 */
async function esCarpeta(entrada: Dirent, ruta: string): Promise<boolean> {
  if (entrada.isDirectory()) return true
  if (!entrada.isSymbolicLink()) return false

  const info = await stat(ruta).catch(() => undefined)

  return info?.isDirectory() === true
}

export async function listarCarpetas(
  pedida: string,
  opciones: ListarOpciones = {},
): Promise<ListarResultado> {
  if (!isAbsolute(pedida) || tieneControl(pedida)) {
    return { ok: false, motivo: 'invalida', detalle: 'la carpeta tiene que ser una ruta absoluta' }
  }

  const ruta = resolve(pedida)

  try {
    const info = await stat(ruta)
    if (!info.isDirectory()) {
      return { ok: false, motivo: 'no-existe', detalle: 'esa ruta no es una carpeta' }
    }
  } catch (cause) {
    const codigo = codigoDe(cause)
    if (codigo === 'EACCES' || codigo === 'EPERM') {
      return { ok: false, motivo: 'sin-permiso', detalle: 'no se pudo leer esa carpeta' }
    }

    return { ok: false, motivo: 'no-existe', detalle: 'esa carpeta no existe' }
  }

  let entradas: Dirent[]
  try {
    entradas = await readdir(ruta, { withFileTypes: true })
  } catch {
    return { ok: false, motivo: 'sin-permiso', detalle: 'no se pudo leer esa carpeta' }
  }

  const dirs: DirectoryEntry[] = []
  for (const entrada of entradas) {
    const rutaHija = join(ruta, entrada.name)
    if (!(await esCarpeta(entrada, rutaHija))) continue

    dirs.push({ name: entrada.name, path: rutaHija })
  }

  // Las ocultas y las de sistema no se esconden: elegir su carpeta es cosa del
  // usuario, y decidir por él qué carpetas existen es peor que enseñarlas todas.
  const ordenadas = dirs.sort((uno, otro) =>
    uno.name.localeCompare(otro.name, 'es', { numeric: true }),
  )

  const padre = dirname(ruta)
  const enLaRaiz = padre === ruta
  const platform = opciones.platform ?? process.platform
  const volumes =
    enLaRaiz && platform === 'win32' ? await (opciones.unidades ?? unidadesWindows)() : []

  return {
    ok: true,
    listado: {
      path: ruta,
      parent: enLaRaiz ? null : padre,
      dirs: ordenadas.slice(0, opciones.limit ?? MAX_DIRS),
      volumes,
    },
  }
}
