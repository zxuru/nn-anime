import { describe, expect, test } from 'bun:test'
import { type CliOptions, parseArgs, type UsageError } from './args'

function ok(argv: readonly string[]): CliOptions {
  const result = parseArgs(argv)
  if (!result.ok) throw new Error(`se esperaba un análisis correcto: ${result.error.key}`)
  return result.value
}

function failure(argv: readonly string[]): UsageError {
  const result = parseArgs(argv)
  if (result.ok) throw new Error('se esperaba un error de uso, pero el análisis fue correcto')
  return result.error
}

function params(argv: readonly string[]): Record<string, unknown> {
  return { ...failure(argv).params }
}

describe('valores por defecto', () => {
  test('sin argumentos, no hay consulta y el navegador se abre', () => {
    const options = ok([])

    expect(options.query).toBeUndefined()
    expect(options.port).toBeUndefined()
    expect(options.open).toBe(true)
    expect(options.dataDir).toBeUndefined()
    expect(options.configDir).toBeUndefined()
    expect(options.providers).toEqual([])
    expect(options.lang).toBeUndefined()
    expect(options.verbose).toBe(false)
    expect(options.help).toBe(false)
    expect(options.version).toBe(false)
  })
})

describe('consulta posicional', () => {
  test('toma el primer argumento suelto como consulta', () => {
    expect(ok(['naruto']).query).toBe('naruto')
  })

  test('une varios argumentos sueltos con espacios', () => {
    expect(ok(['attack', 'on', 'titan']).query).toBe('attack on titan')
  })

  test('admite la consulta junto a otras banderas', () => {
    const options = ok(['naruto', '--no-open'])

    expect(options.query).toBe('naruto')
    expect(options.open).toBe(false)
  })

  test('tras -- todo lo que venga es consulta, aunque empiece por guion', () => {
    expect(ok(['--', '-raro', '--port']).query).toBe('-raro --port')
  })

  test('tras -- no se dispara la ayuda', () => {
    const options = ok(['--', '--help'])

    expect(options.help).toBe(false)
    expect(options.query).toBe('--help')
  })
})

describe('puerto', () => {
  test('acepta la forma corta con valor separado', () => {
    expect(ok(['-p', '8080']).port).toBe(8080)
  })

  test('acepta la forma larga con valor separado', () => {
    expect(ok(['--port', '8080']).port).toBe(8080)
  })

  test('acepta la forma larga con igual', () => {
    expect(ok(['--port=9000']).port).toBe(9000)
  })

  test('rechaza un puerto que no es un número, y nombra el valor', () => {
    const error = failure(['--port', 'abc'])

    expect(error.key).toBe('cli.usage.invalidPort')
    expect(error.exitCode).toBe(2)
    expect(params(['--port', 'abc']).value).toBe('abc')
  })

  test('rechaza el puerto cero', () => {
    expect(params(['--port', '0']).value).toBe('0')
  })

  test('rechaza un puerto por encima del máximo', () => {
    expect(params(['--port', '70000']).value).toBe('70000')
  })

  test('rechaza un puerto con decimales', () => {
    expect(params(['--port', '80.5']).value).toBe('80.5')
  })

  test('rechaza la bandera sin valor, y nombra la bandera', () => {
    const error = failure(['--port'])

    expect(error.key).toBe('cli.usage.missingValue')
    expect(error.exitCode).toBe(2)
    expect(params(['--port']).flag).toBe('--port')
  })

  test('traslada el rango admitido en los parámetros del error', () => {
    expect(params(['--port', 'abc']).min).toBe(1)
    expect(params(['--port', 'abc']).max).toBe(65535)
  })
})

describe('proveedores', () => {
  test('acumula los proveedores en orden', () => {
    expect(ok(['--provider', 'a', '--provider', 'b']).providers).toEqual(['a', 'b'])
  })

  test('acepta la forma con igual', () => {
    expect(ok(['--provider=a']).providers).toEqual(['a'])
  })

  test('sin proveedores, la lista queda vacía y no indefinida', () => {
    expect(ok([]).providers).toEqual([])
  })

  test('recorta los espacios de un identificador', () => {
    expect(ok(['--provider', '  a  ']).providers).toEqual(['a'])
  })

  test('un proveedor en blanco es un error de uso, no un filtro vacío', () => {
    expect(params(['--provider', ' ']).flag).toBe('--provider')
    expect(params(['--provider', '   ']).flag).toBe('--provider')
  })
})

describe('rutas e idioma', () => {
  test('acepta el directorio de datos separado', () => {
    expect(ok(['--data-dir', '/datos']).dataDir).toBe('/datos')
  })

  test('acepta el directorio de configuración con igual', () => {
    expect(ok(['--config-dir=/conf']).configDir).toBe('/conf')
  })

  test('acepta el idioma', () => {
    expect(ok(['--lang', 'en']).lang).toBe('en')
  })

  test('un idioma en blanco es un error de uso', () => {
    expect(params(['--lang', ' ']).flag).toBe('--lang')
  })

  test('rechaza el directorio de datos sin valor', () => {
    expect(params(['--data-dir']).flag).toBe('--data-dir')
  })

  test('acepta una ruta que empieza por guion si viene con igual', () => {
    expect(ok(['--data-dir=-raro']).dataDir).toBe('-raro')
  })
})

describe('banderas simples', () => {
  test('-v activa el modo detallado', () => {
    expect(ok(['-v']).verbose).toBe(true)
  })

  test('--verbose activa el modo detallado', () => {
    expect(ok(['--verbose']).verbose).toBe(true)
  })

  test('--help se anota', () => {
    expect(ok(['--help']).help).toBe(true)
  })

  test('-h se anota', () => {
    expect(ok(['-h']).help).toBe(true)
  })

  test('--version se anota', () => {
    expect(ok(['--version']).version).toBe(true)
  })
})

describe('ayuda y versión tienen prioridad', () => {
  test('--help gana aunque el resto de argumentos sea inválido', () => {
    expect(ok(['--port', 'abc', '--help']).help).toBe(true)
  })

  test('--version gana aunque haya una bandera desconocida', () => {
    expect(ok(['--desconocida', '--version']).version).toBe(true)
  })
})

describe('errores de uso', () => {
  test('una bandera desconocida se nombra en los parámetros', () => {
    const error = failure(['--desconocida'])

    expect(error.key).toBe('cli.usage.unknownFlag')
    expect(error.exitCode).toBe(2)
    expect(params(['--desconocida']).flag).toBe('--desconocida')
  })

  test('una bandera corta desconocida también se nombra', () => {
    expect(params(['-x']).flag).toBe('-x')
  })

  test('el código de salida de todo error de uso es 2', () => {
    expect(failure(['--port', 'abc']).exitCode).toBe(2)
    expect(failure(['--desconocida']).exitCode).toBe(2)
    expect(failure(['--port']).exitCode).toBe(2)
  })
})
