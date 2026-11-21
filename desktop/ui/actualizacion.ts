// La lógica de la ventana de actualizaciones.
//
// Comprueba una sola vez, al cargar, y otra cuando el menú de la bandeja emite
// `buscar-actualizaciones`. Si hay versión nueva, la enseña; si el usuario
// acepta, se actualiza:
//
// - La página manda a Rust la URL y la firma de `windows-x86_64-portable`; Rust
//   descarga, verifica y reemplaza el `.exe` en marcha. Si falla, se enseña el
//   enlace a la release.
// - Si la release no trae esa entrada, no hay nada que descargar: se dice y se
//   deja el enlace.
// - Fuera de Windows no hay manifiesto del updater y la ventana existe para
//   decirlo: no se llama a `check()` y se enlaza a la release para descargar la
//   versión nueva a mano. Lo decide `contexto.automatica`, que viene de Rust.
//
// Los errores no rompen nada: se cuentan en la página y se escriben en el
// registro del anfitrión con el comando `registrar_actualizacion`. Un fallo de
// red se queda ahí —sin conexión, la aplicación ya lo cuenta—; uno del manifiesto
// se enseña también al arrancar, porque no se arregla reintentando y el silencio
// deja a esa copia sin updater y sin que nadie se entere. En los dos casos queda
// el enlace a la release: es la única salida de una copia que no puede
// actualizarse sola.

import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { check, type Update } from '@tauri-apps/plugin-updater'

import { entradaPortable } from './camino-actualizacion'
import { explicarFallo } from './error-actualizacion'

interface Contexto {
  readonly version: string
  readonly releases: string
  /** Si esta compilación puede comprobar e instalar actualizaciones. */
  readonly automatica: boolean
}

/** Lo que Rust manda por el canal mientras descarga el `.exe` portable. */
interface ProgresoPortable {
  readonly descargado: number
  readonly total: number | null
}

declare global {
  interface Window {
    __NN_ACTUALIZACION?: Contexto
  }
}

const EVENTO_BUSCAR = 'buscar-actualizaciones'
const TIEMPO_LIMITE_MS = 30_000

const contexto: Contexto | undefined = window.__NN_ACTUALIZACION

// Se fija aquí, fuera de las funciones, para no repetir la comprobación en cada
// cierre y porque una compilación no cambia de plataforma mientras corre.
const automatica = contexto?.automatica === true

const version = elemento('version', HTMLParagraphElement)
const estado = elemento('estado', HTMLParagraphElement)
const soporte = elemento('soporte', HTMLParagraphElement)
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

function mostrarEnlace(versionNueva: string): void {
  if (contexto === undefined) return

  release.textContent = 'Descargar desde la release'
  release.href = `${contexto.releases}/tag/v${versionNueva}`
  release.hidden = false
}

/**
 * Deja el enlace a la última release cuando el updater no puede hacer su trabajo.
 *
 * Sin esto, un fallo de la comprobación deja la ventana con «Reintentar» y nada
 * más, y quien tiene un endpoint muerto —la 0.10.0 lo tenía— se queda reintentando
 * un 404 para siempre. La release es lo único que puede sacarle de ahí.
 */
function mostrarEnlaceUltima(): void {
  if (contexto === undefined) return

  release.textContent = 'Descargar la última versión'
  release.href = `${contexto.releases}/latest`
  release.hidden = false
}

/**
 * Lo que se enseña donde no hay manifiesto del updater.
 *
 * No se llama a `check()`: en macOS y Linux el plugin buscaría una entrada
 * `darwin-*`/`linux-*` que la release no publica, y el error de la búsqueda se
 * leería como una avería de red. Se dice el límite y se deja la descarga manual.
 */
async function mostrarSinActualizacionAutomatica(manual: boolean): Promise<void> {
  if (contexto === undefined) return

  texto('La actualización automática sólo está disponible en Windows.')
  soporte.textContent =
    'La release no publica un manifiesto del updater para este sistema, así que la aplicación ' +
    'no puede actualizarse sola. Descarga la versión nueva desde la release y sustituye estos ' +
    'archivos a mano; tus datos no se tocan.'
  soporte.hidden = false

  release.textContent = 'Descargar desde la release'
  release.href = `${contexto.releases}/latest`
  release.hidden = false

  if (manual) await mostrarVentana()
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
      `hay una versión nueva: ${encontrada.version} (en marcha ${encontrada.currentVersion})`,
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
    const fallo = explicarFallo(mensaje)
    registrar(`error al comprobar si hay actualizaciones: ${mensaje}`)

    // Sin red, sin release publicada o con un latest.json que no cuadra: se cuenta
    // y la aplicación sigue como estaba. El enlace a la release no falta nunca:
    // es la única salida si esta copia no puede actualizarse sola.
    texto(fallo.titulo, true)
    detalle.textContent = fallo.detalle ?? mensaje
    detalle.hidden = false
    mostrarEnlaceUltima()
    reintentar.hidden = false
    luego.hidden = false

    // Un fallo de red al arrancar no abre nada: puede no haber conexión, y la
    // aplicación ya lo cuenta en su interfaz. Uno del manifiesto sí se enseña:
    // no hay nada que reintentar y, sin ventana, esa copia se queda sin
    // actualizaciones sin que nadie lo sepa.
    if (manual || fallo.deConfiguracion) await mostrarVentana()
  } finally {
    enCurso = false
  }
}

/** La única entrega: Rust descarga, verifica y reemplaza el `.exe` en marcha. */
async function instalarEnSitio(): Promise<void> {
  if (actual === null || enCurso) return

  const entrada = entradaPortable(actual.rawJson)

  if (entrada === null) {
    const mensaje = 'La release no trae un ejecutable portable firmado.'
    registrar(mensaje)
    texto('Esta actualización no se puede aplicar: falta el ejecutable portable firmado.', true)
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
    registrar(`error al actualizar en sitio: ${mensaje}`)

    texto('No se pudo actualizar en sitio.', true)
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
  if (actual === null || !automatica) return

  // `instalarEnSitio` enseña el motivo y el enlace cuando falta el ejecutable
  // portable firmado; no hay otra forma de entrega a la que caer.
  void instalarEnSitio()
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

  version.textContent = automatica
    ? `Versión portable: v${contexto.version}`
    : `Versión: v${contexto.version}`

  await listen(EVENTO_BUSCAR, () => {
    if (automatica) {
      void comprobar(true)
    } else {
      void mostrarSinActualizacionAutomatica(true)
    }
  })

  // En macOS y Linux no hay manifiesto que consultar: se cuenta el límite y no se
  // toca el updater, que devolvería el error de una entrada que no existe.
  if (!automatica) {
    await mostrarSinActualizacionAutomatica(false)
    return
  }

  await comprobar(false)
}

void iniciar()
