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
| Un DNS hostil cambia la respuesta entre la comprobación del destino y la conexión | El nombre se resuelve **una vez**, se juzgan todas sus direcciones y la conexión va a una ya validada, con el nombre en el SNI y el certificado validado contra él. Vale para las cuatro rutas que salen a la red: la capacidad de red de los plugins, el proxy de bytes, la descarga de repositorios y la consulta de metadatos a AniList | T110 |
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
| Un sitio corta la conexión antes de contestar y deja la petición del plugin colgada —con el proceso a un 100 % de CPU— | La capacidad **rechaza** cuando la conexión termina sin una respuesta completa, y el plazo la corta igual; y la petición no se medio cierra, que es lo que provoca ese corte en algunos servidores | T111 |
| Un valor de cabecera inyecta argumentos en `mpv` | Nombre validado con `^[A-Za-z0-9-]+$`, valor sin caracteres de control, argumentos en array y `--no-config` | T29, T29a |
| Una URL de video se filtra al cliente | Tickets opacos en memoria: el cliente nunca ve la dirección del upstream | T25 |
| Una petición sin cookie lee el video | Sólo bajo `/stream/:ticket`, y con un ticket vivo: es la credencial que `mpv` sí puede presentar, porque no tiene cookie. 192 bits de CSPRNG, 600 s y tope de 500; no abre `/api/*` ni otra ruta | T73 |
| Un cliente remoto entra sin credencial en modo servidor | `NN_ANIME_TOKEN` fijo, cookie `HttpOnly; SameSite=Strict` —y `Secure` con origen https—, comparación en tiempo constante. Fuera de loopback sin token el arranque se niega | T168 |
| El token de servidor acaba en una URL, un `Referer` o un log | No viaja en la URL: se pide una vez en `/login` y se guarda en la cookie. El arranque no lo imprime ni lo registra | T168 |
| La salud pública cuenta algo | `/healthz` devuelve sólo `{"status":"ok"}`: ni versión, ni rutas, ni proveedores | T168 |
| Un `Origin` ajeno muta datos en modo servidor | Guard de `Origin` por origen público exacto o mismo `Host`; en local sigue siendo sólo `http://127.0.0.1:PUERTO` | T168 |
| Un webview comprometido usa el anfitrión para leer o escribir archivos | Un único comando IPC, `elegir_carpeta_descargas`: sólo abre el diálogo nativo y devuelve la ruta; no lee ni escribe. El servidor exige ruta absoluta y sin caracteres de control antes de guardarla | T186 |
| Un cliente autenticado usa el servidor para lanzar un reproductor | En modo restringido no se registran `/api/play/mpv*` y Ajustes informa `mpv.available: false` | T168 |
| Un cliente autenticado añade o activa plugins en un servidor | `NN_ANIME_LOCKED=1` no registra `POST /api/providers` ni las mutaciones de repositorios; sólo deja leer la lista | T168 |
| `NN_ANIME_ALLOW_LOOPBACK` se queda puesta en un servidor | El arranque se niega si el host no es loopback | T168 |
| La imagen incluye un proveedor por accidente | La etapa de runtime copia sólo los paquetes de la aplicación; el fixture de pruebas no se copia | T168 |
| Un log guarda una credencial o una URL de video | Claves sensibles redactadas, `ticket` incluido | T25 |
| Una dirección de repositorio lleva al servidor a la red local o a un host ajeno | Lista blanca de **hosts de GitHub** comprobada en **cada salto**, dentro del `fetch` que usa la revalidación de destinos: un host permitido que redirige fuera de GitHub se corta antes de pedir nada | T100 |
| La consulta de metadatos a AniList lleva al servidor a otro sitio, o la usa para saturar a un tercero | Lista blanca de **hosts de AniList** —`graphql.anilist.co` para la API y su CDN para las imágenes— comprobada en cada salto, y **presupuesto**: una petición cada dos segundos, en fila india, con `Retry-After` obedecido en un 429 y una sola repetición. La imagen se pide **por referencia**, nunca por una dirección que venga del cliente | T121 |
| La clave de TMDB del usuario sale del equipo, o una ruta de metadatos se convierte en un proxy | La URL se compone con una base constante (`api.themoviedb.org`); no hay ninguna dirección que venga del cliente ni del plugin. La clave viaja sólo en esa consulta, **no se registra**, **no se devuelve** en `GET /api/settings` y **no se guarda en la caché**. Sin clave no hay petición. La imagen de TMDB no se pide: la ficha usa la portada del plugin | T177 |
| Una ruta del árbol de GitHub escribe fuera del repositorio (`..`, absoluta, unidad de Windows) | Cada ruta se valida segmento a segmento y se confina contra el directorio de destino; el árbol truncado, las rutas hostiles y los archivos que no caben se rechazan o se saltan, y nada se escribe fuera | T100 |
| Un repositorio enorme llena el disco o la memoria | 400 archivos, 512 KiB por archivo y 8 MiB en total; la descarga va a un directorio temporal y se mueve al final, así que un fallo a mitad no reemplaza lo que había | T100 |
| Activar un archivo ejecuta otro que el usuario no marcó | **No se mitiga, se declara.** Ver el riesgo residual 6 | T101 |

