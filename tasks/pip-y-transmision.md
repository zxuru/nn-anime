# Plan de tareas: PiP y cast completo a la TV

> **Estado:** **abierto** — T375 abre el plan y las dos propuestas de contrato. La implementación
> (T376-T399) queda en *Pendiente* hasta que la decisión **D6** se apruebe y el spike **T379** se
> mida con hardware real. El PiP web ya existe; lo que falta es que se vea, que diga la verdad y que
> se pueda usar en los navegadores que lo tienen. El cast se planifica **completo**, no como un MVP.
>
> **Origen:** petición del dueño del producto, 2026-11-19: «quiero poder utilizar el sistema PiP»,
> «retransmitir a otros dispositivos tipo transmitir a otros dispositivos» y, al concretar el
> alcance, «quiero el cast completo en lo posible». La segunda parte se concreta como **cast a una
> TV** (Chromecast y AirPlay), no como watch party.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde en los
paquetes tocados, criterios marcados con la medición que los sostiene, sin `any` implícito ni
`@ts-ignore` ni `as` para silenciar, sin tests saltados, tope de cinco archivos de implementación por
task y commit atómico que cita el task.

Los ids **T376–T399 son propuestos**: se confirman al abrir cada task y no se reservan por
adelantado, como pide `tasks/roadmap.md`. Si otro trabajo toma uno, se renumera la tarjeta sin
renumerar las dependencias por nombre: la dependencia se lee por el asunto, no por el número.
**T388 ya está tomado** por la tarea de release (arm64 y `latest`), así que los tasks de subtítulos en
adelante usan **T394–T399**.

## Estado de la implementación (2026-11-19)

- **Hecho y medido:** T376 (PiP en el marco), T377 (WebKit), T378 (PiP de la app de escritorio en
  WebView2; macOS declarado no medido), T380 (`/api/cast/info`), T381 (tickets, sesión y guards),
  T382 (cargador y CSP), T383 (sesión de Cast), T384a/T384b (mandos y aviso), T385 (e2e con receptor
  falso), T386 (documentación y `SECURITY.md`), T394 (subtítulos), T395 (progreso, saltos y final),
  T395b (el siguiente episodio reutiliza la sesión) y T396 (reconexión).
- **Corrección medida después del cierre:** T401 (cambiar sub/dub con la TV puesta reutiliza la
  sesión, y `SESSION_ENDED` esconde el aviso y reanuda el vídeo local en la posición de la TV).
- **Hecho con dobles, sin hardware:** T387 (AirPlay; la puerta `remote`/WebKit, el `<video>` oculto,
  la URL absoluta, la pausa local y la revocación se miden en el e2e; un Apple TV real no).
- **Pendiente de hardware o de decisión:** T379 (spike con TV real), T397 (móvil con TLS) y T398 (el
  spike de DLNA; su propuesta ya está escrita). AirPlay con hardware y los subtítulos que Safari
  pinte en el receptor siguen dentro de T379/T387 y no se declaran medidos.
- **Propuesta cerrada:** T399 (emitir descargas locales) deja
  `docs/specs/proposals/SPEC-media-proxy.T399.md`; la implementación no se abre sin aprobación.
- Lo que no se ha medido con una TV real se dice en `docs/cast.md` y en `SECURITY.md`; la función
  no se anuncia como completa hasta T379.

## Lo que ya existe

- **PiP web.** `usePictureInPicture.ts` pregunta `document.pictureInPictureEnabled`, escucha
  `enterpictureinpicture`/`leavepictureinpicture` y alterna con `requestPictureInPicture`. El mando
  vive **sólo dentro del menú de ajustes** (`Player.tsx:390`) y no tiene atajo. El estado arranca en
  `false` aunque el video ya estuviera en la ventana flotante, y no hay rama WebKit (Safari/iOS) ni
  medida en la ventana de escritorio. La prueba actual (`Player.test.tsx:386`) comprueba cadenas del
  fuente, no el comportamiento.
- **Watch party.** Sincroniza el estado de reproducción, **no transporta el vídeo** y exige que cada
  participante tenga su propia fuente (`docs/watch-party.md`). No es lo que se pide aquí y no se
  toca.
- **Modo LAN.** El servidor puede escuchar en `0.0.0.0` con `RONA_TOKEN` y ya enumera sus IPv4 en
  `packages/server/src/party/lan.ts`. Es la base para que una TV alcance el proxy.
- **Tickets del proxy.** Son opacos, de 600 s, 500 entradas y no se pueden revocar
  (`packages/media-proxy/src/ticket-store.ts`). Sirven para una reproducción en el navegador, no para
  una TV que puede tardar en arrancar, rebuffering incluido, ni para cerrar la emisión a mano.
- **Subtítulos y descargas.** El proxy convierte SRT/ASS a VTT en `/api/subtitles/:ticket`; las
  descargas se sirven por id en `/api/downloads/:id/file`. Ninguna de las dos credenciales la puede
  presentar una TV.

## Qué significa «cast completo»

La meta no es «que salga la imagen», sino que la TV se comporte como una salida más del reproductor:

| Capacidad | Chromecast | AirPlay | Task |
|---|---|---|---|
| HLS del proxy | Sí | Sí (Safari reproduce HLS nativo) | T379, T387 |
| MP4 del proxy | Sí | Sí | T379, T387 |
| Play, pausa, buscar, volumen | Sí | Sí (medir volumen) | T383, T384a, T387 |
| Velocidad de reproducción | Medir en T379 | Medir en T387 | T384a |
| Subtítulos VTT | Sí, pistas del receptor | Sí si Safari los pinta | T394 |
| Progreso e historial | Sí, desde la posición de la TV | Sí | T395 |
| Saltar intro/ending | Sí | Sí | T395 |
| Siguiente episodio automático | Sí | Sí | T395 |
| Reconectar tras recargar | Sí, `getCurrentSession` | Sí, `remote` | T396 |
| Metadatos y póster | Sí | No (AirPlay no los muestra) | T383 |
| Emisor desde el móvil | Sólo con TLS de confianza | Safari iOS a medir | T397 |
| Descargas locales | Propuesta aparte | Propuesta aparte | T399 |

