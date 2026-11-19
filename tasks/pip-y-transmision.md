# Plan de tareas: PiP y retransmisión a la TV

> **Estado:** **abierto** — T375 abre el plan y las dos propuestas de contrato. La implementación
> (T376–T387) queda en *Pendiente* hasta que la decisión **D6** se apruebe y el spike **T379** se
> mida con un Chromecast real. El PiP web ya existe; lo que falta es que se vea, que diga la verdad y
> que se pueda usar en los navegadores que lo tienen.
>
> **Origen:** petición del dueño del producto, 2026-11-19: «quiero poder utilizar el sistema PiP» y
> «retransmitir a otros dispositivos tipo transmitir a otros dispositivos». La segunda parte se
> concreta como **cast a una TV** (Chromecast/AirPlay), no como watch party.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde en los
paquetes tocados, criterios marcados con la medición que los sostiene, sin `any` implícito ni
`@ts-ignore` ni `as` para silenciar, sin tests saltados, tope de cinco archivos de implementación por
task y commit atómico que cita el task.

Los ids **T376–T387 son propuestos**: se confirman al abrir cada task y no se reservan por
adelantado, como pide `tasks/roadmap.md`. Si otro trabajo toma uno, se renumera la tarjeta sin
renumerar las dependencias por nombre: la dependencia se lee por el asunto, no por el número.

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

## Decisiones

- **D6 — transporte de la retransmisión.** Abierta hasta que T379 mida. La recomendación de T375 es
  **Google Cast SDK para Chromecast** (Chrome de escritorio, HLS y MP4), **Remote Playback sólo para
  AirPlay con fuentes `file`** (navegadores que lo ofrecen, sin guion de terceros) y **DLNA fuera de
  la v1**. Las tres opciones y sus costes están en
  `docs/specs/proposals/SPEC-web-ui.T375.md`; el contrato de tickets y CORS está en
  `docs/specs/proposals/SPEC-media-proxy.T375.md`.
- **`RONA_CAST=1` es un permiso explícito, como `RONA_PARTY=1`.** Sin esa variable no se anuncia la
  función, no se carga el guion de Google y la política de contenido no se relaja. Un despliegue que
  no la encienda no gana superficie.
- **La TV no lleva cookie.** La credencial de la emisión es un ticket de 192 bits, de vida larga y
  revocable, que sólo abre `/stream/*`; nunca `/api/*`.
- **El emisor se abre en `http://127.0.0.1:PUERTO`.** Loopback es contexto seguro para el SDK; la TV
  recibe la dirección de la LAN. Si se abre la interfaz por la IP de la LAN, el SDK puede no estar
  disponible y la interfaz lo dice; no se finge que funciona.

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
`PlayerFrame.tsx`, `packages/web/src/styles/player.css`, `packages/web/src/i18n/es.ts` y sus tests.

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

## Tareas de retransmisión a la TV

### T379 — Probar Cast con un Chromecast real

**Descripción:** medir lo que la propuesta no puede afirmar sin hardware: si un Chromecast alcanza
`http://192.168.x.x:PUERTO/stream/:ticket` sin cookie, si acepta HLS y MP4, si exige CORS o HTTPS, y
qué hosts necesita el SDK en la CSP. El resultado decide D6 y ajusta las propuestas antes de escribir
código de producción.

**Aceptación:**
- [ ] Página de prueba mínima, fuera del árbol de producción, que carga el SDK, enumera dispositivos
      y manda a la TV un MP4 y un HLS servidos por un `Bun.serve` local con ticket.
- [ ] Informe con: modelo de Chromecast, versión, red, resultado de MP4 y HLS, cabeceras que pidió el
      receptor (incluido `Origin`), si hubo CORS/mixed content, latencia de arranque y qué pasa al
      revocar el ticket a mitad.
- [ ] La CSP propuesta se corrige con los hosts **medidos**, no con los que diga un blog.
- [ ] Si el HLS no se puede emitir con la arquitectura actual, D6 se rechaza o se reduce a MP4, y se
      dice antes de T380.

