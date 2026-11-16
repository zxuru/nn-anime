# Roadmap de nn-anime

> Documento de origen de la fase siguiente a la v0.3.1. Lo escribió el humano y lo adopta el
> repositorio aquí. La adaptación al estado **medido** —qué de la fase 0 ya está hecho y qué falla
> de verdad— está en `docs/diagnostico-peliculas-series.md` y `tasks/roadmap.md`.
>
> **Estado (medido el 2026-11-14, no de memoria):** la release publicada es la **0.8.0**. Las
> fases **0 y 1 están cerradas** (T174–T180 y T181–T187). La fase 3 (watch party) está
> **implementada en su modo LAN** y sale en la 0.8.0; le quedan el modo P2P, la coincidencia de
> contenido y el chat. El siguiente bloque declarado es la **fase 2A (manga)**, que **empieza por
> un spec que aún no existe** (`docs/specs/SPEC-manga.md`, tarea T234).
>
> Cada tarea tiene ID, prioridad, dependencias y criterios de aceptación comprobables. Los nombres
> de paquetes y archivos marcados como «probable» son hipótesis a verificar leyendo el código, no
> hechos.

## 0. Cómo usar este documento (instrucciones para el agente)

1. Lee primero `AGENTS.md`, `README.md`, `docs/specs/SPEC-nn-anime.md` y
   `docs/specs/CAPABILITY-MAP.md`.
2. Trabaja **una tarea por rama** (hay un gancho que impide commitear en `main`; existe el skill
   `.agents/skills/agente-worktree`). Commits con Conventional Commits (`feat:`, `fix:`, `docs:`…),
   porque `release-please` genera el changelog a partir de ellos.
3. Antes de cerrar cada tarea: `bun run typecheck`, `bun run lint`, `bun test` y, si toca la
   interfaz, `bun run e2e`. Respeta el umbral de `bun run coverage:gate`.
4. Si una tarea exige una decisión listada en la sección 6, **no la tomes por tu cuenta**: déjala
   escrita en el PR y pregunta.
5. Cada fase empieza con un documento corto en `docs/specs/` (spec) y termina con la documentación
   actualizada. No saltes la spec.
6. Todo cambio de esquema de base de datos lleva su migración (`bun run db:migrate`).

## 1. Estado actual

**Medido el 2026-11-14 contra este árbol**, no copiado de la v1:

| Qué | Estado | Cómo se midió |
|---|---|---|
| Release publicada | **0.8.0** (2026-11-10) | `version` de `package.json` y el encabezado `## [0.8.0]` de `CHANGELOG.md` |
| Suite de pruebas | **3645 pasan, 0 fallan**, en 213 ficheros | `bun test` en este árbol |
| Fase 0 (0.1–0.6) | **Cerrada** | 7 fragmentos de cierre en `tasks/done/`: T174–T180 |
| Fase 1 (1.1–1.7) | **Cerrada** | 12 fragmentos de cierre en `tasks/done/`: T181, T182, T183, T183b–T183f, T184–T187 |
| Fase 3 (watch party) | **Modo LAN implementado**, publicado en la 0.8.0 | 17 rutas `/api/party/*` en `packages/server/src/party/`; apagada sin `NN_ANIME_PARTY=1` |
| Fase 2A (manga) | **Sin abrir**: su primera tarea es un spec que **no existe** | `docs/specs/SPEC-manga.md` no está en el árbol; es la tarea T234 |

Lo que hay hoy:

- **Anime, películas y series funcionan.** La fase 0 está cerrada: el modelo de medios ya distingue
  `anime | movie | series | manga` (`packages/core/src/schema.ts`) y el fallo que documentaba el
  diagnóstico —la serie de varias temporadas, donde el número de episodio se usaba como identidad y
  se repetía en cada temporada— está corregido: la temporada forma parte de la identidad del
  episodio. El reproductor no ofrece «siguiente episodio» en una película y cambia de temporada en
  una serie. El diagnóstico que reordenó la fase está en
  `docs/diagnostico-peliculas-series.md`.
