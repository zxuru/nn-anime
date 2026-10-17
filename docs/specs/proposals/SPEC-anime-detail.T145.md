# SPEC-anime-detail.T145 — la ficha a sangre, el género con `#`, la marca de visto y sin `/anilist`

**Estado:** propuesta, sin integrar. Toca cuatro contratos aprobados —`SPEC-anime-detail.md`,
`SPEC-web-ui.md`, `SPEC-catalog-store.md` y `SPEC-nn-anime.md`—, así que la integran sus cuatro
dueños, que anotan la aprobación y borran este archivo. Mientras viva aquí, ninguno de los cuatro
se edita.

**Origen, con las palabras que lo pidieron:**

> «en las fichas sigue apareciendo como "/search?q=Aventura" cuando le doy clic a un genero dentro
> de un anime, la idea era que apareciera con el #. remueve la pagina catalogo del header ya que no
> es requerido. en la ficha el banner donde sale el nombre con una imagen de fondo lo ideal en mi
> vision seria que no estuviera contenido en un marco, idealmente extendido de lado a lado y sin
> margen con el bottom del header, se puede mantener lo oscurecido para mostrar la ficha. la
> posibilidad para marcar un anime/pelicula como ya visto no aparece implementada, debe quedar asi
> y registrado en la base de datos.»

**Decisiones tomadas con quien lo pidió, antes de escribir esto:**

1. Quitar el Catálogo es quitar **el enlace, la pantalla y la ruta** `/anilist`, no sólo el enlace.
   La búsqueda de una casilla contra AniList desaparece del producto.
2. «Visto» es la marca de la **obra**: una fila por título. **No** escribe progreso de episodios.
3. La marca retira el título de «Continuar viendo» **y** del motor de recomendación.
4. Esta entrega es la spec. La implementación va después, en las cuatro partes del final.

## Objective

Cuatro cosas de la ficha y de su alrededor, con una misma vara: lo que la pantalla promete tiene que
ser lo que pasa.

1. **El género lleva al catálogo que sí sabe de géneros.** Hoy el nombre de un género es un enlace a
   `/search?q=Aventura`, que les pregunta a los proveedores por el texto literal «Aventura» —ninguno
   busca por género, así que devuelven lo que se le parezca— y lo que enseña de verdad son los
   títulos que la base ya conoce. Con el `#`, la búsqueda la contesta AniList, que es el único que
   tiene un catálogo por género.
2. **La cabecera pierde un destino que no se usa.** «Catálogo» sale del `<nav>`, con su pantalla y
   su ruta.
3. **La banda de la ficha deja de ser un recuadro.** El banner y el nombre cruzan la pantalla, sin
   margen con la cabecera pegajosa, con el velo que sostiene el titular. El resto de la ficha sigue
   con su medida de lectura.
4. **Marcar una obra como vista existe, y se guarda.** Una fila por título en la base, un botón en
   la ficha, y el motor y «Continuar viendo» lo respetan.

## Supuestos declarados

Son hechos medidos en el árbol de hoy (`34af076`, rama `dev`), no supuestos de diseño. Cada uno
decide algo del contrato.

