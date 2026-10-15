# Plan de tareas: el filtro de contenido para adultos

Origen: lo pedido con estas palabras — «para los animes veamos el tema de un filtro +18 ya que hay
contenido no apto para siempre». Y la condición con la que se aprueba: **que afecte también a lo que
aparece en Novedades**.

Specs: `docs/specs/proposals/SPEC-discovery.T128.md`, `SPEC-web-ui.T128.md` y
`SPEC-catalog-store.T128.md` — los tres pendientes de integrar. Estado: **propuesta, sin
implementar**.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios medidos mutando la implementación, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin
tests saltados, tope de cinco archivos de implementación por task y commit atómico que cita el
task.

Ocho tareas. Ninguna toca `recsys` ni `media-proxy`.

## Decisiones, tomadas con quien lo pidió

1. **Ocultar por defecto, con desbloqueo explícito y aviso.** El interruptor nace apagado y
   encenderlo es una acción consciente de la página de ajustes.
2. **El único criterio es `isAdult` de AniList.** Sin heurísticas por título y sin géneros: `Ecchi`
   no es contenido para adultos, y marcarlo sería mentir en la marca.
3. **Novedades entra entera, por sus dos procedencias.** No es una fila más: tiene dos orígenes y
   los dos se cubren —la mitad de AniList, que son los capítulos recién emitidos, y su reserva, que
   es el feed de la fuente—. La condición de la aprobación se mide sobre esa fila.
4. **Para cubrir el feed hay que preguntar, y eso cambia la frase.** «Con el interruptor apagado no
   se pide» no se sostiene donde no hay señal: pasa a ser **«no se guarda ni se sirve»**. De una
   obra marcada se guarda un booleano por referencia y nunca la entrada; el top y las películas, que
   sí pueden filtrar en la consulta, siguen sin pedir nada marcado.
5. **El alcance es donde hay señal o donde se puede conseguir**: la vitrina de AniList, las fichas
   enriquecidas, Novedades por sus dos vías, tendencias y las filas que salen de la base
   —historial, favoritos, recomendaciones—. La búsqueda queda fuera y se declara: verificar cada
   resultado pondría una ida y vuelta a AniList en medio de una búsqueda que se escribe a
   pulsaciones.
6. **Un solo id, T128, para las propuestas y para el trabajo.** El id T127 estaba reclamado por otra
   sesión al abrir este.

## Lo que hay hoy, y es la mitad del problema

- `isAdult: false` está escrito **literal** en las cuatro consultas que sí lo llevan —top, películas
  estrenadas, películas por estrenar y el emparejamiento—, y `isAdult` **no se pide** en
  `MEDIA_FIELDS`: la aplicación no sabe que una obra es para adultos, sólo evita pedirla.
- **«Novedades» tiene dos procedencias.** `piezasDeNovedades` usa los capítulos recién emitidos de
  AniList (`/api/discover/recent`) y cae al feed de la fuente (`/api/feed`) cuando no llegan. El
  destacado de reserva sale del mismo feed.
- **La procedencia de AniList no está filtrada y no se puede filtrar por consulta.**
  `AIRING_QUERY` y `AIRED_QUERY` cuelgan de `Page.airingSchedules`, que no expone el argumento
  `isAdult`. Hoy nada las descarta; queda por medir contra la API si devuelven obras marcadas.
- **La procedencia del feed no tiene ninguna señal**: `SearchResult` no lleva géneros y el plugin no
  publica edad.
- La clave de la caché de listas es `top:<media>`: no distingue el eje, así que un ajuste que cambie
  la consulta serviría la lista del estado anterior hasta que venza el TTL.
- La tabla `anime` no guarda nada de esto, así que una fila de historial, de favoritos o del feed no
  se puede filtrar sin salir a la red.

## Riesgos que este trabajo añade y cómo se acotan

| Riesgo | Acotación |
|---|---|
| El interruptor parece una garantía que no es | El aviso lo dice en la propia página, y `SECURITY.md` declara el riesgo: no comprueba edad, no cubre la búsqueda y no cubre lo que las fuentes no publican |
| Una lista cacheada con el interruptor encendido se sirve con el apagado | El eje va en la clave de las listas **y** la frontera descarta `adult: true` al servir |
| Pedir sin filtro llena la caché de contenido marcado | De una obra marcada se escribe **sólo el booleano de su referencia**: ni fila en `anilist_media`, ni portada, ni sinopsis. Se mide contando las filas de `anilist_media` tras verificar un título marcado |
| La primera carga paga la verificación del feed | Una consulta por lote de hasta ocho títulos —el tope que ya usa el emparejamiento—, cacheada un mes por título y año; la marca local evita repetirla para siempre. Las ocho lecturas de la home van en paralelo y un fallo no tumba el resto |
| Con AniList caído no hay verificación y la entrada se enseña | Es la regla que ya rige las filas —un tercero caído no vacía una fila— y esconder lo no comprobado dejaría Novedades vacía en cada fallo. Se declara en `SECURITY.md` |
| El filtro recorta la fila después de recomendar | El filtro va en la lectura del almacén, **antes** del motor, como ya hace el reparto por mitades |
| Un refresco del proveedor borra la marca | Se mide mutando la escritura: reemplazar la fila tiene que dejar una prueba en rojo |

