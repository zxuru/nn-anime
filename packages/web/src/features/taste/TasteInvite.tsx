/**
 * El aviso del inicio y el primer empujón a la encuesta.
 *
 * RoNa no tiene registro: el equivalente a «justo después de registrarse» es la
 * primera vez que la home tiene algo que enseñar. La encuesta se abre sola **una
 * vez por sesión de navegador** y nunca bloquea: se puede omitir desde cualquier
 * paso. Si se omite, el aviso vuelve —discreto— hasta que se agotan las
 * omisiones; después se deja en paz. El límite lo decide el servidor
 * (`RONA_TASTE_SKIP_LIMIT`, tres por defecto).
 *
 * El aviso no se pinta en la propia encuesta: repetir la invitación encima de lo
 * que se está contestando es ruido.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { Sparkles, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { useNavigate, usePath } from '../../router'
import { EMPTY_ANSWERS, toSurveyRequest } from './model'
import { useTaste } from './useTaste'

/** La marca de sesión: evita reabrir la encuesta en cada vuelta a la home. */
export const TASTE_OPENED_KEY = 'rona:taste:opened'

function yaSeAbrio(): boolean {
  try {
    return globalThis.sessionStorage.getItem(TASTE_OPENED_KEY) === '1'
  } catch {
    // Sin almacenamiento —modo privado— no se insiste: abrir la encuesta en cada
    // navegación interna sería peor que no abrirla.
    return true
  }
}

function marcarAbierta(): void {
  try {
    globalThis.sessionStorage.setItem(TASTE_OPENED_KEY, '1')
  } catch {
    // Sin almacenamiento no hay nada que recordar.
  }
}

export function TasteInvite(): ReactNode {
  const { state, data, save } = useTaste()
  const navigate = useNavigate()
  const path = usePath()
  const [oculto, setOculto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const autoAbierta = useRef(false)
  const enLaEncuesta = path.split('?')[0] === '/gustos'

  /*
    La primera abertura automática. Sólo cuando la lectura terminó bien y la
    encuesta no se ha contestado ni se ha abierto ya en esta sesión. El ref evita
    que un doble efecto de React —StrictMode— empuje dos veces la misma ruta.
  */
  useEffect(() => {
    if (state !== 'ready' || data === undefined || enLaEncuesta || autoAbierta.current) return
    if (data.profile.survey.status !== 'not_started' || yaSeAbrio()) return

    autoAbierta.current = true
    marcarAbierta()
    navigate.push('/gustos')
  }, [state, data, enLaEncuesta, navigate])

  if (state !== 'ready' || data === undefined || enLaEncuesta || oculto) return null

  const status = data.profile.survey.status
  const invitar =
    status === 'not_started' || (status === 'skipped' && data.profile.survey.skips < data.skipLimit)

  if (!invitar) return null

  const ahoraNo = async (): Promise<void> => {
    if (guardando) return

    setGuardando(true)
    try {
      await save(toSurveyRequest(EMPTY_ANSWERS, 'skipped'))
      setOculto(true)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <aside className="gustos-aviso" aria-label={t(DEFAULT_LOCALE, 'taste.invite.title')}>
      <span className="gustos-aviso__icono" aria-hidden="true">
        <Sparkles size={20} strokeWidth={2} />
      </span>
      <div className="gustos-aviso__texto">
        <p className="gustos-aviso__titulo">{t(DEFAULT_LOCALE, 'taste.invite.title')}</p>
        <p className="gustos-aviso__cuerpo">{t(DEFAULT_LOCALE, 'taste.invite.body')}</p>
      </div>
      <div className="gustos-aviso__acciones">
        <button
          type="button"
          className="button button--primary"
          onClick={() => navigate.push('/gustos')}
        >
          {t(DEFAULT_LOCALE, 'taste.invite.open')}
        </button>
        <button
          type="button"
          className="button gustos-aviso__luego"
          aria-label={t(DEFAULT_LOCALE, 'taste.invite.later')}
          title={t(DEFAULT_LOCALE, 'taste.invite.later')}
          onClick={() => void ahoraNo()}
          disabled={guardando}
        >
          <X size={16} strokeWidth={2.4} aria-hidden="true" />
          <span className="gustos-aviso__luego-texto">
            {t(DEFAULT_LOCALE, 'taste.invite.later')}
          </span>
        </button>
      </div>
    </aside>
  )
}
