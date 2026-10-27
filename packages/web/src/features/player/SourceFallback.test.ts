import { describe, expect, test } from 'bun:test'
import type { AnimeSummary, Episode } from '@nn-anime/core/models'
import { rutaDeAlternativa } from './SourceFallback'

const FUENTE: AnimeSummary = {
  ref: { providerId: 'otra', value: 'serie/uno' },
  title: 'Serie Uno',
}

const EPISODIO: Episode = {
  ref: { providerId: 'otra', value: 'serie/uno/temporada/2#1' },
  animeRef: { providerId: 'otra', value: 'serie/uno' },
  number: 1,
  season: 2,
  mode: 'sub',
}

describe('la ruta de una fuente alternativa', () => {
  test('lleva la referencia real, la temporada, el modo y la posición', () => {
    const ruta = rutaDeAlternativa({
      source: FUENTE,
      episode: EPISODIO,
      mode: 'dub',
      positionS: 123.9,
    })

    expect(ruta).toStartWith('/watch/otra/serie%2Funo%2Ftemporada%2F2%231?')
    expect(ruta).toContain('mode=dub')
    expect(ruta).toContain('anime=serie%2Funo')
    expect(ruta).toContain('n=1')
    expect(ruta).toContain('s=2')
    // La posición se recorta al segundo: no se manda una fracción al servidor.
    expect(ruta).toContain('at=123')
  })

  test('sin posición no se inventa un segundo', () => {
    const ruta = rutaDeAlternativa({
      source: FUENTE,
      episode: EPISODIO,
      mode: 'sub',
      positionS: 0,
    })

    expect(ruta).not.toContain('at=')
  })
})
