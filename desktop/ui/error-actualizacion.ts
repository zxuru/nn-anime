// Qué se cuenta cuando la comprobación de novedades falla.
//
// Vive aparte de la ventana para poder medirlo sin DOM ni IPC. El plugin del
// updater contesta en inglés y con frases que sólo significan algo para quien
// leyó su código; la ventana es lo último que ve alguien cuyo actualizador está
// roto, así que aquí se decide qué se dice.
//
// La distinción que importa es **red o manifiesto**. Un fallo de red se arregla
// solo —o reintentando— y al arrancar no merece una ventana: sin conexión, la
// aplicación ya lo cuenta en su interfaz. Uno del manifiesto no se arregla
// esperando, y callarlo es lo que dejó a la 0.10.0 dos releases sin updater y
// sin que nadie se enterara: su endpoint apuntaba a un repositorio que no
// existe y el único aviso era una línea del registro.

/** Lo que la ventana enseña de un fallo. */
export interface Explicacion {
  /** La frase corta, la que va en el estado. */
  readonly titulo: string
  /** Lo que se lee debajo, con qué hacer; `null` si el mensaje en crudo ya lo dice. */
  readonly detalle: string | null
  /** Si es del manifiesto y no de la red: no se arregla reintentando. */
  readonly deConfiguracion: boolean
}

// Los textos exactos de `tauri-plugin-updater` 2.14, que es la versión fijada en
// `Cargo.lock`. Se comparan por fragmento porque varios llevan datos dentro.
const SIN_MANIFIESTO = 'Could not fetch a valid release JSON from the remote'
const SIN_PLATAFORMA = 'the response `platforms` object'
const FIRMA_DE_OTRA_VERSION = 'The update was signed for version'
const SIN_VERSION_FIRMADA = 'does not specify the version it was signed for'
const SIN_ENDPOINTS = 'does not have any endpoints set'
const PROTOCOLO_INSEGURO = 'must use a secure protocol'

// Los errores de `reqwest` llegan sin traducir y con el detalle del sistema. Si
// el mensaje no es ninguno de ellos, se trata como desconocido y no como red:
// enseñar de más es mejor que callar un fallo que nadie vuelve a mirar.
const RED =
  /error sending request|error trying to connect|dns error|lookup address|timed out|connection refused|connection reset|invalid peer certificate|builder error|proxy|network is unreachable|no such host/i

const MANIFIESTO: Explicacion = {
  titulo: 'El servidor de actualizaciones no publica un manifiesto válido.',
  detalle:
    'La dirección del updater respondió sin un manifiesto legible: puede que ' +
    'apunte a un repositorio que ya no existe, que la release no lo incluya o ' +
    'que GitHub no esté respondiendo. Reintentar no lo arregla por sí solo; ' +
    'descarga la versión nueva desde la release.',
  deConfiguracion: true,
}

const PLATAFORMA: Explicacion = {
  titulo: 'La release no publica una entrada para este sistema.',
  detalle:
    'El manifiesto no trae el ejecutable de esta plataforma, así que no hay nada ' +
    'que descargar. La descarga manual desde la release sigue disponible.',
  deConfiguracion: true,
}

const FIRMA_AJENA: Explicacion = {
  titulo: 'La firma no corresponde a la versión anunciada.',
  detalle:
    'No se instala nada: el manifiesto y la firma dicen versiones distintas, y ' +
    'eso es justo lo que impide una actualización manipulada. Descarga la versión ' +
    'nueva desde la release y cuéntalo; una release así hay que volver a firmarla.',
  deConfiguracion: true,
}

const FIRMA_SIN_VERSION: Explicacion = {
  titulo: 'La firma no dice para qué versión es.',
  detalle:
    'La release se firmó sin la versión en el comentario de confianza y esta copia ' +
    'la exige. Hay que volver a firmarla; mientras, descarga la versión nueva desde ' +
    'la release.',
  deConfiguracion: true,
}

const SIN_DIRECCION: Explicacion = {
  titulo: 'Esta compilación no trae la dirección del updater.',
  detalle: 'Sin endpoint no hay nada que consultar. Descarga la versión nueva desde la release.',
  deConfiguracion: true,
}

const SIN_HTTPS: Explicacion = {
  titulo: 'La dirección del updater no usa HTTPS.',
  detalle:
    'Se rechaza a propósito: bajar un ejecutable por HTTP permitiría sustituirlo por ' +
    'otro. Descarga la versión nueva desde la release.',
  deConfiguracion: true,
}

const SIN_RED: Explicacion = {
  titulo: 'No se pudo contactar con el servidor de actualizaciones.',
  detalle:
    'No hay conexión o el servidor no responde. Reintentar vuelve a probar sin cerrar la aplicación.',
  deConfiguracion: false,
}

const DESCONOCIDO: Explicacion = {
  titulo: 'No se pudo comprobar si hay actualizaciones.',
  detalle: null,
  deConfiguracion: false,
}

/** Traduce el mensaje del plugin a lo que la ventana puede enseñar. */
export function explicarFallo(mensaje: string): Explicacion {
  if (mensaje.includes(SIN_MANIFIESTO)) return MANIFIESTO
  if (mensaje.includes(SIN_PLATAFORMA)) return PLATAFORMA
  if (mensaje.includes(FIRMA_DE_OTRA_VERSION)) return FIRMA_AJENA
  if (mensaje.includes(SIN_VERSION_FIRMADA)) return FIRMA_SIN_VERSION
  if (mensaje.includes(SIN_ENDPOINTS)) return SIN_DIRECCION
  if (mensaje.includes(PROTOCOLO_INSEGURO)) return SIN_HTTPS
  if (RED.test(mensaje)) return SIN_RED

  return DESCONOCIDO
}