| Hecho medido | Dónde | Qué decide |
|---|---|---|
| El nombre del género y el del estudio se pintan con `searchPath(valor)`, que da `/search?q=<nombre>` | `DetailPage.tsx:309` | Es el único sitio a tocar para el `#` |
| `searchPath` codifica con `encodeURIComponent` | `SearchPage.tsx:94-104` | El `#` viaja como `%23`: en la barra de direcciones se lee `?q=%23Aventura`. Un `#` crudo empezaría el fragmento y la consulta llegaría vacía |
| `hasGenreToken` decide quién contesta: con `#`, no se pregunta a los proveedores y la lista pintada es la de AniList | `SearchPage.tsx:224` y `:292`, `routes/search.ts:202-205` y `:274` | El `#` **cambia lo que se enseña**, no sólo cómo se ve la dirección |
| `anilistGenre` traduce el nombre en español al de la lista cerrada de AniList, y compara con `titleKey`, que se come el `#` | `core/anilist.ts:352`, `core/titles.ts:48` | `#Aventura` → `Adventure`: el caso del usuario funciona |
| La tabla de alias cubre los 18 géneros de `ANILIST_GENRES` y nada más | `core/anilist.ts:322-341` | Un género fuera de ella (`#Isekai`) no encuentra nada: hoy el enlace sin `#` sí enseña lo local. Ver la decisión 1 de «Decisiones» |
| Con `anilistGenre` sin definir, la consulta cruzada sólo busca estudios por el texto literal —`#ufotable` incluido— | `catalog.ts:785`, `queries.ts:226-248` | **El `#` no se le pone a un estudio**: lo dejaría sin resultados |
| Con el interruptor de adultos apagado, la interfaz sigue pintando la ficha y sus marcas | `useDetail.ts:348-465` | La lectura de la marca no puede esconder la marca: el botón diría «no está» sobre algo que sí está |
| `listRecentlyWatched` alimenta **dos** cosas: «Continuar viendo» y las señales del motor | `routes/watch.ts:101`, `recommend/signals.ts:172` | El filtro de la marca **no** puede vivir en esa lectura: borraría la señal de afinidad |
| `filterCandidate` excluye sin excepción lo que está al 100 % (`ratio >= 0.9`) y el `reason` del filtro no sale en la API | `recsys/filters.ts:84`, `routes/recommendations.ts:312` | La marca entra como medida vista, sin tocar `recsys` ni inventar progreso de episodios |
| `favorite` es la marca que ya existe: `anime_id` como clave primaria, `created_at`, sin TTL | `0001-initial.sql:77`, `repositories/favorites.ts` | La tabla nueva es su hermana, no una columna de `anime` |
| La poda de huérfanos deja en paz lo que tiene un favorito o un visionado reciente, y borra el resto a los 90 días | `prune.ts:59-73`, `:108` | Una obra marcada como vista **y sin visionados** —una película vista fuera de la aplicación— se podaría con su marca: hay que protegerla, o la marca se pierde sola |
| Una lectura nueva que devuelva referencias se acota **en un solo sitio** | `provider-scope.ts:74-95` | `listWatchedTitles` entra en esa lista |
| Ninguna clave del catálogo puede estar sin usar, y toda clase del marcado tiene que estar en un CSS | `i18n.test.ts:64`, `styles.test.ts:82` | Borrar la pantalla **obliga** a borrar sus textos; añadir una caja obliga a definir su clase |

## Contrato

### `web-ui` — la cabecera pierde «Catálogo», y con él la pantalla

De `app.tsx` desaparece `<Link to="/anilist">{t(LOCALE, 'nav.anilist')}</Link>`. El `<nav>` queda con
tres destinos: Inicio, Buscar y Ajustes.

De `router.tsx` desaparece el nombre `'anilist'` de `RouteName` y su patrón de `PATTERNS`. `/anilist`
pasa a ser `not-found`, que es lo que es: una ruta que ya no existe.

**Y desaparece la superficie entera que sólo esa pantalla usaba.** No se deja código muerto: un
endpoint que le pregunta a un tercero y no tiene consumidor es superficie sin dueño. Se borran, en
el mismo cambio:

| Capa | Qué se va |
|---|---|
| `web` | `features/anilist/` entero (`AniListSearchPage.tsx`, `useAniListSearch.ts`, `anilist.test.tsx`), el caso de `styles.test.ts` que lee esa página con su constante `ANILIST_PAGE`, y las claves `anilist.*` de `i18n/es.ts` |
| `server` | el manejador `GET /api/anilist/search` de `routes/anilist.ts`, `searchItem` y el tipo `AniListSearchItem`, y `catalog.search` con su mapa de paginación. **No** se toca el resto del archivo: la imagen, `/api/discover/*`, el enriquecimiento y `anilist-related` se quedan |
| `server` | `catalog.genres()` con la consulta `GenreCollection` **si queda sin consumidor** —hoy sólo la usa `search()`—, y `searchPageSchema` |
| `core` | `anilist-search.ts` se queda **sólo** con `hasGenreToken` (lo usan la búsqueda y su ruta) y `genreKey` **si conserva consumidor**; se van `parseAniListInput`, `buildAniListVariables`, `displayTitleOf`, `ANILIST_SORT_*` y `DEFAULT_PER_PAGE`/`MAX_PER_PAGE`, con sus exportaciones del barril |
| `core` | `anilistSearchResponseSchema` y `AniListSearchResponse` de `api.ts`, y sus casos de prueba |

`anilistGenre`, `ANILIST_GENRES`, `anilistEntrySchema` y `catalog.cross` **no se tocan**: son lo que
contesta la búsqueda por género, que es justo lo que esta propuesta viene a usar más.

**La propuesta `docs/specs/proposals/SPEC-anilist-search.T140.md` queda retirada.** Describía esa
pantalla y su API, y las dos desaparecen; su archivo se borra al integrar esto.

### `web-ui` — la ficha a sangre

La banda deja de ser una tarjeta dentro de la caja de la pantalla. `.shell__main` mide
`max-inline-size: var(--content-max)` con `padding: var(--space-7) var(--space-6)`, y la banda es
una fila de la rejilla `.detail` que vive dentro: de ahí el marco y el aire con la cabecera.

El cambio es la tercera variante de la caja, hermana de `--ancha` y `--sin-tope`:

```
.shell__main--ficha      max-inline-size: none; padding: 0;      (cuando route.name === 'detail')
```

y el marcado de la ficha se parte en dos:

