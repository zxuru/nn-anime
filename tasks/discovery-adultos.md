# Plan de tareas: el filtro de contenido para adultos

Origen: lo pedido con estas palabras — «para los animes veamos el tema de un filtro +18 ya que hay
contenido no apto para siempre».

Specs: `docs/specs/proposals/SPEC-discovery.T128.md`, `SPEC-web-ui.T128.md` y
`SPEC-catalog-store.T128.md` — los tres pendientes de integrar. Estado: **propuesta, sin
implementar**.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios medidos mutando la implementación, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin
tests saltados, tope de cinco archivos de implementación por task y commit atómico que cita el
task.

Siete tareas. Ninguna toca `recsys` ni `media-proxy`.

## Decisiones, tomadas con quien lo pidió

1. **Ocultar por defecto, con desbloqueo explícito y aviso.** El interruptor nace apagado y
   encenderlo es una acción consciente de la página de ajustes.
2. **El único criterio es `isAdult` de AniList.** Sin heurísticas por título y sin géneros: `Ecchi`
   no es contenido para adultos, y marcarlo sería mentir en la marca.
3. **El alcance es donde hay señal**: la vitrina de AniList, las fichas enriquecidas y las filas que
   salen de la base —historial, favoritos, recomendaciones— de lo que ya se marcó. Las filas de
   proveedor sin enriquecido quedan fuera y se declaran.
4. **Un solo id, T128, para las propuestas y para el trabajo.** El id T127 estaba reclamado por otra
   sesión al abrir este.

## Lo que hay hoy, y es la mitad del problema

- `isAdult: false` está escrito **literal** en las cuatro consultas que sí lo llevan —top, películas
  estrenadas, películas por estrenar y el emparejamiento—, y `isAdult` **no se pide** en
  `MEDIA_FIELDS`: la aplicación no sabe que una obra es para adultos, sólo evita pedirla.
- **La parrilla y lo recién emitido no están filtradas.** `AIRING_QUERY` y `AIRED_QUERY` cuelgan de
  `Page.airingSchedules`, que no expone el argumento `isAdult`. Hoy nada los filtra; queda por medir
  contra la API si devuelven obras marcadas.
- La clave de la caché de listas es `top:<media>` y la del emparejamiento `título|año`: ninguna
  distingue el eje, así que un ajuste que cambie la consulta serviría la lista del estado anterior
  hasta que venza el TTL.
- La tabla `anime` no guarda nada de esto, así que una fila de historial o de favoritos no se puede
  filtrar sin salir a la red.

## Riesgos que este trabajo añade y cómo se acotan

| Riesgo | Acotación |
|---|---|
| El interruptor parece una garantía que no es | El aviso lo dice en la propia página, y `SECURITY.md` declara el riesgo: no comprueba edad y no cubre lo que las fuentes no publican |
| Una lista cacheada con el interruptor encendido se sirve con el apagado | El eje va en la clave de caché **y** la frontera descarta `adult: true` al servir: dos barreras, y la segunda se prueba con una fila adulta metida a mano |
| El filtro recorta la fila después de recomendar | El filtro va en la lectura del almacén, **antes** del motor, como ya hace el reparto por mitades |
| Un refresco del proveedor borra la marca | Se mide mutando la escritura: reemplazar la fila tiene que dejar una prueba en rojo |
| El usuario enciende el interruptor y no ve qué cambió | La marca `+18` en la pieza y en la ficha, con texto y no sólo color |

## T128a — `core`: las formas

**Descripción:** `adult` en las cuatro formas de la frontera y `adultContent` en los dos schemas de
ajustes.

**Archivos:** `packages/core/src/schema.ts`, `packages/core/src/api.ts`, `schema.test.ts`,
`api.test.ts`.

**Aceptación:**
- [ ] `anilistEntrySchema`, `discoverItemSchema`, `airingItemSchema` y `enrichmentSchema` llevan
      `adult: boolean` **obligatorio**. Medido mutando: quitarlo de `anilistEntrySchema` deja en
      rojo la prueba que hoy valida una entrada guardada.
