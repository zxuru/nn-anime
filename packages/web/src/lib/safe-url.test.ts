import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { isSafeUrl, SAFE_SCHEMES, safeUrl } from './safe-url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

describe('lista blanca de esquemas', () => {
  test('sólo http y https', () => {
    expect(SAFE_SCHEMES).toEqual(['http:', 'https:'])
    expect(safeUrl('http://ejemplo.example/a.png')).toBe('http://ejemplo.example/a.png')
    expect(safeUrl('https://ejemplo.example/a.png')).toBe('https://ejemplo.example/a.png')
  })

  test('los esquemas que ejecutan se rechazan', () => {
    for (const malo of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://ejemplo.example/abc',
      'about:blank',
    ]) {
      expect(safeUrl(malo), malo).toBeNull()
    }
  })

  test('el esquema se compara en minúsculas y sin espacios', () => {
    expect(safeUrl('  HTTPS://ejemplo.example/a  ')).toBe('https://ejemplo.example/a')
    expect(safeUrl('jAvAsCrIpT:alert(1)')).toBeNull()
  })

  test('una dirección vacía o ausente no es una dirección', () => {
    expect(safeUrl(undefined)).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('   ')).toBeNull()
  })

  test('una ruta relativa no se admite: podría ser otro origen', () => {
    expect(safeUrl('/portada.png')).toBeNull()
    expect(safeUrl('//otro.example/portada.png')).toBeNull()
    expect(safeUrl('portada.png')).toBeNull()
  })

  test('el texto que no es una dirección no rompe nada', () => {
    expect(safeUrl('no es una url')).toBeNull()
    expect(safeUrl('http://[mal')).toBeNull()
  })

  test('`isSafeUrl` responde a lo mismo', () => {
    expect(isSafeUrl('https://ejemplo.example/a')).toBe(true)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl(undefined)).toBe(false)
  })

  test('un salto de línea dentro del esquema no lo salva', () => {
    expect(safeUrl('java\nscript:alert(1)')).toBeNull()
    expect(safeUrl('java\tscript:alert(1)')).toBeNull()
  })
})

describe('ningún atributo toma una URL de proveedor sin pasar por la lista blanca', () => {
  /**
   * Recorre los `src=` y `href=` de todo el paquete.
   *
   * Es una comprobación por texto y a propósito: la alternativa es confiar en que
   * quien escriba el próximo componente se acuerde, y este proyecto ya ha visto
   * tres veces lo que pasa cuando algo depende de que alguien se acuerde.
   */
  async function atributos(): Promise<{ readonly archivo: string; readonly expresion: string }[]> {
    const glob = new Bun.Glob('**/*.tsx')
    const encontrados: { archivo: string; expresion: string }[] = []

    for await (const relativo of glob.scan({ cwd: ROOT })) {
      const texto = await Bun.file(`${ROOT}${relativo}`).text()

      for (const coincidencia of texto.matchAll(/\b(?:src|href)=\{([^}]*)\}/g)) {
        encontrados.push({ archivo: relativo, expresion: coincidencia[1] ?? '' })
      }
    }

    return encontrados
  }

  test('una URL de proveedor en un atributo pasa por `safeUrl`', async () => {
    const sospechosas = (await atributos()).filter(({ expresion }) =>
      /coverUrl|\.url\b|subtitle/i.test(expresion),
    )

    for (const { archivo, expresion } of sospechosas) {
      expect(expresion, `${archivo}: ${expresion}`).toContain('safeUrl')
    }
  })

  test('hay atributos que revisar: la comprobación no está vacía', async () => {
    expect((await atributos()).length).toBeGreaterThan(0)
  })
})