- **Descargas para ver sin conexión.** La fase 1 está cerrada y sus descargas se publican desde la
  release **0.4**: motor de descargas con cola persistente, reanudación y remux a MP4, pantalla de
  descargas, reproducción local, selector de carpeta en el escritorio y gestión de espacio.
- **Watch party en modo LAN.** Una sala de visionado en la red local donde el invitado habla desde
  su propio servidor, con relevo del invitado. Está **apagada por defecto**: sin
  `NN_ANIME_PARTY=1` no se registra ninguna ruta `/api/party/*`. Ver
  [`docs/watch-party.md`](watch-party.md) y la sección 4.
- **Manga no está.** No hay spec, ni contrato de plugin, ni lector. `mediaType: 'manga'` está
  reservado en el modelo, pero no hay nada detrás.
- Distribución: Windows (exe único e instalador), macOS, Linux; ventana de escritorio con Tauri
  (`desktop/`).
- Arquitectura: monorepo Bun + TypeScript, React, Hono, `bun:sqlite`. Paquetes: `core`,
  `provider-sdk`, `providers-fixture`, `catalog-store`, `media-proxy`, `recsys`, `server`, `web`,
  `cli`.

## 2. Restricciones de diseño (no negociables)

Todo lo que se construya debe respetar esto. Si una tarea lo contradice, se replantea la tarea, no
la restricción.

- **Local primero:** sin servidor central, sin cuentas, sin telemetría.
- **Sin scrapers, torrents, protocolos de pares ni alojamiento de contenido en este repositorio.**
  Las fuentes viven en plugins (repositorio `nn-anime-plugins`). El núcleo solo define contratos y
  motores genéricos.
- **El servidor escucha solo en `127.0.0.1` y exige token de arranque.** Cualquier función que
  abra la red (ver watch party) debe ser opt-in, avisar en la UI y tener su propio modelo de
  amenaza en `SECURITY.md`. La sala de watch party es el ejemplo: sin `NN_ANIME_PARTY=1` no se
  registra ninguna ruta `/api/party/*`.
- **Los plugins se ejecutan sin sandbox**, con los permisos del usuario. No ampliar su superficie
  sin necesidad.
- **AniList:** respetar sus términos (lista blanca de hosts, 1 petición cada 2 s, caché con TTL, no
  acaparar datos). `NN_ANIME_ANILIST_OFFLINE=1` debe seguir funcionando en las pruebas.
- Compatibilidad hacia atrás del contrato de plugin: `capabilities.media` ausente significa anime.

## 3. Resumen y prioridades

Leyenda: **P0** base bloqueante · **P1** alto valor · **P2** valor medio o riesgo alto · **P3**
posterior. Esfuerzo: S (días) · M (1-2 semanas) · L (varias semanas) · XL (un mes o más).

| Fase | Tema | Prioridad | Esfuerzo | Depende de | Estado | Encaja con la arquitectura local |
|------|------|-----------|----------|------------|--------|----------------------------------|
| 0 | Estabilizar películas y series + modelo de medios | P0 | M | n/a | **Cerrada** (T174–T180) | Total |
| 1 | Descargas para ver sin conexión | P1 | L | 0 | **Cerrada** (T181–T187) | Total (todo en el equipo del usuario) |
| 2A | Manga: lectura | P1 | XL | 0 | **Sin abrir**: su spec no existe (T234) | Total |
| 2B | Manga: descarga | P2 | M | 1, 2A | Sin abrir; depende de la 2A | Total |
| 3 | Watch party | P2 | XL | 0 (idealmente 1) | **Modo LAN en la 0.8.0**; faltan 3.4, 3.6 y 3.7 | Baja: choca con «sin servidor central» |

**Por qué este orden:**

- La fase 0 era obligatoria antes de todo: manga añade un tercer tipo de medio, y si el modelo no
  se generaliza primero habría que rehacerlo dos veces. **Ya está**: el modelo admite `manga` y las
  películas y series funcionan.
- Las descargas iban antes que manga porque construyen el **motor de descargas genérico** (cola,
  reanudación, disco) que luego reutiliza la descarga de manga. **Ya está**: ese motor es el que
  reutilizará la 2.8.
