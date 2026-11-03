# Especificación · `watch-party`: sala de visionado sincronizada

**Estado:** propuesta de contrato para la tarea **3.1** de `docs/roadmap.md`, pedida por el humano.
La primera entrega está implementada en la rama `feat/watch-party`; falta la revisión humana y la
aprobación de la enmienda de `CAPABILITY-MAP.md`. La decisión **D3** (transporte remoto) sigue
abierta: el modo P2P no está implementado.

**Módulo nuevo:** `watch-party`. **Depende de:** `core` (protocolo y máquina de estados), `server`
(coordinador LAN), `web-ui` (interfaz y transporte P2P), `catalog-store` (sólo lectura, para
emparejar contenido). **No toca** el contrato de plugins, ni SQLite, ni `media-proxy`.

**Enmienda a `CAPABILITY-MAP.md` que este spec propone** (pendiente de aprobación, por eso no se
edita el mapa todavía):

| Module id | Responsabilidad | Depende de | Cuándo |
|---|---|---|---|
| `watch-party` | Salas de visionado sincronizado: protocolo de estado, coordinador LAN (SSE) y transporte P2P WebRTC con señalización manual. Nunca comparte vídeo, tickets ni URLs | `core`, `server`, `web-ui`, `catalog-store` (lectura) | fase 3, después de aprobar este spec |

## 0. Nota de implementación

La primera entrega cambia una pieza del diseño original: **la pestaña del invitado no habla con el
servidor del anfitrión**. Lo hace el servidor de su propia instancia, que recibe el token de sala y
habla con el anfitrión; la pestaña sólo consume su mismo origen. El motivo es concreto: el CSP del
proyecto es `connect-src 'self'`, y abrirlo a la LAN —o añadir CORS con credenciales— habría
debilitado una mitigación de XSS para una función experimental. Con el relevo en el servidor no hay
CORS nuevo, ni cookies de terceros, ni token en el navegador.

Implementado: protocolo y corrección de deriva en `core` (3.2), coordinador LAN y credencial de sala
(3.3), interfaz de sala (3.5) y el invitado desde su servidor. Pendiente: el modo P2P de 3.4
(decisión D3), la coincidencia de contenido (3.6), «esperar a todos» y el control compartido. Las
secciones 6, 7.1 y 11 se leen con esa corrección.

## 1. Qué es y qué no es

Una sala donde varias instancias de nn-anime reproducen el mismo episodio a la vez, cada una desde
**su propia fuente o su copia descargada**. Se sincroniza **sólo el estado de reproducción**: qué
título, qué episodio, en qué segundo, pausado o no, a qué velocidad y desde cuándo. Nunca viaja el
vídeo, ni un ticket del proxy, ni una URL de stream.

Lo que el resto del documento asume:

- Cada participante necesita una fuente que sirva ese episodio. Si no la tiene, se le dice y el resto
  sigue; no se bloquea la sala.
- El historial y el progreso de cada participante los escribe **su** instancia, en **su** base. La
  sala no escribe en SQLite ni en ningún otro sitio.
- La sala es efímera: vive en memoria, caduca y muere con el proceso. No hay historial de salas, ni
  de quién entró, ni de IPs.
- La sala no es un servicio de la iniciativa. Es la instancia de una persona, encendida mientras
  dura la sala. No hay una dirección por defecto a la que conectarse.

## 2. La pregunta del servidor: qué forma se elige

Hay cuatro formas de «servidor» y este spec elige tres y descarta una.

| Forma | Decisión | Por qué |
|---|---|---|
| Sala en la instancia del anfitrión (LAN) | **Sí, MVP (3.3)** | Es el servidor que ya existe. Cero infraestructura nueva: el modo servidor ya tiene token, guards y `0.0.0.0` opt-in. |
| Señalización/relay autohospedado | **Opcional, nunca obligatorio** | Sólo para emparejar NAT o hacer de TURN. Sin cuentas, sin base, salas en memoria. Lo aloja el usuario. |
| WebRTC P2P con señalización manual | **Sí, modo remoto (3.4); es la recomendación de D3** | Respeta «sin servidor central». Sólo estado; el canal va cifrado con DTLS. |
| Servicio público central | **No** | Contradice la promesa pública (ni cuentas, ni servidor central, ni telemetría), el modelo de `SECURITY.md` (un token, un usuario; sin rate limiter global) y añade moderación, coste y obligaciones legales. Sería otro producto, no una fase. |

