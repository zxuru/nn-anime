# Plan de tareas: la ficha de un anime (relacionados, hueco, modos y vistos)

Spec: `docs/specs/SPEC-anime-detail.md` · Estado: **implementado y medido** · 2026-10-12
Commits: T58 `4e68ff2`, T59 `7b587f0`, T60 `1ec44cd`, T61 `382cbdb`, T62 `a18acea`.

Origen: con la captura de «Sousou no Frieren» delante, cuatro cosas se ven a la vez. No hay
relacionados —ver la segunda temporada no lleva a la primera—; la columna de texto lleva
`max-width: var(--measure)` dentro de media pantalla, así que a la derecha quedan cientos de píxeles
muertos y los episodios se apilan en una tira estrecha; el botón de modo marcado se pinta con el
acento de fondo **y** con la sombra dura del acento, que se lee como un botón duplicado; y nada
dice qué episodio ya se vio, aunque `watch_event.finished` exista desde la primera migración y
nadie lo escriba.

Rige el mismo **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios marcados y medidos, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin tests saltados,
tope de cinco archivos de implementación por task y commit atómico que cita el task.

Cinco tareas: T58 a T62. Ninguna toca `provider-sdk`, `provider-core`, `media-proxy`, `recsys` ni
`providers-fixture`.

**T57 queda reservado** para el arreglo en curso de la duración del progreso, que ya está en el
árbol sin commitear. T59 depende de él: sin `durationS` guardada no hay proporción que comparar.

## Architecture Decisions

1. **Los relacionados son una heurística local y se llama así.** El proveedor no declara relaciones
   y no hay ni un plugin que pudiera hacerlo, así que la comparación es de título base dentro del
   mismo proveedor, sobre lo que la base ya conoce. No se pide red para rellenar la sección: sería
   una petición por ficha abierta y el spec prohíbe la precarga especulativa. El límite —una fuente
   que nombre la secuela de otra forma no empareja— se declara en el spec y se ve en la interfaz
   cuando la sección queda vacía con su motivo.
2. **El título base se normaliza con una lista cerrada de marcadores.** «Quitar lo que parezca un
   número» convierte «86» en cadena vacía y «5-toubun no Hanayome» en «toubun no hanayome». Cada
   marcador tiene su prueba, y cada falso positivo conocido también.
3. **El visionado terminado se escribe donde ya había sitio.** `watch_event.finished` existe desde
   `0001-initial.sql`; esta entrega no añade columnas ni migración. El umbral vive en `core`
   (`FINISHED_RATIO`) porque lo leen el servidor que escribe y la interfaz que pinta, y dos umbrales
   harían que un episodio saliera «visto» en la ficha y siguiera en «continuar viendo».
4. **Una consulta por lectura, no por fila.** Los relacionados salen de una lectura del proveedor y
   los vistos de una sola consulta con `GROUP BY`; el spec de `catalog-store` prohíbe el patrón
   «una consulta por fila» y en una temporada de 24 se nota.
5. **Los relacionados no son recomendaciones.** Mezclar el motor de `recsys` aquí haría que la
   sección significara dos cosas a la vez —saga y parecido— y ninguna de las dos con claridad.
6. **La sombra dura del botón activo deja de ser del color del relleno.** Token nuevo
   `--shadow-hard-pressed` (crema en oscuro, tinta en claro): la lengua visual es la misma —sombra
   desplazada sin desenfoque— y el botón vuelve a leerse como uno.

## T58 — `core`: título base, umbral y las dos formas

**Qué:** `baseTitle` con sus pruebas (un caso por marcador y uno por falso positivo), la constante
`FINISHED_RATIO`, el tipo `WatchedEpisode` y los schemas `relatedResponseSchema` y
`watchedResponseSchema`.

**Por qué:** es la pieza pura de las dos mitades —lo comparten el servidor y la interfaz— y la que
se puede medir sin base ni navegador.

**Archivos:** `packages/core/src/titles.ts`, `packages/core/src/titles.test.ts`,
`packages/core/src/api.ts`, `packages/core/src/index.ts`.

**Aceptación:**
- [x] `baseTitle('Sousou no Frieren 2nd Season')` es `'sousou no frieren'`; mutar la lista para
      quitar `2nd season` rompe la prueba. Medido en `packages/core/src/titles.test.ts`.