**Verificación:** el informe y el vídeo de la TV; sin dispositivo, el task **no se cierra** y las
tareas de implementación no empiezan.

**Depende de:** T375.

**Archivos:** `docs/spike-cast.md` y la página de prueba en `scripts/spike-cast/` (no entra en el
bundle).

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

### T381 — Tickets de emisión largos y revocables

**Descripción:** una emisión dura un episodio y a veces más; el ticket de 600 s y 500 entradas del
proxy no sirve. Un almacén aparte, pequeño y revocable, emite la URL que se le manda a la TV; al
parar, se revoca.

**Aceptación:**
- [ ] `POST /api/cast/session` resuelve el stream **en el servidor** —nunca acepta una URL del
      cliente— y devuelve `{ id, kind, urls, expiresAt, title, poster? }`; `urls` son absolutas,
      `http://<ipv4>:<puerto>/stream/<ticket>`.
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
`RONA_CAST=1` y la persona abre el mando de transmitir; la CSP se relaja exactamente con los hosts
medidos en T379. Sin permiso no hay petición a `gstatic` ni cambio de política.

**Aceptación:**
- [ ] `cargarCastSdk()` es idempotente, resuelve cuando `cast.framework` está listo, rechaza con un
      error claro si el guion falla o tarda más de 10 s, y no se llama al cargar la página.
- [ ] Con `available: false` no se crea ningún `<script>` ni se pide nada a `gstatic`.
- [ ] La CSP por defecto no cambia; con `RONA_CAST=1` añade sólo `script-src` y `connect-src` con los
      hosts medidos. No aparecen `unsafe-inline`, `unsafe-eval` ni `frame-src` abiertos sin medir.
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

### T383 — La sesión de Cast: cargar, mandar y parar

**Descripción:** la conversación con el SDK, sin dibujo: pedir sesión, mandar el medio con su tipo,
escuchar el estado del receptor y cerrar. La interfaz de T384 sólo usa este gancho.

**Aceptación:**
- [ ] `iniciar(url, kind, meta, positionS)` manda `contentType`
      `application/vnd.apple.mpegurl` para `hls` y `video/mp4` para `file`, `currentTime` y
      `autoplay: true`; la URL es la de la sesión, no una ruta relativa.
- [ ] `detener()` cierra la sesión y el estado `conectado` pasa a `false`; al desmontar se cierra.
- [ ] Los estados del receptor se traducen a `cargando`, `reproduciendo`, `pausado`, `error` y
      `desconectado`; un error del receptor no deja la interfaz en «conectado».
- [ ] Los tipos del SDK se declaran a mano con las propiedades que se usan; no entra `any` ni se
      instala `@types` nuevo.
- [ ] El video local se pausa al conectar y se reanuda en la posición del receptor al desconectar;
      la decisión se prueba con dobles, sin una TV.

**Verificación:** `bun test packages/web/src/features/player/cast` · mutación: mandar
`application/x-mpegURL` para `file` deja el caso en rojo; no pausar el video local duplica el
consumo y deja la prueba en rojo.

**Depende de:** T381, T382.

**Archivos:** `cast-types.ts`, `cast-session.ts`, `useCastSession.ts` y tests.

**Tamaño:** L.

### T384 — El mando de transmitir y su aviso

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
- [ ] El mando mide 44 × 44 px, no tapa el botón de saltar y la fila de mandos no desborda en 320,
      768 y 1024.
- [ ] Los textos nuevos están en `i18n/es.ts`; no hay cadenas sueltas.

**Verificación:** `bun test packages/web` · e2e de T385 · mutaciones: llamar al SDK antes del `POST`
deja la prueba del orden en rojo; no hacer `DELETE` al parar deja el ticket vivo y T385 lo mide.

**Depende de:** T383.

**Archivos:** `CastControl.tsx`, `Player.tsx`, `PlayerFrame.tsx`, `styles/player.css`,
`i18n/es.ts` y tests.

