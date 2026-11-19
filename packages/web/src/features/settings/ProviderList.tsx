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
 *
 * **Las capacidades son iconos, no una lista de palabras.** Cinco palabras
 * separadas por puntos ocupaban un renglón entero y se leían como una frase; el
 * dibujo dice lo mismo de un vistazo y el `aria-label` conserva el nombre para
 * quien no lo ve. Los badges llevan su icono por la misma razón: «ANIME»,
 * «ACTIVO» y «PREFERIDO» se distinguen por la forma además de por el texto.
 */

import type { ProviderProbeResponse, SettingsResponse } from '@rona/core/api'
import { providerProbeResponseSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import {
  Activity,
  Bell,
  Captions,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleOff,
  Languages,
  Search,
  Star,
  TrendingUp,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { apiPostJson, type RequestDeps } from '../../api/client'
import { describirFallo } from '../../api/fallo'
import { resumenDeFallo } from '../../components/ErrorNotice'
import { t } from '../../i18n'

/**
 * Prueba un proveedor contra su ruta del servidor.
 *
 * La ruta no guarda nada: el resultado se queda en el estado de esta fila y
 * desaparece al recargar. Las dependencias se pueden inyectar para medir la
 * llamada sin red, igual que en el resto del cliente HTTP.
 */
export function probeProvider(id: string, deps?: RequestDeps): Promise<ProviderProbeResponse> {
  return apiPostJson(
    `/api/providers/${encodeURIComponent(id)}/probe`,
    {},
    providerProbeResponseSchema,
    {},
    deps,
  )
}

/** Lo que se sabe de una prueba mientras se hace o después. */
export type ProbeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly result: ProviderProbeResponse }
  | { readonly kind: 'unreachable'; readonly message: string }

/** El texto de una prueba, o vacío mientras no hay nada que contar. */
export function probeStatusText(state: ProbeState): string {
  if (state.kind === 'idle') return ''
  if (state.kind === 'running') return t(DEFAULT_LOCALE, 'settings.provider.probeRunning')
  if (state.kind === 'unreachable') {
    return t(DEFAULT_LOCALE, 'settings.provider.probeUnreachable', { message: state.message })
  }

  if (state.result.ok) {
    return t(DEFAULT_LOCALE, 'settings.provider.probeOk', { ms: state.result.latencyMs })
  }

  return t(DEFAULT_LOCALE, 'settings.provider.probeFailed', { message: state.result.error ?? '' })
}

/**
 * El resultado de una prueba, en la región viva de la fila.
 *
 * Es `role="status"` porque la prueba termina sin que el foco se mueva: sin
 * anunciarlo, quien usa un lector de pantalla pulsa «Probar» y no oye nada.
 */
export function ProbeStatus(props: { readonly state: ProbeState }): ReactNode {
  const falla =
    props.state.kind === 'unreachable' || (props.state.kind === 'done' && !props.state.result.ok)

  return (
    <span className={falla ? 'search__error' : 'field__hint'} role="status" aria-live="polite">
      {probeStatusText(props.state)}
    </span>
  )
}

/** El mensaje de un fallo al hablar con la ruta: primero lo que dijo el servidor. */
function messageOf(cause: unknown): string {
  const fallo = describirFallo(cause)

  return fallo.detalle ?? resumenDeFallo(fallo)
}

/**
 * El botón de probar de una fila.
 *
 * El estado es local a la fila a propósito: probar una fuente no deshabilita las
 * demás ni la lista entera. Es un diagnóstico, no una operación de la pantalla.
 */
function ProbeButton(props: {
  readonly provider: Provider
  readonly probe: (id: string) => Promise<ProviderProbeResponse>
}): ReactNode {
  const [state, setState] = useState<ProbeState>({ kind: 'idle' })
  const ejecutando = state.kind === 'running'
  const etiqueta = t(DEFAULT_LOCALE, 'settings.provider.probeLabel', {
    provider: props.provider.name,
  })

  function probar(): void {
    setState({ kind: 'running' })

    void props.probe(props.provider.id).then(
      (result) => setState({ kind: 'done', result }),
      (cause: unknown) => setState({ kind: 'unreachable', message: messageOf(cause) }),
    )
  }

  return (
    <span className="settings__caps">
      <button
        type="button"
        className="settings__link settings__link--icono"
        disabled={ejecutando}
        aria-label={etiqueta}
        title={etiqueta}
        onClick={probar}
      >
        <Activity size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
        {t(DEFAULT_LOCALE, 'settings.provider.probe')}
      </button>
      <ProbeStatus state={state} />
    </span>
  )
}

export interface ProviderListProps {
  readonly providers: SettingsResponse['providers']
  /** El orden guardado, del preferido al último. Un id que no exista se ignora. */
  readonly priority?: readonly string[]
  /** Recibe la lista de activos entera, ya reordenada. */
  readonly onReorder?: (order: readonly string[]) => void
  /**
   * Ejecuta la prueba de un proveedor.
   *
   * Por defecto llama a `POST /api/providers/:id/probe`; las pruebas de la
   * pantalla inyectan un doble para medir lo que se pinta sin abrir la red.
   */
  readonly onProbe?: (id: string) => Promise<ProviderProbeResponse>
}

type Provider = SettingsResponse['providers'][number]

/**
 * Las cinco capacidades, cada una con su dibujo y su clave de texto.
 *
 * El orden es el del contrato: primero lo que se puede buscar, después lo que se
 * puede oír y al final lo que se publica sin preguntar.
 */
const CAPACIDADES = [
  {
    clave: 'settings.cap.search',
    icono: Search,
    activa: (c: Provider['capabilities']) => c.search,
  },
  { clave: 'settings.cap.sub', icono: Captions, activa: (c: Provider['capabilities']) => c.sub },
  { clave: 'settings.cap.dub', icono: Languages, activa: (c: Provider['capabilities']) => c.dub },
  {
    clave: 'settings.cap.trending',
    icono: TrendingUp,
    activa: (c: Provider['capabilities']) => c.trending,
  },
  { clave: 'settings.cap.feed', icono: Bell, activa: (c: Provider['capabilities']) => c.feed },
] as const

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

/** Los badges de un proveedor, cada uno con su dibujo. */
function Badges(props: { readonly provider: Provider; readonly preferido: boolean }): ReactNode {
  const activo = props.provider.status === 'active'
  const IconoEstado = activo ? CircleCheck : CircleOff

  return (
    <>
      <span className="badge">
        <IconoEstado size={12} strokeWidth={2} aria-hidden="true" focusable="false" />
        {activo
          ? t(DEFAULT_LOCALE, 'settings.provider.active')
          : t(DEFAULT_LOCALE, 'settings.provider.rejected')}
      </span>
      {props.preferido ? (
        <span className="badge">
          <Star size={12} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(DEFAULT_LOCALE, 'settings.provider.preferred')}
        </span>
      ) : null}
    </>
  )
}

