/**
 * El registro vivo de proveedores.
 *
 * Un plugin nuevo tiene que estar disponible **sin reiniciar**, y eso no se
 * consigue recargando el archivo: todas las rutas ya tienen delante la lista de
 * proveedores que había al arrancar. Lo que sí se puede hacer es no cambiar
 * nunca las referencias y cambiar su contenido: las rutas leen
 * `options.providers` dentro del manejador, así que un array vaciado y rellenado
 * se ve al instante en la búsqueda, en el detalle y en los ajustes.
 *
 * De ahí las dos reglas de este módulo:
 *
 * 1. **La identidad no cambia.** `providers`, y los dos arrays del informe, se
 *    mutan en su sitio. Devolver arrays nuevos funcionaría en una prueba y
 *    dejaría la aplicación enseñando el proveedor viejo.
 * 2. **La recarga es todo o nada por archivo.** El loader ya trae esa garantía:
 *    un plugin que no conforma se queda fuera y los demás entran. Aquí sólo se
 *    copia su informe.
 */

import type { LoadReport, Provider } from '@nn-anime/provider-sdk'
import { loadProviders } from '@nn-anime/provider-sdk'
import type { PluginReport } from './routes/providers'

export interface ProviderHub {
  /**
   * Los proveedores activos, en el orden en que se cargaron.
   *
   * La referencia es estable durante toda la vida del proceso: se vacía y se
   * rellena. Quien la guarde, no se queda con una foto del arranque.
   */
  readonly providers: readonly Provider[]
  /** El informe del último intento de carga. Misma regla de identidad. */
  readonly report: PluginReport
  /** Vuelve a leer el directorio. Sin directorio, devuelve lo que ya hay. */
  reload(): Promise<PluginReport>
}

export interface ProviderHubOptions {
  /** Directorio de plugins. Sin él no hay nada que recargar. */
  readonly directory?: string | undefined
  /** Lo que el arranque ya cargó. */
  readonly initial?: PluginReport | undefined
  /** Inyectable: las pruebas comprueban la recarga sin escribir plugins. */
  readonly load?: ((directory: string, files: readonly string[]) => Promise<LoadReport>) | undefined
  /**
   * Los archivos de fuera del directorio que hay que cargar: los proveedores
   * habilitados de los repositorios descargados.
   *
   * Es una función y no una lista porque **se recalcula en cada recarga**, y ahí
   * está todo el asunto: habilitar una casilla en Ajustes tiene que verse sin
   * reiniciar, y quien sabe qué está habilitado es el store. El hub no consulta
   * los ajustes: pregunta.
   */
  readonly extraFiles?: (() => Promise<readonly string[]>) | undefined
}

const EMPTY: LoadReport = { active: [], rejected: [] }

/** Las filas del informe, tal como las ve este módulo. */
type ActiveEntry = PluginReport['active'][number]
type RejectedEntry = PluginReport['rejected'][number]

export function createProviderHub(options: ProviderHubOptions = {}): ProviderHub {
  const providers: Provider[] = []
  // Se declaran con la forma del informe y no con la del loader: un rechazo se
  // enseña por su mensaje, y un `PluginReport` sólo promete eso.
  const active: ActiveEntry[] = []
  const rejected: RejectedEntry[] = []
  const report: PluginReport = { active, rejected }
  const directory = options.directory
  const load =
    options.load ??
    ((target: string, files: readonly string[]) => loadProviders({ directory: target, files }))

  /** Copia en el sitio. Es lo único que puede tocar los tres arrays. */
  function apply(loaded: PluginReport): void {
    active.length = 0
    active.push(...loaded.active)
    rejected.length = 0
    rejected.push(...loaded.rejected)
    providers.length = 0
    providers.push(...loaded.active.map((entry) => entry.provider))
  }

  apply(
    options.initial === undefined
      ? EMPTY
      : { active: options.initial.active, rejected: options.initial.rejected },
  )

  return {
    providers,
    report,

    async reload(): Promise<PluginReport> {
      // Sin directorio no hay recarga, y devolver una lista vacía mentiría sobre
      // lo que hay cargado: se devuelve el informe actual tal cual.
      if (directory === undefined) return { active: [...active], rejected: [...rejected] }

      // Se pregunta por los habilitados **antes** de cargar: si el store falla,
      // el informe que ya había se queda como está en vez de vaciarse.
      const files = options.extraFiles === undefined ? [] : await options.extraFiles()
      const loaded = await load(directory, files)
      apply(loaded)

      return loaded
    },
  }
}
