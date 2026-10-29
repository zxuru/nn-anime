// La lógica de la ventana de actualizaciones.
//
// Comprueba al cargar y cada tres horas, y también cuando el menú de la bandeja
// emite `buscar-actualizaciones`. Si hay versión nueva, la enseña; si el usuario
// acepta, se actualiza de la forma que corresponda:
//
// - **Instalada** (el NSIS): `downloadAndInstall()` del plugin y `relaunch()`.
// - **Portable** (el `.exe` único): el plugin no puede ejecutar un instalador que
//   no existe, así que se manda a Rust la URL y la firma de
//   `windows-x86_64-portable`; Rust descarga, verifica y reemplaza el `.exe` en
//   marcha. Si falla, se enseña el enlace a la release.
//
// Los errores no rompen nada: se cuentan en la página (cuando la comprobación la
// pidió el usuario) y se escriben en el registro del anfitrión con el comando
// `registrar_actualizacion`.

import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'

interface Contexto {
  readonly instalada: boolean
  readonly version: string
  readonly releases: string
}

/** Lo que Rust manda por el canal mientras descarga el `.exe` portable. */
interface ProgresoPortable {
  readonly descargado: number
  readonly total: number | null
}

/** La entrada del manifiesto que corresponde a la copia portable. */
interface EntradaPortable {
  readonly url: string
  readonly signature: string
}

declare global {
  interface Window {
    __NN_ACTUALIZACION?: Contexto
  }
}

const EVENTO_BUSCAR = 'buscar-actualizaciones'
const INTERVALO_MS = 3 * 60 * 60 * 1000
const TIEMPO_LIMITE_MS = 30_000
const CLAVE_PORTABLE = 'windows-x86_64-portable'

const contexto: Contexto | undefined = window.__NN_ACTUALIZACION

const version = elemento('version', HTMLParagraphElement)
const estado = elemento('estado', HTMLParagraphElement)
const detalle = elemento('detalle', HTMLParagraphElement)
const progreso = elemento('progreso', HTMLProgressElement)
const instalar = elemento('instalar', HTMLButtonElement)
const luego = elemento('luego', HTMLButtonElement)
const reintentar = elemento('reintentar', HTMLButtonElement)
const release = elemento('release', HTMLAnchorElement)

let actual: Update | null = null
let enCurso = false

function elemento<T extends HTMLElement>(id: string, tipo: new () => T): T {
  const encontrado = document.getElementById(id)

  if (!(encontrado instanceof tipo)) {
    throw new Error(`falta el elemento #${id} en la ventana de actualizaciones`)
  }

  return encontrado
}