/**
 * Las capacidades activas, en iconos.
 *
 * Cada una lleva su nombre en el `aria-label` y en el `title`; el `role="img"` es
 * lo que hace que un lector de pantalla lo anuncie como una cosa con nombre y no
 * como un dibujo suelto.
 */
function Capabilities(props: { readonly capabilities: Provider['capabilities'] }): ReactNode {
  const activas = CAPACIDADES.filter((capacidad) => capacidad.activa(props.capabilities))

  if (activas.length === 0) {
    return <span className="card__meta">{t(DEFAULT_LOCALE, 'settings.cap.none')}</span>
  }

  return (
    <span className="settings__caps">
      {activas.map((capacidad) => {
        const etiqueta = t(DEFAULT_LOCALE, capacidad.clave)
        const Icono = capacidad.icono

        return (
          <span
            key={capacidad.clave}
            className="settings__cap"
            role="img"
            aria-label={etiqueta}
            title={etiqueta}
          >
            <Icono size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
          </span>
        )
      })}
    </span>
  )
}

export function ProviderList(props: ProviderListProps): ReactNode {
  if (props.providers.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'settings.providers.empty')}</p>
  }

  const orden = providersByPriority(props.providers, props.priority ?? [])
  const activos = orden.filter((provider) => provider.status === 'active').map((p) => p.id)
  const reordenable = props.onReorder !== undefined
  const probe = props.onProbe ?? probeProvider

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
              {/* Lo que sirve, antes del estado, y sólo si el plugin cargó: de un
                  rechazado no se sabe qué sirve —no declaró nada que valga— y
                  enseñar el defecto del contrato sería inventarle una capacidad, que
                  es lo que el motivo del rechazo ya evita. */}
              <Badges provider={provider} preferido={puesto === 0} />
              {/* También en un rechazado: «sin capacidades» es justo lo que
                  explica por qué no sirve, y esconderlo dejaba el motivo solo. */}
              <Capabilities capabilities={provider.capabilities} />
              {provider.status === 'active' && provider.capabilities.search ? (
                <ProbeButton provider={provider} probe={probe} />
              ) : null}
              {provider.warning === undefined ? null : (
                <span className="field__hint" role="status">
                  {t(DEFAULT_LOCALE, 'settings.provider.warning', { message: provider.warning })}
                </span>
              )}
              {provider.lastError === undefined && provider.reason === undefined ? null : (
                <span className="search__error">
                  {provider.lastError === undefined
                    ? provider.reason
                    : t(DEFAULT_LOCALE, 'settings.provider.lastError', {
                        message: provider.lastError,
                      })}
                </span>
              )}
              {puesto === -1 || !reordenable ? null : (
                <span className="settings__order">
                  <button
                    type="button"
                    className="settings__order-boton"
                    disabled={puesto === 0}
                    aria-label={t(DEFAULT_LOCALE, 'settings.priority.up', {
                      provider: provider.name,
                    })}
                    title={t(DEFAULT_LOCALE, 'settings.priority.up', { provider: provider.name })}
                    onClick={() => props.onReorder?.(moved(activos, puesto, puesto - 1))}
                  >
                    <ChevronUp size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                  </button>
                  <button
                    type="button"
                    className="settings__order-boton"
                    disabled={puesto === activos.length - 1}
                    aria-label={t(DEFAULT_LOCALE, 'settings.priority.down', {
                      provider: provider.name,
                    })}
                    title={t(DEFAULT_LOCALE, 'settings.priority.down', { provider: provider.name })}
                    onClick={() => props.onReorder?.(moved(activos, puesto, puesto + 1))}
                  >
                    <ChevronDown size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
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
