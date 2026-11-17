/**
 * El esqueleto de un resultado, con la forma de la tarjeta.
 *
 * No es un bloque gris suelto: la espera ocupa exactamente lo que va a ocupar la
 * tarjeta —portada 2:3, título y meta—, así que cuando llegan los datos la fila
 * no cambia de alto ni arrastra el contenido de abajo. Es la misma regla que
 * T271 dejó en Perfil, Historial, Biblioteca y Ajustes; Buscar se había quedado
 * con el rectángulo de 14 rem.
 *
 * Es decoración: `aria-hidden` y sin texto. Lo que se anuncia es el estado de la
 * lista (`aria-busy`), no cada hueco.
 */

import type { ReactNode } from 'react'

export function EsqueletoResultado(): ReactNode {
  return (
    <div className="card card--esqueleto" aria-hidden="true">
      <div className="skeleton card__cover--esqueleto" />
      <div className="skeleton card__linea--titulo" />
      <div className="skeleton card__linea--meta" />
    </div>
  )
}
