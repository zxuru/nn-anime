/**
 * Datos de la página de ajustes.
 *
 * Una lectura y una escritura, y la escritura es **optimista**: el tema cambia al
 * instante y se revierte si el servidor falla. Un selector de tema que espera a la
 * red para cambiar de color se siente roto, y el cambio es reversible.
 */

import type { ProviderSummary, SettingsResponse } from '@nn-anime/core/api'
import { providerRegisterResponseSchema, settingsResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch, apiPostJson } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'
import { themeAttribute } from './ThemeToggle'

export type SettingsState = 'loading' | 'ready' | 'error'

export interface Settings {
  readonly state: SettingsState
  readonly data: SettingsResponse | undefined
  readonly error: Fallo | undefined
  readonly setTheme: (theme: 'dark' | 'light' | 'system') => void
  /**
   * Enseña o esconde el contenido que AniList marca para adultos.
   *
   * Es del servidor y no del navegador: con él se decide qué se pide a AniList, qué se
   * guarda y qué se sirve, así que la interfaz sólo lo refleja.
   */
  readonly setAdultContent: (adultContent: boolean) => void
  /** Guarda el orden de preferencia de proveedores, del primero al último. */
  readonly setProviderPriority: (order: readonly string[]) => void
  /** Registra un proveedor y refresca la lista. Lanza si no se pudo. */
  readonly register: (draft: unknown) => Promise<ProviderSummary>
  /**
   * Vuelve a leer los ajustes.
   *
   * Lo necesita la sección de repositorios: activar uno carga un proveedor nuevo
   * y la lista de proveedores de esta pantalla es la que tiene que enterarse. Se
   * relee en vez de componer la lista a mano porque el servidor es quien sabe qué
   * cargó de verdad —un archivo del repositorio puede estar rechazado—, y
   * componerla aquí sería una segunda versión de esa verdad.
   */
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
 */
export function useAppTheme(): void {
  const { data } = useSettings()

  useEffect(() => {
    const prefiereClaro =
      typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches

    document.documentElement.dataset.theme = themeAttribute(data?.theme ?? 'system', prefiereClaro)
  }, [data?.theme])
}

export function useSettings(): Settings {
  const [data, setData] = useState<SettingsResponse | undefined>(undefined)
  const [state, setState] = useState<SettingsState>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  // Un contador y no una función de carga: la lectura vive en el efecto, que es
  // el que sabe cancelarse al desmontar, y volver a leer es volver a ejecutarlo.
  const [lectura, setLectura] = useState(0)

  // El contador `lectura` es el disparador de la relectura y no un dato que el
  // efecto lea: por eso no aparece dentro, y por eso la supresión.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lectura` dispara la relectura
  useEffect(() => {
    let vivo = true

    void apiGet('/api/settings', settingsResponseSchema).then(
      (salida) => {
        if (!vivo) return

        setData(salida)
        setState('ready')
      },
      (cause: unknown) => {
        if (!vivo) return

        setError(describirFallo(cause))
        setState('error')
      },
    )

    return () => {
      vivo = false
    }
  }, [lectura])

  const refresh = useCallback(() => {
    // No se vuelve a «cargando»: la pantalla ya tiene datos y parpadeárselos
    // mientras se relee es peor que enseñar los de hace un segundo.
    setLectura((actual) => actual + 1)
  }, [])

  const setTheme = useCallback(
    (theme: 'dark' | 'light' | 'system') => {
      const previo = data?.theme

      setData((actual) => (actual === undefined ? actual : { ...actual, theme }))
      void apiPatch('/api/settings', { theme }).catch(() => {
        // Si no se pudo guardar, se vuelve al valor anterior: el tema que se ve
        // tiene que ser el que está guardado.
        setData((actual) =>
          actual === undefined || previo === undefined ? actual : { ...actual, theme: previo },
        )
      })
    },
    [data?.theme],
  )

  /**
   * El contenido para adultos, también optimista.
   *
   * El cambio no se ve en esta pantalla —no pinta ninguna fila— sino al volver a la
   * vitrina: sus filas se leen al montar la página, así que el ajuste nuevo lo ven sin
   * reiniciar nada.
   */
  const setAdultContent = useCallback(
    (adultContent: boolean) => {
      const previo = data?.adultContent

      setData((actual) => (actual === undefined ? actual : { ...actual, adultContent }))
      void apiPatch('/api/settings', { adultContent }).catch(() => {
        // Si no se pudo guardar, el interruptor vuelve a donde estaba: lo que se ve
        // tiene que ser lo que el servidor está aplicando.
        setData((actual) =>
          actual === undefined || previo === undefined
            ? actual
            : { ...actual, adultContent: previo },
        )
      })
    },
    [data?.adultContent],
  )

  /**
   * El orden, también optimista.
   *
   * Subir un proveedor se ve al instante y se deshace si el servidor falla. Un
   * botón que espera a la red para mover una fila invita a pulsarlo dos veces, y
   * la segunda pulsación movería la fila equivocada.
   */
  const setProviderPriority = useCallback(
    (order: readonly string[]) => {
      const previo = data?.providerPriority

      setData((actual) =>
        actual === undefined ? actual : { ...actual, providerPriority: [...order] },
      )
      void apiPatch('/api/settings', { providerPriority: order }).catch(() => {
        setData((actual) =>
          actual === undefined || previo === undefined
            ? actual
            : { ...actual, providerPriority: previo },
        )
      })
    },
    [data?.providerPriority],
  )

  const register = useCallback(async (draft: unknown): Promise<ProviderSummary> => {
    // Aquí no hay escritura optimista, y es a propósito: esto no pinta una lista,
    // escribe un archivo. Enseñar «guardado» antes de que el servidor conteste
    // sería enseñarlo justo cuando más importa saber si el plugin cargó.
    const salida = await apiPostJson('/api/providers', draft, providerRegisterResponseSchema)

    // La lista se actualiza con lo que el servidor devolvió, sin volver a pedirla:
    // la respuesta es el proveedor que quedó activo, y el servidor acaba de
    // recargar su registro, así que no hay nada más que preguntar. Se sustituye
    // por identificador en vez de añadir a ciegas, para que un alta repetida no
    // deje dos filas del mismo.
    setData((actual) =>
      actual === undefined
        ? actual
        : {
            ...actual,
            providers: [
              ...actual.providers.filter((provider) => provider.id !== salida.provider.id),
              salida.provider,
            ],
          },
    )

    return salida.provider
  }, [])

  return { state, data, error, setTheme, setProviderPriority, setAdultContent, register, refresh }
}
