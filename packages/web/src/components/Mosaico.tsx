/**
 * El mosaico de una sección.
 *
 * Una rejilla de seis columnas como mucho donde cada pieza ocupa una. La fila se
 * compone para el número de piezas que lleva: la hoja lee `--mosaico-piezas` y
 * usa tantas pistas como haya, hasta el tope de la composición. Sin eso, una fila
 * de cuatro títulos en seis pistas dejaba el tercio derecho vacío.
 *
 * No decide el tamaño de nada: el tope de la pista lo pone el punto de corte de
 * la hoja y el peso de cada pieza es el mismo —un cartel de una columna—. Lo que
 * cuenta aquí es cuántas hay, y por eso se cuentan los hijos reales: `toArray`
 * quita los `null` de una condición, que si contaran ensuciarían la cuenta.
 */

import { Children, type CSSProperties, type ReactNode } from 'react'

export interface MosaicoProps {
  readonly children: ReactNode
  readonly className?: string | undefined
}

/** La propiedad con la que la hoja sabe cuántas pistas componer. */
type EstiloMosaico = CSSProperties & Record<'--mosaico-piezas', number>

export function Mosaico(props: MosaicoProps): ReactNode {
  const clase = props.className === undefined ? 'mosaico' : `mosaico ${props.className}`
  const piezas = Children.toArray(props.children).length
  const estilo: EstiloMosaico = { '--mosaico-piezas': piezas }

  return (
    <div className={clase} style={estilo}>
      {props.children}
    </div>
  )
}
