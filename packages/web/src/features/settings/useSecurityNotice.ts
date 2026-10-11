/**
 * De dónde sale el aviso de seguridad.
 *
 * El documento vive en la raíz del repo y la aplicación lo sirve en
 * `/SECURITY.md`. Se pide ahí, en vez de copiarlo dentro del bundle, por dos
 * motivos: el documento sigue siendo **uno solo** —el que se lee en el repo y el
 * que se lee en la pantalla son el mismo archivo— y no hace falta ningún truco
 * de empaquetado para meterlo en el build.
 *
 * La carga es perezosa: no se pide nada hasta que el usuario abre el aviso.
 *
 * La descarga es una función pura y aparte —recibe el `fetch`— porque así se
 * prueba con un doble, sin navegador y sin montar un componente.
 */

import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

/** La ruta servida. Relativa a propósito: nunca una URL absoluta. */
const RUTA = '/SECURITY.md'

export interface ContentFetcher {
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
}

export interface NoticeContent {
  readonly markdown: string | undefined
  /** El fallo, ya clasificado, si el documento no llegó. */
  readonly error: Fallo | undefined
}

/** Pide el documento y devuelve su texto. Lanza si la respuesta no es 200. */
export async function loadNotice(deps: ContentFetcher, signal?: AbortSignal): Promise<string> {
  const response = await deps.fetch(RUTA, {
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  })
  // Se lanza un `ApiError` y no un `Error` suelto: así el fallo del documento se
  // clasifica por su estado —un 404 es que no está, un 500 es del servidor— con
  // el mismo camino que el resto de las peticiones.
  if (!response.ok) throw new ApiError(response.status, `GET ${RUTA} respondió ${response.status}`)

  return await response.text()
}

/**
 * El documento, cuando hace falta.
 *
 * Se pide al abrir y se guarda: cerrar y volver a abrir no repite la petición.
 * Si falló, la siguiente apertura lo vuelve a intentar, que es lo que se espera
 * de un enlace que no cargó.
 */
export function useSecurityNotice(open: boolean): NoticeContent {
  const [content, setContent] = useState<NoticeContent>({
    markdown: undefined,
    error: undefined,
  })

  useEffect(() => {
    if (!open || content.markdown !== undefined) return

    const controller = new AbortController()

    void loadNotice({ fetch: (input, init) => fetch(input, init) }, controller.signal).then(
      (markdown) => setContent({ markdown, error: undefined }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setContent({ markdown: undefined, error: describirFallo(error) })
      },
    )

    return () => controller.abort()
  }, [open, content.markdown])

  return content
}