**Lo que no se puede prometer sin hardware:** si el Chromecast acepta el `http://192.168.x.x` sin
TLS, si exige CORS/CORP, si reproduce el HLS del proxy o si el códec del proveedor no está en la TV.
Eso es T379. Si el HLS no entra, el cast completo se reduce a lo que la TV acepte y se dice; no se
finge.

## Decisiones

- **D6 — transporte de la retransmisión.** Abierta hasta que T379 mida. La recomendación de T375 es
  **Google Cast SDK para Chromecast** (Chrome de escritorio, HLS y MP4) y **Remote Playback/AirPlay**
  para Safari; **DLNA fuera de la v1** y sólo como propuesta T398. Las opciones y sus costes están en
  `docs/specs/proposals/SPEC-web-ui.T375.md`; el contrato de tickets, subtítulos y CORS está en
  `docs/specs/proposals/SPEC-media-proxy.T375.md`.
- **`RONA_CAST=1` es un permiso explícito, como `RONA_PARTY=1`.** Sin esa variable no se anuncia la
  función, no se carga el guion de Google y la política de contenido no se relaja. Un despliegue que
  no la encienda no gana superficie.
- **La TV no lleva cookie.** La credencial de la emisión es un ticket de 192 bits, de vida larga y
  revocable, que sólo abre `/stream/*`; nunca `/api/*`. Los subtítulos de la TV usan el mismo tipo de
  ticket.
- **El emisor se abre en `http://127.0.0.1:PUERTO`.** Loopback es contexto seguro para el SDK; la TV
  recibe la dirección de la LAN. Si se abre la interfaz por la IP de la LAN, el SDK puede no estar
  disponible y la interfaz lo dice; no se finge que funciona.
- **El cast completo se corta en tareas medianas.** Subtítulos, mandos, progreso, reconexión y
  AirPlay son tareas propias, no un «ya que estamos» dentro de la sesión. Así cada una se mide y se
  puede dejar en rojo sin arrastrar a las demás.

## Tareas de PiP

### T376 — La ventana flotante, a la vista y con estado

**Descripción:** sacar el mando del menú de ajustes y ponerlo **dentro del marco**, junto a la
imagen, donde se busca; que el estado salga siempre del elemento y no de haber pulsado el botón; y
que funcione con teclado y en los anchos que ya se miden.

**Aceptación:**
- [ ] Con `document.pictureInPictureEnabled === false` no hay mando; con `true`, hay **un solo**
      control accesible, con el nombre «Ventana flotante».
- [ ] Al pulsarlo se llama a `requestPictureInPicture` sobre el `<video>`; con el video ya en la
      ventana flotante se llama a `document.exitPictureInPicture`.
- [ ] `enterpictureinpicture` deja `aria-pressed="true"` y el nombre «Salir de la ventana flotante»;
      `leavepictureinpicture` lo deshace. Si el navegador rechaza la petición, no se inventa el
      estado y no hay promesa sin manejar.
- [ ] Al montar, si el elemento ya es `document.pictureInPictureElement`, el mando nace encendido.
- [ ] El mando mide 44 × 44 px, tiene anillo de foco visible y no se solapa con el botón de saltar ni
      con la tarjeta del siguiente en 320, 768 y 1024 px.
- [ ] El mando **no** está duplicado en el menú de ajustes: dos controles con el mismo nombre
      accesible son un nombre ambiguo.

**Verificación:** `bun test packages/web/src/features/player` en verde · e2e nuevo con un doble de
la API (`addInitScript`) que comprueba el botón, el clic y los dos eventos · mutaciones: quitar la
guarda `pip.disponible` deja el mando sin soporte; no escuchar `enterpictureinpicture` deja
`aria-pressed` en `false`; no leer el estado inicial deja el caso «ya estaba dentro» en rojo.

**Depende de:** T375.

**Archivos:** `packages/web/src/features/player/usePictureInPicture.ts`, `Player.tsx`,
`packages/web/src/styles/obra.css`, `packages/web/src/i18n/es.ts` y sus tests.

**Tamaño:** M.

### T377 — La ventana flotante en Safari y en iOS

**Descripción:** donde no existe `document.pictureInPictureEnabled` pero sí la presentación WebKit
(`webkitSupportsPresentationMode('picture-in-picture')`), ofrecer el mismo mando y alternar con
`webkitSetPresentationMode`; escuchar `webkitpresentationmodechanged` para el estado. Si no existe
ninguna de las dos APIs, no hay mando.

**Aceptación:**
- [ ] La decisión «¿hay soporte y por qué vía?» vive en una función pura y se prueba con dobles:
      estándar, WebKit y ninguna.
- [ ] La rama WebKit llama a `webkitSetPresentationMode('picture-in-picture')` para entrar y a
      `'inline'` para salir; el estado se actualiza con `webkitpresentationmodechanged`.
- [ ] La rama estándar de T376 no cambia.
- [ ] La reproducción real en Safari/iOS **no se declara medida** si no hay un Mac o un iPhone en el
      cierre; se dice con esas palabras.

**Verificación:** `bun test packages/web/src/features/player` · mutaciones: preguntar sólo por la API
estándar deja el doble WebKit sin mando; no escuchar el evento deja el estado congelado.

**Depende de:** T376.

**Archivos:** `usePictureInPicture.ts` y su test.

**Tamaño:** S.

### T378 — La ventana flotante en la app de escritorio: medir WebView2

**Descripción:** la app de escritorio carga la interfaz en WebView2 (Windows) o WKWebView (macOS).
Antes de prometer PiP nativo, medir qué pasa en la ventana real: si `document.pictureInPictureEnabled`
es verdadero, si `requestPictureInPicture` abre una ventana que se queda encima y si el botón de T376
aparece. Si no funciona, proponer una ventana flotante propia de Tauri (siempre encima) o declarar
que el PiP es sólo del navegador, con el motivo.

