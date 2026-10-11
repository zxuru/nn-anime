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
- [x] `seasonNumberOf('Sousou no Frieren 2nd Season')` es 2, el de «Shingeki no Kyojin Season 3
      Part 2» es 3 y el de «Overlord IV» es 4.
- [x] `seasonNumberOf('One Piece')` es `undefined`: no se inventa un 1. Mutar `undefined` por 1 deja
      la prueba en rojo.
- [x] `franchiseTitle('Naruto Shippuden')` es `'naruto'` y el de «Dragon Ball Z» es `'dragon ball'`.
- [x] `sagaTitle('One Piece Film: Red')` es `'one piece'`; sin `film` en la lista, la prueba cae.
- [x] Los falsos positivos declarados siguen en pie: `86`, `5-toubun no Hanayome`, `Final Fantasy
      VII`.

**Estado:** hecho, pero **bajo el id T70**: el reclamo de T69 lo tenía otra sesión —trabajando en
`packages/web/src/features/player`, justo los archivos de T68— cuando esta entrega llegó a él. Los
ids no se reescriben; el trabajo va donde hay sitio y se declara.

**Depende de:** —. **Tamaño:** S.

## T70 — `core` + `catalog-store` + `server`: las claves y el alcance

**Qué:** lo de T69 —que no se pudo reclamar— más `list(ref, limit, scope)` con `'saga'` por defecto y
`'franchise'` como alternativa, y el parámetro `?scope=` en la ruta.

**Por qué:** la franquicia no es otra consulta: es la misma con otra comparación en memoria, y el
prefiltro por la primera palabra de la saga ya cubre la franquicia.

**Decisión corregida al implementar:** el orden **no** cambia. Sigue siendo `byYearProximity`, el de
hoy; ordenar por número de temporada es presentación y vive en el rail (T71), que es quien tiene el
título, el año y el tipo de cada entrega. Moverlo a la lectura habría cambiado el orden de la
sección de relacionados ya aprobada para ganar nada.

**Archivos:** `packages/core/src/titles.ts`, `packages/core/src/index.ts`,
`packages/catalog-store/src/repositories/related.ts`, `packages/catalog-store/src/store.ts`,
`packages/server/src/routes/detail.ts`.

**Aceptación:**
- [x] Sin `scope`, la lectura devuelve exactamente lo de hoy: ninguna llamada existente cambia.
- [x] Con `'franchise'`, «Naruto Shippuden» sale para la ficha de «Naruto»; sin él, no.
- [x] La franquicia contiene a la saga: la segunda temporada sale en los dos alcances, y quitarla de
      la sección de franquicia es trabajo del rail.
- [x] `?scope=basura` cae a `'saga'` y no devuelve 400.
- [x] Sigue siendo **una** consulta preparada (contador de consultas).

**Depende de:** —. **Tamaño:** M.

## T71 — `web`: el rail de temporadas y la franquicia

**Qué:** `SagaRail` en la ficha: Temporadas (kind tv), Películas y especiales, y «Más de esta
franquicia»; la entrega actual marcada y sin enlace; el hueco explicado.

**Archivos:** `packages/web/src/features/detail/SagaRail.tsx`,
`packages/web/src/features/detail/DetailPage.tsx`,
`packages/web/src/features/detail/useDetail.ts`, `packages/web/src/styles/shell.css`,
`packages/web/src/i18n/es.ts`.

**Aceptación:**
- [x] Con dos temporadas, la sección las pinta ordenadas y marca la actual; medido mutando: sin la
      marca, la prueba cae.
- [x] Las películas y los especiales van en su bloque y no intercalados con las temporadas.
- [x] Una franquicia que no aporta ninguna entrega nueva no pinta su sección.
- [x] Con una sola entrega conocida, el hueco se explica.

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
T70 ── T71 ── T72
```

Camino crítico: T70 → T71 → T72.

## Fuera de este plan

- Limpiar de la base las filas basura ya escritas: merece su propia medición (Open Question 1 del
  spec).
- Arcos declarados por el plugin o tabla de arcos en el repositorio: decidido no.
- Un componente de rail compartido entre la ficha y la home.