**Tamaño:** M.

### T385 — El cast de punta a punta con un receptor falso

**Descripción:** la TV no entra en CI. Un SDK falso en Playwright y un receptor falso en el proceso
de prueba miden lo que importa: que la URL que se manda es la de la LAN, que la TV la puede pedir
**sin cookie**, que el tipo es el correcto y que al parar la URL deja de servir.

**Aceptación:**
- [ ] E2E con servidor en `RONA_HOST=0.0.0.0`, `RONA_TOKEN` y `RONA_CAST=1`; la pestaña se abre en
      `127.0.0.1`.
- [ ] El SDK falso registra `loadMedia`; el test comprueba `contentId` absoluto, `contentType` de HLS
      y de MP4, `currentTime` y `autoplay`.
- [ ] El receptor falso pide `contentId` sin cookie y con `Range: bytes=0-1023`: 206/200 y bytes; al
      parar, la misma petición da 404/410.
- [ ] El video local queda pausado mientras se emite y vuelve a reproducir al parar.
- [ ] `GET /api/cast/info` en la pestaña dice `available: true` y al menos una URL.
- [ ] Mutaciones: usar una ruta relativa, no revocar o no pausar el video local ponen el caso en rojo.

**Verificación:** `bun run e2e` con el caso nuevo; sin dispositivo real, T379 sigue siendo la medida
física.

**Depende de:** T384.

**Archivos:** `packages/web/e2e/cast.e2e.ts`, `packages/web/e2e/cast-fake.ts`,
`scripts/e2e-server.ts`, el fixture si hace falta, y `playwright.config.ts` sólo si el caso necesita
otro servidor.

**Tamaño:** M.

### T386 — Documentar la emisión y su riesgo

**Descripción:** lo que hay que saber para usarlo y lo que hay que saber para no confiar de más:
arranque en LAN, permiso `RONA_CAST`, qué TV funciona, qué no (subtítulos, AirPlay sin hardware,
DLNA), y las filas nuevas de `SECURITY.md`.

**Aceptación:**
- [ ] `README.md` tiene la sección «Transmitir a la TV» con el comando exacto
      (`RONA_HOST=0.0.0.0 RONA_TOKEN=… RONA_CAST=1 bun run start`), la advertencia de LAN de confianza
      y el enlace a `docs/guia.md`.
- [ ] `SECURITY.md` declara: ticket de emisión (192 bits, 4 h, 16, revocable, sólo `/stream`), guion
      de Google cargado sólo con permiso, CSP exacta, y el CORS acotado si T379 lo exige.
- [ ] `docs/specs/SPEC-web-ui.md` y `docs/specs/SPEC-media-proxy.md` se actualizan **sólo** después de
      que sus dueños integren las propuestas; si no, la documentación dice «propuesta».
- [ ] `bun test packages/web/src/docs.test.ts` pasa y los comandos citados existen en
      `package.json`.
- [ ] Lo no medido se dice: AirPlay sin hardware, PiP de escritorio si T378 no lo midió, DLNA fuera.

**Verificación:** `bun test packages/web/src/docs.test.ts` · `bun run lint` · revisión de que cada
comando del README existe.

**Depende de:** T385.

**Archivos:** `README.md`, `docs/guia.md`, `SECURITY.md`, `docs/specs/SPEC-web-ui.md`,
`docs/specs/SPEC-media-proxy.md`.

**Tamaño:** M.

### T387 — AirPlay por Remote Playback (opcional, después de T379)

**Descripción:** Safari y algunos navegadores de Android ofrecen `video.remote`. Para fuentes
`file`, es una vía sin guion de terceros; para HLS con `MediaSource` no sirve. Se ofrece sólo cuando
`video.remote` existe y el tipo es `file`; si T379 no mide AirPlay, el task se cancela y se declara no
soportado.

**Aceptación:**
- [ ] `useRemotePlayback` detecta `HTMLMediaElement.prototype.remote`, muestra el mando sólo con
      `file`, y usa la URL absoluta de la sesión de T381.