**Aceptación:**
- [ ] Informe con sistema, versión de WebView2/WKWebView, resultado de las tres preguntas y captura.
- [ ] Si WebView2 lo soporta, no se toca código y se anota en `SPEC-desktop.md`.
- [ ] Si no lo soporta, la propuesta de `SPEC-desktop` (T378) decide entre ventana propia o declarar
      la limitación; no se abre una implementación a ciegas.

**Verificación:** medición manual en Windows; en macOS se declara no medida si no hay máquina. No hay
test que sustituya a la ventana real.

**Depende de:** T376.

**Archivos:** `docs/desktop-pip.md` (informe) y, si toca, la propuesta de `SPEC-desktop`.

**Tamaño:** S.

## Tareas de cast

### T379 — Spike de cast completo con hardware

**Descripción:** medir lo que la propuesta no puede afirmar sin hardware, y medirlo **todo** lo que
la fase va a usar: MP4 y HLS, CORS y CORP, subtítulos VTT, control remoto, metadatos, reconexión,
AirPlay y el emisor móvil por HTTP. El resultado decide D6 y ajusta las tareas antes de escribir
código de producción.

**Aceptación:**
- [ ] Página de prueba mínima, fuera del árbol de producción, que carga el SDK, enumera dispositivos
      y manda a la TV un MP4 y un HLS servidos por un `Bun.serve` local con ticket.
- [ ] Informe con: modelo de Chromecast y de Apple TV (si hay), versión, red, resultado de MP4 y HLS,
      cabeceras que pidió el receptor (incluidos `Origin` y `Range`), CORS, CORP, mixed content,
      latencia de arranque, subtítulos VTT, play/pausa/buscar/volumen/velocidad, metadatos y qué
      pasa al revocar el ticket a mitad.
- [ ] AirPlay desde Safari (macOS/iOS si hay): HLS nativo, `video.remote`, `x-webkit-airplay`,
      `webkitShowPlaybackTargetPicker` y subtítulos.
- [ ] Chrome de Android por `http://192.168...`: ¿existe `chrome.cast`? Si no, se documenta la vía
      TLS y se declara.
- [ ] La CSP propuesta se corrige con los hosts **medidos**, no con los que diga un blog.
- [ ] Si el HLS no se puede emitir con la arquitectura actual, D6 se rechaza o se reduce a MP4, y se
      dice antes de T380. Si un códec del proveedor no lo decodifica la TV, se declara como límite
      del medio, no como fallo del cast.

**Verificación:** el informe y el vídeo de la TV; sin dispositivo, el task **no se cierra** y las
tareas de implementación no empiezan. La página de prueba se guarda en `scripts/spike-cast/` y no
entra en el bundle.

**Depende de:** T375.

**Archivos:** `docs/spike-cast.md` y `scripts/spike-cast/`.

**Tamaño:** M.

### T380 — El servidor dice si puede transmitir y con qué direcciones

**Descripción:** una lectura para que la interfaz no ofrezca un botón que no puede funcionar:
`GET /api/cast/info` devuelve si `RONA_CAST=1` está encendido, si el servidor escucha en una
dirección alcanzable por la TV y las IPv4 con las que se puede probar.

**Aceptación:**
- [ ] `{ available, urls, reason? }` es un objeto estricto en `core/api.ts`; `reason` sólo aparece
      cuando `available` es `false` (`disabled`, `loopback`, `no-token`).
- [ ] `available` es `true` sólo con `RONA_CAST=1`, host no loopback y `RONA_TOKEN`; en loopback o sin
      token es `false` y **no** se enumeran direcciones.
- [ ] `urls` sale de las IPv4 no internas, sin `0.0.0.0`, con el puerto real; sin interfaces útiles
      no se inventa loopback para una TV.
- [ ] La ruta exige la sesión normal: un ticket de emisión no la abre.
- [ ] `RONA_CAST=1` sin `RONA_TOKEN` no arranca o se niega con el mismo aviso que el modo servidor;
      nunca queda un puerto LAN sin credencial.

**Verificación:** `bun test packages/server` y `bun test packages/core` · casos loopback, LAN con
token, LAN sin token, apagado · mutación: devolver `available: true` en loopback deja el caso en rojo.

**Depende de:** T379.

**Archivos:** `packages/core/src/api.ts`, `packages/server/src/routes/cast.ts`,
`packages/server/src/app.ts`, `packages/server/src/party/lan.ts` (o su extracción a `lan.ts`),
`packages/cli/src/server-env.ts` y tests.

**Tamaño:** M.

### T381 — Tickets de emisión, sesión y guards

**Descripción:** una emisión dura un episodio y a veces más; el ticket de 600 s y 500 entradas del
proxy no sirve. Un almacén aparte, pequeño y revocable, emite la URL que se le manda a la TV; al
parar, se revoca. La sesión incluye los subtítulos disponibles, aunque el ticket de cada subtítulo se
complete en T394.

**Aceptación:**
- [ ] `POST /api/cast/session` resuelve el stream **en el servidor** —nunca acepta una URL del
      cliente— y devuelve `{ id, kind, urls, expiresAt, title, poster?, subtitles: [] }`; `urls` son
      absolutas, `http://<ipv4>:<puerto>/stream/<ticket>`.
- [ ] `DELETE /api/cast/session/:id` revoca el ticket; después, `/stream/<ticket>` responde 404/410 y
      ningún segmento nuevo se sirve.
- [ ] El ticket de emisión vive 4 h, hay como mucho 16 por instancia y no comparte el LRU de 500 con
      los tickets del navegador; los tickets hijos de una playlist siguen a 600 s.
- [ ] La URL de la emisión no lleva cookie, no abre `/api/*`, no se registra en ningún log y no
      contiene la URL del upstream.
- [ ] Los guards de sesión y de token reconocen el ticket de emisión (los dos almacenes); sin eso la
      TV recibe 401 antes de llegar al proxy, y el test lo mide sin cookie.
- [ ] Sin `RONA_CAST=1` o sin LAN, `POST` responde 409 con el motivo y no emite nada.
- [ ] La respuesta no incluye cabeceras del upstream ni la dirección del proveedor.

