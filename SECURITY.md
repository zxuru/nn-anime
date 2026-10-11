# Seguridad de nn-anime

nn-anime ejecuta **plugins de terceros** y habla con **sitios que no controla**. Este documento dice
qué se mitiga, qué no, y por qué.

## Modelo de amenaza

| Amenaza | Mitigación | Dónde |
|---|---|---|
| Un sitio cualquiera abre la aplicación | Sesión en cookie `HttpOnly; SameSite=Strict` y token de arranque de un solo uso | `docs/specs/SPEC-nn-anime.md`, mitigación 1 |
| Otro sitio del navegador llama a la API local | Guard de `Origin` en métodos mutantes | mitigación 2 |
| Un plugin hace peticiones a la red local | Lista blanca de destinos: sólo `http`/`https`, sin loopback, sin redes privadas, sin metadata de nube, revalidada en cada salto de redirección | T26a |
| Un plugin lee o escribe fuera de su sitio | El plugin sólo devuelve datos; nunca recibe rutas ni la base | `docs/specs/SPEC-provider-core.md` |
| Una cookie del upstream contamina `127.0.0.1` | `Set-Cookie` se elimina siempre; sólo pasa una lista blanca de cabeceras | T26b |
| Un dato de proveedor ejecuta guiones en la página | Lista blanca de esquemas (`http`/`https`) y portadas servidas desde `/api/cover` | T31a |
| Un valor de cabecera inyecta argumentos en `mpv` | Nombre validado con `^[A-Za-z0-9-]+$`, valor sin caracteres de control, argumentos en array y `--no-config` | T29, T29a |
| Una URL de video se filtra al cliente | Tickets opacos en memoria: el cliente nunca ve la dirección del upstream | T25 |
| Un log guarda una credencial o una URL de video | Claves sensibles redactadas, `ticket` incluido | T25 |

## Riesgo residual, en texto claro

1. **Un plugin se ejecuta sin sandbox, con los permisos del usuario.** No hay aislamiento: el proceso
   que carga el plugin es el mismo que sirve la aplicación. Un plugin hostil puede leer lo que el
   usuario pueda leer. Por eso sólo se cargan plugins que el usuario copia a mano en su directorio de
   configuración, y por eso esta advertencia aparece **en la interfaz**, no sólo aquí.
2. **DNS rebinding.** Entre la comprobación de destino y la conexión, un DNS hostil puede cambiar la
   respuesta. Cerrarlo del todo exige conectar a la IP ya validada, y eso rompe SNI y la validación
   del certificado. Aceptado y anotado en T26a.
3. **Los sitios de terceros pueden cambiar.** Un proveedor puede empezar a servir otra cosa, o dejar de
   servir: la aplicación lo dice con un error claro, no lo esconde.

## Qué no hace esta aplicación

- No descarga torrents ni usa protocolos de pares.
- No aloja, replica ni redistribuye contenido.
- No incluye scrapers de sitios: sólo un contrato de plugin y un plugin de prueba con datos inventados.
