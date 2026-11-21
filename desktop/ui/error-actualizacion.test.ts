import { describe, expect, test } from 'bun:test'
import { explicarFallo } from './error-actualizacion'

// Los mensajes son los de `tauri-plugin-updater` 2.14, copiados de su
// `error.rs` con los datos de ejemplo dentro: si una versión del plugin cambia
// una frase, este archivo deja de cubrirla y hay que volver a mirarlo.
const SIN_MANIFIESTO = 'Could not fetch a valid release JSON from the remote'
const PLATAFORMA = 'the platform `windows` was not found in the response `platforms` object'
const RESPALDO =
  'None of the fallback platforms `["a", "b"]` were found in the response `platforms` object'
const FIRMA_AJENA =
  'The update was signed for version 0.9.0 but the update endpoint announced version 0.11.1. The endpoint response may have been tampered with to force installing a different release.'
const SIN_VERSION =
  'The update signature does not specify the version it was signed for, which `requireSignedVersion` requires. Re-sign and re-publish this release, or disable `requireSignedVersion`.'
const SIN_ENDPOINTS = 'Updater does not have any endpoints set.'
const SIN_HTTPS = 'The configured updater endpoint must use a secure protocol like `https`.'
const DNS =
  'error sending request for url (https://github.com/zxuru/nn-anime/releases/latest/download/latest.json): error trying to connect: dns error: failed to lookup address information: Name or service not known'
const TIEMPO = 'error sending request for url (https://github.com/…): operation timed out'
const CORTE = 'error sending request for url (https://github.com/…): connection reset by peer'

describe('lo que se cuenta de un fallo de la comprobación', () => {
  test('un endpoint que no da manifiesto es un fallo de configuración', () => {
    const fallo = explicarFallo(SIN_MANIFIESTO)

    // Es el caso de la 0.10.0: el endpoint apuntaba a un repositorio que no existe.
    // Reintentar devuelve un 404 igual, así que al arrancar se enseña.
    expect(fallo.deConfiguracion).toBe(true)
    expect(fallo.titulo).toContain('manifiesto')
    expect(fallo.detalle).toContain('repositorio que ya no existe')
  })

  test('una release sin la plataforma o con la firma torcida también es de configuración', () => {
    for (const mensaje of [
      PLATAFORMA,
      RESPALDO,
      FIRMA_AJENA,
      SIN_VERSION,
      SIN_ENDPOINTS,
      SIN_HTTPS,
    ]) {
      expect(explicarFallo(mensaje).deConfiguracion, mensaje).toBe(true)
    }

    // Y cada uno con su frase: un fallo de firma no se cuenta como uno de red.
    expect(explicarFallo(FIRMA_AJENA).titulo).toContain('firma')
    expect(explicarFallo(RESPALDO).titulo).toContain('este sistema')
    expect(explicarFallo(SIN_ENDPOINTS).titulo).toContain('dirección del updater')
  })

  test('un fallo de red no es de configuración y no se enseña al arrancar', () => {
    for (const mensaje of [DNS, TIEMPO, CORTE]) {
      const fallo = explicarFallo(mensaje)

      expect(fallo.deConfiguracion, mensaje).toBe(false)
      expect(fallo.titulo).toContain('No se pudo contactar')
    }
  })

  test('lo desconocido se calla al arrancar y enseña el mensaje en crudo si se pidió', () => {
    const fallo = explicarFallo('algo que el plugin no dijo todavía')

    expect(fallo.deConfiguracion).toBe(false)

    // Sin detalle propio, la ventana cae al mensaje original: es lo que se copia
    // en un informe de fallo.
    expect(fallo.detalle).toBeNull()
  })

  test('un mensaje vacío no rompe la ventana', () => {
    expect(explicarFallo('').deConfiguracion).toBe(false)
    expect(explicarFallo('').titulo).not.toBe('')
  })
})
