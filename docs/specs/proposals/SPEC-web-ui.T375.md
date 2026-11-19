# Propuesta — retransmitir a la TV (D6) y el PiP a la vista

**Sobre** `main` en `d54cbed` (después de T373; T372 aún en curso). **Origen:** petición del dueño
del producto, 2026-11-19: «quiero poder utilizar el sistema PiP», «retransmitir a otros dispositivos
tipo transmitir a otros dispositivos» y, al concretar el alcance, «quiero el cast completo en lo
posible».

**Estado:** **propuesta, pendiente de aprobación humana.** Abierta el 2026-11-19 por T375. La
decisión **D6** no se cierra hasta que el spike **T379** mida un Chromecast real. Mientras tanto no
se toca la CSP, no entra ningún guion de terceros y no se abre la red.

Toca **`SPEC-web-ui`** (mando de PiP, mando de emisión, CSP) y, en la parte de tickets, a
**`SPEC-media-proxy`**; esa segunda mitad va en
[`SPEC-media-proxy.T375.md`](SPEC-media-proxy.T375.md).

## Por qué

1. **La TV es el sitio natural para ver anime y la aplicación no llega.** El reproductor web ya
   resuelve HLS y MP4, pero no hay forma de mandar la imagen al salón sin un cable. El watch party no
   sirve para esto: sincroniza el estado y exige que cada participante tenga su propia fuente
   (`docs/watch-party.md`), así que el televisor no participa.
2. **El PiP existe, pero está escondido y a medias.** El mando vive en el menú de ajustes
   (`Player.tsx:390`), no tiene atajo, arranca en `false` aunque el video ya esté en la ventana
   flotante y no conoce la variante WebKit. Quien pide «poder usar el PiP» no lo encuentra.
3. **La alternativa barata no cubre el caso real.** Chrome de escritorio no implementa Remote
   Playback para `MediaSource` y el HLS del reproductor usa `hls.js`; el camino sin SDK sirve para
   AirPlay en Safari (HLS nativo y MP4), pero no para Chrome de escritorio ni para el HLS con MSE.
4. **El modo LAN ya existe.** `RONA_HOST=0.0.0.0` + `RONA_TOKEN` es la puerta que usa watch party y
   la que puede usar la TV. Lo que falta es una credencial que la TV pueda presentar sin cookie y una
   dirección que no sea `127.0.0.1`.

## D6 — las cuatro opciones

| | Google Cast SDK | Remote Playback API | DLNA/UPnP | RoNa a RoNa |
|---|---|---|---|---|
| Qué alcanza | Chromecast y Android TV con Cast | AirPlay (Safari) y Cast en Chrome Android | Televisiones con DLNA | Otra instancia de RoNa o un navegador |
| Chrome de escritorio | **Sí** | **No** (Chrome lo limita; el HLS con MSE no se puede mandar) | Sí, por el servidor | Sí |
| HLS | Sí (lo reproduce el receptor) | No con `MediaSource`; en Safari, HLS nativo sí | Muchos televisores no | Sí, cada uno con su fuente |
| Guion de terceros | **Sí** (`gstatic`) | No | No | No |
| Contexto seguro | El emisor; loopback vale | El emisor; loopback vale | No | No |
| CORS | A medir en T379 | A medir | No | No |
| Coste | Medio | Bajo | Alto (SSDP, SOAP, AVTransport) | Ya existe el transporte de la sala |
| Riesgo nuevo | CSP + confianza en Google | Ninguno | Red local + XML | Ninguno |

**Recomendación:** **Cast SDK para Chromecast**, detrás de `RONA_CAST=1`; **Remote
Playback/AirPlay completo para Safari** (HLS y MP4) y **DLNA sólo como propuesta T398**. La razón es
la única que ordena el resto: el HLS del catálogo no se puede emitir sin SDK, y el usuario que pide
«transmitir» tiene una TV, no otra pestaña de RoNa.

**Lo que no puede afirmarse todavía:** si el Chromecast acepta un `http://192.168.x.x` sin TLS, si
exige `Access-Control-Allow-Origin`, si el receptor pide `frame-src` o si el HLS del proxy se
reproduce tal cual. Eso es T379 y no se escribe código de producción antes.

