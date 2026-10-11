# Plan de tareas: descubrimiento en frío (post-v1)

Spec: `docs/specs/SPEC-discovery.md` · Estado: **para revisión humana** · 2026-10-11

Origen: la home sólo enseña contenido si el usuario buscó antes. Los candidatos del motor salen de
la tabla `anime` —que se escribe al abrir un detalle, no al buscar— y la única fuente que no
depende del usuario es `getTrending`, que es opcional. Se añaden dos caminos: **lo último que la
aplicación ya conoce** y **lo que la fuente publica en su feed**, para los proveedores que lo
declaren.

Rige el mismo **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios marcados y medidos, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin tests saltados,
tope de cinco archivos de implementación por task y commit atómico que cita el task.

Siete tareas: T48, T48a, T49, T49a, T50, T51 y T52. Ninguna toca `recsys` ni `media-proxy`.

## Architecture Decisions

1. **La capacidad es `feed`, no «rss», y vive en el plugin.** La fuente y su formato los conoce
   quien escribe el plugin; la aplicación sólo pide «novedades» y recibe referencias. Llamarla
   `rss` ataría el contrato a un formato, y un proveedor sin RSS pero con una lista de novedades
   propias no podría declararla.
2. **La aplicación no descarga el feed.** Lo descarga el plugin, que ya se ejecuta con los permisos
   del usuario y sin sandbox. Así no aparece una ruta que salga a una URL que venga de un ajuste, ni
   un destino nuevo para la lista blanca del proxy.
3. **La fecha de publicación es lo que hace útil un feed, y por eso es parte del contrato.** Sin
   ella, un feed es una lista de tendencias con otro nombre; con ella, la fila de novedades se puede
   ordenar por lo último y deja de ser una promesa del plugin.
4. **Las entradas del feed no puntúan en el motor.** Los `reason.kind` son contrato de `recsys` y
   ninguno describe «lo publicó la fuente». Meterlas con `trending` sería mentir en la razón, que es
   justo lo que el motor existe para no hacer.
5. **Dos fuentes locales, una fila.** «Último añadido» une lo abierto y lo encontrado por una
   búsqueda: son la misma cosa para quien lee la página —lo que la aplicación conoce— y separarlos
   en dos filas sería pedirle al usuario que entienda la diferencia entre `anime` y `search_cache`.

## T48 — `core` y `provider-sdk`: la capacidad `feed` y `getFeed`

**Descripción:** Añadir al contrato la lista de novedades de una fuente, sin romper a ningún plugin
ya instalado.

**Aceptación:**
- [ ] `providerCapabilitiesSchema.feed` es `z.boolean().default(false)`: un manifiesto **sin** el
      campo parsea y queda en `false`.
- [ ] `FeedEntry extends SearchResult` con `publishedAt?: string` validado como ISO-8601.
- [ ] `Provider.getFeed?(options): Promise<readonly FeedEntry[]>` y `OPTIONAL_PROVIDER_METHODS`
      incluye `'getFeed'`.
- [ ] `RESPONSE_SCHEMAS.getFeed` valida `readonly FeedEntry[]`; una fecha que no es ISO se rechaza
      nombrando el campo.
- [ ] `assertConforms` rechaza «declara `capabilities.feed` y no implementa `getFeed`», y con la
      capacidad en `false` no lo exige.
- [ ] `PROVIDER_API_VERSION` sigue en `'1'`, con una prueba que lo fija: la compatibilidad hacia
      atrás es una decisión, no una casualidad.

**Verificación:** `bun test packages/core packages/provider-sdk`. Medido mutando la
implementación: sin el valor por defecto falla 1 (el manifiesto viejo se rechaza), sin la
comprobación de conformidad 1 y admitiendo una fecha no ISO 1. Control: 0 fallos.

**Depende de:** ninguno.

**Archivos:** `packages/core/src/schema.ts`, `packages/provider-sdk/src/{types.ts,schema.ts,conformance.ts}`.
**Ampliación declarada:** las pruebas de cada uno, el barril de `provider-sdk` con su prueba de
exportaciones (que enumera lo exportado y falla si falta algo) y el barril de `core` si hace falta
exportar el tipo.

**Tamaño:** S.

---