**Verificación:** `bun test packages/media-proxy` y `packages/server` · emisión con `Range`, sin
cookie; revocación a mitad; TTL con reloj falso; capacidad · mutación: resolver contra el almacén de
600 s deja el episodio sin segmentos a los diez minutos; no revocar deja el segundo `GET` en 200.

**Depende de:** T380.

**Archivos:** `packages/media-proxy/src/ticket-store.ts`, `packages/server/src/container.ts`,
`packages/server/src/routes/cast.ts`, `packages/server/src/routes/stream.ts`,
`packages/core/src/api.ts` y tests.

**Tamaño:** L. Si no cabe en cinco archivos, se corta en T381a (almacén, guards y revocación) y
T381b (rutas y contrato).

### T382 — Cargar el SDK de Cast sólo con permiso

**Descripción:** el único guion de terceros de la aplicación. Se carga **a petición**, sólo si
`RONA_CAST=1` y la persona abre el mando de transmitir; para reconectar una sesión anterior se carga
al abrir la pantalla sólo si quedó una emisión recordada. La CSP se relaja exactamente con los hosts
medidos en T379. Sin permiso no hay petición a `gstatic` ni cambio de política.

**Aceptación:**
- [ ] `cargarCastSdk()` es idempotente, resuelve cuando `cast.framework` está listo, rechaza con un
      error claro si el guion falla o tarda más de 10 s, y no se llama al cargar la página salvo que
      haya una emisión recordada.
- [ ] Con `available: false` no se crea ningún `<script>` ni se pide nada a `gstatic`.
- [ ] La CSP por defecto no cambia; con `RONA_CAST=1` añade sólo `script-src`, `connect-src` y, si
      T379 lo exige, `frame-src`, con los hosts medidos. No aparecen `unsafe-inline` ni `unsafe-eval`.
- [ ] Un fallo del guion (bloqueador, sin red) deja un aviso y no rompe el reproductor.
- [ ] `bun run lint` no encuentra la cadena `gstatic` fuera del cargador y de su test.

**Verificación:** `bun test packages/web` y `packages/server` · prueba estática de la CSP · mutación:
cargar el guion en el arranque deja la prueba de «no se pide nada» en rojo; añadir `unsafe-inline` a
la política la deja en rojo.

**Depende de:** T379, T380.

**Archivos:** `packages/web/src/features/player/cast/cast-sdk.ts`,
`packages/web/src/api/cast.ts`, `packages/server/src/middleware/security-headers.ts`,
`packages/server/src/app.ts`, `packages/server/src/routes/cast.ts` y tests.

**Tamaño:** M.

### T383 — La sesión de Cast: cargar, mandar y estado

**Descripción:** la conversación con el SDK, sin dibujo: pedir sesión, mandar el medio con su tipo y
sus metadatos, escuchar el estado del receptor y exponer los mandos que la interfaz usará. Es la
mitad «modelo» del cast; T384a es la mitad «reproductor».

**Aceptación:**
- [ ] `iniciar(url, kind, meta, positionS)` manda `contentType`
      `application/vnd.apple.mpegurl` para `hls` y `video/mp4` para `file`, `currentTime`,
      `autoplay: true`, título, episodio y póster; la URL es la de la sesión, no una ruta relativa.
- [ ] El estado del receptor se traduce a `conectado`, `dispositivo`, `cargando`, `playing`,
      `positionS`, `durationS`, `volume`, `muted`, `rate`, `subtitles`, `activeSubtitle`, `error` y
      `desconectado`; un error no deja la interfaz en «conectado».
- [ ] Expone `play`, `pause`, `toggle`, `seekTo`, `setVolume`, `setMuted`, `setRate`,
      `selectSubtitle` y `detener`; `detener` cierra la sesión y al desmontar se cierra.
- [ ] Los tipos del SDK se declaran a mano con las propiedades que se usan; no entra `any` ni se
      instala `@types` nuevo.
- [ ] La velocidad y el volumen se prueban contra el doble del SDK; si el SDK no los soporta, el
      gancho lo dice con un estado y no finge.

**Verificación:** `bun test packages/web/src/features/player/cast` · mutación: mandar
`application/x-mpegURL` para `file` deja el caso en rojo; no traducir `playerState` deja el estado en
`cargando` para siempre.

**Depende de:** T381, T382.

**Archivos:** `cast-types.ts`, `cast-session.ts`, `useCastSession.ts` y tests.

**Tamaño:** L. Si no cabe, se corta en T383a (carga y estado) y T383b (mandos y subtítulos).

### T384a — Los mandos del reproductor hablan con la TV

**Descripción:** cuando hay una emisión conectada, el reproductor deja de mandar en el `<video>` local
y manda en la TV. Los mismos botones, la misma barra, las mismas teclas y el mismo reloj, pero el
estado viene del receptor y las acciones van al receptor. El video local se pausa y no se descarga
dos veces.

**Aceptación:**
- [ ] `Player` elige un solo conductor: local o cast. Con cast conectado, `play/pausa`, `±10 s`,
      buscar en la barra, silencio, volumen, velocidad y las teclas `Espacio`, `K`, flechas, `M`,
      `S` y `T` llaman al receptor y el reloj pinta la posición de la TV.
- [ ] La barra refleja `currentTime` y `duration` del receptor; un `seek` local no mueve el `<video>`
      escondido, mueve la TV.
- [ ] El video local queda pausado y oculto tras una capa «Se está viendo en {dispositivo}»; no hay
      dos reproducciones ni dos descargas.
- [ ] Si el SDK no soporta velocidad o volumen, el mando correspondiente se oculta o se explica; no
      se pulsa en el vacío.
- [ ] Cambiar de audio (sub/dub) mientras se emite pide otra sesión con el modo nuevo, conserva la
      posición y recarga el receptor; no se queda con el audio viejo.
- [ ] Al desconectar, el reproductor local se reanuda en la posición de la TV y el foco vuelve al
      mando de play.
