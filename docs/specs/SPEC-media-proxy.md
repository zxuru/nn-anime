# Spec: media-proxy
> **Los criterios de esta lista no son el registro que se mantiene.** El trabajo se cierra contra la
> aceptación de cada tarea en `tasks/todo.md`, que está marcada **y medida mutando la implementación**;
> esta lista es el contrato —el *qué*— y duplica aquélla. Se decidió en el Checkpoint H: mantener dos
> listas de lo mismo acaba con una de las dos mintiendo, y la que mintió durante la v1 fue ésta.


Module id: `media-proxy` · Depende de: `core`, `provider-core` · Paquete: `packages/media-proxy`
Convenciones heredadas de `SPEC-nn-anime.md`.

## Objective

Poner el video en pantalla resolviendo tres problemas que el navegador y mpv no resuelven
solos: CORS, headers obligatorios del upstream y playlists HLS con segmentos protegidos. Además,
entregar el stream a mpv sin que el cliente web vea nunca un header sensible.

Éxito significa:

1. Un `StreamSource` de cualquier proveedor se reproduce en el reproductor web sin tocar el
   navegador a mano.
2. Un `StreamSource` se abre en mpv con los headers correctos, con un clic.
3. Los headers de upstream existen en un solo lugar: la memoria de este proceso.
4. Buscar en la línea de tiempo funciona: el proxy soporta `Range` de extremo a extremo.
5. El proxy no acumula bytes: memoria estable durante un episodio completo.

## Contrato

Rutas HTTP. Todas exigen el token de sesión y el `Host` validado del server.

```
GET  /stream/:ticket                 proxy de bytes o de playlist
GET  /stream/:ticket/seg/:index       segmento resuelto de una playlist HLS
GET  /api/subtitles/:ticket           proxy de una pista de subtítulos, con conversión a vtt
GET  /api/cover/:providerId/:ref      portada del título cacheado, con caché larga
POST /api/play/mpv                    lanza mpv con el stream resuelto
POST /api/play/mpv/:pid/stop          mata el mpv lanzado
GET  /api/play/mpv/events             SSE: estado del reproductor externo
```

La ruta de subtítulos faltaba en esta lista y T30 la implementaba igual. Y la de portadas no
existía en ningún sitio, aunque la interfaz prohíbe en su sección Never incrustar recursos remotos:
sin ella no había forma de mostrar una portada sin incumplir el contrato. Las dos se añaden al
auditar. Un contrato que no lista una de sus rutas es un contrato incompleto, y un contrato que
exige algo sin dar el mecanismo es peor.

El `:ticket` es un identificador opaco, aleatorio con CSPRNG y de vida corta (600 s). Nunca
contiene la URL de upstream, para que el cliente web no pueda leerla ni compartirla. La
resolución ticket → URL y headers vive en una tabla en memoria con tope de 500 entradas y
desalojo LRU.

El ticket **no es de un solo uso**: una reproducción HLS exige decenas de peticiones de segmento.
Lo que lo acota es la vida corta, el tope de entradas y el alcance por índice: el índice de
segmento se resuelve contra la playlist ya parseada y cacheada, y un índice fuera de rango
devuelve 404 sin tocar el upstream.

Comportamiento del proxy de bytes:

- Reenvía al upstream sólo los headers que el proveedor declaró, más `Range` del cliente.
- Reenvía al cliente sólo una **lista blanca** de cabeceras de respuesta: `content-type`,
  `content-length`, `content-range`, `accept-ranges`, `cache-control`, `etag`, `last-modified`.
  Todo lo demás se descarta.
- **Elimina `Set-Cookie` siempre, sin excepción.** Las cookies ignoran el puerto: un upstream
  hostil podría escribir cookies para todo `127.0.0.1` y contaminar otros servicios locales del
  usuario.
- Fuerza el `Content-Type` desde lo que se pidió (playlist, segmento o subtítulo) y añade
  `X-Content-Type-Options: nosniff`. Nunca copia el `Content-Type` del upstream.
