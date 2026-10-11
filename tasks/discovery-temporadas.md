# Plan de tareas: temporadas, franquicia y listas largas

Spec: `docs/specs/proposals/SPEC-anime-detail.temporadas.md` · Estado: **en curso** · 2026-10-11.

Decisiones del humano tomadas el 2026-10-11: rail de dos niveles (saga y después franquicia),
listas largas por ventanas y salto —sin arcos—, y los plugins rellenan `year` en la búsqueda.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios medidos por mutación, sin `any` ni `@ts-ignore` ni `as` para silenciar, tope de cinco
archivos de implementación por task y commit atómico que cita el task.

Medición de origen, sobre una copia de la base real: los relacionados de Dandadan **ya funcionan**
en HEAD (`jkanime/dandadan/related` devuelve la segunda temporada), así que la captura del usuario
era de un servidor anterior al merge de T65. Lo que falta es otra cosa: Naruto↔Shippuden y
Dragon Ball↔Z nunca se relacionan porque `sagaTitle` no los empareja; los resultados de búsqueda no
traen `year`; y la fila basura `jkanime|dandadan/12` demuestra que el reproductor deduce la
referencia del título con una sola convención cuando jkanime usa otra.

## T68 — `web`: el reproductor deja de deducir la referencia del título

**Qué:** `watchPath` escribe la referencia del título en la consulta (`?anime=`), la toma de
`Episode.animeRef` —dato que la ficha ya tiene—, y `animeRefOf` queda como último recurso para una
dirección escrita a mano, con las dos convenciones (`#N` y `slug/N`).

**Por qué:** pedir el detalle de `dandadan/12` escribió en la base real una fila con el `<title>` de
la página del episodio. La ficha de esa fila basura es lo que aparece en «Último añadido».

**Archivos:** `packages/web/src/features/player/watch-route.ts`,
`packages/web/src/features/player/WatchPage.tsx`,
`packages/web/src/features/detail/EpisodeList.tsx`, `packages/web/src/features/home/ContinueRow.tsx`
(si construye direcciones), `packages/web/src/features/player/watch-route.test.ts`.

**Aceptación:**
- [ ] `watchPath` con título escribe `?anime=`; sin él, no lo escribe.
- [ ] `animeRefOf('dandadan/12')` es `'dandadan'` y `animeRefOf('aurora-nocturna#3')` es
      `'aurora-nocturna'`; una referencia sin separador es su propio título.
- [ ] El visionado de un episodio de jkanime se registra contra `dandadan`, no contra `dandadan/12`.
      Medido mutando: volver a la versión de una sola convención deja la prueba en rojo.
- [ ] La dirección del reproductor sigue llevando **una** referencia de episodio: el título viaja
      aparte y no sustituye a la del stream.

**Depende de:** —. **Tamaño:** S.

## T69 — `core`: número de temporada, franquicia y el marcador que falta

**Qué:** `seasonNumberOf`, `franchiseTitle` y `film` en los marcadores de película.

**Por qué:** es la pieza pura que comparten el rail y el orden, y se mide sin base y sin navegador.

**Archivos:** `packages/core/src/titles.ts`, `packages/core/src/titles.test.ts`.

**Aceptación:**
- [ ] `seasonNumberOf('Sousou no Frieren 2nd Season')` es 2, el de «Shingeki no Kyojin Season 3
      Part 2» es 3 y el de «Overlord IV» es 4.
- [ ] `seasonNumberOf('One Piece')` es `undefined`: no se inventa un 1. Mutar `undefined` por 1 deja
      la prueba en rojo.
- [ ] `franchiseTitle('Naruto Shippuden')` es `'naruto'` y el de «Dragon Ball Z» es `'dragon'`.
- [ ] `sagaTitle('One Piece Film: Red')` es `'one piece'`; sin `film` en la lista, la prueba cae.
- [ ] Los falsos positivos declarados siguen en pie: `86`, `5-toubun no Hanayome`, `Final Fantasy
      VII`.