- [ ] `onPlay`, `onPause`, `onProgress`, `onDuration` y `onEnded` salen del estado del cast, para que
      el historial y la presencia sigan funcionando.

**Verificación:** `bun test packages/web/src/features/player` con un conductor falso · mutaciones:
mover el `<video>` local en vez del receptor deja la posición en rojo; no reanudar al desconectar
deja el video en pausa.

**Depende de:** T383.

**Archivos:** `Player.tsx`, `usePlayer.ts` (o el adaptador), `PlayerButtons.tsx`,
`player-props.ts`, `PlayerFrame.tsx` y tests.

**Tamaño:** L. Si no cabe, se corta en T384a-1 (estado y reloj) y T384a-2 (acciones y teclas).

### T384b — El mando de transmitir y su aviso

**Descripción:** un solo mando en el marco, junto al PiP, que abre el selector de dispositivos y
dice a quién se está emitiendo. Sin dispositivos o sin permiso no aparece; si el usuario cancela, no
pasa nada. El aviso permite parar y volver a la reproducción local.

**Aceptación:**
- [ ] Con `available: false` no hay mando; con `true`, un solo control accesible «Transmitir a un
      dispositivo».
- [ ] Al pulsar se pide `POST /api/cast/session`, se llama a `iniciar` con la URL y el tipo y se
      anuncia «Se está viendo en {dispositivo}» con `aria-live="polite"`.
- [ ] «Dejar de transmitir» llama a `DELETE` y a `detener()`, reanuda el video local en la posición
      del receptor y devuelve el foco al mando.
- [ ] Si el receptor se desconecta solo, el aviso lo dice y se reanuda local; si `POST` falla, no se
      llama al SDK y se enseña el motivo.
- [ ] Si el SDK dice `NO_DEVICES_AVAILABLE`, el mando lo dice en Ajustes y no abre un selector vacío.
- [ ] El mando mide 44 × 44 px, no tapa el botón de saltar y la fila de mandos no desborda en 320,
      768 y 1024.
- [ ] Los textos nuevos están en `i18n/es.ts`; no hay cadenas sueltas.

**Verificación:** `bun test packages/web` · e2e de T385 · mutaciones: llamar al SDK antes del `POST`
deja la prueba del orden en rojo; no hacer `DELETE` al parar deja el ticket vivo y T385 lo mide.

**Depende de:** T383.

**Archivos:** `CastControl.tsx`, `Player.tsx`, `PlayerFrame.tsx`, `styles/obra.css`,
`i18n/es.ts` y tests.

**Tamaño:** M.

### T385 — El cast completo de punta a punta con un receptor falso

**Descripción:** la TV no entra en CI. Un SDK falso en Playwright y un receptor falso en el proceso
de prueba miden lo que importa: que la URL que se manda es la de la LAN, que la TV la puede pedir
**sin cookie**, que el tipo es el correcto, que los mandos viajan, que los subtítulos se piden y que
al parar la URL deja de servir.

**Aceptación:**
- [ ] E2E con servidor en `RONA_HOST=0.0.0.0`, `RONA_TOKEN` y `RONA_CAST=1`; la pestaña se abre en
      `127.0.0.1`.
- [ ] El SDK falso registra `loadMedia`; el test comprueba `contentId` absoluto, `contentType` de HLS
      y de MP4, `currentTime`, `autoplay`, metadatos y pistas de subtítulos.
- [ ] El receptor falso pide `contentId` sin cookie y con `Range: bytes=0-1023`: 206/200 y bytes; al
      parar, la misma petición da 404/410.
- [ ] Los mandos del reproductor llaman al receptor: play, pausa, buscar, volumen, velocidad y
      subtítulos; el reloj y la barra siguen al receptor.
- [ ] El progreso llega al historial; el salto de intro y el siguiente episodio se disparan desde la
      posición de la TV.
- [ ] Al recargar, la sesión se reconecta y el aviso sigue; al cerrar la sesión, se limpia.
- [ ] El video local queda pausado mientras se emite y vuelve a reproducir al parar.
- [ ] `GET /api/cast/info` en la pestaña dice `available: true` y al menos una URL.
- [ ] Mutaciones: usar una ruta relativa, no revocar, no pausar el video local o no mandar los
      subtítulos ponen el caso en rojo.

**Verificación:** `bun run e2e` con los casos nuevos; sin dispositivo real, T379 sigue siendo la
medida física.

**Depende de:** T384a, T384b, T394, T395, T396.

**Archivos:** `packages/web/e2e/cast.e2e.ts`, `packages/web/e2e/cast-fake.ts`,
`scripts/e2e-server.ts`, el fixture si hace falta, y `playwright.config.ts` sólo si el caso necesita
otro servidor.

**Tamaño:** L. Si no cabe, se corta en T385a (medio y controles) y T385b (subtítulos, progreso,
saltos y reconexión).

### T386 — Documentar el cast completo y su riesgo

**Descripción:** lo que hay que saber para usarlo y lo que hay que saber para no confiar de más:
arranque en LAN, permiso `RONA_CAST`, qué TV funciona, qué no (subtítulos si el receptor no los
pinta, AirPlay sin hardware, móvil sin TLS, DLNA fuera, descargas fuera) y las filas nuevas de
`SECURITY.md`.

**Aceptación:**
- [ ] `README.md` tiene la sección «Transmitir a la TV» con el comando exacto
      (`RONA_HOST=0.0.0.0 RONA_TOKEN=… RONA_CAST=1 bun run start`), la advertencia de LAN de confianza
      y los enlaces a `docs/cast.md` y `docs/spike-cast.md`.
- [ ] La guía de `docs/cast.md` tiene la matriz de capacidades de este plan, con lo medido y lo no
      medido.
- [ ] `SECURITY.md` declara: ticket de emisión y de subtítulo (192 bits, 4 h, 16, revocables, sólo
      `/stream`), guion de Google cargado sólo con permiso, CSP exacta, CORS/CORP acotados si T379 lo
      exige, y el límite de la LAN.
- [ ] `docs/specs/SPEC-web-ui.md` y `docs/specs/SPEC-media-proxy.md` se actualizan **sólo** después de
      que sus dueños integren las propuestas; si no, la documentación dice «propuesta».