## El cambio, en una línea

La interfaz gana un mando de PiP **en el marco** y un mando de **transmitir** que sólo aparece cuando
`GET /api/cast/info` dice que hay una dirección alcanzable y `RONA_CAST=1`. Al transmitir, el
servidor emite una URL de LAN con ticket revocable; la TV la pide sin cookie; al parar, se revoca. La
TV se comporta como una salida más del reproductor: los mismos mandos, los subtítulos, el progreso,
los saltos, el siguiente episodio y la reconexión.

## Contrato de la interfaz

### PiP (T376/T377)

- El mando sale del menú de ajustes y vive **una sola vez**, dentro del marco, con el nombre
  «Ventana flotante» y `aria-pressed` cuando está activo. No hay dos controles con el mismo nombre.
- El estado sale de `document.pictureInPictureElement` y de los eventos
  `enterpictureinpicture`/`leavepictureinpicture`; no de haber pulsado el botón. Si el navegador
  rechaza, el mando sigue diciendo la verdad.
- La detección de soporte es una función pura: `document.pictureInPictureEnabled` o
  `webkitSupportsPresentationMode('picture-in-picture')`. Sin ninguna de las dos, no hay mando.
- El PiP no cambia la CSP, ni el contrato HTTP, ni el modelo de datos.

### Transmitir (T380–T399)

- `GET /api/cast/info` (sólo con sesión normal):
  `{ available: boolean, urls: string[], reason?: 'disabled' | 'loopback' | 'no-token' }`.
  `urls` son `http://<ipv4>:<puerto>`; `available` exige `RONA_CAST=1`, host no loopback y
  `RONA_TOKEN`. Un ticket de emisión **no** abre esta ruta.
- `POST /api/cast/session` con `{ providerId, episodeRef, mode }`:
  `{ id, kind, urls, expiresAt, title, poster?, subtitles: [] }`. El servidor resuelve el stream; el
  cliente nunca manda una URL. `urls` son la misma emisión por cada IPv4 útil.
- `DELETE /api/cast/session/:id`: revoca el video y los subtítulos. Un ticket revocado o vencido da
  404/410; no hay rama «vieja servible».
- La interfaz no ofrece el mando si `available` es `false`, si el SDK no cargó o si el SDK dice que
  no hay dispositivos. Un botón que sólo puede fallar es peor que no tenerlo.
- Al conectar, el video local se pausa y se anuncia «Se está viendo en {dispositivo}» con
  `aria-live="polite"`. Al parar, se revoca, se reanuda en la posición del receptor y el foco vuelve
  al mando.
- Sin `RONA_CAST=1`: no se anuncia, no se pide `gstatic`, la CSP no cambia y las rutas de emisión no
  emiten nada (409 con motivo).

#### Mandos (T384a)

- Con una emisión conectada, el reproductor usa **un solo conductor**: el `<video>` local o el
  receptor. Los mismos botones, la misma barra, las mismas teclas y el mismo reloj.
- `play/pausa`, `±10 s`, buscar, silencio, volumen, velocidad, salto de intro y `Espacio`, `K`,
  flechas, `M`, `S`, `T` llaman al receptor cuando hay cast.
- El video local se pausa y se oculta tras una capa «Se está viendo en {dispositivo}»; no hay dos
  reproducciones ni dos descargas.
- Si el SDK no soporta velocidad o volumen, el mando se oculta o se explica; no se pulsa en el vacío.
- Cambiar de audio (sub/dub) mientras se emite pide otra sesión con el modo nuevo, conserva la
  posición y recarga el receptor; no se queda con el audio viejo.
- `onPlay`, `onPause`, `onProgress`, `onDuration` y `onEnded` salen del estado del cast, para que el
  historial y la presencia sigan funcionando.

#### Subtítulos (T394)

- La sesión devuelve `subtitles: [{ id, url, lang, label }]` con URLs absolutas de LAN y tickets
  revocables; cada subtítulo es un ticket de emisión.
