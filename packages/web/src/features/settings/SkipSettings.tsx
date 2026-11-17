/**
 * Los ajustes de los saltos de intro y ending.
 *
 * Son dos preferencias de quien mira, y viven donde se buscan: la de saltar sola
 * y el margen con el que se salta. Se guardan en el almacén del navegador junto
 * al resto de lo que la pantalla recuerda —por dónde iba el episodio, si el
 * siguiente empieza solo— así que no viajan al servidor ni se mezclan con los
 * ajustes de la instalación.
 *
 * El salto automático nace **apagado**: encadenar episodios se espera de una
 * serie, pero saltarse un trozo del capítulo sin que nadie lo pida es decidir por
 * quien está mirando.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { type ReactNode, useCallback, useState } from 'react'
import { t } from '../../i18n'
import { MARGEN_MAXIMO_S } from '../player/skip'
import {
  almacenLocal,
  guardarMargenSalto,
  guardarSaltoAuto,
  leerMargenSalto,
  leerSaltoAuto,
} from '../player/storage'

/** El margen que se ofrece en la lista, del 0 al máximo. */
const MARGENES = Array.from({ length: MARGEN_MAXIMO_S + 1 }, (_, indice) => indice)

export function SkipSettings(): ReactNode {
  const [auto, setAuto] = useState(() => leerSaltoAuto(almacenLocal()))
  const [margen, setMargen] = useState(() => leerMargenSalto(almacenLocal()))

  const cambiarAuto = useCallback((valor: boolean) => {
    setAuto(valor)
    guardarSaltoAuto(almacenLocal(), valor)
  }, [])

  const cambiarMargen = useCallback((valor: number) => {
    const limpio = Number.isFinite(valor) ? valor : 0

    setMargen(limpio)
    guardarMargenSalto(almacenLocal(), limpio)
  }, [])

  return (
    <section>
      <h3>{t(DEFAULT_LOCALE, 'settings.skip.title')}</h3>
      <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.skip.body')}</p>

      <label className="field field--check" htmlFor="skip-auto">
        <input
          id="skip-auto"
          type="checkbox"
          checked={auto}
          onChange={(evento) => cambiarAuto(evento.target.checked)}
        />
        <span>{t(DEFAULT_LOCALE, 'settings.skip.auto')}</span>
      </label>

      {/* Un `select` y no un deslizador: son seis valores —0 a 5— y una lista
          cerrada se recorre con el teclado sin afinar el pulso. */}
      <label className="field" htmlFor="skip-margin">
        <span className="field__label">{t(DEFAULT_LOCALE, 'settings.skip.margin')}</span>
        <select
          id="skip-margin"
          className="field__input"
          value={margen}
          onChange={(evento) => cambiarMargen(Number(evento.target.value))}
        >
          {MARGENES.map((segundos) => (
            <option key={segundos} value={segundos}>
              {t(DEFAULT_LOCALE, 'settings.skip.marginOption', { seconds: segundos })}
            </option>
          ))}
        </select>
        <span className="field__hint">{t(DEFAULT_LOCALE, 'settings.skip.marginHint')}</span>
      </label>
    </section>
  )
}
