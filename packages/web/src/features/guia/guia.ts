/**
 * La guía de la aplicación: un recorrido por pantalla y los avisos de novedad.
 *
 * Cada sección tiene el suyo —Inicio, Buscar, Biblioteca, Perfil, Historial,
 * Ajustes, la ficha y el reproductor— y sale la primera vez que se entra en
 * ella. El «?» de la cabecera repite el de la pantalla en la que estás; Ajustes
 * los lista todos. Así una pantalla nueva no hereda el tutorial de otra: se
 * añade su recorrido aquí y sus anclas en el marcado.
 *
 * Los avisos son otra cosa: un faro sobre una función recién publicada, que se
 * descarta y no vuelve.
 *
 * Aquí no hay DOM ni driver.js: sólo datos y el estado de lo visto, para poder
 * probarlo sin navegador. Quien los convierte en pasos es `useGuia.ts`.
 */

import type { RouteName } from '../../router'

/** El ancla que un paso busca en el marcado: `data-tour="…"`. */
export const ANCLAS = {
  // La cabecera, común a todas las pantallas.
  cabecera: 'cabecera',
  buscar: 'buscar',
  biblioteca: 'biblioteca',
  ajustes: 'ajustes',
  tipo: 'tipo',
  // Inicio.
  destacado: 'destacado',
  continuar: 'continuar',
  recomendado: 'recomendado',
  // Buscar.
  buscadorCampo: 'buscador-campo',
  buscadorEstado: 'buscador-estado',
  // Biblioteca.
  bibliotecaResumen: 'biblioteca-resumen',
  bibliotecaColeccion: 'biblioteca-coleccion',
  bibliotecaAjustes: 'biblioteca-ajustes',
  // Perfil.
  perfilListas: 'perfil-listas',
  perfilHistorial: 'perfil-historial',
  // Historial.
  historialLista: 'historial-lista',
  historialPaginas: 'historial-paginas',
  // Ajustes.
  ajustesProveedores: 'ajustes-proveedores',
  ajustesTema: 'ajustes-tema',
  ajustesGuia: 'ajustes-guia',
  // Ficha.
  fichaAcciones: 'ficha-acciones',
  fichaModos: 'ficha-modos',
  fichaEpisodios: 'ficha-episodios',
  // Reproductor.
  reproductorVideo: 'reproductor-video',
  reproductorMandos: 'reproductor-mandos',
  reproductorEpisodios: 'reproductor-episodios',
} as const

export type Lado = 'top' | 'right' | 'bottom' | 'left'
export type Alineacion = 'start' | 'center' | 'end'

export interface PasoGuia {
  readonly id: string
  /** Sin ancla, el paso va centrado: sirve para abrir el recorrido. */
  readonly ancla?: string
  readonly titulo: string
  readonly cuerpo: string
  readonly lado?: Lado
  readonly alineacion?: Alineacion
}

/**
 * El recorrido de una pantalla.
 *
 * `rutas` y no `ruta`: la biblioteca conserva la dirección vieja (`/downloads`)
 * y las dos abren la misma pantalla, así que el mismo recorrido sirve para las
 * dos.
 */
export interface Recorrido {
  readonly id: string
  /** El nombre de la sección, para el «?» y para la lista de Ajustes. */
  readonly titulo: string
  readonly rutas: readonly RouteName[]
  readonly pasos: readonly PasoGuia[]
}

export interface AvisoGuia {
  readonly id: string
  readonly ancla: string
  readonly titulo: string
  readonly cuerpo: string
  readonly lado?: Lado
  readonly alineacion?: Alineacion
  readonly rutas?: readonly RouteName[]
}

const INICIO: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.inicio.bienvenida.titulo',
    cuerpo: 'guia.inicio.bienvenida.cuerpo',
  },
  {
    id: 'cabecera',
    ancla: ANCLAS.cabecera,
    titulo: 'guia.inicio.cabecera.titulo',
    cuerpo: 'guia.inicio.cabecera.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'tipo',
    ancla: ANCLAS.tipo,
    titulo: 'guia.inicio.tipo.titulo',
    cuerpo: 'guia.inicio.tipo.cuerpo',
    lado: 'bottom',
    alineacion: 'end',
  },
  {
    id: 'destacado',
    ancla: ANCLAS.destacado,
    titulo: 'guia.inicio.destacado.titulo',
    cuerpo: 'guia.inicio.destacado.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'continuar',
    ancla: ANCLAS.continuar,
    titulo: 'guia.inicio.continuar.titulo',
    cuerpo: 'guia.inicio.continuar.cuerpo',
    lado: 'top',
    alineacion: 'center',
  },
  {
    id: 'recomendado',
    ancla: ANCLAS.recomendado,
    titulo: 'guia.inicio.recomendado.titulo',
    cuerpo: 'guia.inicio.recomendado.cuerpo',
    lado: 'top',
    alineacion: 'center',
  },
]