- [ ] `bun test packages/web/src/docs.test.ts` pasa y los comandos citados existen en
      `package.json`.
- [ ] Lo no medido se dice: AirPlay sin hardware, PiP de escritorio si T378 no lo midió, DLNA fuera,
      descargas fuera y móvil sin TLS.

**Verificación:** `bun test packages/web/src/docs.test.ts` · `bun run lint` · revisión de que cada
comando del README existe.

**Depende de:** T385.

**Archivos:** `README.md`, `docs/cast.md`, `SECURITY.md`, `docs/specs/SPEC-web-ui.md`,
`docs/specs/SPEC-media-proxy.md`.

**Tamaño:** M.

### T387 — AirPlay completo: HLS, MP4 y control

**Descripción:** Safari y algunos navegadores ofrecen `video.remote`; Safari reproduce HLS nativo.
Para no tocar el `<video>` principal, la emisión usa un `<video>` oculto con la URL absoluta de la
sesión y la interfaz se conecta a ese elemento. Si `remote` no existe, se prueba
`webkitShowPlaybackTargetPicker` y los eventos `webkitcurrentplaybacktargetiswireless`.

**Aceptación:**
- [ ] `useRemotePlayback` detecta `HTMLMediaElement.prototype.remote` y, si no,
      `webkitShowPlaybackTargetPicker`; sin ninguna de las dos, no hay mando de AirPlay.
- [ ] Usa la URL absoluta de la sesión de T381 y funciona con HLS y con `file`; la CSP `media-src`
      permite la LAN **sólo** con `RONA_CAST=1` y no abre `connect-src`.
- [ ] El video oculto se pausa/reanuda y la posición se refleja en el reproductor; al conectar, el
      video local se pausa; al desconectar, se reanuda en la posición remota.
- [ ] Los subtítulos se ofrecen con URLs absolutas de T394 si Safari los pinta; si no, se ocultan y
      se dice.
- [ ] Sin Apple TV o AirPlay 2 no se declara medido; se mide con un doble de `remote`.
- [ ] Mutación: usar la ruta relativa deja al receptor sin alcance; no detectar `remote` deja el
      mando visible donde no existe.

**Verificación:** pruebas con un doble de `remote` y de `webkitShowPlaybackTargetPicker`; la medida
real queda condicionada a hardware.

**Depende de:** T379, T381, T383, T394.

**Archivos:** `useRemotePlayback.ts`, `Player.tsx`, `cast-types.ts`,
`packages/server/src/middleware/security-headers.ts` y tests.

**Tamaño:** L.

### T394 — Subtítulos en la TV

**Descripción:** los subtítulos del proveedor son texto y la TV puede pintarlos si se los damos como
VTT con una URL que pueda pedir sin cookie. Un ticket de subtítulo por pista, la misma conversión que
ya hace `/api/subtitles/:ticket` y las pistas en `MediaInfo.tracks` con `activeTrackIds`.

**Aceptación:**
- [ ] La sesión de T381 devuelve `subtitles: [{ id, url, lang, label }]` con URLs absolutas de LAN;
      cada URL es un ticket de emisión de subtítulo, revocable con la sesión.
- [ ] `GET /stream/:ticket/sub/:index` sirve el VTT con `content-type: text/vtt`, sin cookie y con
      los headers del proveedor; el guard de sesión lo reconoce.
- [ ] El `loadMedia` lleva `tracks` (`SUBTITLES`, `text/vtt`, idioma, nombre) y `activeTrackIds` con
      la pista elegida; el usuario puede cambiarla desde el reproductor.
- [ ] La pista por defecto es la misma que el reproductor local; sin pistas, no se manda ninguna.
- [ ] CORS/CORP para el subtítulo se mide en T379 y se aplica acotado al ticket de emisión, como el
      video.
- [ ] Un subtítulo que el receptor no pinta se declara y se oculta el selector de la TV con un aviso.

**Verificación:** `bun test packages/server` y `packages/web` · receptor falso que pide el VTT sin
cookie y comprueba los bytes y el `content-type` · mutación: usar la ruta con cookie deja al receptor
en 401; no revocar el subtítulo deja el VTT vivo después de parar.

**Depende de:** T381, T383.

**Archivos:** `packages/server/src/routes/cast.ts`, `packages/server/src/routes/subtitles.ts`,
`packages/server/src/container.ts`, `packages/core/src/api.ts`, `packages/web/src/.../cast-session.ts`
y tests.

**Tamaño:** L.

### T395 — Progreso, saltos y siguiente episodio en la TV

**Descripción:** la TV no avisa al servidor de lo que ve; lo tiene que hacer el emisor. La posición
del receptor alimenta el historial, el salto de intro/ending y el siguiente episodio, con las mismas
reglas que la reproducción local.

**Aceptación:**
- [ ] La posición del cast se reporta al historial cada 15 s y al pausar, buscar y parar; «continuar
      viendo» queda en el mismo segundo que la TV.
- [ ] El salto automático de intro/ending se dispara desde la posición del cast, una sola vez por
      intervalo y episodio, con el mismo margen que la reproducción local.
- [ ] El botón de saltar y la tecla `S` mandan el salto al receptor, no al `<video>` local.
- [ ] Al terminar, si la reproducción automática está encendida, se emite el siguiente episodio; si
      no, se muestra la tarjeta del siguiente sin cortar la sesión.
- [ ] La presencia de Discord sigue el estado del cast (play, pausa, posición) por los mismos
      callbacks; no se queda «en pausa» mientras la TV reproduce.
- [ ] Un fallo al reportar el progreso no corta la emisión ni vacía el historial.

**Verificación:** `bun test packages/web` y `packages/server` · doble del SDK con reloj falso ·
mutaciones: reportar sólo al parar deja el historial sin posición; no marcar el intervalo saltado
repite el salto; no usar el estado del cast deja Discord en pausa.

**Depende de:** T383, T384a.