**Depende de:** —. **Tamaño:** S.

## T70 — `catalog-store` + `server`: el alcance de la lectura

**Qué:** `list(ref, limit, scope)` con `'saga'` por defecto y `'franchise'` como alternativa, el
orden `bySagaOrder` (número de temporada, después año, después estable) y el parámetro `?scope=` en
la ruta.

**Por qué:** la franquicia no es otra consulta: es la misma con otra comparación en memoria, y el
prefiltro por la primera palabra ya era el suyo.

**Archivos:** `packages/catalog-store/src/repositories/related.ts`,
`packages/catalog-store/src/repositories/related.test.ts`,
`packages/server/src/routes/detail.ts`, `packages/server/src/routes/detail.test.ts`,
`packages/catalog-store/src/store.ts`.

**Aceptación:**
- [ ] Sin `scope`, la lectura devuelve exactamente lo de hoy: ninguna llamada existente cambia.
- [ ] Con `'franchise'`, «Naruto Shippuden» sale para la ficha de «Naruto»; sin él, no.
- [ ] El orden es por número de temporada y, sin él, por año; dos llamadas seguidas dan el mismo
      orden.
- [ ] `?scope=basura` cae a `'saga'` y no devuelve 400.
- [ ] Sigue siendo **una** consulta preparada (contador de consultas).

**Depende de:** T69. **Tamaño:** M.

## T71 — `web`: el rail de temporadas y la franquicia

**Qué:** `SagaRail` en la ficha: Temporadas (kind tv), Películas y especiales, y «Más de esta
franquicia»; la entrega actual marcada y sin enlace; el hueco explicado.

**Archivos:** `packages/web/src/features/detail/SagaRail.tsx`,
`packages/web/src/features/detail/DetailPage.tsx`,
`packages/web/src/features/detail/useDetail.ts`, `packages/web/src/styles/shell.css`,
`packages/web/src/i18n/es.ts`.

**Aceptación:**
- [ ] Con dos temporadas, la sección las pinta ordenadas y marca la actual; medido mutando: sin la
      marca, la prueba cae.
- [ ] Las películas y los especiales van en su bloque y no intercalados con las temporadas.
- [ ] Una franquicia que no aporta ninguna entrega nueva no pinta su sección.
- [ ] Con una sola entrega conocida, el hueco se explica.

**Depende de:** T70. **Tamaño:** M.

## T72 — `web`: ventanas y salto en la lista de episodios

**Qué:** `EpisodeList` pinta de 100 en 100 con su control de ventana, un salto a número y el resumen
de vistos de la ventana visible; con 100 o menos, sin controles.

**Archivos:** `packages/web/src/features/detail/EpisodeList.tsx`,
`packages/web/src/features/detail/WindowPicker.tsx`,
`packages/web/src/features/detail/detail.test.tsx`, `packages/web/src/i18n/es.ts`,
`packages/web/src/styles/shell.css`.

**Aceptación:**
- [ ] Con 1180 episodios el DOM tiene 100 filas; medido mutando: sin el recorte, 1180.
- [ ] Con 100 episodios o menos no se pinta ningún control.
- [ ] El salto deja el foco en la fila del episodio pedido y no cambia el modo elegido.
- [ ] El resumen de vistos cuenta la ventana visible, no el título entero.

**Depende de:** T71. **Tamaño:** M.

## Dependencias

```
T68 ─────────────────────────── (independiente)
T69 ── T70 ── T71 ── T72
```

Camino crítico: T69 → T70 → T71 → T72.

## Fuera de este plan

- Limpiar de la base las filas basura ya escritas: merece su propia medición (Open Question 1 del
  spec).
- Arcos declarados por el plugin o tabla de arcos en el repositorio: decidido no.
- Un componente de rail compartido entre la ficha y la home.
