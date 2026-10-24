/**
 * El análisis de una dirección de repositorio.
 *
 * Cada prueba de rechazo comprueba lo que **sí** sale, no sólo que `undefined`:
 * un analizador que rechazara todo pasaría las pruebas de rechazo, y el que se
 * está probando es el que tiene que aceptar lo de arriba.
 */

import { describe, expect, test } from 'bun:test'
import {
  githubRepoFromUrl,
  MAX_REPO_NAME_LENGTH,
  MAX_REPO_OWNER_LENGTH,
  MAX_REPO_REF_LENGTH,
  MAX_REPO_SUBDIR_LENGTH,
  RECOMMENDED_PROVIDER_REPO,
} from './repos'

const SIMPLE = {
  owner: 'zxuru',
  repo: 'nn-anime-plugins',
  url: 'https://github.com/zxuru/nn-anime-plugins',
}

describe('githubRepoFromUrl: las formas que la gente escribe', () => {
  test('la dirección del navegador', () => {
    expect(githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins')).toEqual(SIMPLE)
  })

  test('con barra final', () => {
    expect(githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins/')).toEqual(SIMPLE)
  })

  test('sin esquema y con el host', () => {
    expect(githubRepoFromUrl('github.com/zxuru/nn-anime-plugins')).toEqual(SIMPLE)
  })

  test('la forma corta owner/repo', () => {
    expect(githubRepoFromUrl('zxuru/nn-anime-plugins')).toEqual(SIMPLE)
  })

  test('con un espacio alrededor', () => {
    expect(githubRepoFromUrl('  zxuru/nn-anime-plugins  ')).toEqual(SIMPLE)
  })

  test('con http, que se normaliza a https', () => {
    expect(githubRepoFromUrl('http://github.com/zxuru/nn-anime-plugins')?.url).toBe(SIMPLE.url)
  })

  test('con el sufijo .git, que no es parte del nombre', () => {
    expect(githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins.git')).toEqual(SIMPLE)
  })

  test('con www, que es el mismo host', () => {
    expect(githubRepoFromUrl('https://www.github.com/zxuru/nn-anime-plugins')).toEqual(SIMPLE)
  })

  test('la consulta y el fragmento de la dirección no cambian el repo', () => {
    expect(githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins?tab=readme#x')).toEqual(
      SIMPLE,
    )
  })
})

describe('githubRepoFromUrl: la referencia y la subcarpeta', () => {
  test('una rama', () => {
    expect(githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins/tree/dev')).toEqual({
      ...SIMPLE,
      ref: 'dev',
      url: `${SIMPLE.url}/tree/dev`,
    })
  })

  test('una rama y una subcarpeta', () => {
    expect(
      githubRepoFromUrl('https://github.com/zxuru/nn-anime-plugins/tree/main/src/providers'),
    ).toEqual({
      ...SIMPLE,
      ref: 'main',
      subdir: 'src/providers',
      url: `${SIMPLE.url}/tree/main/src/providers`,
    })
  })

  test('un commit de cuarenta hexadecimales', () => {
    const sha = 'a'.repeat(40)

    expect(githubRepoFromUrl(`https://github.com/zxuru/nn-anime-plugins/tree/${sha}`)?.ref).toBe(
      sha,
    )
  })

  test('la referencia conserva sus mayúsculas: una etiqueta no es lo mismo en minúsculas', () => {
    expect(githubRepoFromUrl('zxuru/nn-anime-plugins/tree/V1.2.3')?.ref).toBe('V1.2.3')
  })
})

describe('githubRepoFromUrl: lo que se normaliza y lo que se rechaza', () => {
  test('mayúsculas en el usuario y el repositorio', () => {
    expect(githubRepoFromUrl('https://github.com/ZXURU/NN-Anime-Plugins')).toEqual(SIMPLE)
  })

  test('la misma entrada de cuatro formas da la misma cadena', () => {
    const formas = [
      'https://github.com/zxuru/nn-anime-plugins',
      'http://www.github.com/zxuru/nn-anime-plugins/',
      'github.com/ZXURU/NN-ANIME-PLUGINS.git',
      '  zxuru/nn-anime-plugins  ',
    ]

    expect(new Set(formas.map((forma) => githubRepoFromUrl(forma)?.url)).size).toBe(1)
  })

  test('otro host no es un repositorio de GitHub', () => {
    expect(githubRepoFromUrl('https://gitlab.com/zxuru/nn-anime-plugins')).toBeUndefined()
    // El host se compara entero: `github.com.evil.example` no es GitHub.
    expect(githubRepoFromUrl('https://github.com.evil.example/o/r')).toBeUndefined()
  })

  test('otro esquema se rechaza antes de mirar el host', () => {
    expect(githubRepoFromUrl('file:///github.com/o/r')).toBeUndefined()
    expect(githubRepoFromUrl('git://github.com/o/r')).toBeUndefined()
  })

  test('credenciales o puerto son otra cosa que un repositorio', () => {
    expect(githubRepoFromUrl('https://user@github.com/o/r')).toBeUndefined()
    expect(githubRepoFromUrl('https://github.com:8443/o/r')).toBeUndefined()
  })

  test('`blob` nombra un archivo, no el repositorio', () => {
    expect(githubRepoFromUrl('https://github.com/o/r/blob/main/a.ts')).toBeUndefined()
  })

  test('`tree` sin referencia no existe en GitHub', () => {
    expect(githubRepoFromUrl('https://github.com/o/r/tree')).toBeUndefined()
    expect(githubRepoFromUrl('https://github.com/o/r/tree/')).toBeUndefined()
  })

  test('sin host se admite la forma corta con `tree`, y se rechaza lo demás', () => {
    expect(githubRepoFromUrl('o/r')).toEqual({
      owner: 'o',
      repo: 'r',
      url: 'https://github.com/o/r',
    })
    expect(githubRepoFromUrl('o/r/tree/main')?.ref).toBe('main')
    // `o/r/x` sería un repo con una carpeta, o dos carpetas: adivinar no.
    expect(githubRepoFromUrl('o/r/x')).toBeUndefined()
    expect(githubRepoFromUrl('o/r/../x')).toBeUndefined()
  })

  test('`..` no es un nombre de repositorio ni de carpeta', () => {
    expect(githubRepoFromUrl('o/..')).toBeUndefined()
    // Sin host no hay normalización de `URL` que valga: aquí decide la validación.
    expect(githubRepoFromUrl('o/r/tree/main/../../etc')).toBeUndefined()
    expect(githubRepoFromUrl('o/r/tree/../main')).toBeUndefined()
  })

  test('el analizador de `URL` ya quita los segmentos `.` y `..`', () => {
    // No es una prueba de la validación: es la prueba de que la validación no
    // hace falta aquí. `new URL` resuelve `..` y `%2e%2e` antes de que nadie
    // mire la ruta, así que lo que llega es el repositorio y no una salida.
    expect(githubRepoFromUrl('https://github.com/o/r/tree/main/../..')).toEqual({
      owner: 'o',
      repo: 'r',
      url: 'https://github.com/o/r',
    })
    expect(githubRepoFromUrl('https://github.com/o/r/tree/main/%2e%2e/%2e%2e')).toEqual({
      owner: 'o',
      repo: 'r',
      url: 'https://github.com/o/r',
    })
  })

  test('`..` codificado se juzga después de descodificar', () => {
    expect(githubRepoFromUrl('https://github.com/o/%2e%2e')).toBeUndefined()
    // `%2f` descodifica a una barra: dentro de un segmento es una salida.
    expect(githubRepoFromUrl('https://github.com/o/r/tree/main/a%2f..%2fb')).toBeUndefined()
  })

  test('la barra invertida y la unidad de Windows no son una ruta del repo', () => {
    expect(githubRepoFromUrl('https://github.com/o/r/tree/main/C:\\Windows')).toBeUndefined()
    expect(githubRepoFromUrl('o/r\\x')).toBeUndefined()
  })

  test('un texto vacío no es un repositorio', () => {
    expect(githubRepoFromUrl('   ')).toBeUndefined()
  })

  test('los topes de cada parte son los que acotan la dirección', () => {
    // No hay tope del total: la suma de estos cuatro es el máximo posible. Si
    // alguno desaparece, esta prueba es la que lo dice.
    expect(githubRepoFromUrl(`o/${'r'.repeat(MAX_REPO_NAME_LENGTH + 1)}`)).toBeUndefined()
    expect(githubRepoFromUrl(`${'o'.repeat(MAX_REPO_OWNER_LENGTH + 1)}/r`)).toBeUndefined()
    expect(githubRepoFromUrl(`o/r/tree/${'v'.repeat(MAX_REPO_REF_LENGTH + 1)}`)).toBeUndefined()
    expect(
      githubRepoFromUrl(`o/r/tree/main/${'s'.repeat(MAX_REPO_SUBDIR_LENGTH + 1)}`),
    ).toBeUndefined()
  })

  test('una referencia y una carpeta del tamaño del tope sí entran', () => {
    const ref = 'r'.repeat(MAX_REPO_REF_LENGTH)
    const subdir = 's'.repeat(MAX_REPO_SUBDIR_LENGTH)

    expect(githubRepoFromUrl(`o/r/tree/${ref}/${subdir}`)?.subdir).toHaveLength(
      MAX_REPO_SUBDIR_LENGTH,
    )
  })

  test('un nombre de usuario que empieza por guion se rechaza', () => {
    expect(githubRepoFromUrl('-o/r')).toBeUndefined()
    expect(githubRepoFromUrl('o-/r')).toBeUndefined()
  })

  test('un solo segmento no es un repositorio', () => {
    expect(githubRepoFromUrl('nn-anime-plugins')).toBeUndefined()
    expect(githubRepoFromUrl('/')).toBeUndefined()
  })
})

/**
 * El repositorio que la aplicación recomienda en el primer arranque.
 *
 * No basta con que sea una cadena: tiene que pasar el mismo analizador que el
 * campo de Ajustes, o la recomendación sería una dirección que la propia
 * aplicación rechaza. Si alguien cambia el host o el nombre, esto falla.
 */
describe('el repositorio recomendado', () => {
  test('es un repositorio de GitHub válido y normalizado', () => {
    expect(githubRepoFromUrl(RECOMMENDED_PROVIDER_REPO)).toEqual(SIMPLE)
  })
})
