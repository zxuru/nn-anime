/**
 * Las otras fuentes que tienen el mismo episodio, cuando la activa falla.
 *
 * El reproductor sabe pedir la ficha de una fuente; lo que faltaba era decirlo
 * cuando no puede resolver el stream. La lista se construye con la misma lectura
 * que el «También en» de la ficha (`/sources`) y **la misma referencia de
 * episodio**, no con el número suelto: en una serie con temporadas, el número no
 * identifica nada.
 *
 * La posición viaja en el enlace (`at`) para que cambiar de fuente no empiece el
 * episodio desde cero. Si la otra fuente no tiene ese número, no se ofrece un
 * enlace que va a fallar.
 */

import {
  episodeResponseSchema,
  providersResponseSchema,
  sourcesResponseSchema,
} from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary, Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'
import { t } from '../../i18n'
import { Link } from '../../router'
import { episodeNumberPath, sourcesPath } from '../detail/useDetail'
import { type PlayMode, watchPath } from './watch-route'

export interface Alternativa {
  readonly providerId: string
  readonly name: string
  readonly href: string
}

/** Lo que hace falta para enlazar el mismo episodio en otra fuente. */
export interface AlternativaInput {
  readonly source: AnimeSummary
  readonly episode: Episode
  readonly mode: PlayMode
  readonly positionS: number
}

/**
 * La ruta de la alternativa, con la posición y la referencia reales.
 *
 * Es una función y no código dentro del efecto porque es lo único que se puede
 * medir sin red, y es donde vive el «no perder la posición».
 */
export function rutaDeAlternativa(input: AlternativaInput): string {
  return watchPath(input.source.ref.providerId, input.episode.ref.value, {
    mode: input.mode,
    anime: input.source.ref.value,
    n: input.episode.number,
    ...(input.episode.season === undefined ? {} : { s: input.episode.season }),
    ...(input.positionS > 0 ? { at: Math.floor(input.positionS) } : {}),
  })
}

export interface SourceFallbackProps {
  readonly providerId: string
  /** La referencia del título en la fuente activa. */
  readonly titleRef: string
  readonly number: number | undefined
  readonly mode: PlayMode
  readonly positionS: number
}

export function SourceFallback(props: SourceFallbackProps): ReactNode {
  const [alternativas, setAlternativas] = useState<readonly Alternativa[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (props.number === undefined) {
      setCargando(false)
      return
    }

    const controlador = new AbortController()

    void Promise.all([
      apiGet(
        sourcesPath(props.providerId, props.titleRef),
        sourcesResponseSchema,
        { signal: controlador.signal },
      ).catch(() => ({ items: [] })),
      apiGet('/api/providers', providersResponseSchema, {
        signal: controlador.signal,
      }).catch(() => ({ providers: [] })),
    ]).then(async ([fuentes, proveedores]) => {
      if (controlador.signal.aborted) return

      const nombres = new Map(
        proveedores.providers.map((provider) => [provider.id, provider.name]),
      )
      const otras = fuentes.items.filter(
        (fuente) => fuente.ref.providerId !== props.providerId,
      )

      const resueltas = await Promise.all(
        otras.map(async (fuente) => {
          const episodio = await apiGet(
            episodeNumberPath(
              fuente.ref.providerId,
              fuente.ref.value,
              props.number ?? 0,
            ),
            episodeResponseSchema,
            { signal: controlador.signal },
          ).catch(() => undefined)

          if (episodio === undefined) return undefined

          return {
            providerId: fuente.ref.providerId,
            name: nombres.get(fuente.ref.providerId) ?? fuente.ref.providerId,
            href: rutaDeAlternativa({
              source: fuente,
              episode: episodio.episode,
              mode: props.mode,
              positionS: props.positionS,
            }),
          } satisfies Alternativa
        }),
      )

      if (controlador.signal.aborted) return

      setAlternativas(resueltas.filter((item): item is Alternativa => item !== undefined))
      setCargando(false)
    })

    return () => controlador.abort()
  }, [props.providerId, props.titleRef, props.number, props.mode, props.positionS])

  if (cargando || alternativas.length === 0) return null

  return (
    <section className="watch__fallback" aria-live="polite">
      <h2>{t(DEFAULT_LOCALE, 'player.fallback.title')}</h2>
      <p>{t(DEFAULT_LOCALE, 'player.fallback.body')}</p>
      <ul className="watch__fallback-list">
        {alternativas.map((alternativa) => (
          <li key={alternativa.providerId}>
            <Link className="button" to={alternativa.href}>
              {t(DEFAULT_LOCALE, 'player.fallback.source', { name: alternativa.name })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
