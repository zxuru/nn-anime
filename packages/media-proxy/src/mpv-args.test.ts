import { describe, expect, test } from 'bun:test'
import {
  HEADER_FIELD_FLAG,
  HEADER_NAME_RE,
  invalidHeaderError,
  type MpvArgsOptions,
  mpvArgs,
  validHeaderName,
  validHeaderValue,
} from './mpv-args'

/** Los argumentos, o un fallo explícito si la cabecera no vale. */
function argumentos(options: MpvArgsOptions): readonly string[] {
  const salida = mpvArgs(options)
  if (!salida.ok) throw new Error(`cabecera rechazada: ${salida.header}`)

  return salida.args
}

describe('argumentos de mpv', () => {
  test('lleva `--no-config` y la URL al final, como un argumento', () => {
    const args = argumentos({ url: 'http://127.0.0.1:7717/stream/abc' })

    expect(args[0]).toBe('--no-config')
    expect(args.at(-1)).toBe('http://127.0.0.1:7717/stream/abc')
  })

  test('las cabeceras van en un solo argumento, con el formato del spec', () => {
    const args = argumentos({
      url: 'http://127.0.0.1:7717/stream/abc',
      headers: { Referer: 'https://sitio.example', 'User-Agent': 'nn-anime' },
    })
    const cabeceras = args.find((arg) => arg.startsWith(HEADER_FIELD_FLAG))

    expect(cabeceras).toBe(
      '--http-header-fields=Referer: https://sitio.example,User-Agent: nn-anime',
    )
  })

  test('sin cabeceras no se añade el argumento', () => {
    expect(argumentos({ url: 'x' }).some((arg) => arg.startsWith(HEADER_FIELD_FLAG))).toBe(false)
    expect(
      argumentos({ url: 'x', headers: {} }).some((arg) => arg.startsWith(HEADER_FIELD_FLAG)),
    ).toBe(false)
  })

  test('`startAtS` sólo se pasa si es positivo', () => {
    expect(argumentos({ url: 'x', startAtS: 42 })).toContain('--start=42')
    expect(argumentos({ url: 'x', startAtS: 0 }).some((arg) => arg.startsWith('--start='))).toBe(
      false,
    )
    expect(argumentos({ url: 'x' }).some((arg) => arg.startsWith('--start='))).toBe(false)
  })

  test('una cabecera con espacios o punto y coma no parte la línea de comandos', () => {
    const args = argumentos({
      url: 'http://127.0.0.1/stream/abc',
      headers: { Referer: 'https://sitio.example/a b; rm -rf /' },
    })

    // El valor entero vive dentro de un solo argumento: no hay shell que lo
    // interprete, y el array lo hace imposible por construcción.
    const cabeceras = args.find((arg) => arg.startsWith(HEADER_FIELD_FLAG))

    expect(cabeceras).toContain('rm -rf /')
    expect(args).toHaveLength(6)
    expect(args.at(-1)).toBe('http://127.0.0.1/stream/abc')
    expect(args.at(-2)).toBe('--')
  })

  test('los argumentos extra van antes de la URL', () => {
    const args = argumentos({ url: 'x', extraArgs: ['--volume=50'] })

    expect(args.indexOf('--volume=50')).toBeLessThan(args.indexOf('x'))
  })
})

describe('validación de cabeceras', () => {
  test('el nombre admite letras, dígitos y guiones, y nada más', () => {
    expect(HEADER_NAME_RE.source).toBe('^[A-Za-z0-9-]+$')
    expect(validHeaderName('Referer')).toBe(true)
    expect(validHeaderName('X-Fuente-1')).toBe(true)
    for (const malo of ['X Cabecera', 'X:Cabecera', 'X\tC', 'X\nC', '', 'X_C', 'X.C']) {
      expect(validHeaderName(malo), malo).toBe(false)
    }
  })

  test('el valor no admite caracteres de control', () => {
    expect(validHeaderValue('https://sitio.example/a b')).toBe(true)
    expect(validHeaderValue('')).toBe(true)
    for (const malo of ['a\nb', 'a\rb', 'a\u0000b', 'a\u001fb', 'a\u007fb']) {
      expect(validHeaderValue(malo), JSON.stringify(malo)).toBe(false)
    }
  })

  test('un nombre inválido devuelve el nombre ofensor y no construye nada', () => {
    const salida = mpvArgs({ url: 'http://127.0.0.1/stream/abc', headers: { 'X Malo': 'v' } })

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.header).toBe('X Malo')
  })

  test('un valor con salto de línea se rechaza', () => {
    const salida = mpvArgs({
      url: 'http://127.0.0.1/stream/abc',
      headers: { Referer: 'https://sitio.example\nX-Inventada: 1' },
    })

    expect(salida.ok).toBe(false)
    if (!salida.ok) expect(salida.header).toBe('Referer')
  })

  test('el error nombra la cabecera y no su valor', () => {
    const error = invalidHeaderError('Referer')

    expect(error.message).toContain('Referer')
    expect(JSON.stringify(error.context)).not.toContain('https://')
  })

  test('un valor con salto de línea no añade ningún argumento al espía', () => {
    const lanzados: (readonly string[])[] = []
    const espia = (lista: readonly string[]) => {
      lanzados.push(lista)

      return { pid: 1, exited: Promise.resolve(0), kill: () => {}, stderr: async () => '' }
    }

    const salida = mpvArgs({
      url: 'http://127.0.0.1/stream/abc',
      headers: { Referer: 'https://sitio.example\nX-Inventada: 1' },
    })
    // La ruta real hace esto: si la validación falla, no se llama al espía.
    if (salida.ok) espia(salida.args)

    expect(lanzados).toHaveLength(0)
  })

  test('el espía recibe el array exacto', () => {
    const lanzados: (readonly string[])[] = []
    const espia = (lista: readonly string[]) => {
      lanzados.push(lista)

      return { pid: 1, exited: Promise.resolve(0), kill: () => {}, stderr: async () => '' }
    }

    const salida = mpvArgs({
      url: 'http://127.0.0.1:7717/stream/abc',
      headers: { Referer: 'https://sitio.example' },
      startAtS: 90,
    })
    if (salida.ok) espia(salida.args)

    expect(lanzados).toEqual([
      [
        '--no-config',
        '--force-window=yes',
        '--keep-open=no',
        '--http-header-fields=Referer: https://sitio.example',
        '--start=90',
        '--',
        'http://127.0.0.1:7717/stream/abc',
      ],
    ])
  })
})
