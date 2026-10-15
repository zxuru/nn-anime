# Metadatos e imágenes desde AniList, y la parrilla de estrenos

Origen: lo pedido con estas palabras — «aquellos como recomendados, el top, las novedades, así como
también varios datos de las fichas en cada anime, se rellenen utilizando datos desde estas API
(anilist.co, anichart.net) […] de ser posible también poder recolectar mejores imágenes […] agrega
también en el inicio algo así como un calendario con el cual anuncias cuáles son las series próximas
a publicar un nuevo capítulo». Y la condición con la que se autoriza: **acceder directamente a las
API publicadas y respetar sus términos de uso**.

El hueco ya estaba escrito en el repositorio, dos veces: `packages/web/src/features/home/HomePage.tsx`
dice que la parrilla semanal y la fila de episodios nuevos no están «porque no hay datos para ello:
la fecha de emisión por episodio, y los proveedores no la dan»; `SPEC-discovery.md` lo repite. AniList
publica esa fecha.

## Decisiones, tomadas con quien lo pidió

1. **AniList manda en el top, en las novedades y en la parrilla; «Recomendado para ti» sigue siendo
   el motor local.** El motor explicable es el rasgo del proyecto y no se sustituye; lo que se
   sustituye es lo que el motor no puede saber —el ranking real, lo que acaba de emitirse y lo que
   se emite esta semana—. Las tarjetas del motor llevan la portada de AniList cuando su obra está
   emparejada, para que la vitrina no mezcle dos calidades de arte.
2. **La portada de AniList sustituye a la del proveedor cuando existe.** `extraLarge` (≈460 px) y
   consistente entre fuentes. Se sirve **por el servidor** con caché en disco, como la portada de un
   proveedor: el navegador sigue sin conocer ninguna dirección remota y la CSP no cambia.
3. **Se habla con la API publicada, no con la web.** `https://graphql.anilist.co`, GraphQL, sin
   cuenta ni token. `anichart.net` es una aplicación de AniList sobre esa misma API: no tiene API
   propia, así que no se raspa ninguna página.
4. **Términos de uso, respetados por construcción.** La API es gratuita para uso no comercial y
   prohíbe usarla «como servicio de respaldo o de almacenamiento de datos» y el «hoarding». De ahí
   tres reglas de este trabajo: la caché es para no repetir la misma consulta —TTL obligatorio,
   nunca un espejo del catálogo entero—; ninguna consulta se hace por adelantado, sólo responde a
   algo que la pantalla está enseñando; y el cliente lleva un **presupuesto de peticiones**
   (una cada 2 s y como techo el límite, hoy degradado a 30/min) que espacia las consultas y
   obedece `Retry-After` en un 429. No hay nombre propio que declare la aplicación como oficial:
   el `User-Agent` dice `nn-anime (UNOFFICIAL)`.

## Riesgos que este trabajo añade y cómo se acotan

| Riesgo | Acotación |
|---|---|
| Un tercero caído o limitado tumba la home | Ninguna fila depende de AniList: si no responde, el top vuelve al de la fuente, las novedades al feed y la parrilla se explica. La caché caducada se sirve antes que nada; nunca se vacía una fila por un fallo de red |
| Salir a un host nuevo | Lista blanca de hosts (`graphql.anilist.co` para la API; `s4.anilist.co`/`img.anilist.co` para la imagen), comprobación de destino en cada salto con `fetchAllowed`, timeout y tope de tamaño. La imagen se referencia **por id**, nunca por URL que venga del cliente |
| Un emparejamiento equivocado enseña la sinopsis de otra obra | El emparejamiento es conservador —nombre normalizado de toda la obra, con la misma identidad que usa la búsqueda— y un candidato que no cumple **no se enriquece**: se prefiere no tener sinopsis a tener la de otra |
| Trabas del proveedor por exceso de peticiones | Una consulta por fila y media hora de TTL; la ficha una vez por título y 30 días; el emparejamiento va **por lotes** —varias obras en una sola consulta— y los fallos se cachean menos —7 días— para no repetirlos. Presupuesto serializado con intervalo mínimo |
| La descripción trae HTML | `description(asHtml: false)` de la API y, además, saneado a texto plano en `core`: nunca se inyecta HTML en la interfaz |
| El calendario enseña capítulos de series que no están en ninguna fuente | La entrada se marca con su referencia local **si la base ya la conoce**; si no, enlaza a la búsqueda de ese título. Y se dice en la nota del tramo de dónde sale |