## T48a — Fixture: un feed de prueba con fecha

**Descripción:** Que el único proveedor del repositorio declare `feed` e implemente `getFeed`, para
poder verificar el camino entero sin red.

**Aceptación:**
- [ ] El fixture declara `capabilities.feed: true` e implementa `getFeed` con entradas inventadas y
      `publishedAt` en ISO.
- [ ] `failures.feed` acepta los cuatro modos de fallo que ya existen (`http500`, `http404`,
      `throws`, `timeout`) y `latencyMs` se respeta como en los demás métodos.
- [ ] `calls.count('feed')` cuenta las llamadas, que es lo que permite afirmar «la segunda carga no
      volvió a pedir el feed».
- [ ] La prueba de conformidad del fixture comprueba las capacidades **completas**, con `feed`
      incluido.

**Verificación:** `bun test packages/providers-fixture`. Medido mutando: sin `feed: true` en el
fixture falla la prueba de capacidades, y devolviendo una fecha no ISO falla la validación.

**Depende de:** T48.

**Archivos:** `packages/providers-fixture/src/{data.ts,index.ts}`.
**Ampliación declarada:** `packages/providers-fixture/src/{fixture.test.ts,conformance.test.ts}`.

**Tamaño:** S.

---

## T49 — `catalog-store`: caché del feed

**Descripción:** Guardar el feed por proveedor, con su TTL, para que la segunda carga de la home no
vuelva a pedirlo.

**Aceptación:**
- [ ] Migración `0006-feed-cache.sql` con la tabla `feed_cache`, aplicada por el runner y por
      `bun run db:migrate`.
- [ ] `TTL_SECONDS.feed = 1800`, con su comentario, en `cache-policy.ts`.
- [ ] `readFeed` devuelve `null` sin fila y un `CacheHit` con `fetchedAt`, `ttlS` y `stale` con el
      reloj inyectado.
- [ ] `writeFeed` reemplaza la fila del proveedor y `readFeed` la relee con sus fechas.
- [ ] Un `results_json` que no cumple el schema lanza `StoreError` con `op: 'readFeed'`, no una
      excepción de parseo sin contexto.
- [ ] La tabla es propia y no una clave reservada dentro de `search_cache` ni de `trending_cache`.

**Verificación:** `bun test packages/catalog-store`. Medido mutando: sin validar el JSON cacheado
falla 1, sin el TTL propio 1 y sin el `ON CONFLICT` 1 (la segunda escritura no reemplaza). Control:
0 fallos.

**Depende de:** T48.

**Archivos:** `packages/catalog-store/src/migrations/0006-feed-cache.sql`,
`packages/catalog-store/src/cache-policy.ts`, `packages/catalog-store/src/repositories/feed.ts`,
`packages/catalog-store/src/store.ts`.
**Ampliación declarada:** `packages/catalog-store/src/{repositories/repositories.test.ts,db.test.ts}`
y el barril del paquete.

**Tamaño:** S.

---

## T49a — `catalog-store`: lo último que la aplicación conoce

**Descripción:** Una lectura que une lo abierto y lo encontrado por una búsqueda, del más nuevo al
más viejo.

**Aceptación:**
- [x] `listRecentSummaries(limit)` une `anime` y `search_cache` y deduplica por referencia,
      quedándose con la marca `fetched_at` **más nueva** de las dos.
- [x] El orden es descendente por esa marca y el `limit` se respeta.
- [x] Una entrada de `search_cache` **caducada cuenta igual**: la fila dice «lo que la aplicación
      conoce», no «lo fresco», y esconder lo que ya está en disco sería justo lo contrario.
- [x] Un resultado de búsqueda sin `coverUrl` no inventa el campo, y una fila de `anime` sin año
      tampoco.
- [x] `search_cache` con un JSON que no cumple el schema no rompe la lectura entera: se salta esa
      fila.

**Verificación:** `bun test packages/catalog-store` · 174 pruebas. Medido mutando: sin el `GROUP BY`
falla 1, sin el `MAX` 1, con el orden ascendente 2, sin `json_valid` 1 —`json_each` lanzaría—, sin
descartar las filas sin forma 1 y sin validar el `kind` 2. Control: 0 fallos.

**Depende de:** T49.

