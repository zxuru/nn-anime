/**
 * La calidad preferida del reproductor.
 *
 * Es una preferencia del navegador, no del servidor: vive en `localStorage`
 * junto a la velocidad y los saltos, y viaja en el cuerpo de
 * `POST /api/stream/resolve` como `preferredQuality`. El contrato ya la acepta y
 * el catálogo la usa al elegir la fuente; si la fuente no la ofrece, se queda la
 * primera que publique.
 *
 * La lista es cerrada y se puede dejar en automático. Escribir una calidad a
 * mano no tendría sentido: el valor sólo significa algo si la fuente lo publica
 * con ese nombre.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { t } from '../../i18n'
import { CALIDADES, esCalidad } from '../player/quality'
import { almacenLocal, guardarCalidad, leerCalidad } from '../player/storage'

export function QualitySettings(): ReactNode {
  const [calidad, setCalidad] = useState(() => leerCalidad(almacenLocal()))

  const cambiar = (valor: string): void => {
    const elegida = esCalidad(valor) ? valor : undefined

    setCalidad(elegida)
    guardarCalidad(almacenLocal(), elegida)
  }

  return (
    <section>
      <h3>{t(DEFAULT_LOCALE, 'settings.quality.title')}</h3>
      <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.quality.body')}</p>

      <label className="field" htmlFor="player-quality">
        <span className="field__label">{t(DEFAULT_LOCALE, 'settings.quality.label')}</span>
        <select
          id="player-quality"
          className="field__input"
          value={calidad ?? ''}
          onChange={(evento) => cambiar(evento.target.value)}
        >
          <option value="">{t(DEFAULT_LOCALE, 'settings.quality.auto')}</option>
          {CALIDADES.map((opcion) => (
            <option key={opcion} value={opcion}>
              {t(DEFAULT_LOCALE, 'settings.quality.option', { quality: opcion })}
            </option>
          ))}
        </select>
        <span className="field__hint">{t(DEFAULT_LOCALE, 'settings.quality.hint')}</span>
      </label>
    </section>
  )
}