## T128a — `core`: las formas

**Descripción:** `adult` en las formas de la frontera y `adultContent` en los dos schemas de ajustes.

**Archivos:** `packages/core/src/schema.ts`, `packages/core/src/api.ts`, `schema.test.ts`,
`api.test.ts`.

**Aceptación:**
- [ ] `anilistEntrySchema`, `discoverItemSchema`, `airingItemSchema` y `enrichmentSchema` llevan
      `adult: boolean` **obligatorio**; `feedItemSchema` lo lleva **opcional**. Medido mutando:
      quitarlo de `anilistEntrySchema` deja en rojo la prueba que valida una entrada guardada, y
      volver obligatorio el del feed deja en rojo la prueba de una entrada sin edad conocida.
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

## T128c — `catalog-store`: la marca, su migración y su lectura por lote

**Descripción:** la columna `adult` en `anime`, la escritura de la marca por referencia —sin el
contenido— y la lectura por lote que dice qué referencias de una fila están marcadas.

**Archivos:** `migrations/0010-adulto.sql`, `repositories/anime.ts`, `store.ts`, `index.ts` y las
pruebas del repositorio.

**Aceptación:**
- [ ] La migración es aditiva y deja las filas que ya existen en `0`. Medido mutando: un valor por
      defecto `1` deja en rojo la prueba de «no consta».
- [ ] La lectura por lote devuelve las marcadas de una lista de veinte referencias en **una**
      consulta. Medido mutando: resolverla con una consulta por referencia deja en rojo la prueba
      que cuenta las consultas.
- [ ] Un refresco del proveedor **no** borra la marca. Medido mutando: reemplazando la fila en vez
      de actualizarla, la prueba queda en rojo.
- [ ] El almacén no decide: la marca se lee cuando se le pide. Medido mutando: filtrando dentro de
      la lectura de la ficha, la prueba de la ficha marcada que sí se enseña queda en rojo.
- [ ] `bun test packages/catalog-store` verde.

**Depende de:** T128a. **Tamaño:** M.

## T128d — `server`: las listas de AniList, el emparejamiento y la frontera

**Descripción:** el top y las dos de películas se construyen con la bandera del ajuste y su clave de
caché lleva el eje; `matchQuery` deja de filtrar, sí o sí; y las cinco rutas de AniList descartan
`adult: true` con el interruptor apagado.

**Archivos:** `packages/server/src/anilist/queries.ts`, `anilist/entries.ts`, `anilist/catalog.ts`,
`routes/anilist.ts` y sus pruebas.

**Aceptación:**
- [ ] Con el interruptor apagado no se sirve ninguna pieza `adult: true` en `/api/discover/top`,
      **`/api/discover/recent`** —la procedencia de AniList de Novedades—, `/api/discover/airing` ni
      en las dos del enriquecido. La prueba va sobre `airing` y `recent`, que son las rutas donde la
      consulta no puede filtrar. Medido mutando: quitando el descarte de la frontera, en rojo.
- [ ] Con el interruptor encendido la consulta **omite** `isAdult` y la obra marcada sí llega, con
      `adult: true`. Medido mutando: dejando el literal `false` en la variante encendida, en rojo.
- [ ] La clave de caché distingue los dos ejes: pedir con el interruptor encendido después de haber
      cacheado apagado **no** devuelve la lista cacheada. Medido mutando: quitando el eje de la
      clave, en rojo.
- [ ] Con el interruptor apagado, un emparejamiento que devuelve una obra marcada **no escribe** la
      fila de `anilist_media`: se cuenta el contenido de la tabla. Medido mutando: escribiéndola,
      en rojo.
- [ ] `anilistEntrySchema` con `adult` obligatorio invalida las filas viejas de la caché y se
      vuelven a pedir, sin `500` ni pantalla vacía. Medido mutando: rellenando con `false` la fila
      que no valida, en rojo.
- [ ] `bun test packages/server` verde.

**Depende de:** T128a, T128b. **Tamaño:** L.

## T128e — `server`: las novedades del feed y las tendencias

**Descripción:** `/api/feed` verifica sus entradas contra AniList —por lote, con el mismo
`matchMany` del enriquecido—, marca las que son para adultos, descarta las ya marcadas **antes de
preguntar** y no devuelve ninguna marcada; `/api/trending` cae en la misma pasada.

