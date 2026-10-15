/**
 * Las portadas de AniList para las piezas que ya tienen ficha.
 *
 * El motor devuelve referencias locales, y su portada es la del proveedor. Cuando
 * AniList conoce esa obra, su imagen es mejor y es la misma que la de las filas
 * del descubrimiento: pedirlas en un **lote** —una petición para todas las piezas
 * de la fila— es lo que evita una petición por tarjeta, que con una fila de diez
 * serían diez viajes para adornar.
 *
 * Tres reglas, y las tres importan:
 *
 * 1. **Es opcional.** Sin respuesta no pasa nada: la pieza se queda con la portada
 *    del proveedor, que es la de antes de esta entrega.
 * 2. **Se pide por referencias, nunca por direcciones.** El servidor resuelve la
 *    imagen contra su caché y la sirve por su ruta, así que el navegador sigue sin
 *    conocer ningún origen remoto.
 * 3. **La clave del mapa es el par proveedor y referencia**, que es lo que la
 *    pieza tiene: así el consumidor no tiene que saber de ids de AniList.
 */

import type { EnrichmentBatchResponse } from '@nn-anime/core/api'
import { enrichmentBatchRequestSchema, enrichmentBatchResponseSchema } from '@nn-anime/core/api'
import type { ProviderRef } from '@nn-anime/core/models'
import { useEffect, useState } from 'react'
import { apiPostJson } from '../../api/client'

/** Lo máximo que se pide de una vez: el tope del contrato del servidor. */
export const MAX_ENRIQUECIDOS = 24

/** La clave con la que una pieza busca su portada. */
export function claveDeRef(ref: ProviderRef): string {
  return `${ref.providerId}:${ref.value}`
}

/** La firma de la lista de referencias, para no repetir una petición idéntica. */
export function firmaDeRefs(refs: readonly ProviderRef[]): string {
  return refs
    .slice(0, MAX_ENRIQUECIDOS)
    .map((ref) => claveDeRef(ref))
    .sort()
    .join('|')
}

/**
 * Qué refs se piden de verdad.
 *
 * Sin repetidos, con el tope del contrato y en orden: la firma ordena igual, así
 * que el mismo conjunto de piezas no vuelve a pedirse aunque la fila se reordene.
 */
export function refsAPedir(refs: readonly ProviderRef[]): readonly ProviderRef[] {
  const vistos = new Set<string>()
  const pedidas: ProviderRef[] = []

  for (const ref of refs) {
    const clave = claveDeRef(ref)
    if (vistos.has(clave)) continue

    vistos.add(clave)
    pedidas.push(ref)
    if (pedidas.length === MAX_ENRIQUECIDOS) break
  }

  return pedidas
}

/** Las portadas por referencia, tal y como las pide la fila. */
export function portadasDeRespuesta(
  respuesta: EnrichmentBatchResponse,
): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>()

  for (const item of respuesta.items) {
    if (item.enrichment === undefined) continue

    mapa.set(claveDeRef(item.ref), item.enrichment.cover)
  }

  return mapa
}

/**
 * Las portadas de AniList de estas referencias, o un mapa vacío.
 *
 * Un fallo no se cuenta: esta lectura es un adorno y la pieza ya tiene su portada.
 * Decir «no se pudieron cargar las portadas de AniList» sería ruido sobre algo que
 * el usuario no pidió.
 */
export function usePortadasDeAniList(refs: readonly ProviderRef[]): ReadonlyMap<string, string> {
  const [portadas, setPortadas] = useState<ReadonlyMap<string, string>>(new Map())
  const firma = firmaDeRefs(refs)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `firma` resume las referencias y dispara la lectura
  useEffect(() => {
    if (firma === '') {
      setPortadas(new Map())
      return
    }

    const controller = new AbortController()
    const pedidas = refsAPedir(refs)
    const peticion = enrichmentBatchRequestSchema.parse({ refs: pedidas })

    void apiPostJson('/api/enrichment', peticion, enrichmentBatchResponseSchema, {
      signal: controller.signal,
    }).then(
      (respuesta) => {
        if (!controller.signal.aborted) setPortadas(portadasDeRespuesta(respuesta))
      },
      () => {
        // Sin portadas de AniList: las piezas se quedan con las suyas.
      },
    )

    return () => controller.abort()
    // La firma resume las referencias: con el array la petición saldría en cada render.
  }, [firma])

  return portadas
}