- [ ] La CSP `media-src` permite la dirección LAN **sólo** con `RONA_CAST=1` y no abre `connect-src`.
- [ ] Al conectar se pausa el video local; al desconectar se reanuda en la posición remota.
- [ ] Los subtítulos quedan fuera de la v1 de AirPlay y se dice; sin Apple TV no se declara medido.
- [ ] Mutación: usar la ruta relativa deja al receptor sin alcance; no detectar `remote` deja el
      mando visible donde no existe.

**Verificación:** pruebas con un doble de `remote`; la medida real queda condicionada a hardware.

**Depende de:** T379, T381.

**Archivos:** `useRemotePlayback.ts`, `Player.tsx`, `security-headers.ts` y tests.

**Tamaño:** M.

## orden, dependencias y cortes

```
T375 ─┬─ T376 ── T377
      ├─ T378
      └─ T379 ── T380 ─┬─ T381 ──┐
                       └─ T382 ──┴─ T383 ── T384 ── T385 ── T386
      T387 (T379 + T381, opcional)
```

1. **T376 y T377** no dependen de la TV y se pueden cerrar en paralelo con T379. Son la respuesta
   barata a «quiero usar el PiP».
2. **T379** es la puerta: sin una TV real, la propuesta no se aprueba y T380 no empieza. Si el HLS no
   se puede emitir, D6 se reduce a MP4 y T383/T385 se ajustan antes de escribir la interfaz.
3. **T380 y T381** van en serie: la URL no se emite hasta saber que hay una dirección alcanzable y
   una credencial que la TV pueda presentar.
4. **T382** puede ir en paralelo con T380/T381; el cargador y la CSP no necesitan la sesión.
5. **T383 y T384** separan conversación y dibujo. Si el tope de cinco archivos aprieta, T383 se corta
   en `cast-session` y `useCastSession`.
6. **T385** es la medida de verdad del camino completo; **T386** no se abre hasta que T385 esté en
   verde.
7. **T387** es opcional y no bloquea nada. Sin Apple TV, se cierra como «no medido» o se cancela.

## Lo que no se hace en esta fase

- **DLNA/UPnP.** Otra pila entera (SSDP, SOAP, AVTransport) y muchos televisores no aceptan HLS. Se
  puede proponer después, con su propio spike.
- **Watch party como transporte.** Ya existe y sincroniza estado; no manda el vídeo. No se reescribe
  para esto.
- **Chromecast de la app de escritorio.** WebView2 no trae el ecosistema de Cast del navegador; si
  T378 no lo mide, se dice y se ofrece abrir en el navegador.
- **Emisión desde el móvil.** La interfaz se abre por `http://192.168...`, que no es contexto seguro
  y donde el SDK no está disponible; el mando no aparece y se dice. Exigiría TLS y es otra tarea.
- **Subtítulos en la TV.** Los `<track>` del proxy viven en el origen local y la TV no los pide. La
  v1 emite imagen y sonido; los subtítulos se declaran fuera.
- **Emisión de descargas locales.** El archivo descargado no tiene ticket de emisión todavía; si se
  quiere, se abre otra tarea cuando exista la ruta de archivo servible.

## Criterio de cierre de la fase

- El PiP se ofrece donde el navegador lo tiene, se ve, se anuncia y no miente; la ventana de
  escritorio está medida y lo que no se pueda medir está declarado.
- D6 aprobada con el informe de T379; el cast funciona con un Chromecast real para MP4 y HLS, o D6
  se reduce con el motivo medido.
- La TV recibe una URL de LAN con ticket, sin cookie, revocable; al parar deja de servir.
- Sin `RONA_CAST=1` no hay guion de terceros, ni CSP relajada, ni anuncio en la interfaz.
- `typecheck`, `lint`, `bun test`, `bun run e2e` y `coverage:gate` en verde; `SECURITY.md` con las
  filas nuevas; ninguna afirmación sin su medición.
