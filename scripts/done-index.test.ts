#!/usr/bin/env bun
/**
 * La guarda del índice de cierres.
 *
 * `tasks/done/` es una bandeja, no un archivo: el integrador indexa el fragmento y retira el archivo
 * en el mismo commit. El contenido no se pierde —vive en la historia de git—, pero el índice es la
 * única puerta de entrada. Si un fragmento entra sin fila, o una fila se repite o se queda sin
 * columnas, el índice deja de servir para volver y nadie se entera hasta que hace falta.
 *
 * Nada de esto lo ve `tsc` ni lo mide una prueba de producto: son archivos de `tasks/`. Por eso se
 * comprueban aquí, y por eso el índice cita el comando con el que se recupera cada fragmento.
 */

import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const DONE = join(ROOT, 'tasks', 'done')
const INDICE = join(DONE, 'INDICE.md')
const TODO = join(ROOT, 'tasks', 'todo.md')
const README = join(DONE, 'README.md')

interface Fila {
  readonly id: string
  readonly titulo: string
  readonly commit: string
  readonly verificacion: string
  readonly donde: string
}

/** Separa las celdas de una fila de tabla sin partir los `|` escapados. */
function celdasDe(linea: string): string[] {
  return linea
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((celda) => celda.replace(/\\\|/g, '|').trim())
}

async function filasDelIndice(): Promise<readonly Fila[]> {
  const texto = await Bun.file(INDICE).text()

  return texto
    .split(/\r?\n/)
    .filter((linea) => linea.startsWith('| T'))
    .map((linea) => {
      const [id = '', titulo = '', commit = '', verificacion = '', donde = ''] = celdasDe(linea)
      return { id, titulo, commit, verificacion, donde }
    })
}

async function fragmentosEnDisco(): Promise<readonly string[]> {
  return (await readdir(DONE))
    .filter((archivo) => /^T.*\.md$/.test(archivo))
    .map((archivo) => archivo.replace(/\.md$/, ''))
}

describe('el índice de los cierres', () => {
  test('todo fragmento que está en la bandeja tiene su fila', async () => {
    const filas = await filasDelIndice()
    const indexados = new Set(filas.map((fila) => fila.id))
    const sinFila = (await fragmentosEnDisco()).filter((id) => !indexados.has(id))

    expect(sinFila, 'fragmentos sin fila en tasks/done/INDICE.md').toEqual([])
  })

  test('ninguna tarea aparece dos veces', async () => {
    const filas = await filasDelIndice()
    const ids = filas.map((fila) => fila.id)

    expect(new Set(ids).size, 'ids repetidos en el índice').toBe(ids.length)
  })

  test('cada fila tiene las cinco columnas y no le falta el asunto ni el destino', async () => {
    const lineas = (await Bun.file(INDICE).text())
      .split(/\r?\n/)
      .filter((linea) => linea.startsWith('| T'))

    for (const linea of lineas) {
      const celdas = celdasDe(linea)
      expect(celdas, `fila sin cinco columnas: ${linea}`).toHaveLength(5)
      expect(celdas[0], `fila sin id: ${linea}`).toMatch(/^T\d+[-a-z]*$/)
      expect(celdas[1], `fila sin título: ${linea}`).not.toBe('')
      expect(celdas[4], `fila sin destino: ${linea}`).not.toBe('')
    }
  })

  test('el total que declara la cabecera es el de filas de la tabla', async () => {
    const texto = await Bun.file(INDICE).text()
    const declarado = /(\d+) fragmentos indexados/.exec(texto)?.[1] ?? ''
    const filas = await filasDelIndice()

    expect(Number(declarado), 'la cabecera no declara el total').toBe(filas.length)
  })

  test('el índice se encuentra desde el README y sus destinos existen', async () => {
    const readme = await Bun.file(README).text()
    expect(readme).toContain('INDICE.md')

    const todo = await Bun.file(TODO).text()

    for (const fila of await filasDelIndice()) {
      if (fila.donde !== '`tasks/todo.md`') continue
      expect(todo.includes(fila.id), `${fila.id} dice vivir en tasks/todo.md y no aparece`).toBe(
        true,
      )
    }
  })
})