**Archivos:** `packages/server/src/routes/discovery.ts`,
`packages/server/src/routes/recommendations.ts` y sus pruebas.

**Aceptación:**
- [ ] Con el interruptor apagado, `/api/feed` **no** devuelve la entrada cuya obra AniList marca para
      adultos, y con el encendido sí la devuelve con `adult: true`. Es el criterio de la aprobación:
      se mide con el cliente de AniList fingido, que es como ya se prueban las rutas de AniList.
      Medido mutando: quitando la verificación, en rojo.
- [ ] Una referencia ya marcada **no** gasta una petición: la segunda llamada con las mismas
      entradas no consulta a AniList. Medido mutando: verificando también las marcadas, la prueba
      que cuenta las peticiones del cliente fingido queda en rojo.
- [ ] El filtro va antes del tope: la fila sigue devolviendo `limit` entradas cuando hay de sobra.
      Medido mutando: recortando después de filtrar, en rojo.
- [ ] `/api/trending` descarta las marcadas. Medido mutando: quitando el descarte, en rojo.
- [ ] `bun test packages/server` verde.

**Depende de:** T128c, T128d. **Tamaño:** M.

## T128f — `catalog-store` + `server`: las filas de la base

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

## T128g — `web`: el interruptor y la marca

**Descripción:** el bloque de ajustes con su aviso, el repintado al cambiarlo, y la marca `+18` en la
pieza, en **la fila de Novedades** y en la ficha.

**Archivos:** `packages/web/src/features/settings/SettingsPage.tsx`, `useSettings.ts`,
`packages/web/src/components/Pieza.tsx`, `packages/web/src/features/detail/DetailPage.tsx`,
`packages/web/src/i18n/es.ts` y las pruebas de componente.

**Aceptación:**
- [ ] El interruptor enseña su estado, se cambia con teclado y su aviso dice qué hace y qué no.
      Medido mutando: quitando el aviso, en rojo la prueba que lo busca por su texto.
- [ ] Encender el interruptor cambia lo que se ve sin recargar. Medido mutando: sin volver a pedir
      las listas tras el `PATCH`, en rojo.
- [ ] La marca `+18` sale en la pieza del top, en la parrilla y **en las novedades de las dos
      procedencias** —la de AniList y la del feed, esta última sólo cuando `adult` viene—, y no sale
      cuando falta o es falso. Medido mutando: pintándola siempre, en rojo; pintándola por color sin
      texto, en rojo la prueba del nombre accesible; ignorando el `adult` opcional del feed, en rojo.
- [ ] `bun run typecheck` 0 · `bun run lint` 0 · `bun test packages/web` verde.

**Depende de:** T128d, T128e, T128f. **Tamaño:** L.

## T128h — `SECURITY.md` y el e2e

**Descripción:** el riesgo residual declarado y el recorrido de la interfaz —apagado, encendido,
vuelta a apagar—.

**Archivos:** `SECURITY.md`, `packages/web/e2e/adultos.e2e.ts`.

**Aceptación:**
- [ ] `SECURITY.md` declara, en la tabla de lo no mitigado, que el ajuste **no** comprueba la edad,
      que no cubre la búsqueda y que no cubre lo que las fuentes no publican, y que con AniList caído
      la verificación no puede contestar.
- [ ] El e2e comprueba que el interruptor persiste, que el cambio se ve sin recargar y que con el
      interruptor apagado no hay ninguna marca en pantalla.
- [ ] **Lo que el e2e no puede medir, y se dice:** el arnés arranca con
      `NN_ANIME_ANILIST_OFFLINE=1`, así que no hay obra marcada que enseñar y **la exclusión se mide
      en las pruebas de ruta**, con el cliente fingido. El e2e mide la interfaz; la ruta mide el
      filtro.
- [ ] `bun run e2e adultos` verde.

**Depende de:** T128g. **Tamaño:** S.

## Dependencias

| Task | Depende de |
|---|---|
| T128a | — |
| T128b | T128a |
| T128c | T128a |
| T128d | T128a, T128b |
| T128e | T128c, T128d |
| T128f | T128c |
| T128g | T128d, T128e, T128f |
| T128h | T128g |

## Fuera de este plan

- **Heurísticas por título o por género del proveedor.** Descartadas con quien lo pidió: un filtro
  que falla en silencio es peor que no tenerlo.
- **Verificar la búsqueda.** Llegaría una ida y vuelta a AniList por pulsación.
- **Una pantalla de edad.** No comprueba nada, y fingir una garantía es peor que declarar que no la
  hay.
- **Esconder la ficha de un título marcado al que el usuario llegue por su cuenta.** Es su catálogo,
  y bloquear algo que ya abrió antes no protege a nadie.