**Archivos:** `Player.tsx`, `WatchPage.tsx`, `useCastSession.ts`, `useWatchEvents.ts`,
`player-props.ts` y tests.

**Tamaño:** L.

### T396 — Reconexión y recuperación de la emisión

**Descripción:** recargar la pestaña, perder la red o volver al día siguiente no debe dejar una TV
reproduciendo sin control ni un reproductor local que no sabe dónde estaba. Al abrir, si había una
emisión, se adopta la sesión; si ya no está, se limpia y se reanuda local.

**Aceptación:**
- [ ] Al iniciar una emisión se guarda una marca local; al abrir `/watch` con esa marca y
      `RONA_CAST=1`, se carga el SDK y se adopta la sesión con `getCurrentSession`; sin marca no se
      carga el guion.
- [ ] Si la sesión sigue viva, el aviso y los mandos se reconstruyen con el estado del receptor y no
      se pide un ticket nuevo.
- [ ] Si la sesión terminó, la marca se borra, el video local vuelve a su posición y se dice.
- [ ] `SESSION_RESUMED`, `SESSION_ENDED` y los errores de red se traducen a estados; un fallo de red
      no deja el aviso en «conectado» para siempre.
- [ ] Al parar o al cerrar la pestaña, la marca se limpia y la sesión se cierra si se puede.

**Verificación:** e2e de recarga con el SDK falso: la sesión se adopta y no se duplica el `POST` ·
mutación: no guardar la marca deja la recarga sin reconexión; no limpiar la marca deja el aviso
fantasma.

**Depende de:** T383, T384b.

**Archivos:** `cast-session.ts`, `useCastSession.ts`, `Player.tsx`, `cast-sdk.ts` y tests.

**Tamaño:** M.

## Tareas opcionales, después de T386

### T397 — Cast desde el móvil con TLS

**Descripción:** Chrome de Android exige contexto seguro para `chrome.cast`; `http://192.168...` no
lo es. Medir si el SDK aparece igualmente; si no, documentar la vía de un proxy TLS con certificado
de confianza (Caddy, `RONA_PUBLIC_ORIGIN`) y comprobar que el servidor sigue funcionando detrás de
él. Si el Chromecast no confía en el certificado, se declara y no se promete.

**Aceptación:**
- [ ] Medición en un Android real: `chrome.cast` en HTTP y en HTTPS con certificado de confianza.
- [ ] Si funciona, guía de despliegue con el proxy y el origen público; el servidor ya soporta
      `RONA_PUBLIC_ORIGIN` y la cookie `Secure`.
- [ ] Si no, se declara «el emisor es el escritorio» y se dice por qué.
- [ ] Sin hardware Android, el task no se cierra.

**Depende de:** T386.

**Archivos:** `docs/cast-movil.md` y, si hace falta, una prueba de `RONA_PUBLIC_ORIGIN`.

**Tamaño:** S/M.

### T398 — DLNA: propuesta y spike, no implementación

**Descripción:** para televisiones sin Cast ni AirPlay, DLNA sería la única vía. Es otra pila: SSDP
para descubrir, SOAP/AVTransport para mandar y, en muchos casos, sólo MP4 (sin HLS). Antes de abrir
una implementación, una propuesta con el coste y un spike con una TV real.

**Aceptación:**
- [ ] Propuesta con descubrimiento, control, códecs, límites y modelo de amenaza.
- [ ] Spike con una TV DLNA real que mida si reproduce el MP4 del proxy y si acepta el ticket.
- [ ] Si no hay TV DLNA, no se abre la implementación.

**Depende de:** T386.

**Archivos:** `docs/specs/proposals/SPEC-dlna` (sin `.md` hasta que exista) y `scripts/spike-dlna/`.

**Tamaño:** S (propuesta).

### T399 — Emitir descargas locales

**Descripción:** un episodio descargado no debería necesitar el proveedor para verse en la TV. Hoy
`/api/downloads/:id/file` exige cookie y el proxy no acepta loopback; haría falta un ticket de
emisión para un archivo local y una ruta que lo sirva sin pasar por la lista blanca de destinos.

**Aceptación:**
- [ ] Propuesta de contrato para un ticket de archivo local, con `Range`, revocación y sin cookie.
- [ ] Si se implementa, el MP4 descargado se emite igual que el del proveedor; el HLS descargado se
      sirve desde la playlist local.
- [ ] La TV no puede pedir `/api/*`; el ticket sólo abre la ruta de archivo de la emisión.

**Depende de:** T381, T386.

**Archivos:** `docs/specs/proposals/SPEC-media-proxy` (propuesta) y, si se aprueba, las rutas.

**Tamaño:** S (propuesta).

### T401 — El cast cambia de audio y se recupera de la desconexión

**Descripción:** dos cosas que el cast promete y hoy no hace. Cambiar sub/dub con la TV conectada
resuelve un stream nuevo en el reproductor, pero la sesión de Cast sigue con el `contentId` viejo: la
TV no se entera. Y si el receptor cierra la sesión solo —la TV se apaga, el usuario cambia de
destino, se cae la red—, el aviso y los mandos se quedan en «conectado» para siempre. Las dos se
resuelven en la misma conversación con el receptor: reutilizar la sesión que ya está abierta y
escuchar su estado.

**Aceptación:**
- [ ] Cambiar sub/dub con la TV conectada pide un ticket nuevo al servidor y manda el medio con
      `loadMedia` por la **sesión de Cast ya abierta**, conservando la posición del receptor; no se
      vuelve a `requestSession` y la marca de reconexión apunta al ticket nuevo.
- [ ] Si el receptor termina la sesión (`SESSION_ENDED`), el aviso desaparece, la marca se borra, el
      estado deja de estar «conectado» y el vídeo local se reanuda en la última posición de la TV.
- [ ] Si la petición del cambio de audio falla, la emisión anterior sigue sonando y se dice el
      motivo; el ticket nuevo no queda vivo.
- [ ] `detener` y `cerrar` dejan de escuchar el contexto; una sesión terminada no llama a
      `endSession` dos veces.