## Riesgo residual, en texto claro

1. **Un plugin se ejecuta sin sandbox, con los permisos del usuario.** No hay aislamiento: el proceso
   que carga el plugin es el mismo que sirve la aplicación. Un plugin hostil puede leer lo que el
   usuario pueda leer. Por eso sólo se cargan plugins que el usuario copia a mano en su directorio de
   configuración, y por eso esta advertencia aparece **en la interfaz**, no sólo aquí.
2. **DNS rebinding: cerrado en las rutas que salen a la red, y declarado lo que no cubre.** Entre la
   comprobación de destino y la conexión, un DNS hostil podía cambiar la respuesta. Desde T110 no puede:
   el nombre se resuelve **una vez**, se juzgan todas sus direcciones y la conexión va a una ya validada,
   con el nombre en el SNI, así que el certificado se sigue validando contra el nombre. La afirmación
   contraria que había aquí —que eso rompía SNI y la validación— era falsa, y está medida. Cubre la
   capacidad de red de los plugins (`plugin-fetch.ts`), el proxy de bytes (`pinned-fetch.ts`), la
   descarga de repositorios y la consulta a AniList, que usan el mismo `fetchAllowed`. Lo que
   el código **no** puede impedir es que un plugin llame al `fetch` global y se salte la lista blanca:
   por eso el motor inyecta la capacidad en cada llamada —saltársela es visible, no un descuido— y el
   repositorio de plugins tiene una prueba estática que lo impide. Falta migrar los seis plugins
   publicados y avisar desde el cargador al que no la use, que es trabajo de la fase siguiente.
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
6. **Activar un proveedor de un repositorio es confiar en el repositorio entero.** La aplicación
   ejecuta el archivo que el usuario marca, y ese archivo puede importar cualquier otro del repositorio
   —o cualquier cosa que quepa en un `import`—. La descarga y el escaneo no ejecutan nada y la selección
   está limitada a los archivos que el escáner reconoció, pero eso acota **la puerta de entrada**, no lo
   que hay detrás: no hay sandbox, igual que con un plugin copiado a mano. La aplicación no descarga
   nada hasta que alguien pega una dirección, y no activa nada hasta que alguien marca una casilla.
7. **El filtro de contenido para adultos no es una verificación de edad, y sólo alcanza a lo que las
   fuentes publican.** El ajuste —apagado por defecto— decide qué se pide a AniList, qué se guarda y qué
   se sirve, y la interfaz lo dice con esas palabras. Lo que **no** puede: comprobar quién mira, porque
   es un servidor local de un solo usuario y la sesión la tiene quien abre el puerto; alcanzar a lo que
   ninguna fuente publica, porque el feed de un proveedor no dice la edad de sus entradas —se verifica
   contra AniList y, si AniList no contesta, la entrada se enseña: un tercero caído no puede vaciar una
   fila—; verificar la búsqueda, cuyos resultados llegan mientras se teclea y donde una ida y vuelta a
   AniList por pulsación se pagaría en cada tecla; ni comprobar más allá de la ventana de verificación
   —treinta piezas en las tendencias, y el tope de la fila más ocho en el feed—, que es lo que acota
   cuántas consultas paga la primera carga. Lo que sí hace: con el ajuste apagado no pide, no guarda y
   no sirve nada marcado, y de lo marcado conserva **un booleano por referencia** —nunca la portada, la
   sinopsis ni el identificador de la obra—.
8. **Un token, un usuario.** El modo servidor no tiene cuentas: todos los clientes que conozcan el
   token comparten historial, favoritos, plan y ajustes. No hay forma de saber quién hizo qué, y
   revocar a una persona es cambiar el token a todas. Es el modelo de una instalación doméstica, no
   el de un servicio multiusuario; está dicho en [docs/docker.md](docs/docker.md).
9. **La salud es pública a propósito.** `/healthz` no pide token porque un contenedor tiene que poder
   comprobarse a sí mismo, y devuelve sólo que el proceso responde. Un escaneo de puertos puede
   saber que hay un nn-anime; no puede saber qué versión, qué proveedores ni qué rutas.
10. **Sin `NN_ANIME_PUBLIC_ORIGIN`, el guard de `Host` acepta cualquier nombre.** En una LAN no se
    puede saber con qué nombre llegarán los clientes, y la credencial que protege los datos es la
    cookie `SameSite=Strict`, no el nombre. Un DNS rebinding puede alcanzar el puerto, pero sin
    cookie no lee ni muta nada. Fijar el origen público cierra esa puerta a los nombres que no sean
    el suyo.
11. **El token vive en el entorno del contenedor.** `docker inspect` lo enseña a quien pueda hablar
    con el demonio, y un `docker run -e` lo deja en el historial del shell. Usa un `.env` con
    permisos o el secreto del orquestador; no hay `NN_ANIME_TOKEN_FILE` en esta versión.