### 2.1 Sync-only, no hub

Dentro del modo LAN hay dos productos distintos y el spec elige uno:

- **Sync-only (elegido):** cada invitado tiene su instancia y su fuente; el anfitrión sólo coordina el
  estado. Un invitado con navegador pero sin instancia **no** participa en v1.
- **Hub (descartado en v1):** el anfitrión sirve la interfaz y el vídeo a los invitados. Es cómodo
  para móviles, pero el anfitrión sube el vídeo, el invitado deja de reproducir desde su fuente y la
  promesa de la fase («nunca se comparten tickets ni URLs») deja de ser cierta en la práctica.

Si el humano quiere hub, es una decisión de producto aparte: cambia el modelo de amenaza, el ancho de
banda y la lectura de los términos de los proveedores. No entra en este spec.

## 3. Arquitectura

- **`core`**: tipos, mensajes (zod estricto), máquina de estados pura de la sala, relojes y cálculo de
  deriva. Sin I/O. Es lo que se prueba con reloj simulado.
- **`server`**: registro de salas en memoria, credencial de sala, guard propio y coordinador LAN
  (SSE + POST). No decide el estado: lo retransmite y guarda el último para quien llega tarde.
- **`web-ui`**: interfaz de sala, adaptador del reproductor y transporte P2P (`RTCPeerConnection`
  vive en el navegador, no en el servidor). La señalización manual es UI pura.
- **`catalog-store`**: sólo lectura, para emparejar el contenido de la sala con las fuentes que el
  invitado tiene.

El transporte es una interfaz pequeña; la misma máquina de estados corre sobre las dos:

```ts
interface RoomTransport {
  send(message: ClientMessage): void
  subscribe(handler: (message: ServerMessage) => void): () => void
  close(): void
}
```

`server` implementa la variante LAN; `web-ui`, la de WebRTC. La lógica de sincronización no sabe por
dónde viaja.

## 4. Protocolo v1

Envoltorio, en `core`:

```ts
type Envelope = {
  v: 1
  type: string
  seq: number      // monotonía por emisor
  atMs: number     // performance.now() del emisor que sella el mensaje
  payload: unknown // validado por type con zod estricto
}
```

Del invitado al anfitrión: `hello`, `content` (qué resolvió localmente), `report` (posición, pausa,
almacenando, listo), `syncRequest`, `leave` y, si el control es compartido, `request`. En v1 el
control es sólo del anfitrión: el invitado no pide saltos, sólo reporta.

Del anfitrión a los invitados: `welcome` (snapshot y roster), `state` (autoritativo), `roster`,
`syncReply`, `ping`, `error` y `closed`.

Reglas:

- Máximo 4 KiB por mensaje; 20 mensajes/s agregados por sala y 5/s por invitado. El exceso se corta
  con 429 y el que insiste, con la conexión.
- `seq` estrictamente creciente por emisor; un mensaje viejo se descarta.
- Los nombres se tratan como texto (sin HTML), se recortan a 32 caracteres y no se guardan.
- **Ningún mensaje lleva URL, ticket, cabecera de upstream, ruta de archivo ni nombre de plugin.**
  Prueba estática: serializar cualquier estado y afirmar que no contiene `http://`, `https://`,
  `/stream/` ni `ticket`.
- El estado autoritativo es siempre el del anfitrión. Un invitado no puede cambiar el estado de otro
  ni el suyo: sólo reporta, y el anfitrión decide qué hacer con ese reporte.

## 5. Sincronización y deriva