const BUSCAR: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.buscar.bienvenida.titulo',
    cuerpo: 'guia.buscar.bienvenida.cuerpo',
  },
  {
    id: 'campo',
    ancla: ANCLAS.buscadorCampo,
    titulo: 'guia.buscar.campo.titulo',
    cuerpo: 'guia.buscar.campo.cuerpo',
    lado: 'bottom',
    alineacion: 'start',
  },
  {
    id: 'estado',
    ancla: ANCLAS.buscadorEstado,
    titulo: 'guia.buscar.estado.titulo',
    cuerpo: 'guia.buscar.estado.cuerpo',
    lado: 'bottom',
    alineacion: 'start',
  },
]

const BIBLIOTECA: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.biblioteca.bienvenida.titulo',
    cuerpo: 'guia.biblioteca.bienvenida.cuerpo',
  },
  {
    id: 'resumen',
    ancla: ANCLAS.bibliotecaResumen,
    titulo: 'guia.biblioteca.resumen.titulo',
    cuerpo: 'guia.biblioteca.resumen.cuerpo',
    lado: 'bottom',
    alineacion: 'start',
  },
  {
    id: 'coleccion',
    ancla: ANCLAS.bibliotecaColeccion,
    titulo: 'guia.biblioteca.coleccion.titulo',
    cuerpo: 'guia.biblioteca.coleccion.cuerpo',
    lado: 'top',
    alineacion: 'center',
  },
  {
    id: 'ajustes',
    ancla: ANCLAS.bibliotecaAjustes,
    titulo: 'guia.biblioteca.ajustes.titulo',
    cuerpo: 'guia.biblioteca.ajustes.cuerpo',
    lado: 'top',
    alineacion: 'start',
  },
]

const PERFIL: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.perfil.bienvenida.titulo',
    cuerpo: 'guia.perfil.bienvenida.cuerpo',
  },
  {
    id: 'listas',
    ancla: ANCLAS.perfilListas,
    titulo: 'guia.perfil.listas.titulo',
    cuerpo: 'guia.perfil.listas.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'historial',
    ancla: ANCLAS.perfilHistorial,
    titulo: 'guia.perfil.historial.titulo',
    cuerpo: 'guia.perfil.historial.cuerpo',
    lado: 'top',
    alineacion: 'center',
  },
]

const HISTORIAL: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.historial.bienvenida.titulo',
    cuerpo: 'guia.historial.bienvenida.cuerpo',
  },
  {
    id: 'lista',
    ancla: ANCLAS.historialLista,
    titulo: 'guia.historial.lista.titulo',
    cuerpo: 'guia.historial.lista.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'paginas',
    ancla: ANCLAS.historialPaginas,
    titulo: 'guia.historial.paginas.titulo',
    cuerpo: 'guia.historial.paginas.cuerpo',
    lado: 'top',
    alineacion: 'center',
  },
]

const AJUSTES: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.ajustesRecorrido.bienvenida.titulo',
    cuerpo: 'guia.ajustesRecorrido.bienvenida.cuerpo',
  },
  {
    id: 'proveedores',
    ancla: ANCLAS.ajustesProveedores,
    titulo: 'guia.ajustesRecorrido.proveedores.titulo',
    cuerpo: 'guia.ajustesRecorrido.proveedores.cuerpo',
    lado: 'bottom',
    alineacion: 'start',
  },
  {
    id: 'tema',
    ancla: ANCLAS.ajustesTema,
    titulo: 'guia.ajustesRecorrido.tema.titulo',
    cuerpo: 'guia.ajustesRecorrido.tema.cuerpo',
    lado: 'top',
    alineacion: 'start',
  },
  {
    id: 'guia',
    ancla: ANCLAS.ajustesGuia,
    titulo: 'guia.ajustesRecorrido.guia.titulo',
    cuerpo: 'guia.ajustesRecorrido.guia.cuerpo',
    lado: 'top',
    alineacion: 'start',
  },
]