- `loadMedia` lleva `tracks` (`SUBTITLES`, `text/vtt`, idioma, nombre) y `activeTrackIds` con la
  pista elegida; el usuario puede cambiarla.
- La pista por defecto es la misma que la local; sin pistas, no se manda ninguna.
- Si el receptor no pinta VTT, se oculta el selector de la TV y se dice; no se promete.

#### Progreso, saltos y siguiente (T395)

- La posición del receptor alimenta el historial cada 15 s y al pausar, buscar y parar.
- El salto automático de intro/ending y el botón de saltar usan la posición del cast, una vez por
  intervalo y episodio.
- Al terminar, la reproducción automática emite el siguiente episodio; si está apagada, se muestra
  la tarjeta del siguiente sin cortar la sesión.
- La presencia de Discord sigue el estado del cast por los mismos callbacks.

#### Reconexión (T396)

- Al iniciar una emisión se guarda una marca local; al abrir `/watch` con la marca y `RONA_CAST=1` se
  carga el SDK y se adopta la sesión con `getCurrentSession`. Sin marca no se carga el guion.
- Si la sesión sigue viva, se reconstruyen aviso y mandos sin pedir un ticket nuevo; si terminó, se
  limpia la marca y se reanuda local.
- Un fallo de red no deja el aviso en «conectado» para siempre.

#### AirPlay (T387)

- Safari reproduce HLS nativo y MP4; la emisión usa un `<video>` oculto con la URL absoluta y
  `video.remote`; si no existe, `webkitShowPlaybackTargetPicker` y los eventos
  `webkitcurrentplaybacktargetiswireless`.
- El video local se pausa; los mandos y la posición se reflejan en el reproductor; al desconectar se
  reanuda en la posición remota.
- Los subtítulos se ofrecen con URLs absolutas si Safari los pinta; si no, se ocultan y se dice.
- Sin Apple TV o AirPlay 2 no se declara medido; se mide con dobles.

### CSP

La política actual (`packages/server/src/middleware/security-headers.ts`) es `default-src 'self'`,
`media-src 'self' blob:`, `connect-src 'self'`, `frame-src 'none'`. La propuesta:

- **Por defecto no cambia ni un carácter.**
- Con `RONA_CAST=1`, `script-src` y `connect-src` añaden **sólo** los hosts que T379 mida. La lista
  inicial, a confirmar, es `https://www.gstatic.com` para el guion y
  `https://clients3.google.com` para la configuración del dispositivo. No entra `unsafe-inline`,
  `unsafe-eval` ni un comodín `https:`.
- `frame-src` sólo se abre si el SDK lo exige y T379 lo demuestra; si no, sigue en `'none'`.
- `media-src` **no** se abre para Cast: el emisor no carga la URL de la TV en su propio `<video>`.
  Sólo T387 (AirPlay) necesita `media-src` para la IP de la LAN, y lo hará con `RONA_CAST=1`.

### CORS

`SPEC-media-proxy` prohíbe «CORS abierto a `/stream/*`» y esta propuesta no lo rompe. Si T379 mide
que el receptor exige CORS:

- la cabecera se emite **sólo** en `/stream/:ticket` cuando el ticket es de emisión, con
  `Access-Control-Allow-Origin: *` y sin `Access-Control-Allow-Credentials`;
- nunca en `/api/*`, ni en un ticket de navegador, ni en `/stream/:ticket/seg|key` de una emisión con
  cookie;
- se declara en `SECURITY.md` como superficie nueva y se mide con una petición real del receptor.

Además, todas las respuestas llevan hoy `Cross-Origin-Resource-Policy: same-origin`; si el receptor
es una página web, puede bloquear el medio aunque CORS esté bien. T379 lo mide y, si hace falta, se
cambia a `cross-origin` **sólo** en el ticket de emisión.

El detalle y los casos de prueba están en [`SPEC-media-proxy.T375.md`](SPEC-media-proxy.T375.md).

## Modelo de amenaza