- Watch party va al final por riesgo: es la única función que obliga a abrir la red, y la app
  promete lo contrario. **Ya se ha hecho en su modo LAN**, sin relajar el CSP ni abrir CORS; lo que
  queda —P2P, coincidencia de contenido y chat— es lo más caro de la fase.
- Con la fase 0 y la 1 cerradas, **el siguiente bloque es la 2A (manga)**: se apoya en el modelo ya
  generalizado y en el motor de descargas ya construido, que es justo lo que la 2A reutiliza.

```
Fase 0 ── Fase 1 ──┬── Fase 2A ── Fase 2B    ← siguiente bloque; falta el spec de la 2A
(cerrada) (cerrada)│
                   └── Fase 3                ← modo LAN publicado en la 0.8.0
```

## 4. Fases y tareas

### Fase 0: Estabilizar películas/series y generalizar el modelo (P0, M) — **cerrada**

**Estado:** **cerrada**. Sus siete tareas son T174–T180 y cada una dejó su fragmento de cierre en
`tasks/done/`. El detalle por tarea y el orden final están en `tasks/roadmap.md`; el diagnóstico que
reordenó la fase, en `docs/diagnostico-peliculas-series.md`.

**Objetivo:** que películas, series y doramas funcionen tan bien como el anime, y que el modelo de
datos admita un cuarto tipo (manga) sin cambios estructurales.

| ID | Tarea | Prioridad | Criterios de aceptación |
|----|-------|-----------|-------------------------|
| 0.1 | Diagnóstico: reproducir los fallos con películas y series y documentarlos en `docs/diagnostico-peliculas-series.md` | P0 | Tabla con cada fallo: pasos para reproducirlo, causa probable, paquete afectado, severidad. Cubre búsqueda, ficha, selección de temporada/episodio, reproducción, «continuar viendo» y metadatos |
| 0.2 | Generalizar el tipo de medio en `core`: `anime \| movie \| series \| manga`. Película = un solo ítem reproducible sin episodios; serie = temporadas con episodios numerados por temporada (no numeración absoluta como en anime) | P0 | Tipos y esquemas actualizados; migración de `catalog-store` sin pérdida de datos; `capabilities.media` ausente sigue siendo anime; pruebas de migración |
| 0.3 | Fuente de metadatos para no anime (AniList solo cubre anime y manga). Ver decisión **D1** | P0 | Ficha de película/serie con sinopsis, géneros, año y portada; degradación elegante si la fuente no responde |
| 0.4 | Reproductor: película sin «siguiente episodio», series con cambio de temporada, pistas de audio y subtítulos múltiples (HLS), reanudar posición | P0 | Pruebas e2e para película y para serie de varias temporadas; la posición se recupera tras recargar |
| 0.5 | Ampliar `providers-fixture` con películas y series multi-temporada, y la prueba de conformidad de `provider-sdk` | P0 | `bun test` y `bun run e2e` cubren `?tipo=movies`; hay un caso de proveedor en fallo (`e2e:fallo`) para este tipo |
| 0.6 | Selector de fuente en el visor con alternativa automática cuando una falla | P1 | Si la fuente activa falla, la UI ofrece otra sin perder la posición |

### Fase 1: Descargas para visualización local (P1, L) — **cerrada**

**Estado:** **cerrada**. Sus tareas son T181–T187 (la 1.3 se repartió en T183, T183b–T183f) y cada
una dejó su fragmento de cierre en `tasks/done/`. El motor de descargas que construyeron es el que
reutiliza la fase 2B.

**Objetivo:** descargar películas y episodios al equipo del usuario y verlos sin conexión.