```
.detail                  la ficha entera, a lo ancho de la ventana
├─ .detail__banner       la banda: sin borde, sin radio, pegado al borde inferior de la cabecera
│  └─ .detail__banner-caja   la caja del contenido, con la medida del sitio
└─ .detail__cuerpo       la rejilla de siempre: barra lateral + principal, con la medida del sitio
   ├─ .detail__aside
   └─ .detail__body
```

- `.detail__banner` conserva `isolation: isolate` y `overflow: clip` —la capa del fondo va en
  `z-index: -1` y sin contexto propio se iría detrás del fondo de la página—, su
  `min-block-size: var(--detail-banner-alto)`, el relleno en bloque y la disposición en columna con
  `justify-content: flex-end`. Pierde `border`, `border-radius` y el relleno en línea. La capa
  `.detail__banner-fondo` y su velo `::after` **no cambian**: el velo sigue acabando en
  `var(--color-bg)` al 100 %, que es lo que sostiene el titular sobre una fotografía cualquiera.
- `.detail__banner-caja` es lo que alinea el titular con el resto de la ficha:
  `inline-size: 100%; max-inline-size: var(--content-max); margin-inline: auto;
  padding-inline: var(--space-6)`, en columna y con el `gap: var(--space-2)` que tenía la banda.
  Sin la caja, en una ventana de 2560 px el nombre quedaría a 32 px del borde y la sinopsis a 680.
- `.detail__cuerpo` es la rejilla que hoy es `.detail` (`grid-template-columns:
  minmax(var(--grid-min), var(--aside-width)) 1fr; gap: var(--space-6)`), más
  `max-inline-size: var(--content-max); margin-inline: auto; padding: var(--space-7) var(--space-6)`.
  Recupera así la medida que la caja de la pantalla ya no le da.
- Sin margen con la cabecera: la caja no tiene relleno superior y la banda no tiene margen. El aire
  entre la banda y las columnas lo pone el `padding-block-start` de `.detail__cuerpo`.
- Las dos clases nuevas se definen en `shell.css` en el mismo cambio: `styles.test.ts` falla si una
  clase del marcado no está en ningún CSS, y es el fallo que se quiere.

### `web-ui` — el género con `#`, el estudio sin él

En `.detail__datos`, el nombre de un género enlaza a la búsqueda **por género del catálogo** cuando
AniList conoce ese nombre, y a la búsqueda de siempre cuando no:

```
anilistGenre(genero) === undefined
  ? searchPath(genero)              ->  /search?q=Isekai        (el catálogo local, como hoy)
  : searchPath(`#${genero}`)        ->  /search?q=%23Aventura   (el catálogo de AniList)
```

El nombre del **estudio no lleva `#`, nunca**: con `#`, `hasGenreToken` manda la búsqueda al catálogo
y `anilistGenre('#Estudio Cobre')` no resuelve, así que la consulta se quedaría en la búsqueda de
estudios por el texto `#Estudio Cobre` —cero resultados—. Hoy ese enlace funciona y sigue igual.

El `title` de cada enlace dice a dónde lleva, y son dos frases porque son dos destinos: la de
siempre —«Ver los títulos del género {name}»— y una nueva para el ancho. Un lector de pantalla tiene
que poder distinguir «lo que ya está en tu catálogo» de «todo lo que AniList tiene de ese género».

### `core`, `catalog-store` y `server` — la marca de visto

**`catalog-store`: una tabla y una lectura.**

```
watched_title    anime_id, created_at        -- migración 0011-visto.sql
```

Con la forma de `favorite` y por el mismo motivo: es una marca del usuario, una por obra, sin TTL
—no se vence— y protegida de la poda como el favorito, y la clave primaria es lo que hace
idempotente el botón. **No** es una columna de `anime`: una marca del usuario no es un dato de la
obra, y el refresco del proveedor no puede pisarla. **No** escribe `watch_event`: eso fabricaría
progreso de episodios que nadie vio y ensuciaría la afinidad del motor, que se calcula con lo que de
verdad se reprodujo.

```
setWatchedTitle(ref: ProviderRef, value: boolean): Promise<void>
listWatchedTitles(): Promise<readonly WatchedTitle[]>   // WatchedTitle = AnimeSummary + watchedAt: Date
```

`setWatchedTitle` es idempotente y lanza `StoreError` si el título no está en la base, igual que
`setFavorite`: el caso normal es una obra cuya ficha nadie abrió, y eso es un 404, no un 500.
`listWatchedTitles` es **una sola consulta** con `JOIN`, ordenada por `created_at DESC`, como la de
favoritos. La lectura entra en el acotado de `provider-scope.ts`, que es el único sitio donde la
regla «no ofrezcas una tarjeta de un proveedor que no está cargado» se aplica.