- El anfitrión publica `state` al cambiar (play, pausa, salto, velocidad, episodio) y un latido de
  posición cada 2 s mientras reproduce.
- Reloj: `performance.now()`, nunca `Date`. En LAN el reloj autoritativo es el del **servidor de la
  sala** (sella `atMs` al recibir el estado); en P2P es el del **anfitrión**. El invitado estima su
  desfase con 5 `sync` y se queda con la mediana; el error es como mucho RTT/2.
- Aplicación del estado:
  - `paused`: fijar `currentTime` si |Δ| > 100 ms.
  - reproduciendo: `objetivo = positionS + (ahora + desfase - atMs) / 1000`, acotado a la duración.
  - |Δ| < 150 ms: no tocar nada.
  - 150 ms ≤ |Δ| < 1,5 s: `playbackRate` a 0,95 o 1,05 hasta volver a 150 ms, máximo 5 s; después,
    1,0.
  - |Δ| ≥ 1,5 s: salto duro a `objetivo` y aviso en la píldora de estado.
- Deriva tolerada por el criterio de la fase: **0,5 s**. La UI dice «sincronizado» por debajo de
  0,5 s, «ajustando» hasta 1,5 s y «desincronizado» por encima, con botón «resincronizar».
- «Esperar a todos»: pausa al anfitrión hasta que todos reporten `ready` o pasen 30 s; la UI dice
  quién falta. Desactivado por defecto.
- Pestaña en segundo plano: el navegador frena temporizadores. Al volver, el invitado se resincroniza
  con el último `state` antes de aceptar input. El que se queda atrás no arrastra al resto salvo que
  el anfitrión tenga «esperar a todos».
- El reproductor usa hls.js en modo VOD. La latencia de segmento no se compensa contra el manifiesto:
  se mide la posición real del `<video>` y se corrige contra ella.

## 6. Salas y credenciales

- **Crear:** el anfitrión, desde su sesión local, pide una sala. El servidor genera `roomId` (128
  bits, base32) y `code` (80 bits, base32 de 16 caracteres en grupos de 4). `roomId` no es secreto
  (viaja en la ruta); `code` sí.
- **Unirse (LAN):** el invitado, desde **su** instancia, introduce `host:port` y el `code`. El
  **servidor** de su instancia hace `POST /api/party/join` al del anfitrión, recibe un token de 32
  bytes y lo guarda en memoria; el anfitrión guarda su SHA-256. La pestaña del invitado nunca ve el
  token: habla con su propio servidor, que le reenvía el estado.
- **Credencial separada de la sesión de la app.** El token del modo servidor **no** sirve como
  credencial de invitado y el token de invitado **no** abre `/api/*`. Sin separación, invitar a
  alguien sería darle el historial, los ajustes y las descargas del anfitrión. Las rutas del
  anfitrión y del servidor invitado se montan antes de los guards de `/api/*` con su propio guard;
  `sessionGuard` y `tokenGuard` siguen cubriendo el resto. La tabla de rutas protegidas se amplía
  para que ninguna ruta nueva escape.
- **Sin token en el navegador.** El token de sala viaja en `Authorization: Bearer` entre servidores,
  nunca en una cookie de la pestaña ni en una URL. Las rutas que usa la pestaña del invitado
  (`/api/party/remote/*`) son de su mismo origen y usan su sesión local normal.
- **Sin CORS y sin tocar el CSP.** La pestaña no cruza orígenes: el servidor del invitado es el que
  conecta con el anfitrión (SSE y JSON). No hay preflight, ni `connect-src` relajado, ni cookies de
  terceros. La dirección que teclea el usuario se normaliza a un origen HTTP sin credenciales ni
  ruta, y el cliente saliente no sigue redirecciones.
- **Caducidad:** 4 h por defecto (máximo 12 h, configurable), 8 participantes y 4 salas por
  instancia. La sala se cierra al salir el anfitrión o al caducar; los invitados reciben `closed`.
