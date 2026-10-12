# Seguridad de nn-anime

nn-anime ejecuta **plugins de terceros** y habla con **sitios que no controla**. Este documento dice
qué se mitiga, qué no, y por qué.

Las referencias `S*` remiten a `docs/seguridad-mejoras.md`, que trae el hallazgo, el parche y la
prueba que lo sostiene.

## Modelo de amenaza

| Amenaza | Mitigación | Dónde |
|---|---|---|
| Un sitio cualquiera abre la aplicación | Sesión en cookie `HttpOnly; SameSite=Strict` y token de arranque de un solo uso | `docs/specs/SPEC-nn-anime.md`, mitigación 1 |
| Otro sitio del navegador llama a la API local | Guard de `Origin` en métodos mutantes | mitigación 2 |
| Un plugin hace peticiones a la red local | Lista blanca de destinos: sólo `http`/`https`, sin loopback, sin redes privadas, sin metadata de nube, sin IPv4 embebida en IPv6 y sólo unicast global; revalidada en cada salto de redirección | T26a, S1 |
| Un sitio cualquiera usa la aplicación desde otro nombre | El guard de `Host` se aplica a **todas** las rutas, incluido `/` y el canje de arranque | S7 |
| Un cuerpo de petición agota la memoria | Tope de 256 KiB por petición, aplicado por el servidor antes de que ningún manejador lo lea | `packages/server/src/index.ts` |
| Un plugin lee o escribe fuera de su sitio | El plugin sólo devuelve datos; nunca recibe rutas ni la base | `docs/specs/SPEC-provider-core.md` |
| Una cookie del upstream contamina `127.0.0.1` | `Set-Cookie` se elimina siempre; sólo pasa una lista blanca de cabeceras | T26b |
| Un dato de proveedor ejecuta guiones en la página | Lista blanca de esquemas (`http`/`https`), portadas servidas desde `/api/cover` y política de contenido que no admite `'unsafe-inline'` | T31a, S3 |
| Un guion inyectado manda datos a un origen ajeno | `form-action 'self'` en la política de contenido; `frame-src` y `worker-src` cerrados y declarados, no heredados | S3 |
| Un guion inyectado pide cámara, micrófono o ubicación | `Permissions-Policy` cierra cámara, micrófono, geolocalización, pagos, USB y serial | S3 |
| Otro origen incrusta o abre respuestas de este servidor | `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy` en `same-origin`, y `X-Permitted-Cross-Domain-Policies: none` | S3 |
| Un alta de proveedor pisa un archivo que ya existe | La escritura lleva `flag: 'wx'`: decide el sistema de archivos, no una comprobación previa que puede quedar vieja | S4 |
| El navegador guarda en disco las rutas del usuario | `Cache-Control: no-store` en `GET /api/settings`, que es la única respuesta que las lleva | S8 |
| Un upstream que deja de responder mantiene la conexión abierta | Vigilante de inactividad de 30 s que se rearma con cada trozo: corta el silencio, no la reproducción | S9 |
| Un valor de cabecera inyecta argumentos en `mpv` | Nombre validado con `^[A-Za-z0-9-]+$`, valor sin caracteres de control, argumentos en array y `--no-config` | T29, T29a |
| Una URL de video se filtra al cliente | Tickets opacos en memoria: el cliente nunca ve la dirección del upstream | T25 |
| Una petición sin cookie lee el video | Sólo bajo `/stream/:ticket`, y con un ticket vivo: es la credencial que `mpv` sí puede presentar, porque no tiene cookie. 192 bits de CSPRNG, 600 s y tope de 500; no abre `/api/*` ni otra ruta | T73 |
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
4. **No hay limitador de tasa en ninguna ruta.** Es deliberado: la aplicación escucha en `127.0.0.1`,
   la sirve un solo proceso para un solo usuario, y un contador en memoria no protege de nada que el
   guard de `Host` y la cookie de sesión no cierren antes. Un limitador compartido tendría sentido el
   día que esto se sirva a más de una persona, y ese día habrá que añadirlo con su almacén, no con un
   `Map` por proceso.
5. **La excepción de loopback del proxy, si alguien la pone.** `NN_ANIME_ALLOW_LOOPBACK=1` abre
   loopback y redes privadas en la lista blanca de destinos. Existe para el arnés de pruebas, se anuncia
   en el registro al arrancar y **desactiva la mitigación de SSRF** para esas direcciones mientras esté
   puesta. La metadata de nube se sigue rechazando.

## Qué no hace esta aplicación

- No descarga torrents ni usa protocolos de pares.
- No aloja, replica ni redistribuye contenido.
- No incluye scrapers de sitios: sólo un contrato de plugin y un plugin de prueba con datos inventados.