- [x] `baseTitle('86')` es `'86'`; normalizar dígitos sueltos la rompe.
- [x] `baseTitle('Bleach: Thousand-Year Blood War Part 2')` es `'bleach thousand year blood war'`.
- [x] `watchedResponseSchema` rechaza una proporción fuera de `[0, 1]`
      (`packages/core/src/api.test.ts`).

**Depende de:** —. **Tamaño:** S.

## T59 — `catalog-store`: relacionados y vistos

**Qué:** `listRelated` (una lectura del proveedor, normalización en memoria, orden por cercanía de
año, exclusión de la propia referencia) y `listWatchedEpisodes` (una consulta con `GROUP BY` por
episodio, la fila más avanzada). `updateWatchPosition` escribe `finished` con `FINISHED_RATIO`.

**Por qué:** la fachada es el único punto de lectura y escritura; la regla del umbral vive junto a
la escritura que la aplica.

**Archivos:** `packages/catalog-store/src/repositories/related.ts`,
`packages/catalog-store/src/repositories/watched-episodes.ts`,
`packages/catalog-store/src/repositories/watch.ts`, `packages/catalog-store/src/store.ts`,
`packages/catalog-store/src/index.ts`.

**Aceptación:**
- [x] Con «Frieren» y «Frieren 2nd Season» en la base, `listRelated` de la segunda devuelve la
      primera y nunca a sí misma (`related.test.ts`).
- [x] `listRelated` resuelve con **una** consulta preparada (contador de consultas, como en
      `user.test.ts`).
- [x] Con dos visionados del mismo episodio, `listWatchedEpisodes` devuelve el más avanzado y una
      sola fila (`watched-episodes.test.ts`).
- [x] `updateWatchPosition` con 90 % deja `finished = 1`; con 89 %, `0`.
- [x] **No hizo falta columna nueva**: se usa `watch_event.finished`, que existía desde la primera
      migración y nadie escribía.

**Depende de:** T58, T57 (la duración llega al servidor). **Tamaño:** M.

## T60 — `server`: las dos rutas y el umbral

**Qué:** `GET /api/anime/:providerId/:ref/related` y `GET /api/anime/:providerId/:ref/watched`,
ambas locales y sin `X-Cache`. `GET /api/watch/recent` cambia su ventana de proporción por
`finished`, y deja de tener su propio `MAX_CONTINUE_RATIO`.

**Por qué:** las proporciones las calcula el servidor para que dos pantallas no pinten la misma
barra con valores distintos; con dos umbrales, una de las dos miente.

**Archivos:** `packages/server/src/routes/detail.ts` —las dos rutas comparten la única decisión que
hay que tomar, que el proveedor exista, y separarlas duplicaba esa comprobación—,
`packages/server/src/routes/detail.test.ts`, `packages/server/src/routes/watch.ts`,
`packages/server/src/app.ts`.

**Aceptación:**
- [x] Las dos rutas son locales: sin proveedores cargados contestan 404 y no tocan la red
      (`detail.test.ts`).
- [x] Un proveedor desconocido sigue siendo 404; una referencia sin fila en la base, lista vacía.
- [x] Un episodio al 96 % **no** sale en `/api/watch/recent`; al 50 %, sí. Medido mutando: quitar
      `!fila.finished` del filtro deja en rojo la prueba del terminado.

**Depende de:** T59. **Tamaño:** M.

## T61 — `web`: la ficha en dos columnas y los relacionados

**Qué:** `.detail` con barra lateral y columna principal; la sinopsis conserva su medida; los
relacionados como fila de tarjetas-enlace con su hueco explicado; el token
`--shadow-hard-pressed` y su uso en el botón activo.

**Por qué:** es el hueco que el usuario señala con el dedo y el color que se repite.

**Archivos:** `packages/web/src/features/detail/DetailPage.tsx`,
`packages/web/src/features/detail/RelatedList.tsx`, `packages/web/src/features/detail/useDetail.ts`,
`packages/web/src/styles/{tokens,shell}.css`, `packages/web/src/i18n/es.ts`.