- **Opt-in:** las rutas de sala no se registran si la función no está habilitada
  (`NN_ANIME_PARTY=1` o ajuste equivalente, a decidir al implementar). Sin ella, `/api/party/*` es
  404. En modo local el servidor sigue en loopback; para LAN hay que arrancar el modo servidor, que
  ya exige token y es una decisión explícita.
- **Sin persistencia:** ni SQLite, ni archivo, ni log de salas, códigos, nombres o IPs. Un reinicio
  borra todo. El código se muestra una vez y no se puede recuperar.

## 7. Transportes

### 7.1 LAN (MVP, 3.3)

- El coordinador es la instancia del anfitrión. El navegador del anfitrión publica `state` con su
  sesión (mismo origen); el **servidor** del invitado se suscribe con `Authorization: Bearer` y
  `fetch` en streaming, y reemite los eventos por SSE a su propia pestaña. La pestaña nunca sale de
  su origen.
- El anfitrión se suscribe al mismo flujo con su sesión, no con el token de invitado, para recibir
  los reportes del roster.
- El coordinador guarda el último `state` y el roster para el que llega tarde; `welcome` lo entrega.
- Heartbeat cada 15 s: sin él, un proxy intermedio cierra la conexión. Un consumidor lento no bloquea
  la sala: se le corta.
- Límites: 1 conexión SSE por participante, 8 por sala; al cerrar la pestaña se libera por el
  `AbortSignal`.
- Alcance de red: la pestaña del invitado no necesita CORS, ni Private Network Access, ni TLS: el
  salto a la LAN lo da su servidor. Si el servidor del invitado no alcanza al del anfitrión, la
  pestaña lo dice con el motivo; no se cae a otro transporte en silencio.

### 7.2 P2P con señalización manual (3.4, D3)

- `RTCPeerConnection` con **un** data channel ordenado y fiable. Sin audio ni vídeo: sólo estado.
- Señalización: el anfitrión genera una oferta, la comprime (`deflate-raw` + base64url) y la muestra
  como código; el invitado la pega y devuelve la respuesta por el mismo canal humano. Sin servidor de
  señalización.
- ICE: por defecto **sólo candidatos host** (LAN y misma red), sin STUN. Para WAN se configura un
  STUN en Ajustes; es una petición a un tercero que ve la IP y se explica en la UI. TURN es opcional
  y lo aloja el usuario; nunca lo aloja el proyecto.
- El código de señalización contiene direcciones IP del anfitrión: es efímero, de un solo uso y
  caduca a los 10 minutos; la UI lo dice antes de mostrarlo.
- Si la conexión directa falla (NAT simétrica, CGNAT), la UI lo explica y ofrece el relay
  autohospedado o el túnel del usuario; no se reintenta en silencio.
- Contexto seguro: la app se abre en `http://127.0.0.1`, que cuenta como contexto seguro. El spike
  mide el caso de servir la interfaz por IP de LAN antes de prometerlo.

### 7.3 Relay/señalización autohospedado (opcional)

- Servicio mínimo (paquete o binario aparte, a decidir al implementar), sin cuentas ni base: salas en
  memoria, intercambio de SDP/ICE y, si se configura, credenciales efímeras de TURN.
- No ve el estado de reproducción si la sala va directa; si hace de relay, ve metadatos de tráfico
  (IPs), no el contenido (DTLS).
- Nunca obligatorio: sin él, el modo manual funciona. Se documenta como `docker run` del usuario.

### 7.4 Túnel del propio usuario

No es un transporte nuevo: es el modo servidor de siempre detrás de Tailscale o Cloudflare del
usuario. Es la vía más barata para probar el remoto, pero expone la app entera, no sólo la sala; se
documenta como ensayo, no como producto, y no se promete en la UI.

## 8. Contenido y emparejamiento

- La sala identifica el contenido por `mediaId` (el id de AniList, que es la identidad que ya usa
  `catalog-store`) + temporada + número de episodio + duración declarada.
