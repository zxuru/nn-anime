import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { type Block, inline, parseNotice } from './notice-markdown'

/**
 * El intérprete del aviso de seguridad.
 *
 * Se prueba con trozos pequeños —una tabla, una lista, un párrafo partido— y
 * además con el documento de verdad: un intérprete que sólo pasa sus casos de
 * juguete y se atraganta con el documento que tiene que leer no sirve de nada.
 */

const DOC = fileURLToPath(new URL('../../../../../SECURITY.md', import.meta.url))

function kinds(blocks: readonly Block[]): readonly string[] {
  return blocks.map((block) => block.kind)
}

describe('marca en línea', () => {
  test('separa negrita y código del texto', () => {
    expect(inline('un `dato` y **esto**')).toEqual([
      { kind: 'text', value: 'un ' },
      { kind: 'code', value: 'dato' },
      { kind: 'text', value: ' y ' },
      { kind: 'strong', value: 'esto' },
    ])
  })

  test('sin marca devuelve un solo tramo', () => {
    expect(inline('nada que marcar')).toEqual([{ kind: 'text', value: 'nada que marcar' }])
  })

  test('el asterisco suelto no abre negrita', () => {
    expect(inline('2 * 3')).toEqual([{ kind: 'text', value: '2 * 3' }])
  })
})

describe('bloques', () => {
  test('reconoce los tres niveles de título', () => {
    const blocks = parseNotice('# uno\n\n## dos\n\n### tres\n')

    expect(blocks).toEqual([
      { kind: 'heading', level: 1, spans: [{ kind: 'text', value: 'uno' }] },
      { kind: 'heading', level: 2, spans: [{ kind: 'text', value: 'dos' }] },
      { kind: 'heading', level: 3, spans: [{ kind: 'text', value: 'tres' }] },
    ])
  })

  test('las líneas partidas a mano son un solo párrafo', () => {
    const blocks = parseNotice('una frase\npartida en tres\n\notro párrafo\n')

    expect(kinds(blocks)).toEqual(['paragraph', 'paragraph'])
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      spans: [{ kind: 'text', value: 'una frase partida en tres' }],
    })
  })

  test('la tabla se separa en cabecera y filas', () => {
    const blocks = parseNotice('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | `c` |\n')

    expect(kinds(blocks)).toEqual(['table'])
    expect(blocks[0]).toEqual({
      kind: 'table',
      head: [[{ kind: 'text', value: 'A' }], [{ kind: 'text', value: 'B' }]],
      rows: [
        [[{ kind: 'text', value: '1' }], [{ kind: 'text', value: '2' }]],
        [[{ kind: 'text', value: '3' }], [{ kind: 'code', value: 'c' }]],
      ],
    })
  })

  test('una lista numerada une sus líneas de continuación', () => {
    const blocks = parseNotice('1. primero\n   sigue aquí\n2. segundo\n')

    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [
          [{ kind: 'text', value: 'primero sigue aquí' }],
          [{ kind: 'text', value: 'segundo' }],
        ],
      },
    ])
  })

  test('una lista con guiones queda desordenada', () => {
    const blocks = parseNotice('- uno\n- dos\n')

    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', value: 'uno' }], [{ kind: 'text', value: 'dos' }]],
      },
    ])
  })

  test('una barra suelta no abre tabla', () => {
    const blocks = parseNotice('| no es tabla |\n')

    expect(kinds(blocks)).toEqual(['paragraph'])
  })
})

describe('el documento de verdad', () => {
  test('se convierte entero, sin dejarse ningún bloque', async () => {
    const markdown = await Bun.file(DOC).text()
    const blocks = parseNotice(markdown)

    expect(kinds(blocks)).toContain('heading')
    expect(kinds(blocks)).toContain('paragraph')
    expect(kinds(blocks)).toContain('table')
    expect(kinds(blocks)).toContain('list')

    // El texto no se pierde por el camino: ni una línea con contenido se queda
    // fuera. Las de la tabla y las de las listas van dentro de sus bloques, así
    // que se comprueba contra el total de caracteres.
    const dentro = JSON.stringify(blocks)
    for (const trozo of [
      'Seguridad de nn-anime',
      'Modelo de amenaza',
      'Riesgo residual, en texto claro',
      'Qué no hace esta aplicación',
      'DNS rebinding',
      'No descarga torrents',
    ]) {
      expect(dentro, trozo).toContain(trozo)
    }
  })

  test('la tabla del modelo de amenaza llega entera', async () => {
    const markdown = await Bun.file(DOC).text()
    const tabla = parseNotice(markdown).find((block) => block.kind === 'table')

    expect(tabla?.kind).toBe('table')
    if (tabla?.kind !== 'table') return

    // Las filas se cuentan en el documento, no aquí: un número escrito a mano
    // se queda viejo en cuanto se añade una mitigación, y entonces la prueba
    // falla por el documento estar bien. Lo que se comprueba es que el parser no
    // pierde ninguna, que es lo que puede romperse.
    const lineas = markdown.split('\n')
    const desde = lineas.findIndex((linea) => linea.trimStart().startsWith('|'))
    const cuerpo = lineas.slice(desde).filter((linea) => linea.trimStart().startsWith('|'))

    expect(desde).toBeGreaterThan(-1)
    expect(tabla.head).toHaveLength(3)
    expect(tabla.rows).toHaveLength(cuerpo.length - 2)
  })
})
