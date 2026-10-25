import { describe, expect, test } from 'bun:test'
import { settingsResponseSchema } from './api'

const BASE = {
  theme: 'system',
  providerPriority: [],
  adultContent: false,
  paths: { data: '/data', config: '/config', cache: '/cache' },
  mpv: { available: false },
  providers: [],
} as const

describe('el campo locked de los ajustes', () => {
  test('sin campo, el modo es local y no restringido', () => {
    const parsed = settingsResponseSchema.parse(BASE)

    expect(parsed.locked).toBe(false)
  })

  test('acepta el modo restringido', () => {
    const parsed = settingsResponseSchema.parse({ ...BASE, locked: true })

    expect(parsed.locked).toBe(true)
  })

  test('un valor que no es booleano se rechaza', () => {
    expect(settingsResponseSchema.safeParse({ ...BASE, locked: 'sí' }).success).toBe(false)
  })
})