- Cada participante resuelve el episodio en su instancia. Si no tiene fuente, ve «no tienes fuente
  para este episodio» y el resto continúa; el anfitrión lo ve en el roster.
- Si la duración difiere más de un 20 %, se avisa (versión distinta, corte, película): la
  sincronización sigue, pero el estado lo dice.
- Nunca se comparten refs de proveedor, tickets, URLs ni el nombre del plugin.
- Subtítulos y pista de audio: **cada uno elige los suyos** en v1; no se sincronizan ni se comparten.
  Queda como propuesta posterior.

## 9. Interfaz

- Entrada en el reproductor y en la ficha: «Ver juntos» (anfitrión) y «Unirse» (código).
- Pantalla de sala: código (copiar), roster con «listo»/«almacenando», indicador de sincronización,
  «esperar a todos», «salir» y «cerrar sala» (anfitrión). Los controles de reproducción del invitado
  se deshabilitan con explicación («lo controla el anfitrión»); «pedir pausa» queda para después.
- Avisos obligatorios:
  - Crear: «Esto abre un puerto en tu red local mientras dure la sala. Sin TLS, el código viaja sin
    cifrar. Cierra la sala al terminar.»
  - P2P: «Tu IP será visible para las personas de la sala. No hay servidor central.»
  - Invitado sin fuente, sala llena, código caducado, anfitrión ausente, NAT sin salida.
- Todos los textos en `packages/web/src/i18n/es.ts`; nada de cadenas sueltas.
- Accesibilidad: estado de sincronización con `aria-live="polite"`, foco al abrir y cerrar la sala,
  atajos del reproductor sin cambios, contraste y tamaños de toque del sistema de diseño.
- Móvil: la UI de sala no promete funcionar en v1 (sync-only exige instancia). Se dice en la pantalla
  si se abre desde un dispositivo sin la app.

## 10. Modelo de amenaza

| # | Amenaza | Mitigación | Residual declarado |
|---|---|---|---|
| A1 | Un tercero en la LAN prueba códigos de sala | 80 bits de entropía, TTL, 5 intentos/min por IP, 404 uniforme que no distingue sala inexistente de código erróneo | Quien vea el tráfico HTTP ve el código: LAN de confianza o TLS |
| A2 | Un invitado usa la sala para leer la biblioteca del anfitrión | `partyGuard` propio, token bearer sólo para `/api/party/*`, allowlist de rutas, prueba de tabla que recorre todas las rutas | Ninguno si la tabla está completa; el anfitrión conserva su app |
| A3 | CSRF desde una web que el anfitrión tenga abierta | No hay credencial ambiental: el token va en cabecera; `Origin` se sigue comprobando en métodos mutantes | Una web local maliciosa que ya tenga el token (no lo tiene) |
| A4 | DNS rebinding contra el coordinador | `hostGuard` existente y opt-in de la función; sin `NN_ANIME_PUBLIC_ORIGIN` en LAN el guard acepta cualquier `Host`, pero la credencial de sala sigue | El riesgo 10 ya declarado en `SECURITY.md` |
| A5 | XSS con el nombre de un participante | Texto plano, 32 caracteres, sin HTML, CSP sin `unsafe-inline` | — |
| A6 | Agotamiento de la sala | Topes de participantes, salas, mensajes y conexiones SSE; se corta al lento; cierre al que insiste | DoS de red sigue siendo posible; no hay rate limiter global |
| A7 | Fuga de la fuente del anfitrión | Sólo `mediaId`/temporada/episodio; prueba que serializa y busca `http`, `/stream/`, `ticket` | — |
| A8 | Suplantación del anfitrión | El `state` se acepta sólo con la sesión del anfitrión; el invitado no puede emitirlo; si el anfitrión sale, la sala se cierra | El navegador del anfitrión comprometido puede desincronizar la sala (sólo estado) |
| A9 | Repetición o desorden | `seq`, `atMs`, descarte de mensajes viejos; TTL de sala | — |
| A10 | La IP del anfitrión queda expuesta a los pares | Es inherente al P2P: aviso explícito, señalización manual, sin descubrimiento automático, sin logs | Quien esté en la sala ve la IP; no hay identidad verificada |
| A11 | Se filtra el código de señalización | Efímero, un solo uso, TTL de 10 min, aviso en la UI, regenerar | Quien lo copie a tiempo puede intentar la conexión; el anfitrión puede cerrar |
| A12 | Un STUN/TURN de terceros ve IP o tráfico | Por defecto sin STUN (sólo candidatos host); STUN opt-in explicado; TURN del usuario | STUN ve IP y puerto; TURN ve metadatos |
| A13 | Un invitado miente posición o «listo» | El anfitrión ignora el estado de invitados salvo reportes; «esperar» tiene timeout | La desincronización de ese invitado es suya; el anfitrión puede expulsarlo |
| A14 | Un `mediaId` hostil provoca peticiones | Se valida contra el catálogo local; nunca se construye una URL desde el mensaje | — |
| A15 | Persistencia accidental de la sala | Memoria; sin logs; sin SQLite; prueba que arranca la app y comprueba que no aparecen archivos nuevos | Volcado de memoria del proceso |
| A16 | Una instancia en modo servidor público abre salas | En v1 la sala no se registra con origen público fuera de loopback/LAN, o exige flag explícito y TLS | Decisión al implementar; documentar |
| A17 | Reloj manipulado o desfasado | `performance.now()` monótono; desfase por mediana; sin `Date` | El reloj del anfitrión manda; un invitado con reloj roto se resincroniza |
| A18 | La sala como proxy de red | No hay `fetch` desde mensajes ni relay de bytes; sólo estado | — |

