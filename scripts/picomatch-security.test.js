import { describe, expect, it } from 'bun:test'
import picomatch from 'picomatch'

describe('la mitigación ReDoS de picomatch', () => {
  it('no genera cuantificadores anidados para extglobs de una sola rama', () => {
    for (const pattern of ['+(*)', '+(*a)', '*(*a)', '+(a*)', '+(a*b)', '*(*.js)']) {
      expect(picomatch.makeRe(pattern).source).not.toMatch(/\)[+*]/)
    }
  })

  it('rechaza entradas adversarias sin backtracking exponencial', () => {
    const entrada = `${'a'.repeat(50)}b`

    for (const pattern of ['+(*a)', '*(*a)', '+(*a)c', 'x+(*a)']) {
      const inicio = performance.now()
      expect(picomatch.isMatch(entrada, pattern)).toBe(false)
      expect(performance.now() - inicio).toBeLessThan(100)
    }
  })

  it('conserva la semántica de coincidencia', () => {
    expect(picomatch.isMatch('abc', '+(*)c')).toBe(true)
    expect(picomatch.isMatch('aaa', '+(*a)')).toBe(true)
    expect(picomatch.isMatch('ab', '+(*a)')).toBe(false)
    expect(picomatch.isMatch('axbayb', '+(a*b)')).toBe(true)
    expect(picomatch.isMatch('foo.js', '*(*.js)')).toBe(true)
    expect(picomatch.isMatch('foo.ts', '*(*.js)')).toBe(false)
  })
})
