import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

/**
 * La documentación, comprobada.
 *
 * Un README con un comando que ya no existe es peor que no tener README: manda a
 * quien lo lee a un error y le hace dudar de todo lo demás. Estas pruebas
 * comprueban lo que se puede comprobar sin leer: que los comandos que se citan
 * están en `package.json` y que los documentos que se enlazan existen.
 */

const RAIZ = fileURLToPath(new URL('../../..', import.meta.url))

async function leer(ruta: string): Promise<string> {
  return await Bun.file(`${RAIZ}${ruta}`).text()
}

/**
 * Los `bun run X` que aparecen en un texto.
 *
 * El guion bajo y los dígitos entran: sin ellos, `bun run e2e` se leía como
 * `bun run e` y la prueba fallaba por su propia expresión regular. Lo encontró
 * ella misma.
 */
function comandos(texto: string): readonly string[] {
  return [...new Set([...texto.matchAll(/bun run ([a-z0-9:_-]+)/g)].map((m) => m[1] ?? ''))]
}

describe('el README', () => {
  test('todos los comandos que cita existen', async () => {
    const scripts = Object.keys(
      JSON.parse(await leer('package.json')) as { scripts: Record<string, string> },
    ).map((nombre) => `scripts.${nombre}`)
    void scripts

    const manifiesto = JSON.parse(await leer('package.json')) as {
      scripts: Record<string, string>
    }

    for (const comando of comandos(await leer('README.md'))) {
      expect(Object.keys(manifiesto.scripts), comando).toContain(comando)
    }
  })

  test('los documentos que enlaza existen', async () => {
    const texto = await leer('README.md')

    for (const coincidencia of texto.matchAll(/\]\(([^)]+\.(?:md|png))\)/g)) {
      const ruta = coincidencia[1] ?? ''
      const existe = await Bun.file(`${RAIZ}${ruta}`).exists()

      expect(existe, ruta).toBe(true)
    }
  })

  test('dice que no incluye scrapers y que los plugins no tienen sandbox', async () => {
    const texto = await leer('README.md')

    expect(texto).toContain('no incluye ningún scraper')
    expect(texto).toContain('sin sandbox')
    expect(texto).toContain('responsabilidad de quien usa el programa')
  })

  test('explica qué produce `bun run build`', async () => {
    const texto = await leer('README.md')

    expect(texto).toContain('**Qué produce `bun run build`:**')
    expect(texto).toContain('la interfaz')
  })
})

describe('la guía de plugins', () => {
  test('los comandos que cita existen', async () => {
    const manifiesto = JSON.parse(await leer('package.json')) as {
      scripts: Record<string, string>
    }

    for (const comando of comandos(await leer('docs/providers.md'))) {
      expect(Object.keys(manifiesto.scripts), comando).toContain(comando)
    }
  })

  test('avisa del sandbox y no enseña scraping', async () => {
    const texto = await leer('docs/providers.md')

    expect(texto).toContain('sin sandbox')
    expect(texto).toContain('No incluye ningún scraper')
    // Un ejemplo que enseñara a scrapear sería el problema, no la solución.
    expect(texto).not.toContain('querySelector')
    expect(texto).not.toContain('cheerio')
  })

  test('los documentos que enlaza existen', async () => {
    const texto = await leer('docs/providers.md')

    for (const coincidencia of texto.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const ruta = coincidencia[1] ?? ''
      const desdeDocs = ruta.startsWith('../') ? ruta.slice(3) : `docs/${ruta}`
      const existe = await Bun.file(`${RAIZ}${desdeDocs}`).exists()

      expect(existe, ruta).toBe(true)
    }
  })
})