### 10.1 Riesgo residual para `SECURITY.md`

1. La IP de los pares es visible en el modo P2P.
2. En LAN sin TLS, el código de sala y el estado viajan sin cifrar.
3. El código de sala es una credencial bearer sin identidad: quien lo tenga, entra.
4. Sin TURN no hay garantía de conexión directa.
5. La precisión depende del reloj y del RTT; la tolerancia es 0,5 s.
6. La sala no verifica que el otro esté viendo el mismo corte (sólo avisa si la duración difiere más
   de un 20 %).
7. El rate limit es de la sala, no global: el resto de la aplicación sigue sin limitador, como ya
   declara `SECURITY.md`.

## 11. API LAN

Todo bajo `/api/party/`; las rutas de invitado usan `Authorization: Bearer`, las de anfitrión usan la
sesión de la app.

| Método | Ruta | Credencial | Qué hace |
|---|---|---|---|
| `POST` | `/api/party/rooms` | sesión del anfitrión | Crea la sala; devuelve `{ roomId, code, expiresAt }` |
| `DELETE` | `/api/party/rooms/:roomId` | sesión del anfitrión | Cierra la sala y avisa a los invitados |
| `POST` | `/api/party/rooms/:roomId/state` | sesión del anfitrión | Publica el estado autoritativo; el servidor sella `atMs` y lo reparte |
| `POST` | `/api/party/join` | ninguna (servidor a servidor) | `{ code, name }` → `{ roomId, token, expiresAt, state, roster }`; 20 intentos/min por instancia |
| `GET` | `/api/party/rooms/:roomId` | bearer o sesión | Snapshot y roster para reincorporarse |
| `GET` | `/api/party/rooms/:roomId/events` | bearer o sesión | SSE: `welcome`, `state`, `roster`, `ping`, `closed` |
| `POST` | `/api/party/rooms/:roomId/report` | bearer | `{ positionS, paused, buffering, ready }` del invitado |
| `POST` | `/api/party/rooms/:roomId/sync` | bearer | `{ t0 }` → `{ t0, t1, t2 }`; el desfase se calcula con la mediana |
| `POST` | `/api/party/rooms/:roomId/leave` | bearer | El servidor del invitado se va de la sala |
| `GET` | `/api/party/info` | sesión del anfitrión | `{ port, urls }` con las direcciones de la LAN |
| `GET` | `/api/party/rooms` | sesión del anfitrión | Las salas abiertas y sus participantes |
| `POST` | `/api/party/remote/join` | sesión del invitado | `{ baseUrl, code, name }` → snapshot; su servidor habla con el anfitrión |
| `GET` | `/api/party/remote` | sesión del invitado | Snapshot del enlace, para reincorporarse |
| `GET` | `/api/party/remote/events` | sesión del invitado | SSE del relevo, ya en el mismo origen |
| `POST` | `/api/party/remote/report` | sesión del invitado | Reenvía `{ positionS, paused, buffering, ready }` |
| `POST` | `/api/party/remote/sync` | sesión del invitado | Reenvía `{ t0 }` y devuelve el reloj del anfitrión |
| `POST` | `/api/party/remote/leave` | sesión del invitado | Corta el enlace y avisa al anfitrión |

