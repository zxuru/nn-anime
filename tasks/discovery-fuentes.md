# Descubrimiento: la misma obra en varias fuentes

Origen: con la home delante, «Último añadido» pinta **la misma obra una vez por proveedor** —en la
captura, «Super no Ura de Yani Suu Futari» tres veces y «Yani Neko» dos—, y la ficha de un título no
dice que esa obra esté también en otra fuente. El usuario pidió lo segundo con estas palabras: «si
hay varios proveedores del mismo contenido podría colocarse en la ficha o en el reproductor del
mismo anime elegir si se quiere de una fuente o de otra».

Medido sobre la base de desarrollo (`~/.local/share/nn-anime/nn-anime.db`, 51 fichas y dos
proveedores activos): la lectura de «Último añadido» devuelve **216 entradas** y agrupar por título
normalizado más año las deja en **201**. Son 15 obras repetidas, todas entre `jkanime` y `animeav1`
—«One Piece», «Dandadan», «Dandadan 2nd Season», el bloque entero de «Kimetsu no Yaiba»—, y la
mayoría sin año en las dos fuentes, así que el año no estorba: cuando falta en las dos, `null` es
tan comparable como un número.

Decisiones tomadas con quien pidió el cambio:

1. **El selector vive en la ficha, no en el reproductor.** En la ficha basta un enlace a la ficha de
   la otra fuente; en el reproductor habría que mapear el número de episodio de una numeración a
   otra y arrastrar el segundo donde se iba, y eso es otra entrega. El usuario eligió la ficha.
2. **Una tarjeta por obra en «Último añadido» y en «Novedades».** Es el mismo criterio que ya rigen
   la búsqueda (T66) y el top de la fuente (T63). La obra sale una vez y las demás fuentes siguen
   siendo elegibles desde la ficha, que es donde se comparan.
3. **La clave es título normalizado más año.** La misma que ya usa la búsqueda: dos fuentes que
   escriben el mismo título el mismo año son la misma obra. No se usa `baseTitle`: juntaría
   «Frieren» con «Frieren 2nd Season», que son dos entregas que las fuentes publican por separado.

Rige el mismo **Definition of Done** de `tasks/plan.md`. Tres tareas, T74 a T76.

**El límite conocido, y se declara:** la clave empareja títulos escritos distinto sólo hasta donde
llega la normalización. En los datos reales, «Ijiranaide, Nagatoro-san 2nd Season» (animeav1) y
«Ijiranaide, Nagatoro-san 2nd Attack» (jkanime) **no** emparejan: una fuente llama a la entrega
«Season» y la otra «Attack». Preferir el recuerdo al ruido es la decisión; el título de la otra
fuente sigue a un clic desde la búsqueda, que agrupa con la misma clave y por tanto tiene el mismo
límite.

## T74 — `core` + `server`: una tarjeta por obra en el arranque en frío

**Qué:** la clave de título pasa a `core` —`titleKey`, la normalización que ya vivía dentro de
`titles.ts` y duplicaba `claveDeTitulo` en `routes/recommendations.ts`— y las dos rutas del arranque
en frío, `GET /api/feed` y `GET /api/catalog/recent`, descartan la segunda fuente de la misma obra.

**Por qué:** había **dos** normalizadores de título escritos por separado —uno en `core/titles.ts`,
privado, y otro en `routes/recommendations.ts`— y la fila que se está arreglando necesitaba un
tercero. Tres copias de la misma regla divergen: la de la búsqueda no quita acentos y las otras dos
sí, así que la misma obra se agruparía en una pantalla y no en la de al lado.

**Archivos:** `packages/core/src/titles.ts`, `packages/core/src/index.ts`,
`packages/server/src/routes/recommendations.ts`, `packages/server/src/routes/discovery.ts`.

**Aceptación:**

- [ ] `titleKey('  One  Piece! ')` y `titleKey('one piece')` dan la misma clave; «Bleach: Sennen
      Kessen-hen» y «bleach sennen kessen hen» también. Un título sin letras ni números da cadena
      vacía y **no empareja con nada**.
- [ ] `GET /api/catalog/recent` devuelve una entrada por obra: dos proveedores con el mismo título
      y el mismo año dejan **una** tarjeta, la del `fetched_at` más nuevo.
- [ ] La misma regla en `GET /api/feed`: dos entradas con el mismo título y año, una por fuente,
      dejan una. La fecha y el orden de la fila no cambian.
- [ ] El título y su temporada siguen siendo dos tarjetas (`titleKey` no usa `baseTitle`).
- [ ] El tope del límite sigue mandando: con más obras repetidas que el límite, la fila se recorta
      **después** de agrupar, no antes.
- [ ] `claveDeTitulo` desaparece de `recommendations.ts` y el top sigue dejando una tarjeta por
      anime: sus cuatro pruebas de duplicados siguen en verde sin tocarlas.

**Verificación:** `bun test packages/core packages/server` · medido mutando: quitar la agrupación
por título deja en rojo las pruebas nuevas de `discovery.test.ts`; quitar sólo el año, la de la
misma obra con años distintos.