Rige el **Definition of Done** de `tasks/plan.md`. Una tarea, T121, en tres partes: el id T122
se cruzó con el de otra sesión y el trabajo se numeró entero con el id reclamado.

## T121, parte 1 — `core` + `catalog-store`: las formas de AniList y su caché

**Descripción:** los tipos y schemas de lo que AniList publica y de lo que las rutas nuevas
devuelven; las funciones puras (saneado de la descripción, mapa de formato a `TitleKind`, claves de
una obra de AniList y elección de la candidata); y las tres tablas de caché con sus lecturas.

**Aceptación:**
- [x] `anilistKeys` y `sameAniListWork` reconocen «Danmachi» y «Dungeon ni Deai wo Motomeru no wa
      Machigatteiru Darou ka» como la misma obra (el caso real de `discovery-identidad.md`), y **no**
      juntan «Kimetsu no Yaiba» con su película.
- [x] `pickAniListMatch` prefiere la candidata cuyo nombre coincide exacto y, entre dos que valen,
      la del año; sin candidata que cumpla devuelve `undefined` —mejor sin sinopsis que con la de
      otra obra—.
- [x] `plainText` quita etiquetas y decodifica entidades de una descripción de AniList.
- [x] `kindOfFormat` traduce el formato de AniList a `TitleKind`, y `MUSIC` no es de ninguna.
- [x] Los schemas nuevos son estrictos: `discoverItemSchema`, `airingItemSchema`,
      `enrichmentSchema`, `discoverResponseSchema`, `airingResponseSchema`,
      `enrichmentResponseSchema`, `enrichmentBatch*`.
- [x] `anilistImagePath` compone `/api/anilist/image/<kind>/<id>` y no acepta un id que no sea entero
      positivo.
- [x] Migración `0008-anilist.sql` con `anilist_media`, `anilist_list_cache` y `anilist_image`;
      `db:migrate` dos veces no la reaplica.
- [x] Las lecturas del repositorio devuelven un `CacheHit`-equivalente con `stale` calculado con
      reloj inyectable, y escriben con `INSERT … ON CONFLICT`.
- [x] `findLocalByName` reutiliza la consulta de candidatos de `related.ts` —una expresión, no dos—.

**Verificación:** `bun test packages/core packages/catalog-store` · medido mutando.

**Depende de:** nada. **Tamaño:** M.

## T121, parte 2 — `server`: el cliente de AniList, sus rutas y el emparejamiento

**Descripción:** el cliente GraphQL con presupuesto y lista blanca, la caché de listas y de
emparejamientos, las rutas del descubrimiento (`/api/discover/top`, `/api/discover/airing`,
`/api/discover/recent`), el enriquecimiento de la ficha (`/api/anime/:providerId/:ref/enrichment`),
el lote del motor (`POST /api/enrichment`) y la imagen (`/api/anilist/image/:kind/:id`).

**Aceptación:**
- [x] El cliente espacia: dos peticiones seguidas no salen sin el intervalo mínimo, y hay una prueba
      con reloj y `fetch` inyectados.
- [x] Un 429 obedece `Retry-After` y se cachea el fallo; una respuesta que no valida el schema es un
      error, no un dato.
- [x] Sólo se sale a los hosts de la lista blanca, con comprobación de destino en cada salto.
- [x] `/api/discover/top`: el ranking de AniList, con la referencia local cuando la base conoce esa
      obra; sin AniList y con caché vieja, se sirve la caché.