| ID | Tarea | Prioridad | Criterios de aceptación |
|----|-------|-----------|-------------------------|
| 1.1 | Spec `docs/specs/SPEC-descargas.md`: formatos (MP4 directo y HLS), ubicación, límites, qué hace el motor y qué el plugin. Ver decisión **D2** | P1 | Spec revisada antes de escribir código |
| 1.2 | Contrato: el plugin puede declarar si una fuente admite descarga (por ejemplo `capabilities.download`); el motor usa el mismo mecanismo de tickets del `media-proxy` que la reproducción | P1 | Contrato versionado, prueba de conformidad actualizada, fixture con una fuente descargable y otra no |
| 1.3 | **Motor de descargas genérico** (probable: paquete nuevo `downloads` o dentro de `media-proxy`): cola persistente en `catalog-store`, concurrencia limitada, pausar, reanudar, cancelar, reintentos con espera creciente, progreso, comprobación de espacio libre, rutas saneadas (sin path traversal) | P1 | Pruebas con un servidor HTTP falso que sirve segmentos HLS: reanudación tras corte, disco lleno, cancelación a mitad, nombres de archivo hostiles |
| 1.4 | Interfaz: botón «descargar» en episodio y película, vista «Descargas» (cola y progreso), marca de «descargado» en la ficha, ajustes (carpeta, concurrencia, límite de ancho de banda) | P1 | e2e del flujo completo con el fixture |
| 1.5 | Reproducción local: el reproductor prefiere la copia descargada y funciona sin red; `mpv` también | P1 | e2e con la red cortada reproduce un título descargado |
| 1.6 | Escritorio (Tauri): selector nativo de carpeta y notificación al terminar | P2 | Probado en Windows; documentado el comportamiento en macOS y Linux |
| 1.7 | Gestión del espacio: borrar descargas, ver tamaño por título, límite opcional | P2 | Borrado limpia archivos y registros; pruebas |

### Fase 2A: Sección de manga, lectura (P1, XL) — **siguiente bloque; sin abrir**

**Estado:** **sin abrir**, y es el **siguiente bloque declarado** del roadmap. Su primera tarea
(2.1) es el spec `docs/specs/SPEC-manga.md`, y **ese fichero no existe todavía**: es la tarea
**T234** de `tasks/deuda.md`. La regla de
[`docs/specs/proposals/README.md`](specs/proposals/README.md) es que no se escribe código de un
módulo hasta que su spec lo apruebe el humano, así que **lo primero que hay que hacer es escribir
ese spec y que lo apruebe el humano**; hasta entonces, las tareas 2.2–2.7 no se pueden codificar.
Lo que ya está hecho y esta fase reutiliza: la decisión **D5** (formato offline: CBZ) está
cerrada, el modelo ya reserva `mediaType: 'manga'` (`packages/core/src/schema.ts`) y el motor de
descargas de la fase 1 está listo para la 2.8.

**Objetivo:** buscar, abrir y leer manga con progreso guardado.

| ID | Tarea | Prioridad | Criterios de aceptación |
|----|-------|-----------|-------------------------|
| 2.1 | Spec `docs/specs/SPEC-manga.md` (modelo, contrato, lector, descargas) — **el fichero no existe todavía: es la tarea T234** | P1 | Spec revisada antes de codificar |
| 2.2 | Contrato de plugin: `capabilities.media` incluye `manga`; operaciones de buscar, ficha, lista de capítulos y páginas de un capítulo (URLs de imagen servidas por tickets del proxy). Versionar el contrato | P1 | Prueba de conformidad y plugin fixture de manga con imágenes locales inventadas |
| 2.3 | Metadatos de manga con AniList (soporta el tipo MANGA), reutilizando el cliente existente y sus límites | P1 | Ficha enriquecida; modo offline para pruebas |
| 2.4 | Datos: capítulos y volúmenes, progreso de lectura (capítulo + página), y reutilización de la biblioteca (favorito / quiero leer / leído) | P1 | Migración y repositorios en `catalog-store` con pruebas |
| 2.5 | Proxy de imágenes: extender `media-proxy` con caché, cabeceras que exija la fuente, límite de tamaño y tipos MIME permitidos | P1 | Pruebas de límites y de tipos no permitidos |
| 2.6 | Lector: modo paginado (izquierda→derecha y derecha→izquierda), modo vertical continuo, ajuste de ancho/alto, zoom, teclado y gestos, precarga, recuerda la página | P1 | e2e del lector; checklist de accesibilidad añadida a `docs/a11y.md` |
| 2.7 | Index: el conmutador de tipo pasa a tres vías (anime / películas / manga), `?tipo=manga`, top y populares de manga | P1 | Recargar y compartir la URL conserva el tipo |

### Fase 2B: Descarga de manga (P2, M)

