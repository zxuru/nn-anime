/**
 * Selector de tema.
 *
 * El tema se guarda en los ajustes del servidor y se aplica con el atributo
 * `data-theme` en el documento: los colores ya están declarados para los dos
 * temas en la hoja de estructura, así que cambiar de tema es cambiar un atributo,
 * no recalcular estilos.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export type Theme = 'dark' | 'light' | 'system'

export interface ThemeToggleProps {
  readonly value: Theme
  readonly onChange: (theme: Theme) => void
}

/** El tema que se aplica de verdad, resolviendo `system`. */
export function resolvedTheme(theme: Theme, prefersLight: boolean): 'dark' | 'light' {
  if (theme === 'system') return prefersLight ? 'light' : 'dark'

  return theme
}

/** El atributo que entiende la hoja de estilos. */
export function themeAttribute(theme: Theme, prefersLight: boolean): string {
  return resolvedTheme(theme, prefersLight)
}

/**
 * Las claves del catálogo, escritas una a una.
 *
 * Una clave compuesta con el tema funcionaría igual en tiempo de ejecución y
 * escondería los textos al buscador de claves sin usar: acabarían borradas del
 * catálogo por parecer huérfanas.
 */
const THEME_KEYS = {
  system: 'settings.theme.system',
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
} as const

export function ThemeToggle(props: ThemeToggleProps): ReactNode {
  const opciones: readonly Theme[] = ['system', 'dark', 'light']

  return (
    <div className="settings__theme" role="group" aria-label={t(DEFAULT_LOCALE, 'settings.theme')}>
      {opciones.map((opcion) => (
        <button
          key={opcion}
          type="button"
          className="button"
          aria-pressed={props.value === opcion}
          onClick={() => props.onChange(opcion)}
        >
          {t(DEFAULT_LOCALE, THEME_KEYS[opcion])}
        </button>
      ))}
    </div>
  )
}