- [ ] `settingsResponseSchema` lleva `adultContent` y `settingsPatchSchema` lo acepta, con el
      `refine` de «al menos uno de los tres». Medido mutando: un `PATCH` con `{adultContent: true}`
      tiene que pasar, y uno con `{}` tiene que seguir siendo inválido.
- [ ] `bun run typecheck` 0 · `bun run lint` 0 · `bun test packages/core` verde.

**Depende de:** ninguno. **Tamaño:** S.

## T128b — `server`: el ajuste

**Descripción:** `GET /api/settings` devuelve `adultContent` —`false` por defecto— y `PATCH` lo
persiste; el contenedor lo lee para quien tiene que decidir con él.

**Archivos:** `packages/server/src/routes/settings.ts`, `packages/server/src/container.ts` y sus
pruebas.

**Aceptación:**
- [ ] Sin nada guardado, `GET /api/settings` responde `adultContent: false`. Medido mutando: un
      defecto `true` deja en rojo la prueba del defecto.
- [ ] Un `PATCH` con `{adultContent: true}` se lee de vuelta en el siguiente `GET`, y no borra el
      tema ni la prioridad. Medido mutando: escribiendo el ajuste con la clave del tema, en rojo.
- [ ] `bun test packages/server` verde.

**Depende de:** T128a. **Tamaño:** S.

## T128c — `catalog-store`: la marca y su migración

**Descripción:** la columna `adult` en `anime`, su escritura cuando el enriquecimiento trae una obra
marcada, y la lectura que la consulta.

**Archivos:** `migrations/0010-adulto.sql`, `repositories/anime.ts`, `store.ts`, `index.ts` y las
pruebas del repositorio.

**Aceptación:**
- [ ] La migración es aditiva y deja las filas que ya existen en `0`. Medido mutando: un valor por
      defecto `1` deja en rojo la prueba de «no consta».
- [ ] Un refresco del proveedor **no** borra la marca. Medido mutando: reemplazando la fila en vez
      de actualizarla, la prueba queda en rojo.
- [ ] El almacén no decide: la marca se lee cuando se le pide. Medido mutando: filtrando dentro de
      la lectura de la ficha, la prueba de la ficha marcada que sí se enseña queda en rojo.
- [ ] `bun test packages/catalog-store` verde.

**Depende de:** T128a. **Tamaño:** M.

## T128d — `server`: las listas de AniList y la frontera

**Descripción:** las cuatro consultas pasan a construirse con la bandera del ajuste —con la variante
sin filtrar que **omite** `isAdult`—, la clave de caché lleva el eje, y las rutas descartan
`adult: true` cuando el ajuste está apagado.

**Archivos:** `packages/server/src/anilist/queries.ts`, `anilist/entries.ts`, `anilist/catalog.ts`,
`routes/discovery.ts`, `routes/anilist.ts` y sus pruebas.

**Aceptación:**
- [ ] Con el ajuste apagado no se sirve ninguna pieza `adult: true` en `/api/discover/top`,
      `/api/discover/airing`, `/api/discover/recent` ni en las dos del enriquecido. **La prueba va
      sobre `airing` y `recent`**, que son las rutas donde la consulta no puede filtrar. Medido
      mutando: quitando el descarte de la frontera, en rojo.
- [ ] Con el ajuste encendido la consulta **omite** `isAdult` y la obra marcada sí llega, con
      `adult: true`. Medido mutando: dejando el literal `false` en la variante encendida, en rojo.
- [ ] La clave de caché distingue los dos ejes: pedir con el ajuste encendido después de haber
      cacheado apagado **no** devuelve la lista cacheada. Medido mutando: quitando el eje de la
      clave, en rojo.
- [ ] `anilistEntrySchema` con `adult` obligatorio invalida las filas viejas de la caché y se
      vuelven a pedir, sin `500` ni pantalla vacía. Medido mutando: rellenando con `false` la fila
      que no valida, en rojo.
