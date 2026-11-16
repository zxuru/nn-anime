import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
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

describe('los planes de `tasks/`', () => {
  /**
   * Los planes que no son el índice ni el plan maestro.
   *
   * `todo.md` y `plan.md` los escribe una sola mano —la del integrador— y
   * `roadmap.md` y `discovery.md` son los índices. Los demás son planes sueltos:
   * cada uno dice qué se pidió, con qué condición y en qué quedó.
   */
  const EXCLUIDOS = ['todo.md', 'plan.md', 'roadmap.md', 'discovery.md']

  /** Los planes sueltos de `tasks/`. */
  function planes(): readonly string[] {
    return readdirSync(`${RAIZ}tasks`)
      .filter((archivo) => archivo.endsWith('.md') && !EXCLUIDOS.includes(archivo))
      .sort()
  }

  test('cada uno dice en qué estado está, en las primeras líneas', async () => {
    for (const plan of planes()) {
      const texto = await leer(`tasks/${plan}`)
      const cabecera = texto.split('\n').slice(0, 12).join('\n')

      // Un plan sin estado es un plan del que nadie sabe si lo que dice sigue
      // siendo cierto: se lee y no se sabe si hay que seguirlo.
      expect(cabecera, plan).toMatch(/\*\*Estado:\*\* \*\*(cerrado|abierto|caducado)\*\*/)
    }
  })

  test('los planes de descubrimiento están indexados', async () => {
    const indice = await leer('tasks/discovery.md')
    const sueltos = planes().filter((plan) => plan.startsWith('discovery-'))

    expect(sueltos.length).toBeGreaterThan(0)

    for (const plan of sueltos) {
      expect(indice, plan).toContain(`](${plan})`)
    }
  })
})

describe('la guía de Docker', () => {
  test('los comandos que cita existen', async () => {
    const manifiesto = JSON.parse(await leer('package.json')) as {
      scripts: Record<string, string>
    }

    for (const comando of comandos(await leer('docs/docker.md'))) {
      expect(Object.keys(manifiesto.scripts), comando).toContain(comando)
    }
  })

  test('los documentos y archivos que enlaza existen', async () => {
    const texto = await leer('docs/docker.md')

    for (const coincidencia of texto.matchAll(/\]\(([^)]+\.(?:md|example))\)/g)) {
      const ruta = coincidencia[1] ?? ''
      const desdeDocs = ruta.startsWith('../') ? ruta.slice(3) : `docs/${ruta}`
      const existe = await Bun.file(`${RAIZ}${desdeDocs}`).exists()

      expect(existe, ruta).toBe(true)
    }
  })

  test('avisa de no exponer sin token y de los plugins sin sandbox', async () => {
    const texto = await leer('docs/docker.md')

    expect(texto).toContain('No expongas el puerto a Internet sin `RONA_TOKEN`')
    expect(texto).toContain('sin sandbox')
    expect(texto).toContain('Una sola réplica por volumen')
  })
})

/**
 * El mapa de capacidades.
 *
 * El mapa se declara «la única fuente de verdad sobre qué módulos existen», así
 * que cuando se queda viejo no falla: nada lo comprueba. Lo que falló aquí fue
 * peor que viejo: `downloads` estaba en «Enmiendas pendientes de aprobación» —
«no se escribe su spec ni su código hasta que el humano apruebe la enmienda»—
con la mitad de la capacidad ya en producción.
 *
 * Estas pruebas miran el documento **contra el árbol**: los paquetes que cita
 * existen, los contratos que cita existen, y una capacidad no puede estar a la
 * vez en el grafo y en la lista de lo que falta por aprobar.
 */
describe('el informe de la v1', () => {
  test('dice que queda congelado y a dónde está el estado vigente', async () => {
    const texto = await leer('docs/v1-report.md')

    // El informe dice «la v1» y lleva las cifras de la v1: si alguien las
    // actualiza, el documento miente dos veces —sobre cuándo y sobre cuánto— y
    // quien lo cite llevará la cifra equivocada a una presentación.
    expect(texto).toContain('queda congelado')
    expect(texto).toContain('no se actualizan')

    // Y el que quiera el estado de hoy tiene que saber dónde está.
    expect(texto).toContain('tasks/roadmap.md')
    expect(texto).toContain('tasks/deuda.md')
  })

  test('conserva los seis casos de método', async () => {
    const texto = await leer('docs/v1-report.md')
    const casos = texto.slice(texto.indexOf('## Hallazgos de método'))

    // La sección que explica el patrón de fallo más repetido del proyecto no
    // caduca: es historia, y quitarla sería borrar lo que se aprendió.
    for (const tarea of ['T29', 'T39', 'T42', 'T44', 'T46', 'T47']) {
      expect(casos, tarea).toContain(tarea)
    }
  })
})

describe('el mapa de capacidades', () => {
  const MAPA = 'docs/specs/CAPABILITY-MAP.md'

  /** Las filas de una tabla del mapa: `| `a` | b | c |`. */
  async function filas(seccion: string): Promise<readonly string[][]> {
    const texto = await leer(MAPA)
    const desde = texto.indexOf(`## ${seccion}`)

    expect(desde, `el mapa no tiene la sección «${seccion}»`).toBeGreaterThan(-1)

    const cuerpo = texto.slice(desde).split('\n## ')[0] ?? ''
    const filas: string[][] = []

    for (const linea of cuerpo.split('\n')) {
      if (!linea.startsWith('| `')) continue
      filas.push(
        linea
          .split('|')
          .slice(1, -1)
          .map((celda) => celda.trim()),
      )
    }

    return filas
  }

  test('ninguna capacidad está a la vez en el grafo y en lo que falta por aprobar', async () => {
    const enElGrafo = new Set((await filas('Módulos')).map((fila) => fila[0] ?? ''))
    const pendientes = await filas('Enmiendas pendientes de aprobación')

    for (const fila of pendientes) {
      expect(enElGrafo.has(fila[0] ?? ''), fila[0]).toBe(false)
    }
  })

  test('los paquetes que cita el grafo existen', async () => {
    for (const fila of await filas('Módulos')) {
      for (const paquete of (fila[3] ?? '').matchAll(/`([^`]+)`/g)) {
        const ruta = paquete[1] ?? ''
        // `desktop/` vive fuera del monorepo, pero también tiene que estar. Un
        // paquete es un directorio, y `Bun.file` no los ve.
        const existe = existsSync(`${RAIZ}${ruta}`)

        expect(existe, ruta).toBe(true)
      }
    }
  })

  test('los contratos que cita existen, estén donde estén', async () => {
    const texto = await leer(MAPA)

    for (const coincidencia of texto.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const ruta = coincidencia[1] ?? ''
      const existe = await Bun.file(`${RAIZ}docs/specs/${ruta}`).exists()

      expect(existe, ruta).toBe(true)
    }
  })
})