**Y entra en la poda, que es lo que se olvida.** La limpieza de huérfanos borra a los 90 días todo
detalle sin actividad, y hoy protege de ese borrado a lo que tiene un favorito o un visionado
reciente (`prune.ts:59-73`). Una obra marcada como vista puede no tener ninguna de las dos cosas —una
película vista fuera de la aplicación— y su marca desaparecería sin que nadie la quitara. La marca
se suma a las dos protecciones y `watched_title` entra en `PRUNED_TABLES` con su cuenta, que es el
informe que dice qué tocó la limpieza. El motivo es el que ya está escrito para el favorito: **ante
la duda, se conserva lo que el usuario marcó a mano**.

**`core`: dos formas compartidas.** `watchedTitleRequestSchema` (`{ ref, value }`, idéntica a
`favoriteRequestSchema`) y `watchedTitlesResponseSchema` (`{ items: AnimeSummary[] }`). La fecha de
la marca no viaja: la usa el motor para desempatar y la interfaz no la pinta; una forma que nadie
usa es una promesa que nadie pidió.

**`server`: `GET /api/watched-titles` y `POST /api/watched-titles`.** 204 al dejar la marca en el
estado pedido, 404 si el título no está, 400 si el cuerpo no valida —el mismo contrato que
`/api/favorites`, que es donde se copia—.

**Sin filtro de adultos en el `GET`, y es una decisión.** `/api/favorites` lo lleva porque alimenta
una fila de la vitrina que enseña tarjetas; ésta contesta una pregunta de estado —«¿esta obra está
marcada?»— y la lee el botón de la ficha. Filtrarla dejaría el botón en «no está» sobre una obra que
sí está marcada, y pulsarlo no haría nada visible: la marca es del usuario, no del catálogo. El día
que haya una fila «Vistos» en la vitrina, el filtro va donde se arman las tarjetas, no aquí.

### `server` — «Continuar viendo» y el motor respetan la marca

- **`/api/watch/recent`** descarta las filas de un título marcado, con una lectura de
  `listWatchedTitles` y un `Set` de referencias, **en la ruta y no en la consulta**:
  `listRecentlyWatched` alimenta también las señales del motor, y filtrarla ahí borraría la afinidad
  de un título que sí se vio. El patrón es el que ya usa `gatherSignals` para las marcas de adultos:
  la tabla se lee entera porque es pequeña por construcción —una fila por obra marcada— y preguntar
  por cada fila sería la consulta de mil parámetros que el spec del almacén prohíbe.
- **El motor** recibe la marca como lo que es: `watchState += { ref, ratio: 1, at: watchedAt }`, con
  la referencia marcada **fuera** de los estados de sus filas de visionado, para que una fila vieja
  al 10 % no le gane por fecha al reencuentro. Al 100 % `filterCandidate` devuelve `keep: false` sin
  excepción, así que la marca excluye siempre; y como el `reason` del filtro no sale en la API, la
  exclusión no inventa ningún texto para el usuario. **`recsys` no cambia**: lo que cambia es lo que
  el servidor le cuenta.
- La composición vive en una función pura nueva de `recommend/signals.ts`, junto a
  `watchStateFrom`, que se prueba sola. `watchStateFrom` no se toca: su contrato —una fila de
  visionado, un estado— sigue siendo el mismo.

### `web-ui` — el botón de visto en la ficha

`.detail__actions` gana un segundo botón, hermano del de favoritos y con el mismo contrato de
siempre: un `<button aria-pressed>`, estado inmediato y reversión si el servidor falla, la marca
leída de la lista al montar y sin pisar lo que la persona acaba de decidir.

- `useWatchedTitle(ref)`, junto a `useFavorite` y con su misma forma: lee `GET /api/watched-titles`
  **sin señal** —el cliente deduplica por ruta, y con una señal propia cada botón pediría la suya— y
  escribe con `POST`.
- textos nuevos en `packages/web/src/i18n/es.ts`: `detail.watched.add` —«Marcar como visto»— y
  `detail.watched.remove` —«Quitar de vistos»—. El botón dice el estado en el que está, como el de
  favoritos, y no menciona episodios: la marca es de la obra, y vale igual para una película.
- El botón sale en todas las fichas, película o serie: `detail.kind === 'movie'` cambia el titular
  de la lista de episodios, no lo que se puede marcar.

## Estructura de los archivos