- La sala responde `404` uniforme a sala inexistente o código erróneo, `409` cuando está llena y
  `429` cuando se corta el límite. No distingue «no existe» de «no autorizado» donde eso filtraría
  información.
- No hay CORS: la primera tabla la habla el servidor del invitado, y la segunda su propia pestaña en
  el mismo origen. El CSP sigue en `connect-src 'self'`.
- El ticket de `/stream/:ticket` no cambia: la sala nunca lo usa, y el invitado reproduce desde su
  propia instancia.

## 12. Límites, almacenamiento y limpieza

- 8 participantes, 4 salas por instancia, 4 h de vida (12 h máximo), 4 KiB por mensaje, 10
  mensajes/s por participante y 20 intentos de entrada por minuto y por instancia. El límite de
  entrada es por instancia y no por IP: el adaptador HTTP actual no expone una dirección remota
  fiable.
- Todo en memoria: `Map` de salas con `expiresAt`, el último estado, el roster y los tokens
  (hasheados). La caducidad se comprueba antes de cada operación y cierra las salas vencidas con
  `closed`; no hay temporizador propio.
- Sin SQLite, sin archivos, sin logs de sala. Los códigos no se pueden recuperar tras un reinicio.
- El cierre por `SIGTERM` avisa a las salas y corta las conexiones; no hay estado que guardar.

## 13. Pruebas y verificación

- **Unidad (`core`)**: validación zod de cada mensaje, `seq` monótono, descarte de viejos, máquina de
  estados y corrección de deriva con reloj y latencia simulados; 100 trayectorias con |Δ| final
  ≤ 0,5 s. Se mide mutando: quitar la corrección de velocidad o el salto hace fallar las pruebas.
- **Servidor**: rutas de la sala con su propio guard; token de invitado rechazado en `/api/health`
  y en el resto de `/api/*`; 404 uniforme; TTL; sala llena; límite de intentos; límite por
  participante; SSE que entrega `welcome` y reenvía `state`; serialización sin `http`, `/stream/` ni
  `ticket`; relevo del invitado con `fetch` inyectado (sin red en las pruebas).
- **Web**: adaptador del reproductor (posición real del `<video>`), UI de sala con dos contextos de
  navegador simulados, i18n sin cadenas sueltas, `aria-live`.
- **P2P**: prueba de ida y vuelta del códec de señalización con un SDP de fixture (comprimir,
  descomprimir, mismo texto), adaptador con un data channel falso, y el spike manual con métricas
  (no en CI): éxito sin TURN, longitud del código, tiempo hasta conectar, errores por NAT.
- **e2e**: dos contextos con el fixture; el anfitrión crea la sala, el invitado entra con el código,
  play/pausa/salto se reflejan en ≤ 0,5 s; la sala caduca; el invitado no puede leer `/api/settings`.
- Sin red en las pruebas. Sin tests saltados. Los criterios se marcan con la medición que los
  sostiene, no con un «hecho».

## 14. Criterios de aceptación de la fase 3