| ID | Tarea | Prioridad | Criterios de aceptación |
|----|-------|-----------|-------------------------|
| 2.8 | Descargar capítulos sueltos o rangos reutilizando el motor de la tarea 1.3. Formato: ver decisión **D5** | P2 | Descarga, pausa y reanudación; el lector abre capítulos locales sin red |
| 2.9 | Vista de descargas unificada (vídeo y manga) y gestión de espacio | P2 | Una sola pantalla de «Descargas» para ambos tipos |

### Fase 3: Watch party (P2, XL, riesgo alto) — **modo LAN implementado; faltan 3.4, 3.6 y 3.7**

**Estado:** la primera entrega —**sala LAN con relevo del invitado**— está **implementada y
publicada en la 0.8.0**. El contrato y el modelo de amenaza están en
[`docs/specs/SPEC-watch-party.md`](specs/SPEC-watch-party.md), el uso en
[`docs/watch-party.md`](watch-party.md) y los riesgos residuales en
[`SECURITY.md`](../SECURITY.md). La función está **apagada por defecto**: sin `NN_ANIME_PARTY=1` no
se registra ninguna ruta `/api/party/*` y una petición a ellas es un 404.

**Lo que ya hay** (medido en el árbol el 2026-11-14):

- **3.2 — protocolo y tipos en `core`** (`packages/core/src/party.ts`): mensajes con zod estricto,
  `seq` monótono, estado del anfitrión como autoridad y corrección de deriva con reloj simulado
  (tolerancia 0,5 s; por debajo de 0,15 s no se toca el reproductor, entre 0,15 s y 1,5 s se ajusta
  la velocidad y a partir de 1,5 s se salta).
- **3.3 — modo LAN (MVP)**: el anfitrión abre la sala y los invitados entran con `IP:puerto` y un
  código de 16 caracteres (80 bits). La sala vive **en memoria**, en la instancia del anfitrión:
  8 participantes, 4 salas por instancia, 4 h de vida por defecto (12 h máximo) y 4 KiB por mensaje.
  El estado se reparte por SSE.
- **3.5 — interfaz de sala**: panel y barra de sala, roster, indicador de sincronización y
  «Resincronizar». El invitado **no** habla con el servidor del anfitrión: habla con el suyo, que
  es quien se comunica con el del anfitrión. Así no hay CORS nuevo, ni cookies de terceros, ni el
  token de sala en el navegador, y el CSP sigue en `connect-src 'self'`.
- **17 rutas `/api/party/*`** en `packages/server/src/party/`, montadas sólo con la función
  encendida.

**Lo que queda:**

- **3.4 — WebRTC P2P** (decisión **D3**, que sigue abierta): hoy el modo remoto necesita que el
  invitado alcance al servidor del anfitrión por la LAN o por un túnel del usuario; el transporte
  P2P con señalización manual no está implementado.
- **3.6 — coincidencia de contenido**: la sala dice qué título y episodio se ve, pero el invitado
  tiene que abrir el suyo; falta el identificador común (AniList) para emparejar entre
  proveedores y avisar de quién no tiene fuente.
- **3.7 — chat y reacciones** (P3, después de la 3.5).
- De la **3.5** quedan además «esperar a todos» y el control compartido: en la versión publicada el
  control es sólo del anfitrión.

**Principio:** se sincroniza **solo el estado de reproducción**, nunca el vídeo. Cada participante
reproduce desde su propio plugin o desde su copia local. Nunca se comparten tickets del proxy ni
URLs de streams.