```
docs/specs/proposals/SPEC-anime-detail.T145.md   esta propuesta (se borra al integrar)
borrado: docs/specs/proposals/SPEC-anilist-search.T140.md

packages/web/src/
├─ app.tsx                     sin el enlace de Catálogo, y `ficha` para la caja de la ficha
├─ router.tsx                  sin el nombre ni el patrón de `anilist`
├─ i18n/es.ts                  fuera `nav.anilist` y `anilist.*`; dentro `detail.watched.*` y el
│                              `title` del género ancho
├─ styles/shell.css            `.shell__main--ficha`, `.detail__banner-caja`, `.detail__cuerpo`,
│                              `.detail__banner` sin marco
├─ features/anilist/           borrado entero
└─ features/detail/
   ├─ DetailPage.tsx           la caja de la banda, el enlace del género, el botón de visto
   ├─ useDetail.ts             `useWatchedTitle`, al lado de `useFavorite`
   └─ WatchedButton.tsx        nuevo

packages/core/src/
├─ anilist-search.ts           sin `parseAniListInput`/`buildAniListVariables`/`displayTitleOf`
├─ api.ts                      `watchedTitleRequestSchema`, `watchedTitlesResponseSchema`;
│                              sin `anilistSearchResponseSchema`
└─ index.ts                    el barril, ajustado a lo que queda

packages/catalog-store/src/
├─ migrations/0011-visto.sql   nuevo: `watched_title`
├─ repositories/watched-titles.ts   nuevo: `setWatchedTitle`, `listWatchedTitles`
└─ prune.ts                    la marca protege su obra y se cuenta como las demás tablas

packages/server/src/
├─ routes/watched-titles.ts    nuevo: `GET` y `POST /api/watched-titles`
├─ routes/watch.ts             `/api/watch/recent` descarta lo marcado
├─ routes/anilist.ts           sin el manejador de `/api/anilist/search` ni `searchItem`
├─ recommend/signals.ts        la marca entra en `watchState`
├─ provider-scope.ts           la lectura nueva, acotada
└─ anilist/catalog.ts          sin `search`, sin `genres` si queda huérfano
```

## Estrategia de pruebas

Lo de siempre en este repositorio: cada criterio con la medición que lo sostiene y **mutando la
implementación** para comprobar que la prueba mide algo.

- **`core`** — `anilist-search.test.ts` encoge a lo que queda (`hasGenreToken`, `genreKey` si se
  queda); los casos de la superficie borrada se van con ella. `api.test.ts` gana los dos schemas
  nuevos: uno válido pasa, uno con `value` no booleano o con una clave de más falla.
- **`catalog-store`** — `watched-titles.test.ts` nuevo: la marca puesta dos veces deja **una** fila
  y `created_at` no se mueve; quitarla la borra; marcar un título que no está lanza `StoreError`; la
  lectura devuelve los resúmenes ordenados por fecha. `db.test.ts` cuenta la tabla nueva y sus
  columnas contra la lista del spec. `prune.test.ts` gana el caso hermano del favorito: una obra
  marcada como vista, **sin ningún visionado** y con el detalle vencido hace más de 90 días, sigue
  ahí después de la limpieza; y la misma obra sin la marca sí se va. Mutantes: sin `ON CONFLICT`
  falla el de las dos veces; sin el `JOIN` falla el del resumen; sin `ORDER BY` falla el del orden;
  sin la protección en `doomedAnime` falla el de la poda.
- **`server`** — `watched-titles.test.ts` nuevo, calcado del de favoritos: 204, 404 con el título
  que no está, 400 con el cuerpo inválido, y sin cookie 401. `watch.test.ts` gana el caso de la fila
  marcada: con dos filas a medias —una marcada, otra no— `/api/watch/recent` devuelve **una**, y es
  la no marcada. `signals` gana su primera prueba propia —hoy `recommend/signals.ts` no tiene
  archivo de pruebas— para la composición de la marca: una fila al 10 % de hace un año **y** su
  marca dan un solo estado, `ratio: 1`; sin la marca, el mismo estado es el de la fila. Un test de
  tabla comprueba que la lectura nueva está acotada en `provider-scope.ts`.
- **`web`** — `app.test.tsx` fija que el `<nav>` tiene tres destinos y que ninguno es `/anilist`;
  `router.test.ts` que `/anilist` es `not-found`. `detail.test.tsx`: el género conocido lleva a
  `%23…`, el desconocido a `q=…` sin `#`, y el estudio **nunca** lleva `#` —el caso que se rompe si
  alguien generaliza el `#` a las dos etiquetas—; el botón de visto sale pulsado cuando la lista
  trae la referencia, escribe `{ ref, value: true }` al pulsarlo y vuelve a su estado si el POST
  falla. `styles.test.ts` gana la comprobación de que la banda no tiene `border` ni `border-radius`
  y de que el velo sigue acabando en `var(--color-bg) 100%`.