**Archivos:** `packages/catalog-store/src/repositories/recent.ts`, `packages/catalog-store/src/store.ts`.
**Desvío declarado:** la lectura vive en **`recent.ts`** y no en `anime.ts` como decía este plan: no
es una lectura de una tabla, cruza `anime` y `search_cache`, y meterla en el repositorio del anime
obligaría a ese módulo a saber cómo está guardada una búsqueda. Además se **quitó una línea** al
medirla: el `replace` que quitaba comillas del `kind` no hacía nada, porque `json_extract` devuelve
los escalares sin comillas.
**Ampliación declarada:** `packages/catalog-store/src/store.test.ts` y
`packages/catalog-store/src/repositories/repositories.test.ts`.

**Tamaño:** S.

---

## T50 — `server`: las dos rutas y los candidatos de la caché de búsqueda

**Descripción:** Servir `/api/feed` y `/api/catalog/recent`, y hacer que una búsqueda sin detalle
abierto ya alimente al motor.

**Aceptación:**
- [ ] `GET /api/feed?limit=` sólo consulta a proveedores con `capabilities.feed` **y** `getFeed`;
      sin ninguno, devuelve `items: []` y 200, no un error.
- [ ] La segunda petición **no vuelve a llamar** al proveedor: lo verifica el contador del fixture.
- [ ] Orden: `publishedAt` descendente y las entradas sin fecha al final, en el orden de la fuente;
      dedup por `providerId#value`.
- [ ] Un proveedor que falla o tarda devuelve lista vacía y la fila de los demás se sirve igual.
- [ ] Tope de **200 entradas por proveedor**, recortado **antes** de escribir en la caché.
- [ ] `GET /api/catalog/recent?limit=` devuelve lo de T49a sin duplicados y con su tope.
- [ ] Los candidatos del motor incluyen los títulos de `search_cache` con sus tags del corpus
      cacheado cuando el título ya está en `anime`: con una búsqueda y sin ningún detalle abierto,
      el destacado y el top 5 dejan de estar vacíos.
- [ ] Las dos rutas quedan detrás de los guards y aparecen en el barrido de rutas protegidas de
      `tests/seguridad.test.ts`.
- [ ] La plantilla de Ajustes (`provider-template.ts`) genera manifiestos con `feed: false`.

**Verificación:** `bun test packages/server packages/core tests/seguridad.test.ts`. Medido mutando:
sin la caché del feed fallan 2 (la segunda petición llama dos veces), sin el tope de 200 1, sin el
dedup 1, ordenando por llegada en vez de por fecha 2 y sin los candidatos de `search_cache` 1.
Control: 0 fallos.

**Depende de:** T48a, T49, T49a.

**Archivos:** `packages/core/src/api.ts`, `packages/server/src/routes/discovery.ts`,
`packages/server/src/app.ts`, `packages/server/src/provider-template.ts`,
`packages/server/src/recommend/signals.ts`.
**Ampliación declarada:** las pruebas de la ruta nueva, `packages/server/src/app.test.ts`,
`packages/server/src/provider-template.test.ts` y la nota del encabezado de `signals.ts`, que hoy
dice «no llama a ningún proveedor» y sigue siendo verdad.

**Tamaño:** M.

---

## T51 — `web`: Novedades, Último añadido y un destacado con reserva

**Descripción:** Las dos filas nuevas en la home, con su estado vacío, y que el destacado no se
quede en blanco cuando el motor no tiene nada que decir.

**Aceptación:**
- [ ] Fila **Novedades** con su meta y su estado vacío («ningún proveedor activo publica novedades»),
      y fila **Último añadido** con el suyo.
- [ ] El destacado cae a `feed[0]` y después a `recent[0]` cuando las recomendaciones vienen vacías;
      sin ninguna de las tres, el `h1` con el título de la página sigue ahí.
- [ ] `useHomeRows` pide las cinco rutas en paralelo y sólo declara error si **todas** fallan; que
      una falle no borra las otras.
- [ ] La fila de novedades no reordena: el orden lo decide el servidor, que es una sola fuente de
      verdad para las dos pantallas.
