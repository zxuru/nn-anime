/**
 * Los avisos de «Quiero ver» en Novedades.
 *
 * La marca cruza dos cosas que el servidor ya conoce —la lista de pendientes y la
 * fecha de publicación— y la pone al servir la fila. Aquí sólo se decide si la
 * insignia se pinta: apagarla no toca el feed, ni la lista, ni la propia fila.
 *
 * Es una preferencia del navegador, como los saltos y la calidad: no viaja al
 * servidor y nace encendida, que es lo que se espera de un aviso nuevo.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { type ReactNode, useCallback, useState } from 'react'
import { t } from '../../i18n'
import { almacenLocal, guardarAvisosQuieroVer, leerAvisosQuieroVer } from '../player/storage'

export function AvisosSettings(): ReactNode {
  const [avisos, setAvisos] = useState(() => leerAvisosQuieroVer(almacenLocal()))

  const cambiar = useCallback((valor: boolean) => {
    setAvisos(valor)
    guardarAvisosQuieroVer(almacenLocal(), valor)
  }, [])

  return (
    <section>
      <h3>{t(DEFAULT_LOCALE, 'settings.avisos.title')}</h3>

      <label className="field field--check" htmlFor="avisos-quiero-ver">
        <input
          id="avisos-quiero-ver"
          type="checkbox"
          checked={avisos}
          onChange={(evento) => cambiar(evento.target.checked)}
        />
        <span>{t(DEFAULT_LOCALE, 'settings.avisos.quieroVer')}</span>
      </label>
      <p className="field__hint">{t(DEFAULT_LOCALE, 'settings.avisos.hint')}</p>
    </section>
  )
}
