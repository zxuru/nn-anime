import { describe, expect, test } from 'bun:test'
import { argumentosDePlaywright } from './e2e'

/**
 * El reenvío de argumentos del e2e.
 *
 * `bun run e2e --shard=1/2` se escribía en el CI, pero `scripts/e2e.ts` lanzaba
 * Playwright con una orden fija: los dos trabajos de la matriz corrían la suite
 * entera, 211 pruebas cada uno. Esta prueba mide lo único que puede evitar que
 * vuelva a pasar sin abrir un navegador: que los argumentos lleguen a Playwright.
 */
describe('argumentosDePlaywright', () => {
  test('sin argumentos del usuario, conserva el filtro del proveedor caído', () => {
    expect(argumentosDePlaywright([])).toEqual(['test', '--grep-invert', 'proveedor que falla'])
  })

  test('reenvía el shard y los demás argumentos, en el orden en que llegan', () => {
    expect(argumentosDePlaywright(['--list', '--shard=2/2'])).toEqual([
      'test',
      '--grep-invert',
      'proveedor que falla',
      '--list',
      '--shard=2/2',
    ])
  })

  test('un `--` suelto no llega a Playwright', () => {
    expect(argumentosDePlaywright(['--', '--shard=1/2'])).toContain('--shard=1/2')
    expect(argumentosDePlaywright(['--', '--shard=1/2'])).not.toContain('--')
  })
})
