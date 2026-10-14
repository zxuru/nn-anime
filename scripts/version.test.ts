import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  divergences,
  type Manifest,
  readManifests,
  tagProblem,
  withVersion,
  writeVersion,
} from './version'
import { ROOT } from './workspaces'

/**
 * Lo que estas pruebas defienden.
 *
 * Hay diez manifiestos que tienen que decir lo mismo y un tag que tiene que
 * coincidir con ellos. Cuando no coinciden no falla nada: se publica un binario
 * que dice una versión y un instalador que dice otra, y eso se descubre cuando un
 * usuario compara el `--version` con el nombre del archivo.
 *
 * La última prueba mira el repositorio de verdad: es la que convierte «hay que
 * acordarse de subir los diez» en algo que se comprueba.
 */

const UNO: Manifest = { name: 'uno', path: '/tmp/uno/package.json', version: '1.2.3' }
const DOS: Manifest = { name: 'dos', path: '/tmp/dos/package.json', version: '1.2.3' }
const VIEJO: Manifest = { name: 'viejo', path: '/tmp/viejo/package.json', version: '0.1.0' }

describe('la comparación de versiones', () => {
  test('los que coinciden no aparecen', () => {
    expect(divergences(UNO, [DOS])).toEqual([])
  })

  test('los que se desviaron aparecen, y con su nombre', () => {
    expect(divergences(UNO, [DOS, VIEJO]).map((m) => m.name)).toEqual(['viejo'])
  })

  test('un paquete sin versión también se desvía', () => {
    const sinVersion: Manifest = { name: 'suelto', path: '/tmp/s/package.json', version: undefined }

    expect(divergences(UNO, [sinVersion]).map((m) => m.name)).toEqual(['suelto'])
  })
})

describe('la comparación con el tag', () => {
  test('el tag que coincide vale', () => {
    expect(tagProblem('1.2.3', 'v1.2.3')).toBeUndefined()
  })

  test('un tag sin la uve no vale: el flujo publica tags vX.Y.Z', () => {
    expect(tagProblem('1.2.3', '1.2.3')).toContain('no empieza por "v"')
  })

  test('un tag que no coincide dice las dos versiones', () => {
    const problema = tagProblem('1.2.3', 'v1.2.4')

    expect(problema).toContain('1.2.4')
    expect(problema).toContain('1.2.3')
  })
})

describe('la reescritura de un manifiesto', () => {
  const ORIGINAL = `{
  "name": "ejemplo",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "zod": "^4"
  }
}
`

  test('cambia la versión y no toca nada más', () => {
    const nuevo = withVersion(ORIGINAL, '2.0.0')

    expect(nuevo).toContain('"version": "2.0.0"')
    // El orden de las claves y el resto del contenido se conservan: un
    // `package.json` reordenado es un diff que nadie revisa.
    expect(JSON.parse(nuevo)).toEqual({ ...JSON.parse(ORIGINAL), version: '2.0.0' })
    expect(nuevo.indexOf('"name"')).toBeLessThan(nuevo.indexOf('"version"'))
    expect(nuevo.endsWith('\n')).toBe(true)
  })

  test('volver a poner la versión vieja devuelve el archivo original, byte a byte', () => {
    // Es la comprobación que hace `writeVersion` antes de escribir: si esto no
    // se cumple, serializar cambiaría algo más que la versión.
    expect(withVersion(withVersion(ORIGINAL, '2.0.0'), '1.0.0')).toBe(ORIGINAL)
  })

  test('un manifiesto con otro formato se rechaza en vez de reformatearse', async () => {
    const dir = await mkdtemp(join(ROOT, '.tmp', 'version-'))

    try {
      const path = join(dir, 'package.json')
      await writeFile(path, '{ "name": "raro", "version": "1.0.0" }')

      await expect(writeVersion({ name: 'raro', path, version: '1.0.0' }, '2.0.0')).rejects.toThrow(
        /cambiaría más que la versión/,
      )
      // Y no se escribió nada: negarse a escribir es lo que evita el diff enorme.
      expect(readFileSync(path, 'utf8')).toBe('{ "name": "raro", "version": "1.0.0" }')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('escribir la versión que ya está no toca el archivo', async () => {
    const dir = await mkdtemp(join(ROOT, '.tmp', 'version-'))

    try {
      const path = join(dir, 'package.json')
      await writeFile(path, `${JSON.stringify({ name: 'igual', version: '1.0.0' }, null, 2)}\n`)

      expect(await writeVersion({ name: 'igual', path, version: '1.0.0' }, '1.0.0')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('el repositorio', () => {
  test('la raíz y los nueve paquetes dicen la misma versión', async () => {
    const [root, ...paquetes] = await readManifests()

    expect(root?.version).toBeDefined()
    expect(paquetes).toHaveLength(9)
    expect(divergences(root as Manifest, paquetes)).toEqual([])
  })

  test('la versión de la raíz es una versión de release, no un rango', async () => {
    const [root] = await readManifests()

    expect(root?.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(root?.version).not.toContain('^')
  })
})
