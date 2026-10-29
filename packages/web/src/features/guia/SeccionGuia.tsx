/**
 * La guía, en Ajustes.
 *
 * Es el sitio al que se vuelve cuando la bienvenida ya pasó: repetirla y
 * devolver a la lista los avisos descartados. No hay más ajustes que esos dos,
 * porque la guía no se configura: se ve o no se ve.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { useRoute } from '../../router'
import { restablecerAvisos } from './estado'
import { abrirBienvenida } from './useGuia'

export function SeccionGuia(): ReactNode {
  const ruta = useRoute().name

  return (
    <section>
      <h2>{t(DEFAULT_LOCALE, 'guia.ajustes.titulo')}</h2>
      <p>{t(DEFAULT_LOCALE, 'guia.ajustes.cuerpo')}</p>
      <div className="guia__acciones">
        <button type="button" className="button" onClick={() => abrirBienvenida(ruta)}>
          {t(DEFAULT_LOCALE, 'guia.ajustes.ver')}
        </button>
        <button type="button" className="button" onClick={restablecerAvisos}>
          {t(DEFAULT_LOCALE, 'guia.ajustes.avisos')}
        </button>
      </div>
    </section>
  )
}
