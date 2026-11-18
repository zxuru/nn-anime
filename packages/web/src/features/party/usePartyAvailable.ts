/**
 * Si este servidor tiene la sala de visionado montada.
 *
 * La sala es opcional: sin `RONA_PARTY=1` sus rutas no existen y el servidor lo
 * dice en `/api/health` con `party: false`. La pantalla de reproducción pintaba
 * «Ver juntos» siempre, así que en una instalación normal el botón abría un panel
 * que sólo podía fallar, y el 404 se contaba como «esa sala no existe».
 *
 * **La comprobación no bloquea la reproducción.** Es un adorno de la pantalla y
 * va por su cuenta: si el health tarda o falla, el video sigue igual y el mando no
 * se ofrece, que es preferible a ofrecer uno que no lleva a ninguna parte.
 */

import { healthResponseSchema } from '@rona/core/api'
import { useEffect, useState } from 'react'
import { apiGet, type RequestDeps } from '../../api/client'

/** Lo que se sabe de la sala. `comprobando` es «todavía no». */
export type SalaDisponible = 'comprobando' | 'si' | 'no' | 'sin-saber'

/**
 * El plazo de la comprobación.
 *
 * Es corto y propio: el health contesta en milisegundos y no hay nada que
 * esperar. `apiGet` pone su límite cuando no recibe señal, y aquí no se le pasa
 * una —la lectura se comparte entre montajes—, así que este plazo es el que vale.
 */
export const SALUD_TIMEOUT_MS = 4000

export interface PartyHealthOptions {
  /** Inyectable en las pruebas: no se espera el plazo real. */
  readonly timeoutMs?: number
  /** El `fetch` inyectable, como en el resto del cliente. */
  readonly deps?: RequestDeps
}

/**
 * Lo que dice `/api/health` del party.
 *
 * Un fallo se propaga: quien decide qué pintar necesita distinguir «está apagado»
 * de «no se pudo saber», aunque en los dos casos el mando no se enseñe.
 */
export async function readPartyAvailable(options: PartyHealthOptions = {}): Promise<boolean> {
  const salud = await apiGet(
    '/api/health',
    healthResponseSchema,
    { timeoutMs: options.timeoutMs ?? SALUD_TIMEOUT_MS },
    options.deps,
  )

  return salud.party
}

/**
 * Si el mando de la sala se pinta.
 *
 * Sólo con la confirmación del servidor. Un mando que aparece mientras se
 * comprueba y desaparece al llegar el «no» es un salto en el encabezado, y uno
 * que se queda sin confirmación ofrece una sala que puede no existir.
 */
export function muestraBotonSala(estado: SalaDisponible): boolean {
  return estado === 'si'
}

export function usePartyAvailable(): SalaDisponible {
  const [estado, setEstado] = useState<SalaDisponible>('comprobando')

  useEffect(() => {
    let vivo = true

    readPartyAvailable().then(
      (party) => {
        if (vivo) setEstado(party ? 'si' : 'no')
      },
      () => {
        // Sin health legible no se afirma nada: el mando no se ofrece y la
        // reproducción sigue como si la sala no existiera.
        if (vivo) setEstado('sin-saber')
      },
    )

    return () => {
      vivo = false
    }
  }, [])

  return estado
}