12. **HTTP en la LAN no cifra el token ni la cookie.** El formulario de login manda el token en el
    cuerpo, y sin TLS lo ve cualquiera en el camino. Para servir fuera de la propia máquina, pon un
    reverse proxy con HTTPS y define `NN_ANIME_PUBLIC_ORIGIN=https://…`: además marca la cookie
    `Secure`.
13. **SQLite es un solo escritor.** Una réplica por volumen. Dos contenedores sobre el mismo `/data`
    no se reparten el trabajo: se pelean por el archivo y acaban en `SQLITE_BUSY`.
14. **El contenedor no es un sandbox para los plugins.** Acota el sistema de archivos a lo que el
    contenedor ve, pero el plugin sigue en el mismo proceso que el servidor, puede leer `/data`,
    hablar con la red y usar el `fetch` global. `NN_ANIME_LOCKED=1` no cambia eso.
15. **El modo restringido no aísla lo que ya está cargado.** Quita las superficies para añadir,
    activar o descargar plugins y para lanzar `mpv`; los plugins que ya estaban en el directorio se
    siguen ejecutando con los mismos permisos. La lista se decide en el servidor, no desde la
    interfaz.
16. **La clave de TMDB es un secreto del usuario y vive en la base local en claro.** Quien pueda leer
    `nn-anime.db` —el propio usuario, un plugin sin sandbox o un programa con sus permisos— la lee.
    No se cifra porque el servidor tendría que guardar la llave de cifrado en el mismo sitio, que es
    seguridad de teatro. Se mitiga lo que sí se puede: no se devuelve por HTTP, no se registra y sólo
    se usa contra `api.themoviedb.org`. Quien no quiera ese riesgo no pone clave: la ficha se queda
    con lo que publique el plugin.
17. **Cuatro avisos de Rust en la ventana propia, que no dependen de este repositorio.** El anfitrión
    de `desktop/` arrastra `glib 0.18.5` —RUSTSEC-2024-0429, `Iterator`/`DoubleEndedIterator`
    insondables sobre `Variant`—, `proc-macro-error 1.0.4` y, por el plugin de instancia única,
    `zbus_names 4.3.5` y `zvariant 5.15.1` (los tres, «sin mantener»). Ninguno se arregla desde acá:
    los dos primeros llegan por `gtk 0.18.2`, que es lo que fijan `tao`, `muda`, `tray-icon` y
    `tauri 2.12.5` —la última versión publicada—, y el arreglo de `glib` es la 0.20, un salto mayor
    que gtk todavía no da; los otros dos llegan por `zbus 5` dentro de
    `tauri-plugin-single-instance 2.5.4`, también la última. Entran cuando upstream mueva su cadena:
    `cargo update` corre en cada actualización y Dependabot vigila `desktop/src-tauri/Cargo.toml`, así
    que el PR que lo traiga aparece solo. Riesgo real hoy: bajo —los tres «sin mantener» no describen
    una vulnerabilidad explotable, y el de `glib` vive en iteradores de `Variant` que este código no
    usa—, pero está declarado y no escondido.

## Modo servidor

El despliegue en contenedor no relaja el modelo de amenaza: lo cambia de sitio. Las decisiones que
lo sostienen son cuatro:

- **Sin token no hay servidor.** `NN_ANIME_HOST` fuera de loopback —o un `NN_ANIME_PUBLIC_ORIGIN` que
  no sea loopback— exige `NN_ANIME_TOKEN`. El arranque se niega con un mensaje que dice qué falta, y
  un token de menos de 16 caracteres tampoco pasa.
- **La cookie es la puerta.** La interfaz, la API, `/SECURITY.md` y los estáticos piden la cookie
  que se obtiene en `/login`. El token no viaja en ninguna URL. `/healthz` y el propio formulario son
  las dos únicas excepciones, y el ticket de `/stream/:ticket` sigue siendo la credencial de `mpv`.
- **El `Origin` se comprueba contra el host real.** En local sigue siendo sólo
  `http://127.0.0.1:PUERTO`; en un servidor, el origen público declarado o el mismo `Host` de la
  petición. Un `Origin` ausente o `null` en un método que muta se rechaza igual que antes.
- **`NN_ANIME_LOCKED=1` es para quien decide los plugins en el servidor.** Desaparecen el alta de
  proveedores, la descarga y selección de repositorios y las rutas de `mpv`; los plugins ya montados
  se cargan. No es un sandbox y no sustituye a revisar lo que se instala.

La guía de despliegue, con Caddy y los volúmenes, está en [docs/docker.md](docs/docker.md).

## Qué no hace esta aplicación

- No descarga torrents ni usa protocolos de pares.
- No aloja, replica ni redistribuye contenido.
- No incluye scrapers de sitios: sólo un contrato de plugin y un plugin de prueba con datos inventados.
