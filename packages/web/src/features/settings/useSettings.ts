/**
 * Los ajustes, leídos de la fuente compartida.
 *
 * La lectura y las escrituras viven en `almacen.ts`; aquí sólo se conecta el
 * almacén a React. Es lo que evita que la raíz —que aplica el tema— y la pantalla
 * de Ajustes pidan `/api/settings` cada una por su lado: las dos llaman a
 * `cargarAjustes`, y la segunda encuentra la lectura hecha.
 */

import type { ProviderSummary, SettingsResponse } from '@rona/core/api'
import { useEffect, useSyncExternalStore } from 'react'
import {
  type Ajustes,
  cargarAjustes,
  estadoAjustes,
  fijarClaveTmdb,
  fijarContenidoAdultos,
  fijarPresenciaDiscord,
  fijarPrioridadProveedores,
  fijarTema,
  recargarAjustes,
  registrarProveedor,
  type SettingsState,
  suscribirAjustes,
} from './almacen'
import { themeAttribute } from './ThemeToggle'
import { guardarTemaPreferido } from './tema-arranque'

export type { SettingsState }

export interface Settings extends Ajustes {
  readonly setTheme: (theme: 'dark' | 'light' | 'system') => void
  /**
   * Enseña o esconde el contenido que AniList marca para adultos.
   *
   * Es del servidor y no del navegador: con él se decide qué se pide a AniList, qué se
   * guarda y qué se sirve, así que la interfaz sólo lo refleja.
   */
  readonly setAdultContent: (adultContent: boolean) => void
  /** Publica o retira la presencia de Discord; el servidor decide qué enseña. */
  readonly setDiscordPresence: (mode: SettingsResponse['discordPresence']) => void
  /** Guarda el orden de preferencia de proveedores, del primero al último. */
  readonly setProviderPriority: (order: readonly string[]) => void
  /**
   * Guarda o borra la clave de TMDB. Devuelve una promesa y no es optimista: la
   * clave no se puede pintar, así que lo único que cambia es «configurada», y
   * enseñarlo antes de que el servidor conteste sería afirmar que se guardó
   * cuando puede que no. `null` la borra.
   */
  readonly setTmdbKey: (key: string | null) => Promise<void>
  /** Registra un proveedor y refresca la lista. Lanza si no se pudo. */
  readonly register: (draft: unknown) => Promise<ProviderSummary>
  /** Vuelve a leer los ajustes. */
  readonly refresh: () => void
}

/**
 * El tema, aplicado al documento.
 *
 * El atributo `data-theme` es lo que la hoja de estilos mira para cambiar de
 * paleta. Estaba declarado en los tokens y **nadie lo escribía**: el selector de
 * ajustes guardaba el tema y no cambiaba nada, así que el tema claro era
 * inalcanzable. Lo encontró la captura del rediseño, no una prueba.
 *
 * Se aplica desde la raíz y no desde la pantalla de ajustes: el tema es de la
 * aplicación entera, y quien entra directo a la búsqueda tiene que verlo igual.
 *
 * `public/theme-boot.js` ya dejó puesto el tema antes del primer pintado con la
 * preferencia de `localStorage`. Aquí manda el servidor: el efecto reescribe el
 * atributo y `color-scheme` —el script lo dejó en el `style` del documento, y
 * sin reescribirlo el tema viejo ganaría por orden de cascada— y guarda el valor
 * leído para el próximo arranque. Mientras no hay datos no se toca nada: lo que
 * pintó el arranque ya respeta el sistema, y adelantarse a la respuesta sería
 * cambiarlo dos veces.
 */
export function useAppTheme(): void {
  const { data } = useSettings()

  useEffect(() => {
    const tema = data?.theme
    if (tema === undefined) return

    const prefiereClaro =
      typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    const resuelto = themeAttribute(tema, prefiereClaro)
    const raiz = document.documentElement

    raiz.dataset.theme = resuelto
    raiz.style.colorScheme = resuelto
    guardarTemaPreferido(tema)
  }, [data?.theme])
}

/**
 * Los ajustes, reactivos y compartidos.
 *
 * El efecto no vuelve a pedir nada si la raíz ya los leyó: `cargarAjustes` es
 * idempotente y aquí no hay ninguna decisión que tomar. El estado en servidor es
 * el inicial —«cargando»—, que es lo que pinta la página en `renderToString`.
 */
export function useSettings(): Settings {
  const estado = useSyncExternalStore(suscribirAjustes, estadoAjustes, estadoAjustes)

  useEffect(() => {
    void cargarAjustes()
  }, [])

  return {
    ...estado,
    // Las escrituras son las del almacén y no se recrean por render: su
    // identidad es estable, así que un hijo memoizado no se repinta porque el
    // gancho devuelva otro objeto.
    setTheme: fijarTema,
    setProviderPriority: fijarPrioridadProveedores,
    setAdultContent: fijarContenidoAdultos,
    setDiscordPresence: fijarPresenciaDiscord,
    setTmdbKey: fijarClaveTmdb,
    register: registrarProveedor,
    refresh: recargarAjustes,
  }
}