- **e2e (`detail.e2e.ts`)** — tres medidas nuevas, que sólo existen en un navegador, más los casos
  que ya están:
  1. La banda **no tiene marco ni margen**: su `boundingBox()` empieza en el borde inferior de la
     cabecera, su `x` es 0 y su ancho es el de la ventana; y la caja del titular está alineada con
     `.detail__cuerpo` —el mismo `x`—, que es lo que la caja nueva decide.
  2. El género conocido navega a `/search?q=%23…` y pinta tarjetas de la lista del catálogo.
  3. Pulsar «Marcar como visto», **recargar** y volver a la ficha: el botón sigue pulsado. Es la
     prueba de que la marca está en la base y no en el estado del componente.
  4. Y los casos del banner que ya existen —capa decorativa, `z-index: -1`, ninguna `<img>`, un 404
     que no deja imagen rota— siguen pasando sin tocarlos.

Los casos que se borran con la pantalla —`packages/web/src/features/anilist/anilist.test.tsx`, el
caso de `styles.test.ts` sobre `anilist-page`, y los de `/api/anilist/search` en
`routes/anilist.test.ts`— se van enteros. Un test de algo que ya no existe no mide nada.

## Success Criteria

- [ ] El nombre de un género con equivalente en AniList es un enlace a `/search?q=%23<género>`; el
      de un género sin él, a `/search?q=<género>`; el de un estudio, siempre sin `#`.
      *Medición:* el `href` de las tres clases de etiqueta en `detail.test.tsx`, y el caso e2e que
      navega y comprueba las tarjetas pintadas.
- [ ] `/anilist` no está en el `<nav>`, no existe como ruta del enrutador y la pantalla, sus textos
      y su API no están en el árbol. *Medición:* los casos de `app.test.tsx`, `router.test.ts` y
      `i18n.test.ts` —que falla si queda una clave sin usar—, y un `grep` sin coincidencias de
      `anilist-page`, `useAniListSearch` y `/api/anilist/search`.
- [ ] La banda de la ficha cruza la pantalla, no tiene marco y no tiene margen con la cabecera, con
      el velo intacto y el titular alineado con la ficha. *Medición:* las cuatro medidas del e2e y
      el caso de `styles.test.ts` sobre el velo.
- [ ] `watched_title` existe en la base con `anime_id` y `created_at`, y marcar la misma obra dos
      veces deja una sola fila. *Medición:* `db.test.ts` y el caso de idempotencia, mutando el
      `ON CONFLICT`.
- [ ] Una obra marcada sobrevive a la limpieza de huérfanos aunque no tenga ningún visionado.
      *Medición:* el caso nuevo de `prune.test.ts` y el mutante sin la protección en
      `doomedAnime`.
- [ ] `GET`/`POST /api/watched-titles` tienen el contrato de favoritos —204, 404, 400, 401— y la
      lectura contesta el estado de una obra marcada **también** con el interruptor de adultos
      apagado. *Medición:* el archivo de pruebas de la ruta, con los cuatro estados.
- [ ] Una obra marcada no aparece en «Continuar viendo» ni en las recomendaciones.
      *Medición:* el caso de `watch.test.ts` con dos filas —una marcada— y la prueba nueva de
      `signals`: la marca entra con `ratio: 1` y gana a la fila vieja de la misma referencia.
- [ ] La marca sobrevive a una recarga y a un reinicio del servidor. *Medición:* el caso e2e de
      pulsar, recargar y encontrar el botón pulsado.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes tocados, y
      `bun run e2e -- packages/web/e2e/detail.e2e.ts` con los casos nuevos.

## Boundaries

- **No entra** una pantalla de «vistos»: la marca se guarda, se pinta en la ficha y excluye, y no
  hay lista propia. Tampoco una fila «Vistos» en la vitrina.
- **No entra** marcar episodios a mano. El visto por episodio sigue siendo lo que el reproductor
  registra; la marca nueva es de la obra y no la sustituye ni la resume.
- **No cambia** `recsys`: ni un umbral, ni un tipo, ni un texto.
- **No cambia** el velo del banner, ni el `--detail-banner-alto`, ni la disposición en dos columnas
  de la ficha, ni la medida de lectura de la sinopsis.
- **No se toca** el resto de `routes/anilist.ts`: la imagen por id, `/api/discover/*`, el
  enriquecimiento y `anilist-related` siguen igual.
- **No se toca** `anilistGenre` ni su tabla de alias. Si un género no resuelve, el enlace vuelve al
  catálogo local: ampliar la tabla es otra tarea, con su medición.
- **No se toca** `SPEC-live-home.md` ni el TTL de la búsqueda cruzada.

## Decisiones tomadas (eran las preguntas abiertas)