- Devuelve `206` con `Content-Range` cuando el upstream lo devuelve; si no, degrada a `200`.
- Fuerza `Accept-Encoding: identity` para no romper `Range`.
- Timeout de conexión 10 s; sin timeout de cuerpo, porque el cuerpo es el video.
- Emite el cuerpo en streaming con `ReadableStream` y `pipeTo`. Nunca hace `arrayBuffer()`.

Lista blanca de destinos: sólo `http` y `https`. Se rechazan loopback (`127.0.0.0/8`, `::1`),
RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`) y metadata de
nube. La comprobación se aplica al destino inicial y a **cada salto de redirección**, con tope de
5 saltos. Cualquier otro esquema, incluido `file:`, se rechaza antes de abrir la conexión.

Comportamiento del proxy HLS:

- Detecta playlist por `Content-Type` o por extensión `.m3u8`.
- Reescribe las URIs de segmentos y de sub-playlists a `/stream/:ticket/seg/:index`,
  preservando el orden de resolución de URLs relativas contra la URL base de la playlist.
- Conserva las líneas `#EXT-X-KEY` apuntando también al proxy, para que la clave viaje con los
  mismos headers.
- Caché en memoria de playlists por 10 s como máximo, porque cambian entre recargas. **Esa vida es la
  del texto de la lista, no la del índice que resuelve `seg/:index`:** una reproducción entera pide
  segmentos contra el índice, así que el proxy lo crea con la vida del ticket y lo rejuvenece al
  resolverlo. Con la vida corta en el índice, el episodio se quedaba sin él a los pocos segundos de
  cargar la lista y todos los segmentos pasaban a ser 404: se oía lo que ya estaba en el búfer y la
  reproducción se paraba.
- No reescribe ni inspecciona el contenido de los segmentos `.ts` o `.m4s`.

Comportamiento de la ruta de portadas (`GET /api/cover/:providerId/:ref`):

- La `:ref` es la referencia del proveedor y **puede contener barras**. El cliente la manda
  codificada con `encodeURIComponent`. Medido con Hono: `/:ref` captura el valor entero si las
  barras van escapadas (`a%2Fb` → `a/b`) y da 404 si no (`a/b`). Es parte del contrato, no un
  detalle del cliente.
- Una `:ref` con forma de ascenso (`..%2F..%2Fetc%2Fpasswd`) llega entera como parámetro. Hoy es
  sólo una clave de consulta en la base y ahí no hay recorrido posible, pero **el nombre de archivo
  de la caché en disco no se deriva nunca de la referencia**, sino de un hash. La comprobación de
  confinamiento, si se cachea en disco, es la de `packages/server/src/static-assets.ts`.
- El `Content-Type` servido sale de una **lista blanca de tipos ráster** (`image/png`, `image/jpeg`,
  `image/webp`, `image/gif`, `image/avif`) y lo decide el proxy, nunca el upstream — igual que T26b.
  Un tipo fuera de la lista, `image/svg+xml` incluido, se rechaza con 415: un SVG es un documento
  capaz de ejecutar guiones y se serviría desde nuestro propio origen. La CSP lo detendría
  (`default-src 'self'` sin `'unsafe-inline'`), pero esa defensa es indirecta y no debe ser la única.
- Tope de 5 MB por portada: por encima, 413 y no se cachea.
- La portada sale de la fila de `anime` si existe y, si no, de un **listado ya cacheado** —de
  búsqueda o de tendencias— que contenga la referencia. Un `SearchResult` trae su `coverUrl` sin que
  nadie haya abierto la ficha, y sin esta segunda vía las tarjetas de la búsqueda pedían una imagen
  que la ruta contestaba 404 hasta que alguien abría el título.
- Si la referencia no está en ninguna de las dos cachés, 404: la ruta **no** le pregunta al proveedor
  por una portada que no conoce, así que la única petición saliente posible es la de los bytes de una
  portada ya cacheada, y esa pasa por la lista blanca de destinos como cualquier otra.