| Amenaza | Mitigación |
|---|---|
| Cualquiera en la LAN ve la biblioteca | La app sigue exigiendo `RONA_TOKEN`; el ticket de emisión sólo abre `/stream/*` y sólo una fuente |
| Un ticket de emisión adivinado | 192 bits de CSPRNG, 4 h, 16 por instancia, revocable, no se registra |
| La TV sigue viendo después de parar | `DELETE` revoca; el siguiente segmento da 404/410; la conexión ya abierta se corta al cerrar el proceso |
| El guion de Google ejecuta código en la interfaz | Sólo con `RONA_CAST=1` y a petición; CSP con hosts exactos; sin `unsafe-*`; si falla, el reproductor sigue |
| La CSP se relaja para siempre | La política por defecto se prueba sin cambios; la relajada se prueba con la lista exacta |
| Un origen ajeno usa el cast | `GET/POST/DELETE /api/cast/*` pasan por los guards de sesión, `Host` y `Origin` como el resto |
| La URL de la emisión acaba en un log | El ticket se redacta como hoy; la respuesta no se registra; el `Referer` es `no-referrer` |
| El receptor pide la URL del upstream | La URL sólo contiene el ticket; los headers del proveedor se quedan en el proceso |
| Un subtítulo de la TV abre algo más que su pista | Ticket propio por pista, 192 bits, revocable con la sesión, sólo `/stream` y `text/vtt`; nunca `/api` |
| La reconexión carga Google sin un gesto | Sólo si hay una marca local de emisión anterior y `RONA_CAST=1`; sin marca no se pide el guion; la CSP sigue acotada |

## Lo que no entra

- **DLNA implementado.** Sólo propuesta y spike (T398); la pila SSDP/SOAP no entra sin su propia
  decisión.
- **Descargas locales en la TV.** Su ruta no tiene ticket de emisión; T399 es una propuesta y la v1
  emite lo que resuelve el proveedor.
- **Emisor móvil sin TLS.** Chrome de Android exige contexto seguro; T397 mide y documenta la vía TLS
  con un certificado de confianza, pero no se promete si el Chromecast no confía en él.
- **La app de escritorio.** WebView2 no trae el ecosistema de Cast del navegador; T378 lo mide y, si
  no, se ofrece abrir en el navegador. No se promete.
- **Cuentas, perfiles o historial en la TV.** La TV es un reproductor tonto: no tiene sesión, no
  escribe historial y no conoce la biblioteca.
- **DRM y directos.** No hay DRM en el catálogo y el HLS es VOD; si aparece un directo, se abre otra
  tarea.

## Criterios de éxito

1. Sin `RONA_CAST=1`, la interfaz no muestra el mando, no se pide nada a `gstatic` y la CSP es
   idéntica a la de `d54cbed` (prueba estática).
2. Con `RONA_CAST=1` y LAN, `GET /api/cast/info` dice `available: true` y al menos una URL; en
   loopback o sin token dice `false` con el motivo.
3. Un Chromecast real reproduce un MP4 y un HLS servidos por el proxy; el informe de T379 dice si
   hizo falta CORS/CORP o HTTPS y con qué cabeceras.
4. La TV pide la URL **sin cookie**; al parar, la misma URL da 404/410 y el test lo mide con un
   receptor falso.
5. Los mandos del reproductor controlan la TV (play, pausa, buscar, volumen, velocidad, saltos); el
   video local queda pausado y se reanuda al desconectar.
6. Los subtítulos viajan como pistas VTT con URL absoluta y ticket propio; el receptor los pide sin
   cookie y el usuario puede cambiarlos.
7. El progreso llega al historial, el salto de intro y el siguiente episodio se disparan desde la
   posición de la TV, y recargar reconecta la sesión.
8. AirPlay reproduce HLS y MP4 en Safari, o se declara no medido por falta de hardware.
9. El PiP aparece una sola vez, en el marco, con el nombre y el estado correctos; sin soporte no
   aparece; la rama WebKit se mide con dobles y la real se declara si no hay hardware.
10. `typecheck`, `lint`, `bun test`, `bun run e2e` y `coverage:gate` en verde; `SECURITY.md` con las
    filas nuevas; ninguna afirmación sin medición.
