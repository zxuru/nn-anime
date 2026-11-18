/**
 * Las filas «Porque te gusta…».
 *
 * Son la otra mitad de usar el perfil en el inicio: el motor ordena una lista y
 * esto agrupa el catálogo por un género declarado. No añade nada que no
 * estuviera: elige, de lo que ya hay, lo que comparte ese género. Si el perfil
 * no tiene géneros, no se pinta ninguna fila.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { AnimeSummary } from '@rona/core/models'
import type { TasteRow } from '@rona/core/taste'
import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface TasteRowsProps {
  readonly rows: readonly TasteRow[]
  readonly loading?: boolean | undefined
}

/** La ruta de una ficha, con la referencia codificada. */
function fichaDe(item: AnimeSummary): string {
  return `/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`
}

/**
 * El titular de una fila.
 *
 * El género viene del servidor —es un dato del perfil— y la frase del catálogo
 * de la interfaz. Concatenarlos en el servidor habría metido un texto de
 * pantalla en la API.
 */
export function tasteRowTitle(genre: string): string {
  return t(DEFAULT_LOCALE, 'home.tasteRow.title', { genre })
}

export function TasteRows(props: TasteRowsProps): ReactNode {
  /*
    Sin filas no se pinta nada, tampoco un esqueleto.

    Estas filas son un extra del perfil, no una sección fija: reservarles un
    hueco antes de saber si existen haría saltar la home cada vez que un usuario
    sin encuesta la abre. `loading` se conserva en el contrato porque la pantalla
    puede querer distinguir «cargando» de «no hay» más adelante.
  */
  void props.loading
  if (props.rows.length === 0) return null

  return (
    <>
      {props.rows.map((row) => (
        <section key={row.genre} className="seccion">
          <SectionHeader
            title={tasteRowTitle(row.genre)}
            meta={t(DEFAULT_LOCALE, 'home.tasteRow.meta')}
            icon={Sparkles}
          />
          <div className="seccion__cuerpo">
            <Mosaico>
              {row.items.map((item, indice) => (
                <Pieza
                  key={`${item.ref.providerId}#${item.ref.value}`}
                  providerId={item.ref.providerId}
                  ref={item.ref.value}
                  title={item.title}
                  to={fichaDe(item)}
                  recurso={recursoDe(indice)}
                  year={item.year}
                  meta={
                    item.year === undefined
                      ? undefined
                      : t(DEFAULT_LOCALE, 'home.year', { year: item.year })
                  }
                  motivo={t(DEFAULT_LOCALE, 'home.tasteRow.reason', { genre: row.genre })}
                />
              ))}
            </Mosaico>
          </div>
        </section>
      ))}
    </>
  )
}
