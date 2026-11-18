/**
 * La pantalla de la encuesta.
 *
 * Carga el perfil y los títulos del paso 2, y deja la encuesta en manos del
 * componente presentacional. La vuelta la decide la dirección: si se llegó
 * desde el Perfil, se vuelve allí; si es la primera vez, al inicio. Así el
 * botón «Ajustar mis gustos» no obliga a buscar de nuevo la pantalla de la que
 * se vino.
 */

import type { TasteSurveyRequest } from '@rona/core/taste'
import type { ReactNode } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { useNavigate, usePath } from '../../router'
import { TasteSkeleton, TasteSurvey } from './TasteSurvey'
import { useTaste, useTasteTitles } from './useTaste'

/** Si la encuesta se abrió desde el Perfil y hay que volver allí. */
export function returnsToProfile(path: string): boolean {
  return new URLSearchParams(path.split('?')[1] ?? '').get('volver') === 'perfil'
}

export function TastePage(): ReactNode {
  const { state, data, error, reload, save } = useTaste()
  const titles = useTasteTitles()
  const navigate = useNavigate()
  const path = usePath()

  if (state === 'loading') return <TasteSkeleton />

  if (state === 'error') {
    return <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} onRetry={reload} />
  }

  if (data === undefined) return null

  const volver = returnsToProfile(path)
  const done = (): void => {
    navigate.push(volver ? '/profile' : '/')
  }
  const saveAnswers = (request: TasteSurveyRequest): Promise<unknown> => save(request)

  return (
    <TasteSurvey
      profile={data.profile}
      titles={titles.items}
      titlesLoading={titles.loading}
      onSave={saveAnswers}
      onSkip={saveAnswers}
      onDone={done}
    />
  )
}
