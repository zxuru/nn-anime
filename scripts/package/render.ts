#!/usr/bin/env bun
/**
 * Plantillas de los instaladores.
 *
 * Los archivos de `packaging/` son plantillas y no configuración generada: se
 * leen, se sustituyen unos pocos marcadores y se escriben en un temporal. La
 * alternativa —pasar los valores por línea de comandos— no vale para todos: NSIS
 * los admite como `!define`, pero `nfpm` y un `Info.plist` no, y tener tres
 * mecanismos para lo mismo esconde cuál está mal cuando uno falla.
 */

import { join } from 'node:path'
import { ROOT } from '../workspaces'

/** El marcador que hay que sustituir en una plantilla. */
export function marker(name: string): string {
  return `__${name}__`
}

/**
 * Sustituye los marcadores y falla si alguno quedó sin valor.
 *
 * Un marcador olvidado —`__VERSION__` dentro de un `.plist`— produce un archivo
 * válido con un texto absurdo, y el síntoma aparece al instalar. Comprobarlo aquí
 * convierte ese fallo en un error que nombra el marcador.
 */
export function render(template: string, values: Readonly<Record<string, string>>): string {
  let texto = template

  for (const [name, value] of Object.entries(values)) {
    texto = texto.replaceAll(marker(name), value)
  }

  const restantes = texto.match(/__[A-Z_]+__/g)
  if (restantes !== null) {
    throw new Error(`quedaron marcadores sin valor: ${[...new Set(restantes)].join(', ')}`)
  }

  return texto
}

/** El contenido de una plantilla de `packaging/`. */
export async function template(relative: string): Promise<string> {
  return await Bun.file(join(ROOT, 'packaging', relative)).text()
}
