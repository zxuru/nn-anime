/**
 * Resultados de la búsqueda, o su ausencia explicada.
 *
 * Una tarjeta por **obra**, no por proveedor: dos fuentes que devuelven el mismo
 * título en el mismo año son la misma ficha, y pintarlas dos veces es contenido
 * repetido. La tarjeta lleva a la primera fuente que respondió; debajo, con
 * «También en», van los demás proveedores como enlaces a **su** ficha, que es lo
 * único que no se puede fusionar: abrir una tarjeta lleva a un sitio concreto.
 *
 * El estado vacío dice **por qué** está vacío: no es lo mismo una consulta sin
 * coincidencias que una pantalla en la que todavía no se ha buscado nada. Un
 * «no hay resultados» genérico obliga al usuario a adivinar cuál de las dos
 * cosas está mirando.
 *
 * Y sólo se dice **cuando la búsqueda terminó**. Decirlo antes es afirmar algo
 * que todavía no se sabe: la pantalla enseñaba «Nada coincide con «…»» junto a
 * «Buscando…» mientras los proveedores contestaban, y quien abría desde un
 * enlace leía ahí su respuesta y se iba con las manos vacías.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { SearchResult } from '@nn-anime/core/models'
import { Fragment, type ReactNode } from 'react'
import { Grid, GridItem } from '../../components/Grid'
import { t } from '../../i18n'
import { Link } from '../../router'
import { conLaConsulta, rutaDeFicha } from '../detail/direccion'
import { navStateDeTarjeta } from '../detail/nav-state'
import { ResultCard } from './ResultCard'
import { alternativas, groupResults } from './useSearchStream'

export interface ResultGridProps {
  readonly results: readonly SearchResult[]
  /**
   * La consulta que produjo estos resultados.
   *
   * Va en el texto del estado vacío y, además, en la dirección de cada ficha: es
   * el rastro que el servidor anota para que el motor recomiende lo que se busca.
   */
  readonly query: string
  /**
   * Si la búsqueda ya cerró **con respuesta**: lo que hay es todo lo que va a
   * haber. Sin esto —y con un fallo de transporte— no se puede concluir nada:
   * el «no coincide nada» y el «escribe un título» son conclusiones, y
   * afirmarlas antes de la última respuesta, o después de que la búsqueda no
   * llegara a abrirse, culpa a la consulta del usuario de lo que no es su culpa.
   */
  readonly done: boolean
  /**
   * Si la página tiene además la lista de AniList.
   *
   * Con ella, «nada coincide» es media verdad: la búsqueda sí encontró —lo que
   * AniList tiene de ese estudio o de ese género— y decirlo sería contradecir la
   * sección que está justo debajo. Es lo normal en una búsqueda por género, donde
   * ninguna fuente busca por ahí.
   */
  readonly hayAniList?: boolean
  /**
   * El orden de preferencia de proveedores, de los ajustes. Decide a qué ficha
   * lleva la tarjeta cuando la misma obra está en varios; el resto de fuentes
   * siguen en «También en».
   */
  readonly providerPriority?: readonly string[]
  readonly providerLabels?: ReadonlyMap<string, string>
  readonly onPreview?: (result: SearchResult) => void
  readonly onPreviewEnd?: () => void
}

/** La ruta de la ficha de un resultado, con la consulta que la trajo. */
function detailPath(result: SearchResult, consulta: string): string {
  return conLaConsulta(rutaDeFicha(result.ref.providerId, result.ref.value), consulta)
}

export function ResultGrid(props: ResultGridProps): ReactNode {
  if (props.results.length === 0) {
    // Mientras busca no se pinta nada de esto: el renglón de estado y los
    // esqueletos —uno por proveedor pendiente— ya dicen que se está buscando.
    if (!props.done) return null

    // Con la lista de AniList debajo no se dice que no haya nada: lo que no hay es
    // en los proveedores, y eso ya lo cuenta la sección de AniList con su recuento.
    if (props.hayAniList === true) return null

    return (
      <p className="empty">
        {props.query === ''
          ? t(DEFAULT_LOCALE, 'search.emptyNoQuery')
          : t(DEFAULT_LOCALE, 'search.empty', { query: props.query })}
      </p>
    )
  }

  return (
    <Grid label={t(DEFAULT_LOCALE, 'search.results')}>
      {groupResults(props.results, props.providerPriority ?? []).map((grupo) => {
        // El grupo nunca está vacío: sale de un resultado que existe.
        const primero = grupo.results[0]
        if (primero === undefined) return null

        const etiqueta = props.providerLabels?.get(primero.ref.providerId)
        const otros = alternativas(grupo, primero.ref.providerId)

        return (
          <GridItem key={grupo.key}>
            <ResultCard
              result={primero}
              consulta={props.query}
              {...(etiqueta === undefined ? {} : { providerLabel: etiqueta })}
              {...(props.onPreview === undefined
                ? {}
                : { onPreview: () => props.onPreview?.(primero) })}
              {...(props.onPreviewEnd === undefined ? {} : { onPreviewEnd: props.onPreviewEnd })}
            />
            {otros.length === 0 ? null : (
              <p className="card__extra">
                {t(DEFAULT_LOCALE, 'search.alsoIn')}{' '}
                {otros.map((otro, indice) => {
                  const nombre = props.providerLabels?.get(otro.ref.providerId)
                  const visible = nombre ?? otro.ref.providerId
                  /*
                    La fuente alternativa también conoce el título: sin el estado,
                    abrir su ficha desde aquí pintaba la espera de una URL directa,
                    con el nombre que ya estaba a la vista.
                  */
                  const estado = navStateDeTarjeta({
                    title: otro.title,
                    providerId: otro.ref.providerId,
                    ref: otro.ref.value,
                    year: otro.year,
                  })

                  return (
                    <Fragment key={`${otro.ref.providerId}:${otro.ref.value}`}>
                      {indice === 0 ? null : ', '}
                      <Link
                        to={detailPath(otro, props.query)}
                        state={estado}
                        title={t(DEFAULT_LOCALE, 'search.alsoInItem', {
                          title: otro.title,
                          provider: visible,
                        })}
                      >
                        {visible}
                      </Link>
                    </Fragment>
                  )
                })}
              </p>
            )}
          </GridItem>
        )
      })}
    </Grid>
  )
}