- [x] `/api/discover/airing?days=N`: los próximos episodios con `airingAt`, `episode` y portada.
- [x] `/api/discover/recent`: los episodios recién emitidos.
- [x] `/api/anime/:providerId/:ref/enrichment`: sinopsis, géneros, nota, estado, estudio, portada y
      banner de la obra emparejada; 404 por proveedor desconocido, como las otras rutas de la ficha.
- [x] `POST /api/enrichment` con hasta 24 referencias: una sola consulta por lote de 8 para las que
      falten, y las ya emparejadas desde la caché sin tocar la red.
- [x] `/api/anilist/image/:kind/:id`: sirve la imagen del id conocido, con lista blanca de tipos
      ráster, tope de tamaño y el tipo de contenido de la respuesta.

**Verificación:** `bun test packages/server` · medido mutando.

**Depende de:** la parte 1. **Tamaño:** M.

## T121, parte 3 — `web`: la parrilla, las filas de AniList y la ficha enriquecida

**Descripción:** la parrilla de estrenos en la home, el top y las novedades con los datos de AniList
y su vuelta atrás a lo de la fuente, las portadas de AniList en la vitrina y la ficha con sinopsis,
géneros, nota y próximo capítulo.

**Aceptación:**
- [x] La parrilla agrupa por día —«Hoy», «Mañana» y el resto por su nombre— y cada entrada dice el
      episodio y la hora; una entrada sin referencia local enlaza a la búsqueda de su título y se
      distingue de la que abre la ficha.
- [x] El top pinta el de AniList cuando llega y el de la fuente cuando no; nunca se queda en blanco
      por un fallo del tercero.
- [x] «Novedades» cambia a los episodios recién emitidos cuando AniList responde, y se queda con el
      feed de la fuente cuando no.
- [x] Las piezas del motor y de las filas nuevas llevan la portada de AniList si su obra está
      emparejada; si no, la del proveedor.
- [x] La ficha enseña la sinopsis como texto —sin HTML—, los géneros, la nota sobre 100, el estado y
      el próximo capítulo si lo hay; sin emparejamiento no se pinta nada nuevo.
- [x] Los textos nuevos viven en `packages/web/src/i18n/es.ts` y `i18n.test.ts` sigue en verde.
- [x] El e2e de la home cubre la parrilla con la respuesta de AniList interceptada.

**Verificación:** `bun test packages/web` · `bunx playwright test` · medido mutando.

**Depende de:** la parte 2. **Tamaño:** M.

## Lo que cambió al medir contra la API

Tres cosas que ninguna prueba de dobles habría contado y que se vieron hablando con
`graphql.anilist.co` de verdad:

1. **AniList aplana el nodo `Page` cuando cuelga de un alias**: `t0: { media: […] }` y no
   `t0: { Page: { media: […] } }`. El cliente acepta las dos formas y el doble devuelve la de
   verdad —un doble más cómodo esconde exactamente este fallo—.
2. **El estreno de una película suele venir con precisión de año.** Por eso la parrilla es de
   series —`/api/discover/airing?media=movies` responde vacío sin salir a la red y la fila lo
   explica— y los estrenos de películas se listan en Novedades con el año.
3. **`startDate { year }` en el schema descartaba `month` y `day`**: zod tira lo que no se declara,
   y las fechas de las películas se quedaban en el año sin que nadie lo notara. Hay prueba que
   falla si se quitan los tres campos.

## Fuera de alcance, y se dice

1. **Las recomendaciones propias de AniList** (las de una ficha, o las de una cuenta) no se usan:
   requieren cuenta, y subir el historial de visionado a un tercero está prohibido por el mapa de
   capacidades.
2. **El selector de fuente dentro del reproductor** no se toca; el calendario enlaza a la ficha o a
   la búsqueda.
3. **Sincronizar la lista de un usuario de AniList** (OAuth) queda fuera: es cuenta y es contrato
   nuevo.
