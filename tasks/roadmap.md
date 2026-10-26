# Plan de tareas: roadmap post-v0.3.1

Origen: `docs/roadmap.md` · Estado: **fase 0 abierta, 0.1 cerrada** · 2026-10-26.
Diagnóstico que reordena la fase 0: `docs/diagnostico-peliculas-series.md`.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios marcados y medidos, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin tests saltados,
tope de cinco archivos de implementación por task y commit atómico que cita el task.

## Correspondencia roadmap ↔ task

Los ids del roadmap (`0.1`, `1.3`…) son del documento. Los ids de task son los del repositorio y se
asignan al abrir, no se reservan por adelantado: un id reservado que nunca se abre confunde más de
lo que ordena.

| Roadmap | Task | Estado | Depende de |
|---|---|---|---|
| 0.1 Diagnóstico | **T174** | hecho | — |
| 0.2 Modelo de medios y temporadas | T175 | pendiente | T174 |
| 0.3 Metadatos de no-anime | T176 | **bloqueada por D1** | T174 |
| 0.4 Reproductor de película y serie | T177 | pendiente | T175 |
| 0.5 Fixture multi-temporada y caso de fallo | T178 | pendiente | T175 |
| 0.6 Selector de fuente con alternativa | T179 | pendiente | T174 (parcial: el selector de la ficha ya existe) |
| Fase 1 Descargas | sin abrir | — | 0.5 |
| Fase 2A Manga | sin abrir | — | 0.5 |
| Fase 2B Descarga de manga | sin abrir | — | 1.x, 2A |
| Fase 3 Watch party | sin abrir | — | 0.5 (idealmente 1.x) |

**El orden dentro de la fase 0 cambia tras el diagnóstico.** El roadmap ponía 0.2 antes que 0.5;
el diagnóstico muestra que **0.5 es la que hace fallar 0.2**: sin un fixture con numeración por
temporada, el modelo nuevo se probaría con el mismo caso sintético que hoy esconde el fallo. Se
abren juntas, 0.2 y 0.5, y 0.5 puede ir primero en la parte de fixture.

## Qué se conserva de la fase 0

La película ya funciona de punta a punta con el fixture (búsqueda, ficha, reproducción y
«continuar viendo»; e2e de 105 pruebas en verde). No se rehace. Lo que cambia es la **identidad del
episodio** y la fuente de metadatos:

- **0.2** no empieza de cero: la API ya tiene `seasons` y la ficha agrupa por `T<n> E<m>`. Lo que
  falta es que la temporada sea parte de la identidad y no una etiqueta en el título.
- **0.4** no reescribe el reproductor: corrige el salto, los vecinos, «último» y «continuar
  viendo», y quita la etiqueta de episodio a la película.
- **0.6** ya tiene el selector en la ficha; falta el cambio automático al fallar la fuente activa.

## Decisiones que no se toman aquí

- **D1** (metadatos): bloquea 0.3. Opciones y consecuencias en el diagnóstico, sección «Decisión
  pendiente: D1».
- **D2** (formato de descarga HLS) y **D5** (formato de manga): bloquean sus specs, no la fase 0.
- **D3** (transporte de watch party): bloquea 3.4, no el MVP LAN.

## Specs que hay que escribir antes de codificar

| Task | Spec | Por qué |
|---|---|---|
| T175 | `docs/specs/proposals/SPEC-nn-anime.medios.md` | Cambia el modelo de `core` y la lectura de `catalog-store`: es evento de versión mayor del contrato de plugin |
| T176 | `docs/specs/proposals/SPEC-nn-anime.metadatos.md` | Sólo después de D1; abre una salida de red nueva |
| T177 | — | Es interfaz y rutas existentes; el criterio es el e2e |
| T178 | — | Es fixture y pruebas; no cambia contrato |
| T179 | — | Es interfaz; no cambia contrato |

## Lo que este plan no incluye

Las fases 1, 2A, 2B y 3 no tienen tasks abiertas. Se abrirán con su propia spec, como pide el
roadmap, y con las decisiones D2–D5 resueltas. Este documento sólo sostiene la fase 0.
