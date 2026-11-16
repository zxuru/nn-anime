import { describe, expect, test } from 'bun:test'
import { buildPartyMedia } from './media'

/**
 * La adaptación de lo que sabe la pantalla a la forma que viaja en la sala.
 *
 * Lo que se mide: que no se cuele nada que no sea estado —ni proveedor, ni
 * referencia, ni URL— y que lo que no se puede decir con honestidad se descarte
 * en vez de inventarse.
 */

describe('el contenido de la sala', () => {
  test('un episodio lleva título, número y temporada', () => {
    expect(
      buildPartyMedia({
        title: 'Aurora nocturna',
        kind: 'episode',
        episode: 3,
        season: 2,
        episodeTitle: 'La torre',
        durationS: 1425,
      }),
    ).toEqual({
      kind: 'episode',
      title: 'Aurora nocturna',
      episode: 3,
      season: 2,
      episodeTitle: 'La torre',
      durationS: 1425,
    })
  })

  test('una película no lleva episodio aunque se lo pasen', () => {
    const media = buildPartyMedia({
      title: 'Una película',
      kind: 'movie',
      episode: 1,
      season: 1,
    })

    expect(media).toEqual({ kind: 'movie', title: 'Una película' })
    expect(media).not.toHaveProperty('episode')
  })

  test('sin título, sin número de episodio o sin nada no hay sala que anunciar', () => {
    expect(buildPartyMedia({ title: undefined, kind: 'episode', episode: 1 })).toBeUndefined()
    expect(buildPartyMedia({ title: '   ', kind: 'episode', episode: 1 })).toBeUndefined()
    // Un episodio sin número no es un episodio: el invitado no sabría qué abrir.
    expect(buildPartyMedia({ title: 'Aurora', kind: 'episode' })).toBeUndefined()
    expect(buildPartyMedia({ title: 'Aurora', kind: 'episode', episode: 0 })).toBeUndefined()
  })

  test('no se cuela ni proveedor, ni referencia, ni dirección', () => {
    const media = buildPartyMedia({
      title: 'Aurora nocturna',
      kind: 'episode',
      episode: 3,
      durationS: 100,
    })

    const serializado = JSON.stringify(media)

    expect(serializado).not.toContain('providerId')
    expect(serializado).not.toContain('ref')
    expect(serializado).not.toContain('http://')
    expect(serializado).not.toContain('/stream/')
    expect(serializado).not.toContain('ticket')
  })

  test('el texto se recorta y la duración absurda se descarta', () => {
    const media = buildPartyMedia({
      title: `  ${'x'.repeat(400)}  `,
      kind: 'episode',
      episode: 3,
      episodeTitle: '  La torre  ',
      durationS: Number.NaN,
    })

    expect(media?.title.length).toBe(200)
    expect(media?.episodeTitle).toBe('La torre')
    expect(media).not.toHaveProperty('durationS')
  })

  test('una duración de cero no es una duración', () => {
    expect(
      buildPartyMedia({ title: 'Aurora', kind: 'episode', episode: 1, durationS: 0 }),
    ).not.toHaveProperty('durationS')
  })
})
