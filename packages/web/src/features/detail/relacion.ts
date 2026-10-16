/**
 * El motivo de una relación de AniList, en las palabras de la interfaz.
 *
 * AniList publica quince tipos y la frontera deja pasar ocho (`ANILIST_RELATIONS`,
 * en `core`): los que apuntan a otra entrega de la misma franquicia. Aquí cada uno
 * tiene su texto, y el mapa es **cerrado y completo a propósito**: con un `Record`
 * sobre el tipo de `core`, añadir una relación allí sin traducirla aquí no compila.
 *
 * Traducir en un módulo aparte y no dentro del componente es lo que permite medir
 * el mapa sin pintar nada: la prueba recorre las ocho y comprueba que ninguna se
 * queda con la clave en crudo, que es lo que se vería en pantalla si faltara.
 */

import type { AniListRelation } from '@nn-anime/core/anilist'

const CLAVES: Readonly<Record<AniListRelation, string>> = {
  sequel: 'detail.relation.sequel',
  prequel: 'detail.relation.prequel',
  parent: 'detail.relation.parent',
  sideStory: 'detail.relation.sideStory',
  spinOff: 'detail.relation.spinOff',
  alternative: 'detail.relation.alternative',
  summary: 'detail.relation.summary',
  special: 'detail.relation.special',
}

/** La clave del catálogo con la que se lee esta relación. */
export function claveDeRelacion(relacion: AniListRelation): string {
  return CLAVES[relacion]
}