- [ ] Mutación: no escuchar `SESSION_ENDED` deja el aviso fantasma; no reutilizar la sesión deja dos
      `requestSession`; no conservar la posición deja la reanudación en cero.

**Verificación:** `bun test packages/web/src/features/player/cast` · e2e de `cast.e2e.ts` con el SDK
falso: cambiar a «Doblado» produce un segundo `loadMedia` y un solo `requestSession`; emitir
`SESSION_ENDED` esconde el aviso y el vídeo local vuelve a reproducir en la posición de la TV.

**Depende de:** T383, T384a, T384b, T395b.

**Archivos:** `cast-types.ts`, `cast-adapter.ts`, `cast-session.ts`, `useCastControl.ts`,
`Player.tsx` y sus tests.

**Tamaño:** M.

### T402 — El cast dice por qué no puede y no deja mandos muertos

**Descripción:** cuando el SDK no encuentra dispositivos, `requestSession` rechaza con
`NO_DEVICES_AVAILABLE` y hoy la interfaz enseña el texto crudo del SDK —o `[object Object]`—; cuando
hay emisión, los cinco botones de velocidad quedan deshabilitados sin decir por qué. Las dos cosas
son la misma: un mando que no puede y no lo explica.

**Aceptación:**
- [ ] Un rechazo con `NO_DEVICES_AVAILABLE` (en `code`, `description` o `message`) se traduce a un
      texto en español; no se enseña el texto crudo ni `[object Object]`.
- [ ] El motivo se ve en el aviso del reproductor y en el menú de ajustes, que es donde vive el
      mando; no se abre un selector vacío por nuestra parte.
- [ ] Con emisión conectada, el bloque de velocidad explica por qué no se cambia en vez de mostrar
      cinco botones deshabilitados.
- [ ] Los demás errores conservan su mensaje y las claves nuevas viven en `i18n/es.ts`.
- [ ] Mutación: quitar el traductor deja el texto crudo en rojo; volver a la lista deshabilitada deja
      en rojo la nota de velocidad.

**Verificación:** `bun test packages/web/src/features/player/cast` · e2e de `cast.e2e.ts` con un SDK
falso que rechaza `NO_DEVICES_AVAILABLE` y con una emisión conectada que abre Ajustes.

**Depende de:** T384b.

**Archivos:** `cast-session.ts`, `useCastControl.ts`, `Player.tsx`, `i18n/es.ts`, `cast.e2e.ts` y
tests.

**Tamaño:** S.

## Orden, dependencias y cortes

```
T375 ─┬─ T376 ── T377
      ├─ T378
      └─ T379 ── T380 ─┬─ T381 ── T383 ─┬─ T384a ─┐
                       └─ T382 ─────────┘         ├─ T385 ── T386
                              T394 ───────────────┤
                              T395 ───────────────┤
                              T396 ───────────────┘
      T387 ── depende de T379, T381, T383 y T394
      T397 / T398 / T399 ── después de T386
```

1. **T376 y T377** no dependen de la TV y se pueden cerrar en paralelo con T379. Son la respuesta
   barata a «quiero usar el PiP».
2. **T379** es la puerta: sin una TV real, la propuesta no se aprueba y T380 no empieza. Si el HLS no
   se puede emitir, D6 se reduce a MP4 y T383/T385 se ajustan antes de escribir la interfaz.
3. **T380 y T381** van en serie: la URL no se emite hasta saber que hay una dirección alcanzable y
   una credencial que la TV pueda presentar.
4. **T382** puede ir en paralelo con T380/T381; el cargador y la CSP no necesitan la sesión.
5. **T383** es el modelo del cast; **T384a** lo enchufa al reproductor y **T384b** lo enchufa a la
   pantalla. Si el tope de cinco archivos aprieta, cada uno se corta por dentro.
6. **T394, T395 y T396** son la diferencia entre «sale la imagen» y «cast completo». Van después de
   T383/T384a y antes de T385, que es la medida integral.
7. **T387** (AirPlay) comparte el modelo de T383 y los subtítulos de T394; si no hay hardware Apple,
   se mide con dobles y se declara.
8. **T397, T398 y T399** no bloquean la fase. Sin hardware o sin aprobación, se cierran como
   propuesta o se declaran.

## Lo que no se hace en esta fase

- **DLNA implementado.** Sólo propuesta y spike (T398); la pila SSDP/SOAP no entra sin su propia
  decisión.
- **Watch party como transporte.** Ya existe y sincroniza estado; no manda el vídeo. No se reescribe
  para esto.
- **Chromecast de la app de escritorio.** WebView2 no trae el ecosistema de Cast del navegador; si
  T378 no lo mide, se dice y se ofrece abrir en el navegador.
- **Emisor móvil sin TLS.** El móvil por `http://192.168...` no es contexto seguro; T397 mide y
  documenta la vía TLS, pero no se promete.
- **Descargas en la TV.** T399 es una propuesta; la v1 emite lo que resuelve el proveedor.
- **DRM y lives.** No hay DRM en el catálogo y el HLS es VOD; si aparece un directo, se abre otra
  tarea.

## Criterio de cierre de la fase

- El PiP se ofrece donde el navegador lo tiene, se ve, se anuncia y no miente; la ventana de
  escritorio está medida y lo que no se pueda medir está declarado.
- D6 aprobada con el informe de T379; el cast funciona con un Chromecast real para MP4 y HLS, o D6
  se reduce con el motivo medido.
- La TV recibe una URL de LAN con ticket, sin cookie, revocable; al parar deja de servir.
- Los mandos del reproductor controlan la TV; los subtítulos, el progreso, los saltos y el siguiente
  episodio funcionan desde la TV; recargar reconecta.
- AirPlay funciona en Safari con HLS y MP4, o se declara no medido por falta de hardware.
- Sin `RONA_CAST=1` no hay guion de terceros, ni CSP relajada, ni anuncio en la interfaz.
- `typecheck`, `lint`, `bun test`, `bun run e2e` y `coverage:gate` en verde; `SECURITY.md` con las
  filas nuevas; ninguna afirmación sin su medición.