- [ ] Ajustes muestra «novedades» cuando el proveedor declara la capacidad.
- [ ] Las portadas de las filas nuevas pasan por la guarda de `safeUrl` (T31a) **sin tocar la
      guarda**: la comprobación por texto las cubre por construcción.

**Verificación:** `bun test packages/web`. Medido mutando: sin el fallback del destacado fallan 2,
si una fila fallida borra las demás 1, sin el estado vacío 1 y reordenando en el cliente 1.
Control: 0 fallos. `bun run build` confirma que el trozo de la home no crece con `hls.js`.

**Depende de:** T50.

**Archivos:** `packages/web/src/features/home/useHomeRows.ts`,
`packages/web/src/features/home/FeedRow.tsx`, `packages/web/src/features/home/RecentRow.tsx`,
`packages/web/src/features/home/HomePage.tsx`, `packages/web/src/features/settings/ProviderList.tsx`.
**Ampliación declarada:** `packages/web/src/i18n/es.ts` (el texto no es implementación, igual que en
T41), `packages/web/src/features/home/home.test.tsx`, `layout.test.tsx` y
`packages/web/src/features/settings/settings.test.tsx`.

**Tamaño:** M.

---

## T52 — Documentación y e2e del arranque en frío

**Descripción:** Que otro pueda implementar `getFeed` sin leer el código, y que el caso «la home
tiene contenido sin buscar» se pruebe en un navegador.

**Aceptación:**
- [ ] `docs/providers.md`: `getFeed` en la tabla del contrato y en el ejemplo comentado, con la nota
      de que el parseo del XML es del plugin y de que el ejemplo **no** lleva lógica de scraping
      real.
- [ ] `README.md`: las dos filas nuevas en la descripción de la home y la nota de la parrilla
      semanal matizada —el feed da fecha de publicación, no de emisión—.
- [ ] Caso e2e: con el fixture (que declara `feed`), la home muestra **Novedades sin ninguna
      búsqueda previa**, sin tocar la red externa ni `$XDG_*` reales.
- [ ] Las pruebas de documentación siguen pasando: los comandos citados existen y los documentos
      enlazados están.

**Verificación:** `bun run e2e` (el caso nuevo, verde en tres pasadas) y `bun test packages/web`
(las pruebas de documentación). Medido mutando: quitando la fila de la home falla el caso e2e.

**Depende de:** T51.

**Archivos:** `README.md`, `docs/providers.md`, `packages/web/e2e/home.e2e.ts`.
**Ampliación declarada:** `packages/web/src/docs.test.ts` si la lista de documentos crece.

**Tamaño:** S.

---

## Dependencias

```
T48 ─┬─ T48a ─┐
     ├─ T49 ──┼─ T50 ── T51 ── T52
     └─ T49a ─┘
```

| Task | Depende de |
|---|---|
| T48 | — |
| T48a | T48 |
| T49 | T48 |
| T49a | T49 |
| T50 | T48a, T49, T49a |
| T51 | T50 |
| T52 | T51 |

Camino crítico: T48 → T49 → T49a → T50 → T51 → T52.

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Un plugin ya instalado deja de cargar porque su manifiesto no declara `feed` | El campo lleva `default(false)` y hay una prueba con un manifiesto viejo. La versión del contrato no sube |
| 2 | Un feed enorme llena la base y la home pinta mil tarjetas | Tope de 200 entradas por proveedor antes de cachear, con prueba |
| 3 | Un plugin que declara `feed` y no lo implementa rompe la home | Se rechaza con su motivo en el test de conformidad, igual que `trending`; la fila explica el hueco |
| 4 | La fila «Último añadido» parece un historial de vigilancia | Es una lectura local de lo que ya está en la base del usuario y nada sale del proceso; el README ya declara que no hay servidor central ni telemetría |
| 5 | El feed mete en el motor razones que no le corresponden | El feed no entra al motor en esta entrega; el destacado sale de la fila, no de una razón inventada |

## Fuera de este plan

- `reason.kind = 'feed'` en `recsys`: otra entrega, con su spec.
- Parrilla semanal y fila de episodios nuevos por episodio: siguen fuera, porque el feed da fecha
  de publicación del título, no de emisión.
- `feed` en el asistente de Ajustes: un RSS necesita parseo XML, y la plantilla genera rutas JSON.
