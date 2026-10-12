/**
 * La lista de proveedores, incluidos los rechazados.
 *
 * Enseñar los rechazados con su motivo es lo que convierte un misterio en un
 * problema con solución: el usuario copió un archivo, no pasa nada, y sin el
 * motivo no tiene por dónde empezar.
 *
 * La misma lista **ordena la preferencia**. El orden es el dato —la búsqueda
 * enseña la obra una sola vez, y la tarjeta lleva a la primera fuente de esta
 * lista que la tenga—, así que se cambia con dos botones y no arrastrando: el
 * orden tiene que poder cambiarse con teclado. Un rechazado no se mueve ni se
 * marca como preferido: no ofrece nada que elegir.
 */

import type { SettingsResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface ProviderListProps {
  readonly providers: SettingsResponse['providers']
  /** El orden guardado, del preferido al último. Un id que no exista se ignora. */
  readonly priority?: readonly string[]
  /** Recibe la lista de activos entera, ya reordenada. */
  readonly onReorder?: (order: readonly string[]) => void
}

type Provider = SettingsResponse['providers'][number]

/** Las capacidades, en texto. */
function capabilitiesOf(provider: Provider): string {
  const activas: string[] = []
  if (provider.capabilities.search) activas.push(t(DEFAULT_LOCALE, 'settings.cap.search'))
  if (provider.capabilities.sub) activas.push(t(DEFAULT_LOCALE, 'settings.cap.sub'))
  if (provider.capabilities.dub) activas.push(t(DEFAULT_LOCALE, 'settings.cap.dub'))
  if (provider.capabilities.trending) activas.push(t(DEFAULT_LOCALE, 'settings.cap.trending'))
  if (provider.capabilities.feed) activas.push(t(DEFAULT_LOCALE, 'settings.cap.feed'))

  return activas.length === 0 ? t(DEFAULT_LOCALE, 'settings.cap.none') : activas.join(' · ')
}

/**
 * Los proveedores en el orden que se enseña: primero los activos según la
 * preferencia guardada, después los activos que la lista no nombra —en el orden
 * en que cargaron— y al final los rechazados.
 *
 * Se ordena con un índice y un `sort` estable en vez de reconstruir la lista desde
 * `priority`: así un proveedor nuevo, que nadie ha reordenado todavía, aparece en
 * su sitio en lugar de desaparecer de la pantalla hasta que se le asigne un
 * puesto.
 */
export function providersByPriority(
  providers: readonly Provider[],
  priority: readonly string[],
): readonly Provider[] {
  const puestos = new Map(priority.map((id, indice) => [id, indice]))
  const puesto = (id: string): number => puestos.get(id) ?? Number.MAX_SAFE_INTEGER

  const activos = providers.filter((provider) => provider.status === 'active')
  const rechazados = providers.filter((provider) => provider.status !== 'active')

  return [...[...activos].sort((uno, otro) => puesto(uno.id) - puesto(otro.id)), ...rechazados]
}

/** Mueve un elemento de la lista y devuelve una lista nueva. Fuera de rango, la misma. */
export function moved(order: readonly string[], desde: number, hasta: number): readonly string[] {
  if (hasta < 0 || hasta >= order.length) return order

  const copia = [...order]
  const [movido] = copia.splice(desde, 1)
  if (movido === undefined) return order

  copia.splice(hasta, 0, movido)

  return copia
}

export function ProviderList(props: ProviderListProps): ReactNode {
  if (props.providers.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'settings.providers.empty')}</p>
  }

  const orden = providersByPriority(props.providers, props.priority ?? [])
  const activos = orden.filter((provider) => provider.status === 'active').map((p) => p.id)
  const reordenable = props.onReorder !== undefined

  return (
    <>
      {reordenable ? (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'settings.priority.body')}</p>
      ) : null}
      <ul className="settings__providers">
        {orden.map((provider) => {
          const puesto = provider.status === 'active' ? activos.indexOf(provider.id) : -1

          return (
            <li key={`${provider.status}:${provider.id}`} className="episode">
              <span className="episode__title">{provider.name}</span>
              <span className="badge">
                {provider.status === 'active'
                  ? t(DEFAULT_LOCALE, 'settings.provider.active')
                  : t(DEFAULT_LOCALE, 'settings.provider.rejected')}
              </span>
              {puesto === 0 ? (
                <span className="badge">{t(DEFAULT_LOCALE, 'settings.provider.preferred')}</span>
              ) : null}
              <span className="card__meta">{capabilitiesOf(provider)}</span>
              {provider.reason === undefined ? null : (
                <span className="search__error">{provider.reason}</span>
              )}
              {puesto === -1 || !reordenable ? null : (
                <span>
                  <button
                    type="button"
                    className="settings__link"
                    disabled={puesto === 0}
                    aria-label={t(DEFAULT_LOCALE, 'settings.priority.up', {
                      provider: provider.name,
                    })}
                    onClick={() => props.onReorder?.(moved(activos, puesto, puesto - 1))}
                  >
                    {t(DEFAULT_LOCALE, 'settings.priority.moveUp')}
                  </button>
                  <button
                    type="button"
                    className="settings__link"
                    disabled={puesto === activos.length - 1}
                    aria-label={t(DEFAULT_LOCALE, 'settings.priority.down', {
                      provider: provider.name,
                    })}
                    onClick={() => props.onReorder?.(moved(activos, puesto, puesto + 1))}
                  >
                    {t(DEFAULT_LOCALE, 'settings.priority.moveDown')}
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