const FICHA: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.ficha.bienvenida.titulo',
    cuerpo: 'guia.ficha.bienvenida.cuerpo',
  },
  {
    id: 'acciones',
    ancla: ANCLAS.fichaAcciones,
    titulo: 'guia.ficha.acciones.titulo',
    cuerpo: 'guia.ficha.acciones.cuerpo',
    lado: 'right',
    alineacion: 'start',
  },
  {
    id: 'modos',
    ancla: ANCLAS.fichaModos,
    titulo: 'guia.ficha.modos.titulo',
    cuerpo: 'guia.ficha.modos.cuerpo',
    lado: 'right',
    alineacion: 'start',
  },
  {
    id: 'episodios',
    ancla: ANCLAS.fichaEpisodios,
    titulo: 'guia.ficha.episodios.titulo',
    cuerpo: 'guia.ficha.episodios.cuerpo',
    lado: 'top',
    alineacion: 'center',
  },
]

const REPRODUCTOR: readonly PasoGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'guia.reproductor.bienvenida.titulo',
    cuerpo: 'guia.reproductor.bienvenida.cuerpo',
  },
  {
    id: 'video',
    ancla: ANCLAS.reproductorVideo,
    titulo: 'guia.reproductor.video.titulo',
    cuerpo: 'guia.reproductor.video.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'mandos',
    ancla: ANCLAS.reproductorMandos,
    titulo: 'guia.reproductor.mandos.titulo',
    cuerpo: 'guia.reproductor.mandos.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
  {
    id: 'episodios',
    ancla: ANCLAS.reproductorEpisodios,
    titulo: 'guia.reproductor.episodios.titulo',
    cuerpo: 'guia.reproductor.episodios.cuerpo',
    lado: 'left',
    alineacion: 'start',
  },
]

/**
 * Los recorridos, en el orden en que se leen.
 *
 * Un recorrido por pantalla, no por destino del menú: la ficha y el reproductor
 * también tienen el suyo. El de la biblioteca cubre la dirección vieja.
 */
export const RECORRIDOS: readonly Recorrido[] = [
  { id: 'inicio', titulo: 'guia.recorrido.inicio', rutas: ['home'], pasos: INICIO },
  { id: 'buscar', titulo: 'guia.recorrido.buscar', rutas: ['search'], pasos: BUSCAR },
  {
    id: 'biblioteca',
    titulo: 'guia.recorrido.biblioteca',
    rutas: ['library', 'downloads'],
    pasos: BIBLIOTECA,
  },
  { id: 'perfil', titulo: 'guia.recorrido.perfil', rutas: ['profile'], pasos: PERFIL },
  { id: 'historial', titulo: 'guia.recorrido.historial', rutas: ['history'], pasos: HISTORIAL },
  { id: 'ajustes', titulo: 'guia.recorrido.ajustes', rutas: ['settings'], pasos: AJUSTES },
  { id: 'ficha', titulo: 'guia.recorrido.ficha', rutas: ['detail'], pasos: FICHA },
  {
    id: 'reproductor',
    titulo: 'guia.recorrido.reproductor',
    rutas: ['watch'],
    pasos: REPRODUCTOR,
  },
]

/**
 * Los avisos de lo nuevo.
 *
 * Un aviso se publica con la función que anuncia: se añade aquí su entrada, se
 * le pone un ancla en el marcado y dos textos en el catálogo. La primera visita
 * siembra la línea base con los avisos que ya existían, así que sólo ve el faro
 * quien ya tenía la aplicación antes de la función. No hay fechas ni versiones
 * que mantener: el id es la fecha.
 */
export const AVISOS: readonly AvisoGuia[] = [
  {
    id: 'biblioteca-2026-10',
    ancla: ANCLAS.biblioteca,
    titulo: 'guia.aviso.biblioteca.titulo',
    cuerpo: 'guia.aviso.biblioteca.cuerpo',
    lado: 'bottom',
    alineacion: 'center',
  },
]

/** El selector que busca un paso. El valor es interno: no lleva comillas. */
export function selectorDeAncla(ancla: string): string {
  return `[data-tour="${ancla}"]`
}

/** El recorrido de una pantalla, si lo tiene. */
export function recorridoDeRuta(ruta: RouteName): Recorrido | undefined {
  return RECORRIDOS.find((recorrido) => recorrido.rutas.includes(ruta))
}

export interface EstadoGuia {
  /**
   * Los ids de los recorridos que esta instalación ya vio.
   *
   * Cerrar el recorrido también cuenta: se puede repetir desde Ajustes o con el
   * «?». Un recorrido nuevo —otra pantalla, o una pantalla que antes no tenía—
   * no está aquí y por eso sale solo.
   */
  readonly recorridos: readonly string[]
  /**
   * Los ids de los avisos que esta instalación ya conoce.
   *
   * En la primera lectura se siembra con los avisos publicados hasta entonces:
   * lo que ya existía al instalar no es una novedad. Un aviso añadido después
   * tiene un id que no está aquí y por eso sale.
   */
  readonly vistos: readonly string[]
}

