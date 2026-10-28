// La lógica de la ventana de actualizaciones.
//
// Comprueba al cargar y cada tres horas, y también cuando el menú de la bandeja
// emite `buscar-actualizaciones`. Si hay versión nueva, la enseña; si el usuario
// acepta, descarga con progreso, instala y relanza. En modo portable **no
// instala**: un `.exe` suelto no tiene instalador que reemplazar, así que sólo
// anuncia la versión y enlaza a la release.
//
// Los errores no rompen nada: se cuentan en la página (cuando la comprobación la
// pidió el usuario) y se escriben en el registro del anfitrión con el comando
// `registrar_actualizacion`, que es el único que expone esta ventana además de
// los del updater y `relaunch`.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'

interface Contexto {
  readonly portable: boolean
  readonly version: string
  readonly releases: string
}

declare global {
  interface Window {
    __NN_ACTUALIZACION?: Contexto
  }
}

const EVENTO_BUSCAR = 'buscar-actualizaciones'
const INTERVALO_MS = 3 * 60 * 60 * 1000
const TIEMPO_LIMITE_MS = 30_000

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

    if (contexto.portable) {
      detalle.textContent =
        'Esta copia es portable: no puede actualizarse sola. Descarga la versión nueva desde la release.'
      detalle.hidden = false
      release.href = `${contexto.releases}/tag/v${encontrada.version}`
      release.hidden = false
    } else {
      if (encontrada.body !== undefined && encontrada.body !== '') {
        detalle.textContent = encontrada.body
        detalle.hidden = false
      }

      instalar.hidden = false
    }

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

async function cerrarAviso(): Promise<void> {
  // `close` libera los bytes descargados y el recurso del updater; dejarlo vivo
  // hasta la siguiente comprobación es memoria retenida para nada.
  if (actual !== null) {
    await actual.close().catch(() => {})
    actual = null
  }

  await ocultarVentana().catch(() => {})
}

instalar.addEventListener('click', () => {
  void instalarAhora()
})

luego.addEventListener('click', () => {
  void cerrarAviso()
})

reintentar.addEventListener('click', () => {
  if (actual !== null) {
    void instalarAhora()
  } else {
    void comprobar(true)
  }
})

async function iniciar(): Promise<void> {
  if (contexto === undefined) {
    texto('La ventana de actualizaciones no recibió su configuración.', true)
    return
  }

  version.textContent = contexto.portable
    ? `Versión instalada: v${contexto.version} · copia portable`
    : `Versión instalada: v${contexto.version}`

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