| Roadmap | Criterio | Medición |
|---|---|---|
| 3.1 | Spec y modelo de amenaza revisados; `SECURITY.md` actualizado | Este documento aprobado y la sección prevista de `SECURITY.md` en su sitio |
| 3.2 | Protocolo y tipos en `core`; el anfitrión es la autoridad; deriva ≤ 0,5 s | 100 trayectorias simuladas y prueba mutada |
| 3.3 | Sala LAN opt-in; sin la función no hay rutas; sin código no se entra | `/api/party` 404 sin flag; join con código erróneo 404; token de invitado no abre `/api/*` |
| 3.4 | Dos instancias en redes distintas se sincronizan | Spike con métricas: ≥ 80 % de conexiones directas sin TURN en las redes probadas, código ≤ 4 KiB comprimido, tiempo mediano ≤ 60 s |
| 3.5 | UI de sala completa | e2e con dos contextos y los estados de error |
| 3.6 | Coincidencia de contenido por AniList | Invitado sin fuente ve el motivo y los demás siguen |
| 3.7 | Chat y reacciones | Después de 3.5; fuera de este spec |

## 15. Decisiones abiertas y fuera de alcance

**Abiertas:**

- **D3**: transporte remoto. Recomendación: WebRTC con señalización manual; se cierra con el spike y
  sus números, no con una opinión.
- **Hub**: descartado en v1; si el humano lo quiere, es otro spec y otro modelo de amenaza.
- **Control compartido**: en v1 lo controla sólo el anfitrión; «pedir pausa» para después.
- **Modo servidor público**: la sala no se registra con origen público en v1; se revisa si algún día
  se quiere usar el despliegue de Docker para una sala.
- **STUN por defecto**: ninguno; se configura en Ajustes. A confirmar en el spike si conviene un
  STUN público conocido como opción de un clic, con su aviso.
- **Paquete o no**: el coordinador cabe en `packages/server` y el protocolo en `core`; no se crea
  paquete nuevo salvo que el spike P2P pida uno.

**Fuera de alcance:**

- Compartir vídeo, tickets, URLs, archivos o descargas. Ni P2P ni hub.
- Cuentas, identidades persistentes, moderación, servidor público.
- `mpv`: el reproductor externo no se sincroniza en esta fase.
- Chat y reacciones (3.7), subtítulos compartidos, control compartido.
- Sincronizar con usuarios que no tengan instancia (móvil sin app).

## 16. Alternativas descartadas

- **Servidor central propio:** viola la promesa pública y el modelo de seguridad; además exige
  moderación, cuentas, rate limiting global y ancho de banda.
- **P2P de vídeo:** re-streaming de fuentes de terceros, ancho de banda de subida del anfitrión,
  términos de los proveedores y un modelo de amenaza distinto.
- **WebSocket en LAN:** SSE + POST ya cubre el caso y el repositorio ya usa SSE; WebSocket añade una
  superficie que no se necesita. Si el spike P2P necesita otra cosa, será en el navegador.
- **Cookie de sala:** las cookies de terceros (`SameSite`) y el CORS con credenciales hacen que el
  invitado no pueda usarlas desde su localhost; el token en cabecera es más simple y no da autoridad
  ambiental.
- **Descubrimiento automático de salas (mDNS):** anuncia la existencia de la aplicación en la red y
  no hace falta: el código se comparte a mano.

## 17. Orden de implementación propuesto

1. Aprobar este spec y la enmienda de `CAPABILITY-MAP`; actualizar `SECURITY.md` con la sección
   prevista.
2. Protocolo y máquina de estados en `core` (3.2), con reloj simulado.
3. Coordinador LAN, guard, credencial y CORS (3.3).
4. UI de sala y adaptador del reproductor (3.5), con e2e de dos contextos.
5. Emparejamiento de contenido por AniList (3.6).
6. Spike de WebRTC y cierre de D3 con los números del spike (3.4).
7. Transporte P2P y su UI de señalización (3.4).
8. Chat y reacciones (3.7), sólo si el resto está cerrado.
