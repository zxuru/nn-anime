/**
 * Resultados de la búsqueda, o su ausencia explicada.
 *
 * Una tarjeta por **obra**, no por proveedor: dos fuentes que devuelven el mismo
 * título en el mismo año son la misma ficha, y pintarlas dos veces es contenido
 * repetido. La tarjeta lleva a la fuente que prefiere el usuario —el orden de los
 * ajustes— o, sin preferencia, a la que gana por nombre.
 *
 * **La tarjeta no dice de dónde viene ni lista las otras fuentes.** Lo que se
 * busca es una obra, y todas las fuentes de esa obra se eligen en su ficha, que
 * es el sitio donde la decisión importa. Un sello y una lista de enlaces por
 * tarjeta convertían cada resultado en un pequeño índice de proveedores.
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

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { SearchResult } from '@rona/core/models'
import type { ReactNode } from 'react'
import { Grid, GridItem } from '../../components/Grid'
import { t } from '../../i18n'
import { EsqueletoResultado } from './EsqueletoResultado'
import { ResultCard } from './ResultCard'
import { groupResults } from './useSearchStream'

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
   * Los proveedores que siguen pendientes, o las claves de la espera inicial.
   *
   * Van **detrás** de las tarjetas y en la misma lista: la espera no puede
   * pintarse encima de los resultados ni como una segunda lista «Resultados».
   */
  readonly pending?: readonly string[] | undefined
  /** Si la lista todavía puede crecer. Se traduce a `aria-busy`. */
  readonly busy?: boolean | undefined
  /**
   * El orden de preferencia de proveedores, de los ajustes. Decide a qué ficha
   * lleva la tarjeta cuando la misma obra está en varios.
   */
  readonly providerPriority?: readonly string[]
  readonly onPreview?: (result: SearchResult) => void
  readonly onPreviewEnd?: () => void
}

export function ResultGrid(props: ResultGridProps): ReactNode {
  const pendientes = props.pending ?? []
  const grupos = groupResults(props.results, props.providerPriority ?? [])

  if (props.results.length === 0 && pendientes.length === 0) {
    // Mientras busca no se pinta nada de esto: el renglón de estado ya dice que
    // se está buscando y la lista no puede concluir nada antes de tiempo.
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
    <Grid label={t(DEFAULT_LOCALE, 'search.results')} busy={props.busy}>
      {grupos.map((grupo) => {
        // El grupo nunca está vacío: sale de un resultado que existe.
        const primero = grupo.results[0]
        if (primero === undefined) return null

        return (
          <GridItem key={grupo.key}>
            <ResultCard
              result={primero}
              consulta={props.query}
              {...(props.onPreview === undefined
                ? {}
                : { onPreview: () => props.onPreview?.(primero) })}
              {...(props.onPreviewEnd === undefined ? {} : { onPreviewEnd: props.onPreviewEnd })}
            />
          </GridItem>
        )
      })}
      {pendientes.map((clave) => (
        <GridItem key={`pendiente-${clave}`}>
          <EsqueletoResultado />
        </GridItem>
      ))}
    </Grid>
  )
}
