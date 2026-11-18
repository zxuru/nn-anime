import { describe, expect, test } from 'bun:test'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { AnimeSummary } from '@rona/core/models'
import { emptyTasteProfile, type TasteProfile } from '@rona/core/taste'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { t } from '../../i18n'
import {
  answersFromProfile,
  EMPTY_ANSWERS,
  isTitleSelected,
  nextStep,
  previousStep,
  SURVEY_STEPS,
  surveyProgress,
  toggleInList,
  toggleSingle,
  toggleTitle,
  toSurveyRequest,
} from './model'
import { shouldAutoOpen } from './TasteInvite'
import { returnsToProfile } from './TastePage'
import { genresFor, TasteSurvey } from './TasteSurvey'

const STAMP = '2026-11-18T10:00:00.000Z'

function perfil(extra: Partial<TasteProfile> = {}): TasteProfile {
  return {
    ...emptyTasteProfile('local', new Date(STAMP)),
    genres: [{ name: 'Acción', weight: 1, source: 'survey', updatedAt: STAMP }],
    excludedGenres: [{ name: 'Terror', source: 'survey', updatedAt: STAMP }],
    titles: [
      {
        providerId: 'fixture',
        ref: 'aurora-nocturna',
        title: 'Aurora Nocturna',
        relation: 'liked',
        source: 'survey',
        updatedAt: STAMP,
      },
    ],
    format: { value: 'movies', source: 'survey', updatedAt: STAMP },
    tone: { value: 'dark', source: 'survey', updatedAt: STAMP },
    audio: { value: 'sub', source: 'survey', updatedAt: STAMP },
    catalog: { value: 'airing', source: 'survey', updatedAt: STAMP },
    survey: { status: 'completed', skips: 0, updatedAt: STAMP },
    ...extra,
  }
}

const TITULOS: readonly AnimeSummary[] = [
  {
    ref: { providerId: 'fixture', value: 'aurora-nocturna' },
    title: 'Aurora Nocturna',
    coverUrl: 'https://fixture.invalid/aurora.jpg',
  },
  { ref: { providerId: 'fixture', value: 'cocina' }, title: 'Cocina de Medianoche' },
]

function render(element: ReactNode): string {
  return renderToString(element)
}

function encuesta(extra: { readonly initialStep?: number } = {}): string {
  return render(
    <TasteSurvey
      profile={perfil()}
      titles={TITULOS}
      onSave={async () => undefined}
      onDone={() => undefined}
      {...extra}
    />,
  )
}

describe('las respuestas, de la pantalla al contrato', () => {
  test('un perfil guardado se vuelve a pintar tal cual: reabrir no pierde nada', () => {
    const respuestas = answersFromProfile(perfil())

    expect(respuestas.genres).toEqual(['Acción'])
    expect(respuestas.excludedGenres).toEqual(['Terror'])
    expect(respuestas.titles).toEqual([
      { providerId: 'fixture', ref: 'aurora-nocturna', title: 'Aurora Nocturna' },
    ])
    expect(respuestas.format).toBe('movies')
    expect(respuestas.tone).toBe('dark')
    expect(respuestas.audio).toBe('sub')
    expect(respuestas.catalog).toBe('airing')
  })

  test('sin perfil, la encuesta empieza vacía', () => {
    expect(answersFromProfile(undefined)).toEqual(EMPTY_ANSWERS)
  })

  test('completar compone el contrato con sus respuestas', () => {
    const request = toSurveyRequest(answersFromProfile(perfil()), 'completed')

    expect(request.status).toBe('completed')
    expect(request.genres).toEqual(['Acción'])
    expect(request.excludedGenres).toEqual(['Terror'])
    expect(request.titles[0]?.relation).toBe('liked')
    expect(request.format).toBe('movies')
  })

  test('omitir lleva el mismo cuerpo y el estado que lo distingue', () => {
    const request = toSurveyRequest(EMPTY_ANSWERS, 'skipped')

    expect(request.status).toBe('skipped')
    expect(request.genres).toEqual([])
    expect(request.titles).toEqual([])
  })
})