- Caché HTTP normal con la TTL de miniatura de la tabla del spec (604800 s): `Cache-Control` con
  `max-age` y `ETag` por referencia, para que el navegador no repita la petición.

Handoff a mpv:

```
mpv --no-terminal --force-window=yes --really-quiet
    --http-header-fields="Referer: <valor>,User-Agent: <valor>"
    --sub-file=<ruta temporal>          # sólo si hay subtítulo elegido y es srt o ass
    <url de proxy con ticket>
```

- El proceso se lanza con `Bun.spawn`, se registra el `pid` y se escucha su salida.
- El estado (`starting`, `playing`, `exited`, `failed`) se publica por SSE.
- Si `mpv` no existe en el `PATH`, `POST /api/play/mpv` responde 503 con `{ "mpv": false }` y la
  UI ofrece el reproductor web. **Unificado al auditar:** aquí decía `{Available: false}`, y el
  resto del sistema usa `mpv`, incluido `/api/health`. Dos nombres para el mismo dato en el mismo
  flujo es una errata esperando a convertirse en un fallo.
- Al salir mpv con código distinto de 0, se devuelve el `stderr` recortado a 2 KB.

## Estructura del módulo

```
packages/media-proxy/
├─ src/index.ts                fachada y tipos
├─ src/ticket-store.ts         tabla opaca en memoria con TTL y tope LRU
├─ src/byte-proxy.ts           Range, streaming, headers
├─ src/hls.ts                  detección, parseo y reescritura de playlists
├─ src/mpv.ts                  spawn, control, SSE de estado
├─ src/errors.ts
└─ src/*.test.ts
```

## Success Criteria

- [ ] Un `GET /stream/:ticket` con `Range: bytes=0-1023` devuelve 206 y exactamente 1024 bytes.
- [ ] Un mp4 de un fixture se reproduce de punta a punta en el reproductor web y permite
      adelantar sin volver a descargar desde el inicio.
- [ ] Una playlist HLS de fixture con URLs relativas se reescribe y todos los segmentos se
      resuelven a través del proxy.
- [ ] Una playlist con `#EXT-X-KEY` mantiene la clave detrás del proxy.
- [ ] El ticket no aparece nunca en un log ni contiene la URL de upstream en texto claro.
- [ ] Un ticket expirado devuelve 410, y un ticket inexistente, 404.
- [ ] Con `mpv` ausente, `/api/play/mpv` devuelve 503 y la UI muestra el fallback.
- [ ] Reproducir 10 minutos no supera 64 MB de RSS en el proceso del server.
- [ ] Un test verifica que ningún header de upstream se serializa en una respuesta al cliente.
- [ ] Un upstream de fixture que devuelve `Set-Cookie` no produce ninguna cabecera `Set-Cookie`
      en la respuesta al cliente.
- [ ] Sólo aparecen cabeceras de respuesta de la lista blanca: un test compara el conjunto
      completo de cabeceras devueltas contra la lista permitida.
- [ ] El `Content-Type` de una playlist es el que decidió el proxy, aunque el upstream mienta.
- [ ] `GET /api/cover/:providerId/:ref` con una referencia que lleva barras devuelve la imagen si el
      cliente la escapa, y 404 si no la escapa.
- [ ] Una portada que el upstream sirve como `image/svg+xml` se rechaza con 415; una mayor de 5 MB,
      con 413 y sin cachear.
- [ ] Una referencia cacheada no vuelve a llamar al proveedor; una desconocida devuelve 404.
- [ ] El proxy rechaza `http://127.0.0.1:22`, `http://169.254.169.254/`, `http://10.0.0.1/`,
      `file:///etc/passwd` y `data:text/plain,x`, con error explícito.
- [ ] Una redirección de un destino permitido hacia `http://127.0.0.1:22` se rechaza en el salto,
      no se sigue.