1. **El `#` se pone sólo cuando AniList conoce el género, y la alternativa era ponerlo siempre.**
   Con `#` siempre, un género que no está en los 18 de AniList —«Isekai», «Seinen», «Escolar»— deja
   la búsqueda en el catálogo de AniList, que no lo entiende: la consulta cruzada se queda buscando
   estudios por ese texto y la pantalla dice «Nada en el catálogo coincide». Hoy ese mismo enlace
   enseña los títulos locales de ese género, y perder eso para que la dirección lleve un `#` es
   cambiar algo que funciona por algo que se ve bonito. Con la condición, el `#` aparece exactamente
   donde el catálogo se ensancha —que es donde el usuario lo pidió— y lo demás sigue como estaba.
   Se decide con `anilistGenre` en la mano, que ya vive en `core` y ya lo usa la interfaz.
   *Si se prefiere el `#` siempre, es una línea de esta spec y otra del componente; lo que no se
   puede es dejar el enlace roto sin decirlo.*
2. **La marca no escribe progreso de episodios.** Escribir un `watch_event` por episodio de una
   serie de 1216 capítulos para decir «la vi» inventaría un visionado que nadie hizo, y el motor
   calcula la afinidad con lo que de verdad se reprodujo. La marca entra en el motor como lo que
   es: un estado visto, no una medición.
3. **La marca excluye siempre, sin reencuentro.** El reencuentro de `recsys` es para lo que se dejó
   a medias: «ya visto» dicho a mano no es un abandono del que uno se arrepiente a los dos meses.
4. **El filtro de la marca vive en la ruta, no en la consulta del historial.** Mover la exclusión a
   `listRecentlyWatched` parecía más limpio y era el error: esa lectura es también la señal de
   afinidad del motor, así que un título marcado desaparecería del historial **y** del motor, y el
   motor dejaría de saber que se vio.
5. **La ruta de la marca no filtra por adultos.** Ver el contrato: la lee el botón de la ficha, y
   esconderle la marca lo haría mentir.
6. **La banda se parte en dos cajas en lugar de escaparse con márgenes negativos.** El truco del
   sangrado —`margin-inline: calc(50% - 50vw)`— se rompe con la barra de desplazamiento y no se
   puede alinear con la medida del sitio sin repetir la aritmética en dos sitios. Dos cajas —la
   banda a lo ancho y su contenido con la medida— dicen lo mismo sin ninguna cuenta.
7. **La marca protege su obra de la poda, como el favorito.** Es la consecuencia que no se ve al
   escribir la tabla y se ve a los 90 días: una película marcada como vista, sin un solo visionado,
   entra en el plazo de limpieza y su marca se va con el detalle. Se copia la protección que ya
   existe para el favorito —«ante la duda, se conserva lo que el usuario marcó a mano»— y no se
   inventa una regla nueva.

## Tareas

Cuatro, en este orden. La 1 y la 2 no se tocan entre sí; la 3 va antes que la 4.

### T145, parte 1 — fuera la pantalla de catálogo

**Descripción:** el `<nav>` pierde su destino, `/anilist` deja de ser una ruta, y con ellos se va la
superficie que sólo esa pantalla usaba: su componente, su hook, su ruta, su schema y el análisis de
la casilla en `core`.

**Aceptación:**
- [ ] El `<nav>` de la cabecera tiene Inicio, Buscar y Ajustes, y ninguna ruta lleva a `/anilist`.
- [ ] `/anilist` empareja con `not-found`.
- [ ] No queda ninguna clave `anilist.*` en `i18n/es.ts` sin usar, ni el caso de `styles.test.ts`
      sobre la página, ni los casos de `/api/anilist/search`.
- [ ] `catalog.search`, `catalog.genres` y `searchPageSchema` no tienen consumidor antes de
      borrarse: se comprueba con `grep` y se anota cuál quedó sin consumidor.
- [ ] `docs/specs/proposals/SPEC-anilist-search.T140.md` se borra en el mismo commit.

**Medición:** `bun test packages/web packages/server packages/core` con los casos nuevos y los
borrados, y los `grep` de las tres superficies, sin coincidencias. **Tamaño:** M, con más archivos
de los cinco: es un borrado, no una construcción.

### T145, parte 2 — la ficha: el enlace del género y la banda a sangre

**Descripción:** el `#` en las etiquetas de género con equivalente en AniList, y la banda a lo ancho
con su caja de contenido, sin marco y sin margen con la cabecera.

**Aceptación:**
- [ ] El género con equivalente lleva a `%23<género>`; el que no lo tiene, a `q=<género>`; el
      estudio, nunca con `#`.
- [ ] `.shell__main--ficha` deja la caja a lo ancho y sin relleno; `.detail__banner` pierde borde y
      radio; `.detail__banner-caja` y `.detail__cuerpo` llevan la medida del sitio.
- [ ] El velo sigue acabando en `var(--color-bg) 100%` y el titular sigue sobre él.
- [ ] Con banner y sin banner la ficha mide igual: la banda no depende de la imagen.
- [ ] Las dos clases nuevas están definidas en `shell.css` y el `title` de cada etiqueta dice a
      dónde lleva.

