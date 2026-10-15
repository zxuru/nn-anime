/**
 * Lo que un tramo del mosaico dice de sí mismo.
 *
 * Tres cosas que el artefacto pinta y que no son datos del catálogo sino reglas de
 * la composición: cuántos títulos lleva el tramo (el tercer renglón de su nota), la
 * cuenta del top cuando queda algo por desplegar, y el peso de cada pieza dentro
 * de un tramo. Van aquí y no dentro de cada fila porque son la misma regla vista
 * desde cinco sitios, y porque así se miden sin un navegador.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { PesoPieza } from '../../components/Pieza'
import { t } from '../../i18n'

/** La cuenta de un tramo: «3 títulos», «1 título». */
export function cuentaDeTitulos(total: number): string {
  return total === 1
    ? t(DEFAULT_LOCALE, 'home.countOne')
    : t(DEFAULT_LOCALE, 'home.count', { count: total })
}

/**
 * La cuenta del top: los que se ven y los que quedan por desplegar.
 *
 * «12 títulos · y 7 más» mientras está recortado, «19 títulos» cuando ya se
 * desplegó. El primer número es el de los puestos que **se ven**: el renglón
 * acompaña lo que hay en pantalla, y decir «50 títulos» sobre diez piezas hace
 * dudar de si la rejilla se ha cortado o de si el recuento cuenta otra cosa. En el
 * artefacto es el mismo reparto —cinco piezas a la vista y «12 títulos · y 7 más»
 * con doce en el top—.
 */
export function cuentaDelTop(total: number, visibles: number): string {
  if (visibles >= total) return cuentaDeTitulos(total)

  return t(DEFAULT_LOCALE, 'home.countMore', { count: visibles, more: total - visibles })
}

/**
 * El peso de cada pieza de Novedades.
 *
 * El artefacto abre el tramo con una pieza de tres de ancho por dos de alto —lo
 * más reciente manda—, la sigue con una de dos de ancho y reparte el resto en
 * celdas. La primera no es la más importante por casualidad: es la que acaba de
 * publicarse, y por eso pesa más.
 */
const PESOS_DE_NOVEDADES: readonly PesoPieza[] = ['m', 'w', 's', 's', 's']

export function pesoDeNovedades(indice: number): PesoPieza {
  return PESOS_DE_NOVEDADES[indice % PESOS_DE_NOVEDADES.length] ?? 's'
}
