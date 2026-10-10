# Spec: media-proxy

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
POST /api/play/mpv                    lanza mpv con el stream resuelto
POST /api/play/mpv/:pid/stop          mata el mpv lanzado
GET  /api/play/mpv/events             SSE: estado del reproductor externo
```

El `:ticket` es un identificador opaco, aleatorio y de vida corta (10 minutos, renovable). Nunca
contiene la URL de upstream, para que el cliente web no pueda leerla ni compartirla. La
resolución ticket → URL y headers vive en una tabla en memoria con tope de 500 entradas y
expiración por LRU.

Comportamiento del proxy de bytes:

- Copia los headers de upstream tal cual, más `Range` del cliente.
- Devuelve `206` con `Content-Range` cuando el upstream lo devuelve; si no, degrada a `200`.
- Fuerza `Accept-Encoding: identity` para no romper `Range`.
- Timeout de conexión 10 s; sin timeout de cuerpo, porque el cuerpo es el video.
- Emite el cuerpo en streaming con `ReadableStream` y `pipeTo`. Nunca hace `arrayBuffer()`.

Comportamiento del proxy HLS:

- Detecta playlist por `Content-Type` o por extensión `.m3u8`.
- Reescribe las URIs de segmentos y de sub-playlists a `/stream/:ticket/seg/:index`,
  preservando el orden de resolución de URLs relativas contra la URL base de la playlist.
- Conserva las líneas `#EXT-X-KEY` apuntando también al proxy, para que la clave viaje con los
  mismos headers.
- Caché en memoria de playlists por 10 s como máximo, porque cambian entre recargas.
- No reescribe ni inspecciona el contenido de los segmentos `.ts` o `.m4s`.

Handoff a mpv:

```
mpv --no-terminal --force-window=yes --really-quiet
    --http-header-fields="Referer: <valor>,User-Agent: <valor>"
    --sub-file=<ruta temporal>          # sólo si hay subtítulo elegido y es srt o ass
    <url de proxy con ticket>
```

- El proceso se lanza con `Bun.spawn`, se registra el `pid` y se escucha su salida.
- El estado (`starting`, `playing`, `exited`, `failed`) se publica por SSE.
- Si `mpv` no existe en el `PATH`, `POST /api/play/mpv` responde 503 con `{Available: false}` y
  la UI ofrece el reproductor web.
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

## Seguridad

El ticket es la única capacidad que tiene el cliente web. Debe ser aleatorio con CSPRNG, de un
solo uso por resolución y con expiración corta, para que un token filtrado no permita descargar
el video de otro usuario ni enumerar el catálogo del proveedor. La validación de `Range` debe
rechazar valores negativos, múltiplos rangos y tamaños absurdos antes de reenviar.

## Open Questions

1. ¿Se soporta `#EXT-X-DISCONTINUITY` con cambio de URL base, o se rechaza la playlist por
   considerarla fuera de alcance en v1? Se propone rechazar con un error explícito.
2. ¿El subtítulo externo se descarga y se sirve por el proxy, para que el navegador no necesite
   CORS de un tercero? Se propone que sí, con conversión de `srt` a `vtt` en memoria.
3. ¿Se expone el control de mpv (pausa, salto) desde la UI, o sólo lanzar y detener? Se propone
   lanzar, detener y ver estado en v1.