**Medición:** `detail.test.tsx`, el caso del velo en `styles.test.ts` y las cuatro medidas del e2e
—borde de la cabecera, `x` 0, ancho de la ventana y alineación con `.detail__cuerpo`—, con una
captura en los dos temas. **Tamaño:** M.

### T145, parte 3 — la marca de visto, de la base a la API

**Descripción:** la tabla, la lectura, los dos schemas y las dos rutas; y que «Continuar viendo» y
el motor la respeten.

**Aceptación:**
- [ ] `0011-visto.sql` crea `watched_title` con `anime_id` y `created_at`, y `db:migrate` dos veces
      no la reaplica.
- [ ] Marcar dos veces deja una fila; desmarcar la borra; marcar un título que no está lanza
      `StoreError`; la lectura es una consulta y viene ordenada por fecha.
- [ ] La limpieza de huérfanos **no** se lleva una obra marcada: una sin visionados y vencida hace
      más de 90 días sobrevive, y la cuenta de `watched_title` sale en el informe con su cero
      cuando no tocó ninguna.
- [ ] `GET`/`POST /api/watched-titles`: 204, 404, 400 y 401 sin cookie.
- [ ] La lectura nueva está acotada en `provider-scope.ts`.
- [ ] Una fila de visionado de un título marcado no sale en `/api/watch/recent`.
- [ ] El motor recibe un solo estado por referencia marcada, con `ratio: 1`, y gana a la fila de
      visionado de esa misma referencia aunque sea más reciente.

**Medición:** `bun test packages/catalog-store packages/server packages/core`, con los mutantes
dichos en «Estrategia de pruebas», y `curl` contra el servidor en marcha para los cuatro códigos.
**Tamaño:** M.

### T145, parte 4 — el botón de visto en la ficha

**Descripción:** `useWatchedTitle` y el botón, con los textos.

**Aceptación:**
- [ ] El botón es un `<button aria-pressed>` en `.detail__actions`, junto al de favoritos, y sale
      igual en una serie y en una película.
- [ ] Sale pulsado cuando la obra está marcada, y el estado se lee del servidor al montar, sin
      pisar lo que la persona acaba de decidir.
- [ ] El cambio se pinta antes de que el servidor conteste y se revierte si falla.
- [ ] Los dos textos viven en `i18n/es.ts` y ninguna clave queda sin usar.

**Medición:** `detail.test.tsx` y el caso e2e de pulsar, recargar y encontrar el botón pulsado.
**Tamaño:** S.

## Enmiendas propuestas a specs aprobados

| Spec | Qué cambia |
|---|---|
| `SPEC-anime-detail.md` | El bloque `web-ui` gana la regla del `#` (sólo géneros, sólo con equivalente en AniList) y el `title` nuevo; la estructura de la ficha pasa a `.detail__banner` + `.detail__banner-caja` + `.detail__cuerpo`; `.detail__actions` gana el botón de visto. El bloque `catalog-store` gana `setWatchedTitle` y `listWatchedTitles` y nombra `watched_title`. El bloque `server` gana `/api/watched-titles` y el descarte de lo marcado en `/api/watch/recent` |
| `SPEC-web-ui.md` | La cabecera pierde «Catálogo»; la lista de rutas de la SPA no gana `/anilist` —no existía ahí, y ahora se dice—; la lista de rutas HTTP pierde `GET /api/anilist/search` y gana `GET`/`POST /api/watched-titles`; la caja de pantalla gana la variante de la ficha |
| `SPEC-catalog-store.md` | La tabla `watched_title` en el contrato del almacén y la lectura nueva en la fachada y en el acotado; la poda de huérfanos protege la marca y la cuenta, como ya hace con el favorito —regla que hoy no está en el spec y sí en el módulo— |
| `SPEC-nn-anime.md` | El Data Model gana `watched_title` (`anime_id`, `created_at`), con el motivo de no ser una columna de `anime` ni un `watch_event`. Las tablas que otras propuestas pendientes ya añadieron (`anilist_*`, `adult_ref`) no son de ésta y quedan como estén |
| `SPEC-recsys.md` | **No cambia.** Se anota aquí que la marca entra como `ratio: 1` y que su `reason` de filtro no viaja a la API |
| `docs/specs/proposals/SPEC-anilist-search.T140.md` | Se **retira**: su pantalla, su ruta y su API desaparecen con esta propuesta |

## Open Questions

1. **`--detail-banner-alto` en una banda a sangre.** 16 rem era el alto de un recuadro; a lo ancho
   de una ventana de 2560 px la proporción cambia. Se deja como está y se decide con una captura
   delante al implementar la parte 2, no antes.
2. **El nombre del botón.** «Marcar como visto» / «Quitar de vistos» es lo que dice esta spec; si al
   verlo en pantalla pide otra cosa —«Visto» a secas—, es un texto y no un contrato.