- [ ] `bun test packages/server` verde.

**Depende de:** T128a, T128b. **Tamaño:** L.

## T128e — `catalog-store` + `server`: las filas de la base

**Descripción:** las lecturas que alimentan el historial, los favoritos y los candidatos del motor
excluyen lo marcado cuando el ajuste está apagado, **antes** de recomendar.

**Archivos:** `packages/catalog-store/src/repositories/{anime,watch,favorites}.ts`,
`packages/catalog-store/src/store.ts`, `packages/server/src/recommend/signals.ts` y sus pruebas.

**Aceptación:**
- [ ] Con el ajuste apagado, una referencia marcada no aparece en `/api/recommendations`,
      `/api/history` ni `/api/favorites`; con el ajuste encendido sí. Medido mutando: quitando la
      condición de una de las tres lecturas, en rojo.
- [ ] El filtro va antes del motor: el tope de la lista lo llenan títulos enseñables y la fila no
      sale corta. Medido mutando: filtrando la salida de `recommend` en vez de los candidatos, la
      prueba del tope queda en rojo.
- [ ] `bun test packages/catalog-store packages/server` verde.

**Depende de:** T128c. **Tamaño:** M.

## T128f — `web`: el interruptor y la marca

**Descripción:** el bloque de ajustes con su aviso, el repintado al cambiarlo, y la marca `+18` en la
pieza y en la ficha.

**Archivos:** `packages/web/src/features/settings/SettingsPage.tsx`, `useSettings.ts`,
`packages/web/src/components/Pieza.tsx`, `packages/web/src/features/detail/DetailPage.tsx`,
`packages/web/src/i18n/es.ts` y las pruebas de componente.

**Aceptación:**
- [ ] El interruptor enseña su estado, se cambia con teclado y su aviso dice qué hace y qué no.
      Medido mutando: quitando el aviso, en rojo la prueba que lo busca por su texto.
- [ ] Encender el interruptor cambia lo que se ve sin recargar. Medido mutando: sin volver a pedir
      las listas tras el `PATCH`, el e2e queda en rojo.
- [ ] La marca `+18` sale en la pieza y en la ficha cuando `adult` es verdadero, y **no** sale
      cuando falta o es falso. Medido mutando: pintándola siempre, en rojo; pintándola por color sin
      texto, en rojo la prueba de nombre accesible.
- [ ] `bun run typecheck` 0 · `bun run lint` 0 · `bun test packages/web` verde.

**Depende de:** T128a, T128b, T128d. **Tamaño:** L.

## T128g — `SECURITY.md` y el e2e de punta a punta

**Descripción:** el riesgo residual declarado y el recorrido completo —apagado, encendido, vuelta a
apagar— sobre el fixture.

**Archivos:** `SECURITY.md`, `packages/web/e2e/adultos.e2e.ts`.

**Aceptación:**
- [ ] `SECURITY.md` declara, en la tabla de lo no mitigado, que el ajuste **no** comprueba la edad,
      que sólo filtra lo que AniList publica y que las filas de proveedor sin señal no se filtran.
- [ ] El e2e recorre los tres estados y comprueba que la marca aparece sólo en el segundo y que la
      pieza marcada desaparece en el tercero.
- [ ] `bun run e2e adultos` verde.

**Depende de:** T128d, T128e, T128f. **Tamaño:** S.

## Dependencias

```
T128a ─┬─ T128b ─┬─ T128d ─┬─ T128f ─┐
       │         │         │         ├─ T128g
       ├─ T128c ─┴─ T128e ──┘─────────┘
       └─────────────┘
```

## Fuera de este plan

- **Heurísticas por título o por género del proveedor.** Descartadas con quien lo pidió: un filtro
  que falla en silencio es peor que no tenerlo.
- **Filtrar la búsqueda, las tendencias y las novedades al cerrar.** No hay señal; se filtran sólo
  las referencias ya marcadas.
- **Una pantalla de edad.** No comprueba nada, y fingir una garantía es peor que declarar que no la
  hay.
