# Roadmap de nn-anime

> Documento de origen de la fase siguiente a la v0.3.1. Lo escribió el humano y lo adopta el
> repositorio aquí. La adaptación al estado **medido** —qué de la fase 0 ya está hecho y qué falla
> de verdad— está en `docs/diagnostico-peliculas-series.md` y `tasks/roadmap.md`.
>
> **Estado:** fase 0 abierta. La tarea 0.1 (diagnóstico) está cerrada; las demás, pendientes.
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

- Ver anime funciona de forma decente: home, top (AniList), parrilla de estrenos, novedades,
  continuar viendo, favoritos, búsqueda, reproductor HLS (hls.js) y `mpv` opcional.
- **Falla con series no anime de varias temporadas.** El conmutador de tipo (`?tipo=movies`) y
  `capabilities.media` (`anime` | `movies` | `both`) ya existen. El diagnóstico de 0.1
  (`docs/diagnostico-peliculas-series.md`) midió que la película y la serie de una temporada
  funcionan, y que el fallo está en la serie multi-temporada cuando la fuente numera por temporada:
  el número de episodio se usa como identidad y se repite en cada temporada.
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
  amenaza en `SECURITY.md`.
- **Los plugins se ejecutan sin sandbox**, con los permisos del usuario. No ampliar su superficie
  sin necesidad.
- **AniList:** respetar sus términos (lista blanca de hosts, 1 petición cada 2 s, caché con TTL, no
  acaparar datos). `NN_ANIME_ANILIST_OFFLINE=1` debe seguir funcionando en las pruebas.
- Compatibilidad hacia atrás del contrato de plugin: `capabilities.media` ausente significa anime.

## 3. Resumen y prioridades

Leyenda: **P0** base bloqueante · **P1** alto valor · **P2** valor medio o riesgo alto · **P3**
posterior. Esfuerzo: S (días) · M (1-2 semanas) · L (varias semanas) · XL (un mes o más).

| Fase | Tema | Prioridad | Esfuerzo | Depende de | Encaja con la arquitectura local |
|------|------|-----------|----------|------------|----------------------------------|
| 0 | Estabilizar películas y series + modelo de medios | P0 | M | n/a | Total |
| 1 | Descargas para ver sin conexión | P1 | L | 0 | Total (todo en el equipo del usuario) |
| 2A | Manga: lectura | P1 | XL | 0 | Total |
| 2B | Manga: descarga | P2 | M | 1, 2A | Total |
| 3 | Watch party | P2 | XL | 0 (idealmente 1) | Baja: choca con «sin servidor central» |

**Por qué este orden:**

- La fase 0 es obligatoria antes de todo: manga añade un tercer tipo de medio, y si el modelo no se
  generaliza primero habrá que rehacerlo dos veces.
- Las descargas van antes que manga porque construyen el **motor de descargas genérico** (cola,
  reanudación, disco) que luego reutiliza la descarga de manga.
- Watch party va al final por riesgo: es la única función que obliga a abrir la red, y la app
  promete lo contrario. Puede desarrollarse en paralelo tras la fase 0 si hay capacidad, porque no
  depende de descargas ni de manga.

```
Fase 0 ──┬── Fase 1 ──┬── Fase 2B
         ├── Fase 2A ─┘
         └── Fase 3 (independiente; mejora si existe la fase 1)
```

## 4. Fases y tareas

### Fase 0: Estabilizar películas/series y generalizar el modelo (P0, M)

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

### Fase 1: Descargas para visualización local (P1, L)

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

### Fase 2A: Sección de manga, lectura (P1, XL)

**Objetivo:** buscar, abrir y leer manga con progreso guardado.

| ID | Tarea | Prioridad | Criterios de aceptación |
|----|-------|-----------|-------------------------|
| 2.1 | Spec `docs/specs/SPEC-manga.md` (modelo, contrato, lector, descargas) | P1 | Spec revisada antes de codificar |
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

### Fase 3: Watch party (P2, XL, riesgo alto)

**Principio:** se sincroniza **solo el estado de reproducción**, nunca el vídeo. Cada participante
reproduce desde su propio plugin o desde su copia local. Nunca se comparten tickets del proxy ni
URLs de streams.

| ID | Tarea | Prioridad | Criterios de aceptación |
|----|-------|-----------|-------------------------|
| 3.1 | Spec `docs/specs/SPEC-watch-party.md` con modelo de amenaza (qué se abre, a quién, durante cuánto tiempo) y actualización de `SECURITY.md` | P2 | Spec revisada; riesgos y mitigaciones explícitos |
| 3.2 | Protocolo y tipos en `core`: unirse, salir, estado (`mediaId`, `episodeId`, posición, pausa, velocidad, marca de tiempo), búsqueda de posición, «listo». El anfitrión es la autoridad; corrección de deriva (tolerancia aprox. 0,5 s, ajustar velocidad o saltar) | P2 | Pruebas con reloj y latencia simulados |
| 3.3 | Modo LAN (MVP): el anfitrión abre una sala, los invitados entran con IP:puerto + código. Opt-in explícito con aviso en la UI; token de sala con caducidad | P2 | No se expone nada en red si el usuario no activa la función; prueba de que sin el token no se entra |
| 3.4 | Modo remoto sin servidor central: ver decisión **D3** | P2 | Dos instancias en redes distintas se sincronizan |
| 3.5 | Interfaz: crear o unirse a sala, lista de participantes, indicador de sincronización, «esperar a todos», control solo del anfitrión o compartido | P2 | e2e con dos clientes simulados |
| 3.6 | Coincidencia de contenido: resolver el título por identificador común (AniList u otro) y avisar si algún participante no tiene una fuente para él | P2 | Mensaje claro, sin bloquear al resto |
| 3.7 | Chat y reacciones | P3 | Opcional, después de 3.5 |

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
| D2 | Formato de descarga HLS | Guardar playlist y segmentos y servirlos desde el proxy local, o remux a MP4 con ffmpeg opcional | Empezar con segmentos locales (sin dependencias nuevas); ffmpeg opcional después |
| D3 | Transporte de watch party remoto | WebRTC con señalización manual (copiar y pegar un código), relay autohospedable opcional, o túnel del propio usuario | WebRTC con señalización manual: respeta «sin servidor central» |
| D4 | Orden entre manga y watch party | Manga primero o watch party primero | Manga primero, por riesgo y por reutilizar el motor de descargas |
| D5 | Formato de manga offline | CBZ (zip de imágenes, opcionalmente con `ComicInfo.xml`) o carpeta de imágenes | CBZ: un archivo por capítulo, interoperable con otros lectores |

## 7. Definición de terminado de una fase

- Todas sus tareas P0/P1 cumplen sus criterios de aceptación.
- `typecheck`, `lint`, `bun test`, `e2e` y `coverage:gate` en verde en CI.
- Spec, `SECURITY.md`, README y guía de plugins actualizados.
- Release candidata empaquetada para las tres plataformas sin regresiones en la parte de anime.