function esRecord(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Saca la URL y la firma del `.exe` portable de lo que devolvió `check()`. */
function entradaPortable(rawJson: Record<string, unknown>): EntradaPortable | null {
  const platforms = rawJson.platforms

  if (!esRecord(platforms)) return null

  const entrada = platforms[CLAVE_PORTABLE]

  if (!esRecord(entrada)) return null

  const { url, signature } = entrada

  if (typeof url !== 'string' || typeof signature !== 'string') return null

  return { url, signature }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function registrar(mensaje: string): void {
  // El registro es donde se diagnostica: si el comando falla, no hay nada mejor
  // que hacer que seguir con la ventana en pie.
  void invoke('registrar_actualizacion', { mensaje }).catch(() => {})
}

function texto(mensaje: string, esError = false): void {
  estado.textContent = mensaje
  estado.classList.toggle('error', esError)
}

function limpiarAcciones(): void {
  instalar.hidden = true
  luego.hidden = true
  reintentar.hidden = true
  release.hidden = true
}

function mostrarEnlace(versionNueva: string): void {
  if (contexto === undefined) return

  release.href = `${contexto.releases}/tag/v${versionNueva}`
  release.hidden = false
}

async function mostrarVentana(): Promise<void> {
  const ventana = getCurrentWindow()
  await ventana.show()
  await ventana.setFocus()
}

async function ocultarVentana(): Promise<void> {
  await getCurrentWindow().hide()
}

async function comprobar(manual: boolean): Promise<void> {
  if (contexto === undefined || enCurso) return

  // Una comprobación automática no pisa lo que ya se está enseñando: si hay una
  // versión pendiente, la decisión es del usuario y no de un temporizador.
  if (!manual && actual !== null) return

  enCurso = true
  limpiarAcciones()
  progreso.hidden = true
  detalle.hidden = true
  texto('Comprobando actualizaciones…')

  if (manual) {
    try {
      await mostrarVentana()
    } catch (error) {
      registrar(`no se pudo enseñar la ventana: ${mensajeDe(error)}`)
    }
  }

  try {
    const encontrada = await check({ timeout: TIEMPO_LIMITE_MS })

    if (encontrada === null) {
      registrar(`sin novedades: la ${contexto.version} es la última`)
      texto(`Tienes la última versión (v${contexto.version}).`)

      // Al arrancar, la ventana ya estaba oculta; ocultarla otra vez es inofensivo.
      // Si la pidió el usuario, se queda con la respuesta delante.
      if (!manual) await ocultarVentana()

      return
    }

    actual = encontrada
    registrar(
      `hay una versión nueva: ${encontrada.version} (instalada ${encontrada.currentVersion})`,
    )

    texto(`Hay una versión nueva: v${encontrada.version}.`)

    if (encontrada.body !== undefined && encontrada.body !== '') {
      detalle.textContent = encontrada.body
      detalle.hidden = false
    }

    instalar.hidden = false
    luego.hidden = false
    await mostrarVentana()
    instalar.focus()
  } catch (error) {
    const mensaje = mensajeDe(error)
    registrar(`error al comprobar si hay actualizaciones: ${mensaje}`)

    // Sin red, sin release publicada o con un latest.json que no cuadra: se cuenta
    // y la aplicación sigue como estaba. Sólo se enseña si el usuario lo pidió.
    texto('No se pudo comprobar si hay actualizaciones.', true)

    if (manual) {
      detalle.textContent = mensaje
      detalle.hidden = false
      reintentar.hidden = false
      await mostrarVentana()
    }
  } finally {
    enCurso = false
  }
}

/** La copia instalada: el plugin descarga el NSIS, lo verifica y lo ejecuta. */
async function instalarAhora(): Promise<void> {
  if (actual === null || enCurso) return

  enCurso = true
  limpiarAcciones()
  texto(`Descargando la v${actual.version}…`)

  let descargado = 0
  let total: number | undefined
  progreso.hidden = false
  progreso.removeAttribute('value')

  try {
    await actual.downloadAndInstall((evento: DownloadEvent) => {
      switch (evento.event) {
        case 'Started':
          total = evento.data.contentLength

          if (total !== undefined && total > 0) {
            progreso.max = total
            progreso.value = 0
          }

          break

        case 'Progress':
          descargado += evento.data.chunkLength

          if (total !== undefined && total > 0) {
            progreso.value = descargado
            texto(`Descargando… ${Math.round((descargado / total) * 100)} %`)
          }

          break

        case 'Finished':
          texto('Instalando…')
          break
      }
    })

    registrar(`instalada la ${actual.version}; reiniciando la aplicación`)
    texto('Actualización instalada. Reiniciando…')

    // En Windows el updater cierra la aplicación antes de llegar aquí; en macOS y
    // Linux el binario ya está reemplazado y hay que relanzarlo para estrenarlo.
    await relaunch()
  } catch (error) {
    const mensaje = mensajeDe(error)
    registrar(`error al descargar o instalar la ${actual.version}: ${mensaje}`)

    texto('No se pudo instalar la actualización.', true)
    detalle.textContent = mensaje
    detalle.hidden = false
    progreso.hidden = true
    reintentar.hidden = false
    luego.hidden = false
  } finally {
    enCurso = false
  }
}

/** La copia portable: Rust descarga, verifica y reemplaza el `.exe` en marcha. */
async function instalarPortable(): Promise<void> {
  if (actual === null || enCurso) return

  const entrada = entradaPortable(actual.rawJson)

  if (entrada === null) {
    const mensaje = 'La release no trae un ejecutable portable firmado.'
    registrar(mensaje)
    texto('Esta actualización no se puede aplicar a la copia portable.', true)
    detalle.textContent = mensaje
    detalle.hidden = false
    mostrarEnlace(actual.version)
    return
  }

  enCurso = true
  limpiarAcciones()
  progreso.hidden = false
  progreso.removeAttribute('value')
  texto(`Descargando la v${actual.version}…`)

  const canal = new Channel<ProgresoPortable>()
  canal.onmessage = (evento) => {
    if (evento.total !== null && evento.total > 0) {
      progreso.max = evento.total
      progreso.value = evento.descargado
      texto(`Descargando… ${Math.round((evento.descargado / evento.total) * 100)} %`)
    } else {
      texto('Descargando…')
    }
  }

  try {
    await invoke('instalar_portable', {
      datos: { url: entrada.url, signature: entrada.signature, version: actual.version },
      progreso: canal,
    })

    // Lo normal es que la aplicación se cierre aquí para arrancar la nueva; si
    // vuelve, es que el reemplazo no llegó a completarse.
    texto('Reiniciando…')
  } catch (error) {
    const mensaje = mensajeDe(error)
    registrar(`error al actualizar la copia portable: ${mensaje}`)

    texto('No se pudo actualizar la copia portable.', true)
    detalle.textContent = mensaje
    detalle.hidden = false
    progreso.hidden = true
    mostrarEnlace(actual.version)
    reintentar.hidden = false
    luego.hidden = false
  } finally {
    enCurso = false
  }
}

async function cerrarAviso(): Promise<void> {
  // `close` libera los bytes descargados y el recurso del updater; dejarlo vivo
  // hasta la siguiente comprobación es memoria retenida para nada.
  if (actual !== null) {
    await actual.close().catch(() => {})
    actual = null
  }

  await ocultarVentana().catch(() => {})
}

function actualizar(): void {
  if (contexto !== undefined && !contexto.instalada) {
    void instalarPortable()
  } else {
    void instalarAhora()
  }
}

instalar.addEventListener('click', actualizar)

luego.addEventListener('click', () => {
  void cerrarAviso()
})

reintentar.addEventListener('click', () => {
  if (actual === null) {
    void comprobar(true)
  } else {
    actualizar()
  }
})

async function iniciar(): Promise<void> {
  if (contexto === undefined) {
    texto('La ventana de actualizaciones no recibió su configuración.', true)
    return
  }

  version.textContent = contexto.instalada
    ? `Versión instalada: v${contexto.version}`
    : `Versión portable: v${contexto.version}`

  await listen(EVENTO_BUSCAR, () => {
    void comprobar(true)
  })

  await comprobar(false)
}

void iniciar()

// Cada pocas horas, no en cada arranque de la ventana: el updater consulta GitHub
// y no hay razón para pedirle más de lo necesario.
setInterval(() => {
  if (!enCurso && actual === null) void comprobar(false)
}, INTERVALO_MS)
