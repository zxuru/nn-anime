import { describe, expect, test } from 'bun:test'
import { providerDraftSchema } from '@nn-anime/core/api'
import { EMPTY_FORM, type ProviderForm, toProviderDraft } from './draft'

function form(overrides: Partial<ProviderForm> = {}): ProviderForm {
  return { ...EMPTY_FORM, ...overrides }
}

describe('el formulario, convertido en petición', () => {
  test('los valores por defecto describen un proveedor que busca', () => {
    const draft = toProviderDraft(form({ id: 'mio', name: 'Mío', baseUrl: 'https://e.example' }))

    expect(draft.id).toBe('mio')
    expect(draft.name).toBe('Mío')
    expect(draft.baseUrl).toBe('https://e.example')
    expect(draft.capabilities.search).toBe(true)
    expect(draft.capabilities.sub).toBe(true)
    expect(draft.capabilities.dub).toBe(false)
    expect(draft.endpoints.search).toBe('/search?q={query}')
  })

  test('la capacidad de tendencias sale de que haya ruta, no de una casilla', () => {
    const sinRuta = toProviderDraft(form({ endpoints: { ...EMPTY_FORM.endpoints, trending: '' } }))
    expect(sinRuta.capabilities.trending).toBe(false)
    expect(sinRuta.endpoints.trending).toBeUndefined()

    const conRuta = toProviderDraft(
      form({ endpoints: { ...EMPTY_FORM.endpoints, trending: '/top' } }),
    )
    expect(conRuta.capabilities.trending).toBe(true)
    expect(conRuta.endpoints.trending).toBe('/top')
  })

  test('una ruta de tendencias en blanco no cuenta como ruta', () => {
    const draft = toProviderDraft(form({ endpoints: { ...EMPTY_FORM.endpoints, trending: '   ' } }))

    expect(draft.capabilities.trending).toBe(false)
    expect(draft.endpoints.trending).toBeUndefined()
  })

  test('lo que se teclea se recorta antes de salir', () => {
    const draft = toProviderDraft(
      form({ id: ' mio ', name: ' Mío ', baseUrl: ' https://e.example ' }),
    )

    expect(draft.id).toBe('mio')
    expect(draft.name).toBe('Mío')
    expect(draft.baseUrl).toBe('https://e.example')
  })

  test('los campos avanzados se copian tal cual, sin tocar la forma original', () => {
    const original = form({ fields: { ...EMPTY_FORM.fields, searchItems: 'data.items' } })
    const draft = toProviderDraft(original)

    expect(draft.fields.searchItems).toBe('data.items')
    expect(draft.fields.streamUrl).toBe('url')
    expect(original.fields.searchItems).toBe('data.items')
  })

  test('lo que produce el formulario pasa el schema del servidor', () => {
    const draft = toProviderDraft(
      form({
        id: 'mio',
        name: 'Mío',
        baseUrl: 'https://e.example',
        capabilities: { sub: true, dub: true },
      }),
    )

    const parsed = providerDraftSchema.safeParse(draft)

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      // Los dos campos que el formulario no toca los rellena el schema: eso es lo
      // que permite que el formulario tenga diez campos y no doce.
      expect(parsed.data.fields.episodeId).toBe('id')
      expect(parsed.data.fields.streamKind).toBe('kind')
    }
  })
})
