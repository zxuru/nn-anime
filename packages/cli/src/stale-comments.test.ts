import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Los comentarios que ya no dicen la verdad.
 *
 * El encabezado de `index.ts` decía «la migración es un marcador… la
 * implementación real llega en T16» cuando la migración real llevaba meses
 * aplicando `catalog-store`: el comentario mandaba a buscar algo que ya estaba.
 * Los comentarios de este paquete hablan de lo que el módulo hace **hoy**.
 *
 * Por eso la forma de prometer algo para más tarde está prohibida: si un módulo
 * falta, se escribe; no se anuncia en un comentario.
 */

/** El paquete, desde este archivo. */
const PAQUETE = dirname(fileURLToPath(import.meta.url))

/** Los archivos de código del paquete, con sus pruebas. */
function archivos(): readonly string[] {
  const encontrados: string[] = []

  const recorrer = (directorio: string): void => {
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const ruta = join(directorio, entrada.name)

      if (entrada.isDirectory()) {
        recorrer(ruta)
      } else if (entrada.name.endsWith('.ts')) {
        // Este archivo se salta a sí mismo: su encabezado **cita** el comentario
        // viejo para explicar qué vigila, y el vigilante no puede acusarse.
        if (entrada.name !== 'stale-comments.test.ts') encontrados.push(ruta)
      }
    }
  }

  recorrer(PAQUETE)

  return encontrados
}

/** «llega en T16», «llegará en T16»…: un módulo anunciado y no escrito. */
const PROMESA = /\bllega\w*\s+(?:en|a)\s+T\d+/i

describe('los comentarios del paquete', () => {
  test('ninguno anuncia un módulo que ya existe', () => {
    const ofensores: string[] = []

    for (const archivo of archivos()) {
      const texto = readFileSync(archivo, 'utf8')
      const lineas = texto.split('\n')

      lineas.forEach((linea, indice) => {
        if (PROMESA.test(linea)) ofensores.push(`${archivo}:${indice + 1}: ${linea.trim()}`)
      })
    }

    expect(ofensores).toEqual([])
  })
})