| ID | Tarea | Prioridad | Estado | Criterios de aceptación |
|----|-------|-----------|--------|-------------------------|
| 3.1 | Spec `docs/specs/SPEC-watch-party.md` con modelo de amenaza (qué se abre, a quién, durante cuánto tiempo) y actualización de `SECURITY.md` | P2 | **Escrita y con `SECURITY.md` actualizado**; falta la revisión humana del spec y de la enmienda de `CAPABILITY-MAP.md` | Spec revisada; riesgos y mitigaciones explícitos |
| 3.2 | Protocolo y tipos en `core`: unirse, salir, estado (`mediaId`, `episodeId`, posición, pausa, velocidad, marca de tiempo), búsqueda de posición, «listo». El anfitrión es la autoridad; corrección de deriva (tolerancia aprox. 0,5 s, ajustar velocidad o saltar) | P2 | **Hecha** | Pruebas con reloj y latencia simulados |
| 3.3 | Modo LAN (MVP): el anfitrión abre una sala, los invitados entran con IP:puerto + código. Opt-in explícito con aviso en la UI; token de sala con caducidad | P2 | **Hecha** | No se expone nada en red si el usuario no activa la función; prueba de que sin el token no se entra |
| 3.4 | Modo remoto sin servidor central: ver decisión **D3** | P2 | **Pendiente** | Dos instancias en redes distintas se sincronizan |
| 3.5 | Interfaz: crear o unirse a sala, lista de participantes, indicador de sincronización, «esperar a todos», control solo del anfitrión o compartido | P2 | **Hecha en lo esencial**: faltan «esperar a todos» y el control compartido | e2e con dos clientes simulados |
| 3.6 | Coincidencia de contenido: resolver el título por identificador común (AniList u otro) y avisar si algún participante no tiene una fuente para él | P2 | **Pendiente** | Mensaje claro, sin bloquear al resto |
| 3.7 | Chat y reacciones | P3 | **Pendiente** | Opcional, después de 3.5 |

## 5. Trabajo transversal (en cada fase)

- **Pruebas:** `bun test` sin red; e2e con el fixture; cobertura por paquete dentro del umbral.
- **Seguridad:** actualizar `SECURITY.md` en cada fase que amplíe superficie (descargas en disco,
  red local, imágenes).
- **Documentación:** README, guía de plugins (`docs/providers.md`) y changelog al día; el contrato
  de plugin versionado con notas de migración para quien escribe plugins.
- **Accesibilidad:** `docs/a11y.md` al día con lector y reproductor.
- **Idiomas:** cualquier texto nuevo pasa por el mecanismo de idioma existente (`NN_ANIME_LANG`).
- **Empaquetado:** comprobar que el ejecutable único de Windows, los instaladores y el anfitrión
  Tauri siguen compilando tras cada fase.

## 6. Decisiones (las abiertas no las decide el agente: pregunta)

| ID | Decisión | Opciones | Estado o recomendación |
|----|----------|----------|------------------------|
| D1 | Metadatos de películas y series | TMDB con clave del propio usuario en Ajustes, o solo lo que entregue el plugin | **Decidida el 2026-10-26: clave opcional de TMDB en Ajustes, con el plugin como respaldo.** La clave no se devuelve en `GET /api/settings`; TMDB entra en la lista blanca y en `SECURITY.md` |
| D2 | Formato de descarga HLS | Guardar playlist y segmentos y servirlos desde el proxy local, o remux a MP4 con ffmpeg opcional | **Decidida el 2026-10-26: MP4 primero.** Copia directa para fuentes `file`; remux con ffmpeg para HLS; si no hay ffmpeg, segmentos locales reproducibles sólo en la aplicación. El usuario quiere poder abrir lo descargado fuera de nn-anime |
| D3 | Transporte de watch party remoto | WebRTC con señalización manual (copiar y pegar un código), relay autohospedable opcional, o túnel del propio usuario | **Abierta.** Recomendación: WebRTC con señalización manual, porque respeta «sin servidor central». Bloquea la 3.4, no el modo LAN |
| D4 | Orden entre manga y watch party | Manga primero o watch party primero | Manga primero, por riesgo y por reutilizar el motor de descargas |
| D5 | Formato de manga offline | CBZ (zip de imágenes, opcionalmente con `ComicInfo.xml`) o carpeta de imágenes | CBZ: un archivo por capítulo, interoperable con otros lectores |

## 7. Definición de terminado de una fase

- Todas sus tareas P0/P1 cumplen sus criterios de aceptación.
- `typecheck`, `lint`, `bun test`, `e2e` y `coverage:gate` en verde en CI.
- Spec, `SECURITY.md`, README y guía de plugins actualizados.
- Release candidata empaquetada para las tres plataformas sin regresiones en la parte de anime.