/**
 * La clave y la versión del almacén.
 *
 * La 2 cambió `bienvenida: boolean` por `recorridos: string[]`; la 1 se migra
 * en `normalizarEstado` para no perder lo que el usuario ya había visto.
 */
export const CLAVE_GUIA = 'nn-anime.guia'
export const VERSION_GUIA = 2

/** El estado de una instalación que abre la aplicación por primera vez. */
export function estadoInicial(avisos: readonly AvisoGuia[] = AVISOS): EstadoGuia {
  return { recorridos: [], vistos: avisos.map((aviso) => aviso.id) }
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function listaDeTextos(valor: unknown): readonly string[] {
  if (!Array.isArray(valor)) return []

  return [...new Set(valor.filter((id): id is string => typeof id === 'string'))]
}

/**
 * Convierte lo que haya en el almacén en un estado utilizable.
 *
 * Un JSON de otra versión, un valor a medias o basura no rompen la aplicación:
 * se vuelve al estado inicial. Es un archivo del navegador, no un contrato. La
 * única excepción es la versión 1, que se migra: su `bienvenida` era el
 * recorrido de Inicio.
 */
export function normalizarEstado(
  crudo: unknown,
  avisos: readonly AvisoGuia[] = AVISOS,
): EstadoGuia {
  if (!esRegistro(crudo)) return estadoInicial(avisos)

  const vistos = listaDeTextos(crudo.vistos)

  if (crudo.v === 1) {
    return { recorridos: crudo.bienvenida === true ? ['inicio'] : [], vistos }
  }

  if (crudo.v !== VERSION_GUIA) return estadoInicial(avisos)

  return { recorridos: listaDeTextos(crudo.recorridos), vistos }
}

type Lectura = Pick<Storage, 'getItem'>
type Escritura = Pick<Storage, 'setItem'>

/** Lee el estado guardado; sin almacén o con basura, el inicial. */
export function leerEstado(almacen: Lectura | undefined): EstadoGuia {
  const crudo = almacen?.getItem(CLAVE_GUIA)
  if (crudo === null || crudo === undefined) return estadoInicial()

  try {
    return normalizarEstado(JSON.parse(crudo))
  } catch {
    return estadoInicial()
  }
}

/**
 * Guarda el estado.
 *
 * Un almacén lleno o prohibido —modo privado— no puede impedir que la guía
 * funcione: se pierde la memoria y los recorridos vuelven a salir en la sesión
 * siguiente, que es un fallo menor comparado con romper la aplicación.
 */
export function guardarEstado(almacen: Escritura | undefined, estado: EstadoGuia): void {
  if (almacen === undefined) return

  try {
    almacen.setItem(
      CLAVE_GUIA,
      JSON.stringify({
        v: VERSION_GUIA,
        recorridos: estado.recorridos,
        vistos: estado.vistos,
      }),
    )
  } catch {
    return
  }
}

/** El recorrido `id`, visto. */
export function conRecorrido(estado: EstadoGuia, id: string): EstadoGuia {
  return estado.recorridos.includes(id)
    ? estado
    : { ...estado, recorridos: [...estado.recorridos, id] }
}

/** El recorrido de esta pantalla, si aún no se vio. */
export function recorridoPendiente(estado: EstadoGuia, ruta: RouteName): Recorrido | undefined {
  const recorrido = recorridoDeRuta(ruta)

  return recorrido !== undefined && !estado.recorridos.includes(recorrido.id)
    ? recorrido
    : undefined
}

/** Un aviso, descartado. */
export function sinAviso(estado: EstadoGuia, id: string): EstadoGuia {
  return estado.vistos.includes(id) ? estado : { ...estado, vistos: [...estado.vistos, id] }
}

/** Los avisos de hoy vuelven a estar pendientes; lo demás no se toca. */
export function sinAvisos(estado: EstadoGuia, avisos: readonly AvisoGuia[] = AVISOS): EstadoGuia {
  const ids = new Set(avisos.map((aviso) => aviso.id))

  return { ...estado, vistos: estado.vistos.filter((id) => !ids.has(id)) }
}

/** Los avisos que esta pantalla puede enseñar y esta instalación no vio. */
export function avisosPendientes(
  estado: EstadoGuia,
  ruta: RouteName,
  avisos: readonly AvisoGuia[] = AVISOS,
): readonly AvisoGuia[] {
  return avisos.filter(
    (aviso) =>
      !estado.vistos.includes(aviso.id) &&
      (aviso.rutas === undefined || aviso.rutas.includes(ruta)),
  )
}