- [ ] Un header con `\n` o `\r` en nombre o valor se rechaza antes de llegar a `mpv`.
- [ ] Con un mpv ya corriendo, un segundo `POST /api/play/mpv` devuelve 409.

## Boundaries

**Always**

- Resolver URL y headers en el servidor a partir del ticket; el cliente nunca los aporta.
- Reenviar sólo los headers que el proveedor declaró como necesarios, más `Range`.
- Limitar el tamaño de playlist inspeccionada a 4 MB antes de parsear.
- Cerrar el upstream cuando el cliente corta la conexión.

**Ask first**

- Añadir transcodificación con ffmpeg, aunque sea de audio.
- Cachear segmentos en disco.
- Permitir que el cliente pase una URL de upstream propia.

**Never**

- Convertir el cuerpo del video en un buffer en memoria.
- Registrar headers de upstream, cookies o tokens, ni siquiera en nivel debug.
- Aceptar una URL de proxy arbitraria: el cliente sólo maneja tickets.
- Añadir CORS abierto a `/stream/*`.
- Servir `file://` ni rutas locales fuera del directorio de caché.
- Copiar `Set-Cookie` ni ninguna cabecera de respuesta fuera de la lista blanca.
- Seguir una redirección sin revalidar el destino contra la lista blanca.
- Pasar a `mpv` un nombre o valor de header sin validar.
- Confiar en el `Content-Type` que declara el upstream.

## Seguridad

Este módulo es la frontera de red del sistema: es el único lugar que hace peticiones salientes a
partir de datos que no controla. Toda su superficie de ataque se reduce a tres listas blancas, y
las tres son obligatorias:

1. **Destinos.** Sólo `http` y `https`; loopback, RFC1918, link-local y metadata de nube
   bloqueados por defecto. Revalidación en cada salto de redirección, tope de 5 saltos.
2. **Cabeceras de respuesta hacia el cliente.** Lista blanca explícita. `Set-Cookie` siempre
   fuera.
3. **Cabeceras de petición hacia el upstream.** Sólo lo que el proveedor declaró. Nombres y
   valores validados con una expresión estricta que rechaza caracteres de control, para que un
   valor con salto de línea no pueda inyectar una cabecera extra.

El ticket es la única capacidad que tiene el cliente web: aleatorio con CSPRNG, de vida corta,
tope de entradas y alcance limitado a lo que la playlist cacheada declaró. La validación de
`Range` rechaza valores negativos, múltiplos rangos y tamaños absurdos antes de reenviar.

Riesgo residual: un plugin de proveedor puede pedir al proxy que consulte cualquier destino que
pase la lista blanca. La lista blanca evita el pivote hacia la red interna, no evita que un
plugin exfiltre datos hacia internet. Eso ya es posible con un `fetch` dentro del plugin, así que
la mitigación no vive aquí: vive en el aviso al usuario de `SPEC-provider-core.md`.

## Seguridad de mpv

Los headers que se pasan a `mpv` se validan antes de construir el argumento: nombre y valor
contra una expresión estricta, sin `\r`, `\n` ni caracteres de control. El argumento se pasa como
un solo elemento de array a `Bun.spawn`; nunca por shell ni por concatenación de cadenas. Tope de
un proceso mpv concurrente: un segundo pedido devuelve 409.

## Open Questions

1. ¿Se soporta `#EXT-X-DISCONTINUITY` con cambio de URL base, o se rechaza la playlist por
   considerarla fuera de alcance en v1? Se propone rechazar con un error explícito.
2. ¿El subtítulo externo se descarga y se sirve por el proxy, para que el navegador no necesite
   CORS de un tercero? Se propone que sí, con conversión de `srt` a `vtt` en memoria.
3. ¿Se expone el control de mpv (pausa, salto) desde la UI, o sólo lanzar y detener? Se propone
   lanzar, detener y ver estado en v1.
