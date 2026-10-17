#!/usr/bin/env bun
/**
 * El subsistema de un ejecutable de Windows, leído de su cabecera PE.
 *
 * Es la **medición de «sin consola»** que un CI sí puede hacer. Windows decide si
 * un proceso abre una consola por el campo `Subsystem` de su `Optional Header`, no
 * por ninguna convención del código:
 *
 * - `CONSOLE` (3): el sistema le abre una consola al arrancarlo.
 * - `WINDOWS` (2): no se le abre ninguna.
 *
 * El **servidor** tiene que ser `CONSOLE` y está bien que lo sea: así se invoca a
 * mano desde una terminal. El que no puede abrir consola es el **anfitrión**, y por
 * eso `main.rs` lleva `windows_subsystem = "windows"`. Y el servidor, cuando lo
 * lanza el anfitrión, tampoco la abre: de eso se encarga `CREATE_NO_WINDOW` en
 * `sidecar.rs`, que es una decisión de **quien lo lanza**, no de la cabecera.
 *
 * Se lee del archivo y no se ejecuta nada, así que esto corre en cualquier sistema
 * sobre un `.exe` de Windows. Sólo se leen los primeros 64 KiB: la cabecera PE vive
 * al principio y no hay razón para cargar 93 MB en memoria para mirar dos bytes.
 *
 * Uso:
 *   bun run scripts/package/pe.ts <ruta.exe> <windows|console>
 */

/** El desplazamiento de `e_lfanew` dentro de la cabecera DOS. */
const DOS_LFN = 0x3c

/** Lo que mide el `COFF header`, entre la firma `PE\0\0` y el `Optional Header`. */
const COFF_HEADER = 20

/** Dónde vive `Subsystem` **dentro del `Optional Header`**, igual en PE32 y PE32+. */
const SUBSYSTEM_OFFSET = 0x44

/** La firma `PE\0\0`, leída en little-endian. */
const PE_SIGNATURE = 0x0000_4550

/** Aplicación gráfica: Windows no le abre consola. */
export const SUBSYSTEM_WINDOWS = 2

/** Aplicación de consola: Windows le abre una. */
export const SUBSYSTEM_CONSOLE = 3

/** El nombre del subsistema, para los mensajes. */
export function subsystemName(value: number): string {
  if (value === SUBSYSTEM_WINDOWS) return 'windows'
  if (value === SUBSYSTEM_CONSOLE) return 'console'

  return `desconocido (${value})`
}

/**
 * El campo `Subsystem` de un ejecutable de Windows.
 *
 * Lanza en lugar de devolver un valor por defecto: un archivo que no es un PE no
 * tiene subsistema, y devolver `0` haría que el fallo apareciera como «no es
 * ninguno de los dos» en vez de «esto no es un ejecutable».
 */
export function readSubsystem(bytes: Uint8Array): number {
  if (bytes.byteLength < DOS_LFN + 4) {
    throw new Error('el archivo es demasiado corto para tener cabecera DOS')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pe = view.getUint32(DOS_LFN, true)

  // El `Subsystem` está después de la firma, el `COFF header` y 0x44 bytes de
  // `Optional Header`: si el archivo no llega hasta ahí, está truncado.
  const offset = pe + 4 + COFF_HEADER + SUBSYSTEM_OFFSET

  if (offset + 2 > bytes.byteLength) {
    throw new Error(`la cabecera PE está fuera del archivo (dice ${pe})`)
  }

  if (view.getUint32(pe, true) !== PE_SIGNATURE) {
    throw new Error('no es un ejecutable de Windows: falta la firma `PE\\0\\0`')
  }

  return view.getUint16(offset, true)
}

/** Espera del archivo, para poder decir qué se esperaba y qué hay. */
export type Expected = 'windows' | 'console'

/**
 * Comprueba el subsistema de un archivo contra lo que se espera.
 *
 * Devuelve el mensaje que se enseña, o lanza con el motivo exacto.
 */
export function assertSubsystem(bytes: Uint8Array, expected: Expected): string {
  const real = readSubsystem(bytes)
  const querido = expected === 'windows' ? SUBSYSTEM_WINDOWS : SUBSYSTEM_CONSOLE

  if (real !== querido) {
    throw new Error(
      `se esperaba ${expected} (${querido}) y el ejecutable declara ${subsystemName(real)}`,
    )
  }

  return `${expected} (${real})`
}

if (import.meta.main) {
  const [ruta, esperado] = Bun.argv.slice(2)

  if (ruta === undefined || (esperado !== 'windows' && esperado !== 'console')) {
    process.stderr.write('uso: pe.ts <ruta.exe> <windows|console>\n')
    process.exitCode = 2
  } else {
    try {
      // Sólo la cabecera: los primeros 64 KiB bastan y no cargan 93 MB.
      const bytes = new Uint8Array(await Bun.file(ruta).slice(0, 65_536).arrayBuffer())
      const detalle = assertSubsystem(bytes, esperado)

      process.stdout.write(`${ruta}: subsistema ${detalle}\n`)
    } catch (error) {
      process.stderr.write(`${ruta}: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  }
}