**Aceptación:**
- [x] La ficha, con relacionados, los pinta como enlaces que llevan a su ficha; sin ellos, dice por
      qué no hay. Medido mutando: sin el estado vacío cae la prueba del hueco explicado.
- [x] El bloque de la sinopsis conserva `max-width: var(--measure)`; el de episodios, no
      (`.detail__body` ya no impone la medida).
- [x] El botón activo no lleva el acento en fondo y sombra a la vez (`--shadow-hard-pressed`), y
      sigue con `aria-pressed`.

**Depende de:** T60. **Tamaño:** M.

## T62 — `web`: el episodio visto en la lista

**Qué:** `EpisodeList` pinta «visto» con la palabra y la barra de progreso del que está a medias;
`useDetail` pide el estado de visionado junto al resto; las claves nuevas en `es.ts`.

**Por qué:** es lo que convierte la lista en un índice de lo que queda pendiente.

**Archivos:** `packages/web/src/features/detail/EpisodeList.tsx`,
`packages/web/src/features/detail/detail.test.tsx`, `packages/web/src/i18n/es.ts`,
`packages/web/src/features/detail/useDetail.ts`.

**Aceptación:**
- [x] Un episodio con `finished: true` sale con la palabra «visto»; uno al 40 %, con su barra; uno
      sin duración, con ninguna de las dos (`detail.test.tsx`).
- [x] Medido mutando: sin la marca de terminado caen las dos pruebas de «visto».
- [x] La lista marca el episodio, no el modo: el mismo número visto en sub se ve marcado también
      con la lista en dub.

**Depende de:** T60. **Tamaño:** S.

## Dependencias

```
T57 ─┐
T58 ─┴─ T59 ── T60 ─┬─ T61
                    └─ T62
```

| Task | Depende de |
|---|---|
| T58 | — |
| T59 | T58, T57 |
| T60 | T59 |
| T61 | T60 |
| T62 | T60 |

Camino crítico: T57 → T59 → T60 → T61.

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | La heurística empareja títulos que no son la misma saga | Lista cerrada de marcadores, pruebas por falso positivo conocido (`86`, `5-toubun`) y la sección vacía explicada en vez de rellenada |
| 2 | Sembrar «Relacionados» con recomendaciones para que nunca esté vacía | El spec lo prohíbe por escrito: una razón de `recsys` no es una relación |
| 3 | El árbol trae el arreglo de la duración sin commitear y mi commit se lo lleva | Los commits van **con la lista de rutas**; el arreglo ajeno se commitea aparte, como su propio task, y el mensaje lo dice |
| 4 | Marcar terminado al 90 % a quien deja los créditos | Es la decisión tomada; el botón manual queda como pregunta abierta del spec, no como sorpresa |
| 5 | `listRelated` lee toda la tabla de un proveedor | Es la tabla de lo que el usuario ya abrió, no el catálogo entero; tope de candidatos en la lectura y límite en la respuesta |

## Fuera de este plan

- La capacidad `related` en el contrato de plugins: no hay ni un plugin que pudiera declararla.
- Marcar visto a mano y deshacerlo.
- Relacionados entre proveedores distintos.
- Un componente compartido de barra de progreso con la home.

## Nota de la entrega: dos sesiones sobre el mismo árbol

Otra sesión trabajó en el mismo árbol y **reescribió la historia dos veces** mientras esta entrega
estaba en curso. La primera dejó mi commit de T61 fuera de la rama (`382cbdb`, colgado); la segunda
lo devolvió a la rama pero dejó fuera el de T62 (`e1c17d6`), que sólo sobrevivió en el árbol de
trabajo. T62 se volvió a commitear como `a18acea`, con el mismo contenido ya medido: los commits van
con la lista de rutas, y el árbol se reconstruyó sobre `HEAD` con un **índice propio**
(`GIT_INDEX_FILE`) para no llevarse nada de la otra sesión.

Lo que **no** se pudo medir: el e2e. `bun run e2e` falla en el `setup` porque los navegadores de
Playwright no están instalados en esta máquina (`npx playwright install chromium`), así que las
pruebas de navegador de esta entrega quedan pendientes de quien tenga el navegador. `typecheck`,
`lint` de los paquetes tocados y las **1.078 pruebas** de `core`, `catalog-store`, `server` y `web`
están en verde.
