/**
 * Tarjeta de un resultado.
 *
 * Es un **enlace de verdad** —`<a href>`, no un `div` con `onClick`—, así que se
 * alcanza con `Tab`, se abre en una pestaña nueva con el botón central y
 * funciona sin JavaScript. La navegación sin recarga se añade encima, en el
 * enrutador.
 *
 * La portada no se pide al sitio del proveedor: se pide a `/api/cover`, que es
 * lo que el contrato de la interfaz exige. Y si el resultado no trae portada, no
 * se pide nada: el hueco se ve como hueco en lugar de como una imagen rota.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { SearchResult } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'

export interface ResultCardProps {
  readonly result: SearchResult
  /** Nombre del proveedor, si se conoce. Si no, se muestra su id. */
  readonly providerLabel?: string
  readonly coverRequested?: boolean
  /**
   * Cuántos proveedores ofrecen este mismo título.
   *
   * Es una pista visual, no una fusión: la tarjeta sigue siendo de un proveedor
   * concreto y su enlace lleva a ese proveedor. El spec lo pide así porque dos
   * fichas con el mismo título no tienen por qué ser la misma obra.
   */
  readonly alsoIn?: number
  readonly onPreview?: () => void
  readonly onPreviewEnd?: () => void
}

/** Ruta de la portada en el proxy. La referencia va codificada: puede tener barras. */
export function coverPath(providerId: string, ref: string): string {
  return `/api/cover/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`
}

function meta(result: SearchResult): string {
  const partes: string[] = []
  if (result.year !== undefined)
    partes.push(t(DEFAULT_LOCALE, 'search.year', { year: result.year }))
  if (result.kind !== undefined) partes.push(result.kind)

  return partes.join(' · ')
}

export function ResultCard(props: ResultCardProps): ReactNode {
  const { result } = props
  const provider = props.providerLabel ?? result.ref.providerId
  const tienePortada = props.coverRequested ?? result.coverUrl !== undefined

  return (
    <Link
      to={`/anime/${encodeURIComponent(result.ref.providerId)}/${encodeURIComponent(result.ref.value)}`}
      className="card"
      title={result.title}
      {...(props.onPreview === undefined ? {} : { onMouseEnter: props.onPreview })}
      {...(props.onPreviewEnd === undefined ? {} : { onMouseLeave: props.onPreviewEnd })}
    >
      {tienePortada ? (
        <img
          className="card__cover"
          src={coverPath(result.ref.providerId, result.ref.value)}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="card__cover card__cover--vacia" aria-hidden="true" />
      )}
      <span className="card__title">{result.title}</span>
      {meta(result) === '' ? null : <span className="card__meta">{meta(result)}</span>}
      {props.alsoIn !== undefined && props.alsoIn > 1 ? (
        <span className="card__extra">
          {t(DEFAULT_LOCALE, 'search.alsoIn', { count: props.alsoIn })}
        </span>
      ) : null}
      <span className="badge">{t(DEFAULT_LOCALE, 'search.provider', { provider })}</span>
    </Link>
  )
}
