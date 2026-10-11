/**
 * El aviso de un fallo.
 *
 * Una petición que falla no se cuenta con el mensaje del cliente. «GET
 * /api/anime/jkanime/mashle-2nd-season respondió 502» nombra el método, la ruta y
 * el código, y con eso no se sabe si el problema es la red, el servidor o el sitio
 * del que salen los datos —ni qué hacer mientras tanto—. El aviso dice las tres
 * cosas por separado:
 *
 * 1. **Qué pasó**, en una frase: «El proveedor no responde».
 * 2. **Qué hacer**: reintentar, o volver a entrar por la dirección de arranque.
 * 3. **El detalle y el mensaje crudo**, plegados. El detalle es lo que contó el
 *    servidor, en sus palabras; el mensaje crudo es para copiarlo en un informe,
 *    y sin él un fallo no se puede buscar en los registros.
 *
 * La clase del fallo la decide `api/fallo.ts`. Aquí sólo se elige qué texto del
 * catálogo le corresponde, en un mapa exhaustivo: una clase nueva sin texto no
 * compila.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import type { ClaseDeFallo, Fallo } from '../api/fallo'
import { t } from '../i18n'

/** Qué pasó. */
const TITLE: Readonly<Record<ClaseDeFallo, string>> = {
  sinConexion: 'error.title.sinConexion',
  lento: 'error.title.lento',
  sesion: 'error.title.sesion',
  noExiste: 'error.title.noExiste',
  proveedor: 'error.title.proveedor',
  servidor: 'error.title.servidor',
  peticion: 'error.title.peticion',
  forma: 'error.title.forma',
  desconocido: 'error.title.desconocido',
}

/** Qué hacer. */
const BODY: Readonly<Record<ClaseDeFallo, string>> = {
  sinConexion: 'error.body.sinConexion',
  lento: 'error.body.lento',
  sesion: 'error.body.sesion',
  noExiste: 'error.body.noExiste',
  proveedor: 'error.body.proveedor',
  servidor: 'error.body.servidor',
  peticion: 'error.body.peticion',
  forma: 'error.body.forma',
  desconocido: 'error.body.desconocido',
}

/** La frase corta, para donde no cabe el aviso entero. */
const SUMMARY: Readonly<Record<ClaseDeFallo, string>> = {
  sinConexion: 'error.summary.sinConexion',
  lento: 'error.summary.lento',
  sesion: 'error.summary.sesion',
  noExiste: 'error.summary.noExiste',
  proveedor: 'error.summary.proveedor',
  servidor: 'error.summary.servidor',
  peticion: 'error.summary.peticion',
  forma: 'error.summary.forma',
  desconocido: 'error.summary.desconocido',
}

/**
 * El fallo en una frase, para una línea de estado o un anuncio.
 *
 * Es lo que se usa donde un aviso con título y botón no cabe —el anuncio
 * `aria-live` de la búsqueda—, y nunca el mensaje crudo: un lector de pantalla
 * leyendo «GET /api/search respondió 500» no informa de nada.
 */
export function resumenDeFallo(fallo: Fallo): string {
  return t(DEFAULT_LOCALE, SUMMARY[fallo.clase])
}

export interface ErrorNoticeProps {
  readonly fallo: Fallo
  /** Sin esto no se pinta el botón: hay fallos que no se arreglan reintentando. */
  readonly onRetry?: (() => void) | undefined
}

export function ErrorNotice(props: ErrorNoticeProps): ReactNode {
  const { fallo } = props

  return (
    // `role="alert"`: el aviso sustituye a un esqueleto o a un contenido que no
    // llegó, y quien no ve la pantalla tiene que enterarse sin ir a buscarlo.
    <section className="fallo" role="alert">
      <h2 className="fallo__title">{t(DEFAULT_LOCALE, TITLE[fallo.clase])}</h2>
      <p className="fallo__body">{t(DEFAULT_LOCALE, BODY[fallo.clase])}</p>

      {/* Lo que contó el servidor, cuando contó algo: sabe más de por qué falló
          que cualquier frase nuestra. */}
      {fallo.detalle === undefined ? null : <p className="fallo__detail">{fallo.detalle}</p>}

      {props.onRetry === undefined ? null : (
        <p className="fallo__actions">
          <button type="button" className="button" onClick={props.onRetry}>
            {t(DEFAULT_LOCALE, 'error.retry')}
          </button>
        </p>
      )}

      <details className="fallo__technical">
        <summary>{t(DEFAULT_LOCALE, 'error.technical')}</summary>
        <code className="fallo__code">{fallo.tecnico}</code>
      </details>
    </section>
  )
}