**Depende de:** nada. **Tamaño:** S.

## T75 — `core` + `catalog-store` + `server`: las fuentes del mismo título

**Qué:** `GET /api/anime/:providerId/:ref/sources` devuelve las **otras** fuentes que tienen esa
misma obra, leídas de lo que la base ya conoce, con el schema `sourcesResponseSchema` en `core`.

**Por qué:** la ficha conoce una sola referencia. Qué otras fuentes tienen la misma obra sólo lo sabe
la base —`anime` más los listados cacheados—, y resolverlo en el navegador pediría una búsqueda por
ficha abierta, que es justo la precarga especulativa que el spec prohíbe.

**Archivos:** `packages/core/src/api.ts`, `packages/catalog-store/src/repositories/related.ts`,
`packages/catalog-store/src/store.ts`, `packages/server/src/routes/detail.ts`.

**Aceptación:**

- [ ] La lectura vive en `related.ts` y **reutiliza** la consulta de candidatos que ya existe: la
      misma expresión de las cuatro tablas, el mismo prefiltro por la primera palabra y el mismo
      tope de filas. No se escribe una segunda lectura de la base.
- [ ] Una entrada **por proveedor**: dos referencias de la misma fuente para la misma obra no salen
      dos veces; se queda la del `provider_ref` alfabéticamente menor, para que el resultado no
      dependa del orden en que SQLite devolvió las filas.
- [ ] Nunca se incluye la fuente de la ficha, y el prefiltro del `LIKE` sale del título de la
      referencia pedida, no del que se va a buscar.
- [ ] Una referencia que no está en la base devuelve lista vacía —nadie abrió esa ficha—, no un
      error; un proveedor desconocido sigue siendo 404, como en las otras dos rutas de la ficha.
- [ ] La lectura es **local**: el número de consultas preparadas no crece con los candidatos, y
      con la lista de plugins vacía la ruta contesta 404 por proveedor desconocido —la misma
      respuesta que da la de relacionados— sin tocar la red.

**Verificación:** `bun test packages/catalog-store packages/server` · medido mutando: quitar el
filtro del proveedor propio hace fallar la prueba de «la ficha no se lista a sí misma»; dejar la
clave sin año, la de la obra homónima de otro año.

**Depende de:** T74 (la clave de título). **Tamaño:** M.

## T76 — `web`: «También en» en la ficha

**Qué:** la ficha pinta las otras fuentes de la misma obra como enlaces a **su** ficha, con el
nombre del proveedor que ya trae `/api/providers`. Es el mismo «También en» que la búsqueda ya usa
desde T66.

**Por qué:** el usuario quiere elegir fuente, y elegirla es poder llegar a ella. El enlace lleva a la
ficha de la otra fuente, que es donde están sus episodios y su reproductor: la obra no se fusiona
—cada referencia es la suya— y el modo y los episodios los decide la fuente de destino.

**Archivos:** `packages/web/src/features/detail/useDetail.ts`,
`packages/web/src/features/detail/SourcePicker.tsx` (nuevo),
`packages/web/src/features/detail/DetailPage.tsx`, `packages/web/src/i18n/es.ts`.

**Aceptación:**

- [ ] Con dos fuentes, la ficha muestra la sección con **un** enlace, a la otra fuente, con su
      nombre visible; sin otras fuentes, la sección **no se pinta** —una ficha que no tiene nada que
      elegir no necesita un hueco vacío—.
- [ ] Es un enlace de verdad (`<a href>`) a `/anime/<providerId>/<ref>` con la referencia
      codificada, alcanzable con `Tab`.
- [ ] La lista no incluye la fuente que se está viendo, aunque el servidor la mandara.
- [ ] Los textos van en `packages/web/src/i18n/es.ts` y `i18n.test.ts` (que falla con claves
      huérfanas o sin usar) sigue en verde.
- [ ] El estado de error de esa petición no rompe la ficha: sin fuentes, la sección no está, como
      cuando no hay ninguna.

**Verificación:** `bun test packages/web` · e2e de la ficha (`detail.e2e.ts`) con las dos fuentes del
fixture · medido mutando: dejar la sección sin el filtro de la fuente propia la deja en rojo; pintar
la sección vacía, también.

**Depende de:** T75. **Tamaño:** M.

## Camino crítico

T74 ── T75 ── T76.

## Fuera de alcance, y se dice

1. **El selector dentro del reproductor.** Cambiar de fuente a mitad de episodio pide mapear la
   numeración de una fuente a la otra y decidir qué pasa con el segundo donde se iba; el usuario
   eligió la ficha.
2. **«Continuar viendo» y favoritos no se agrupan.** Son historial: la fila dice qué vio el usuario
   y dónde, y fusionar dos visionados en uno borraría lo que la fila existe para contar.
3. **La fila de géneros sale de `searchByGenre` y puede repetir la misma obra en dos fuentes.** Es
   la misma familia de defecto que esta entrega arregla y merece su propio task: la consulta es otra
   —cruza `anime` por término de género, no listados cacheados— y el arreglo no es el mismo.
