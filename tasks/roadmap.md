# Plan de tareas: roadmap post-v0.3.1

Origen: `docs/roadmap.md` · Estado: **fase 0 cerrada; fase 1 abierta, spec 1.1 hecha; motor
siguiente** · 2026-10-26.
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
| 0.2 Modelo de medios y temporadas · spec | **T175** | hecho (aprobada por el humano) | T174 |
| 0.2 Modelo de medios y temporadas · código | **T176** | hecho | T175 |
| 0.3 Metadatos de no-anime | **T177** | hecho; D1 decidida | T174 |
| 0.4 Reproductor de película y serie | **T178** | hecho | T176 |
| 0.5 Fixture multi-temporada y caso de fallo | **T179** | hecho | T176 |
| 0.6 Selector de fuente con alternativa | **T180** | hecho | T174 |
| 1.1 Descargas · spec | **T181** | hecho; D2 decidida | 0.5 |
| 1.2 Descargas · contrato | **T182** | hecho | T181 |
| 1.3a Descargas · cola persistente | **T183** | hecho | T182 |
| 1.3b Descargas · descarga directa | **T183b** | hecho | T183 |
| 1.3c Descargas · HLS/ffmpeg | **T183c** | hecho | T183b |
| 1.3d Descargas · orquestador | **T183d** | hecho | T183c |
| 1.3e Descargas · cola con concurrencia | **T183e** | hecho | T183d |
| 1.3f Descargas · rutas HTTP | **T183f** | hecho | T183e |
| 1.4 Descargas · interfaz | **T184** | hecho | T183f |
| 1.5 Descargas · reproducción local | T185 | **siguiente** | T183f, T184 |
| 1.6 Descargas · escritorio | T186 | pendiente | T184 |
| 1.7 Descargas · espacio | T187 | pendiente | T183f, T184 |
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

## Decisiones

- **D1** (metadatos): **decidida el 2026-10-26** — clave opcional de TMDB en Ajustes, con el plugin
  como respaldo. La implementa 0.3 (T177); la clave no se devuelve en `GET /api/settings` y TMDB
  entra en la lista blanca y en `SECURITY.md`.
- **D2** (formato de descarga HLS) y **D5** (formato de manga): bloquean sus specs, no la fase 0.
- **D3** (transporte de watch party): bloquea 3.4, no el MVP LAN.

## Specs

| Task | Spec | Estado |
|---|---|---|
| T175 (0.2) | `docs/specs/proposals/SPEC-nn-anime.medios.T175.md` | **propuesta entregada**, pendiente de aprobación |
| T176 (0.2, código) | la de T175, una vez aprobada | — |
| T177 (0.3) | `docs/specs/proposals/SPEC-nn-anime.metadatos.md` | por escribir; D1 ya decidida |
| T178 (0.4) | — | Es interfaz y rutas existentes; el criterio es el e2e |
| T179 (0.5) | — | Es fixture y pruebas; no cambia contrato |
| T180 (0.6) | — | Es interfaz; no cambia contrato |

## Lo que este plan no incluye

Las fases 1, 2A, 2B y 3 no tienen tasks abiertas. Se abrirán con su propia spec, como pide el
roadmap, y con las decisiones D2–D5 resueltas. Este documento sólo sostiene la fase 0.
