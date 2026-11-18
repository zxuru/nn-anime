import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  cargoLockVersion,
  cargoPackageName,
  cargoProblems,
  cargoTomlVersion,
  divergences,
  type Manifest,
  readManifests,
  tagProblem,
  withCargoLockVersion,
  withCargoTomlVersion,
  withVersion,
  writeCargo,
  writeVersion,
} from './version'
import { ROOT } from './workspaces'

/**
 * Un directorio temporal, dentro del repositorio y con su padre asegurado.
 *
 * `mkdtemp` **no crea el directorio padre**, y `.tmp/` no existe en un checkout
 * limpio: en el CI esto fallaba con `ENOENT` sólo a veces, según qué otro archivo
 * de prueba hubiera creado `.tmp` antes. Una prueba que pasa o falla según el
 * orden en que corran las demás no mide nada.
 */
async function tempDir(prefijo: string): Promise<string> {
  const base = join(ROOT, '.tmp')
  await mkdir(base, { recursive: true })

  return await mkdtemp(join(base, prefijo))
}

/**
 * Lo que estas pruebas defienden.
 *
 * Hay diez manifiestos que tienen que decir lo mismo y un tag que tiene que
 * coincidir con ellos. Cuando no coinciden no falla nada: se publica un binario
 * que dice una versión y un artefacto que dice otra, y eso se descubre cuando un
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
    const dir = await tempDir('version-')

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
    const dir = await tempDir('version-')

    try {
      const path = join(dir, 'package.json')
      await writeFile(path, `${JSON.stringify({ name: 'igual', version: '1.0.0' }, null, 2)}\n`)

      expect(await writeVersion({ name: 'igual', path, version: '1.0.0' }, '1.0.0')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/**
 * El anfitrión de ventana.
 *
 * `Cargo.toml` y `Cargo.lock` llevan la misma versión que la raíz, y el build compila con
 * `--locked`. La prueba del caso que importa es la divergencia: si `version:check` dejara de mirar
 * el Cargo, el hotfix manual del README volvería a dejar el tag en rojo y nada lo avisaría aquí.
 */
describe('la versión del anfitrión en Cargo', () => {
  const TOML = `[package]
name = "rona-desktop"
version = "1.2.3"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
`

  const LOCK = `version = 4

[[package]]
name = "otra"
version = "9.9.9"

[[package]]
name = "rona-desktop"
version = "1.2.3" # x-release-please-version
dependencies = [
 "otra",
]
`

  test('lee el nombre y la versión de [package], no los de una dependencia', () => {
    expect(cargoPackageName(TOML)).toBe('rona-desktop')
    expect(cargoTomlVersion(TOML)).toBe('1.2.3')
    expect(cargoPackageName('[dependencies]\nname = "otra"\n')).toBeUndefined()
  })

  test('cambia la versión del manifiesto y no la de las dependencias', () => {
    const nuevo = withCargoTomlVersion(TOML, '2.0.0')

    expect(nuevo).toContain('version = "2.0.0"')
    expect(nuevo).toContain('serde = { version = "1"')
    // Volver a la vieja devuelve el archivo original: la sustitución no reformatea nada más.
    expect(withCargoTomlVersion(nuevo, '1.2.3')).toBe(TOML)
  })

  test('cambia sólo la entrada del anfitrión en el lock y conserva la anotación', () => {
    const nuevo = withCargoLockVersion(LOCK, 'rona-desktop', '2.0.0')

    expect(cargoLockVersion(nuevo, 'rona-desktop')).toBe('2.0.0')
    expect(nuevo).toContain('version = "2.0.0" # x-release-please-version')
    // La otra entrada sigue donde estaba: buscar la versión sin mirar el bloque tocaba la primera.
    expect(cargoLockVersion(nuevo, 'otra')).toBe('9.9.9')
    expect(withCargoLockVersion(nuevo, 'rona-desktop', '1.2.3')).toBe(LOCK)
  })

  test('un lock sin la entrada del anfitrión se rechaza en vez de escribir otra cosa', () => {
    expect(() => withCargoLockVersion(LOCK, 'no-existe', '2.0.0')).toThrow(/no hay una entrada/)
  })

  test('una divergencia nombra el archivo y las dos versiones', () => {
    expect(cargoProblems('1.2.3', TOML, LOCK)).toEqual([])

    const problemas = cargoProblems('2.0.0', TOML, LOCK)

    expect(problemas).toHaveLength(2)
    expect(problemas[0]).toContain('Cargo.toml')
    expect(problemas[0]).toContain('1.2.3')
    expect(problemas[0]).toContain('2.0.0')
    expect(problemas[1]).toContain('Cargo.lock')
  })

  test('escribe la versión en los dos archivos y el segundo pase no toca nada', async () => {
    const dir = await tempDir('cargo-')

    try {
      const toml = join(dir, 'Cargo.toml')
      const lock = join(dir, 'Cargo.lock')

      await writeFile(toml, TOML)
      await writeFile(lock, LOCK)

      const cambios = await writeCargo('2.0.0', { toml, lock })

      expect(cambios).toHaveLength(2)
      expect(await Bun.file(toml).text()).toContain('version = "2.0.0"')
      expect(cargoLockVersion(await Bun.file(lock).text(), 'rona-desktop')).toBe('2.0.0')
      // Idempotente: `sync` se puede correr dos veces sin reescribir lo que ya está.
      expect(await writeCargo('2.0.0', { toml, lock })).toEqual([])
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

  test('el Cargo del anfitrión dice la misma versión que la raíz', async () => {
    const [root] = await readManifests()

    expect(
      cargoProblems(
        root?.version ?? '',
        await Bun.file(join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml')).text(),
        await Bun.file(join(ROOT, 'desktop', 'src-tauri', 'Cargo.lock')).text(),
      ),
    ).toEqual([])
  })
})
