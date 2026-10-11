/**
 * Datos de la página de ajustes.
 *
 * Una lectura y una escritura, y la escritura es **optimista**: el tema cambia al
 * instante y se revierte si el servidor falla. Un selector de tema que espera a la
 * red para cambiar de color se siente roto, y el cambio es reversible.
 */

import type { SettingsResponse } from '@nn-anime/core/api'
import { settingsResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch } from '../../api/client'
import { themeAttribute } from './ThemeToggle'

export type SettingsState = 'loading' | 'ready' | 'error'

export interface Settings {
  readonly state: SettingsState
  readonly data: SettingsResponse | undefined
  readonly error: string | undefined
  readonly setTheme: (theme: 'dark' | 'light' | 'system') => void
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
  const [error, setError] = useState<string | undefined>(undefined)

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

        setError(cause instanceof Error ? cause.message : String(cause))
        setState('error')
      },
    )

    return () => {
      vivo = false
    }
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

  return { state, data, error, setTheme }
}