describe('marcar y desmarcar', () => {
  test('un género se añade y se quita conservando el orden', () => {
    expect(toggleInList(['Acción'], 'Drama')).toEqual(['Acción', 'Drama'])
    expect(toggleInList(['Acción', 'Drama'], 'Acción')).toEqual(['Drama'])
  })

  test('una opción única se elige y se vuelve a quitar', () => {
    expect(toggleSingle(null, 'dark' as const)).toBe('dark')
    expect(toggleSingle('dark' as const, 'dark' as const)).toBeNull()
    expect(toggleSingle('dark' as const, 'light' as const)).toBe('light')
  })

  test('un título no se duplica y se puede quitar', () => {
    const titulo = { providerId: 'fixture', ref: 'aurora-nocturna', title: 'Aurora Nocturna' }
    const uno = toggleTitle([], titulo)
    const dos = toggleTitle(uno, titulo)

    expect(uno).toHaveLength(1)
    expect(dos).toHaveLength(0)
    expect(isTitleSelected(uno, titulo)).toBe(true)
  })

  test('los pasos no se salen de la encuesta', () => {
    expect(nextStep(0)).toBe(1)
    expect(nextStep(4)).toBe(4)
    expect(previousStep(0)).toBe(0)
    expect(previousStep(3)).toBe(2)
  })

  test('la barra avanza de 20 en 20 y termina llena', () => {
    expect(surveyProgress(0)).toBe(20)
    expect(surveyProgress(2)).toBe(60)
    expect(surveyProgress(4)).toBe(100)
    // Un índice imposible no pinta una barra fuera de rango.
    expect(surveyProgress(-4)).toBe(20)
    expect(surveyProgress(99)).toBe(100)
  })

  test('los géneros extra del perfil se conservan al reabrir', () => {
    const conExtra = perfil({
      genres: [{ name: 'Documental', weight: 1, source: 'survey', updatedAt: STAMP }],
    })

    expect(genresFor(conExtra)).toContain('Documental')
  })
})

describe('la pantalla de la encuesta', () => {
  test('el primer paso enseña progreso, omitir y las tarjetas marcadas', () => {
    const html = encuesta()

    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.step', { current: 1, total: 5 }))
    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.skip'))
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="20"')
    expect(html).toContain('Acción')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.genres.excludeOne', { genre: 'Acción' }))
  })

  test('omitir está en los cinco pasos, también en el último', () => {
    for (let paso = 0; paso < SURVEY_STEPS.length; paso++) {
      const html = encuesta({ initialStep: paso })

      expect(html, `paso ${paso + 1}`).toContain(t(DEFAULT_LOCALE, 'taste.skip'))
      expect(html, `paso ${paso + 1}`).toContain('role="progressbar"')
    }
  })

  test('el segundo paso enseña portadas y el título marcado', () => {
    const html = encuesta({ initialStep: 1 })

    expect(html).toContain('Aurora Nocturna')
    expect(html).toContain('Cocina de Medianoche')
    // La portada sale del proxy: la CSP sólo admite `img-src 'self'`, así que
    // incrustar la dirección del proveedor dejaba un icono de imagen rota.
    expect(html).toContain('src="/api/cover/fixture/aurora-nocturna"')
    expect(html).not.toContain('https://fixture.invalid/aurora.jpg')
    expect(html).toContain(
      t(DEFAULT_LOCALE, 'taste.titles.selectedOne', { title: 'Aurora Nocturna' }),
    )
    expect(html).toContain(
      t(DEFAULT_LOCALE, 'taste.titles.selectOne', { title: 'Cocina de Medianoche' }),
    )
  })

  test('el último paso cierra con guardar y llega al 100 %', () => {
    const html = encuesta({ initialStep: 4 })

    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.finish'))
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.audio.sub'))
    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.catalog.airing'))
  })

  test('el segundo paso sin catálogo se explica y no se rompe', () => {
    const html = render(
      <TasteSurvey
        profile={perfil()}
        titles={[]}
        initialStep={1}
        onSave={async () => undefined}
        onDone={() => undefined}
      />,
    )

    expect(html).toContain(t(DEFAULT_LOCALE, 'taste.titles.empty'))
  })
})

describe('la vuelta desde el perfil', () => {
  test('volver al perfil sólo cuando se pidió', () => {
    expect(returnsToProfile('/gustos?volver=perfil')).toBe(true)
    expect(returnsToProfile('/gustos')).toBe(false)
    expect(returnsToProfile('/gustos?volver=inicio')).toBe(false)
  })
})

describe('la abertura automática', () => {
  function respuesta(extra: Partial<TasteProfile> = {}, autoOpen = true) {
    return {
      profile: perfil(extra),
      skipLimit: 3,
      autoOpen,
    }
  }

  test('abre una vez si la encuesta no ha empezado y el servidor lo permite', () => {
    const sinEmpezar = respuesta({
      survey: { status: 'not_started', skips: 0, updatedAt: STAMP },
    })

    expect(shouldAutoOpen(sinEmpezar, '/', false)).toBe(true)
  })

  test('no abre si el servidor la apagó, si ya se abrió o si ya está dentro', () => {
    const sinEmpezar = {
      profile: perfil({
        survey: { status: 'not_started' as const, skips: 0, updatedAt: STAMP },
      }),
      skipLimit: 3,
      autoOpen: true,
    }

    expect(shouldAutoOpen({ ...sinEmpezar, autoOpen: false }, '/', false)).toBe(false)
    expect(shouldAutoOpen(sinEmpezar, '/', true)).toBe(false)
    expect(shouldAutoOpen(sinEmpezar, '/gustos', false)).toBe(false)
  })

  test('no abre una encuesta ya contestada u omitida', () => {
    expect(shouldAutoOpen(respuesta(), '/', false)).toBe(false)

    const omitida = respuesta({
      survey: { status: 'skipped', skips: 1, updatedAt: STAMP },
    })
    expect(shouldAutoOpen(omitida, '/', false)).toBe(false)
  })
})
