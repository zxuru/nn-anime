# Propuesta · las familias de contenido y el formato

**Sobre** `fe5ac0c` (v0.8.0). **Origen:** la confusión que aparece al cambiar de pestaña: una
película de anime no tiene un sitio claro, una serie de animación occidental no está catalogada y
«Películas» promete un formato cuando lo que separa es otra cosa.

**Estado:** **aprobada el 2026-11-16.** La fase 1 —el contrato en `core` y los cuatro specs— se
integró en T257a (commit `feat(core): familias de contenido y formato en el contrato (T257a)`). Las
fases 2–4 siguen abiertas, y este archivo se conserva como registro de la aprobación hasta que se
cierren.

Toca **`SPEC-provider-core`** (la capacidad y el tipo por título), **`SPEC-discovery`**,
**`SPEC-recsys`** y **`SPEC-web-ui`** (la navegación). `SPEC-catalog-store` no cambia de forma: los
campos nuevos viajan en el JSON que ya guarda.

## El problema, en una línea

La aplicación parte el catálogo en «anime» y «películas», pero esos dos nombres no son dos ejes:
`movies` significa «todo lo que no es anime» para las fuentes y «las películas de anime» para
AniList. La misma pestaña enseña dos cosas distintas, y una película de anime no tiene sitio.

## Las dos pruebas de que el vocabulario está mezclado

1. **En el contrato de las fuentes.** `MediaFilter` es `'anime' | 'movies'`
   (`packages/core/src/media.ts:32`) y `mediaTypeSchema` es
   `['anime', 'movie', 'series', 'manga']` (`packages/core/src/schema.ts:185`). En la primera,
   `movies` es una familia; en el segundo, `anime` es una familia y `movie`/`series` son formatos.
   `mediaTypeOf` (`packages/core/src/media.ts:49`) tapa el hueco deduciendo una cosa de la otra: en
   una fuente `both`, `kind: 'movie'` cae del lado de películas aunque sea anime, y `kind: 'tv'` cae
   del lado de anime aunque sea de acción real.

2. **En AniList.** `FORMATOS` (`packages/server/src/anilist/catalog.ts:77`) parte el
   descubrimiento en `anime: [TV, TV_SHORT, SPECIAL, OVA, ONA]` y `movies: [MOVIE]`. Es decir: en la
   pestaña «Películas», las filas de AniList son **películas de anime**, mientras las filas de los
   proveedores son **contenido que no es anime**. La pestaña mezcla las dos definiciones sin que
   nada lo diga.

Al usuario le pasa lo que se ve: cambia a «Películas» y encuentra películas de anime, series
occidentales y acción real en la misma lista, sin forma de pedir sólo una de las tres.

## El modelo: dos ejes ortogonales

| Eje | Vocabulario | Qué decide |
|---|---|---|
| **Familia** | `anime` · `animation` · `live` | De qué es la obra |
| **Formato** | `series` · `movie` | Cómo está contada |

- `animation` es la animación que **no** es anime: series y películas occidentales, adultas o
  infantiles.
- `live` es la imagen real: series y películas rodadas con personas.
- Una **película de anime** es `family: anime` + `format: movie`. Vive en la pestaña Anime y se
  puede aislar con el filtro de formato.
- `manga` no entra en ninguno de los dos ejes: es un soporte y tiene su propia fase (2.7). El valor
  `mediaType: 'manga'` sigue leyéndose y sigue sin caer en ninguna pestaña de vídeo.

La regla es una sola y vive en `core`, como hoy: la usan el servidor, el motor de recomendaciones y
la interfaz.

## 1. `core`: el vocabulario y las reglas

```ts
export const mediaFamilySchema = z.enum(['anime', 'animation', 'live'])
export const mediaFormatSchema = z.enum(['series', 'movie'])

export type MediaFamily = z.infer<typeof mediaFamilySchema>
export type MediaFormat = z.infer<typeof mediaFormatSchema>

/** Lo que se pide a una lectura. Sin familias, todas; sin formato, los dos. */
export interface MediaFilter {
  /** Un conjunto y no un valor: el alias viejo `movies` significa dos familias. */
  readonly families?: readonly MediaFamily[] | undefined
  readonly format?: MediaFormat | undefined
}

/** Las familias de un proveedor, con `media` heredado ya traducido. */
export function familiesOf(capabilities: Pick<ProviderCapabilities, 'media' | 'families'>): readonly MediaFamily[]

export function familyOf(
  item: { readonly family?: MediaFamily; readonly mediaType?: MediaType; readonly kind?: TitleKind },
  familias: readonly MediaFamily[],
): MediaFamily

export function formatOf(
  item: { readonly format?: MediaFormat; readonly mediaType?: MediaType; readonly kind?: TitleKind },
): MediaFormat

export function esDeFamilia(
  filtro: readonly MediaFamily[] | undefined,
  familia: MediaFamily,
): boolean

export function puedeServirFamilia(
  filtro: readonly MediaFamily[] | undefined,
  familias: readonly MediaFamily[],
): boolean

export function pasaElFiltro(filtro: MediaFilter, item: Clasificable, familias: readonly MediaFamily[]): boolean
```

### De dónde sale la familia

En este orden:

| Entrada | Resultado |
|---|---|
| `item.family` declarado | ese valor |
| `item.mediaType: 'anime'` (compatibilidad) | `anime` |
| `item.mediaType: 'movie'` / `'series'` (compatibilidad) | la familia que toque por el conjunto y el `kind`, como la fila de abajo |
| `item.mediaType: 'manga'` | ninguna pestaña de vídeo; se conserva el valor |
| el proveedor sirve **una** familia | esa familia |
| el proveedor sirve **varias**, sin dato por título | `kind === 'movie'` → `live` si está, si no `animation`, si no `anime`; cualquier otro `kind` → `anime` si está, si no `animation`, si no `live` |
| sin proveedor (fila huérfana) | `anime` (el defecto del contrato) |

La penúltima fila es la regla de hoy, generalizada: para `anime`/`movies`/`both` da exactamente el
mismo resultado que `mediaTypeOf` (un `movie` de una fuente mixta cae en `live`, un `tv` cae en
`anime`). Un proveedor mixto que no clasifique sus títulos sigue comportándose como hoy; lo que
cambia es que **ahora puede** clasificarlos, y el fixture y la documentación lo enseñan.

### De dónde sale el formato

| Entrada | Resultado |
|---|---|
| `item.format` declarado | ese valor |
| `mediaType: 'movie'` | `movie` |
| `mediaType: 'series'` o `'anime'` | `series` |
| `kind: 'movie'` | `movie` |
| `kind: 'tv' \| 'ova' \| 'ona' \| 'special'` | `series` |
| sin nada | `series` (un título sin formato no es una película) |

`ova`, `ona` y `special` son series a los efectos de la navegación: un OVA no es una película, y el
usuario no pide «sólo OVAs».

### Las formas que viajan

```ts
// searchResultSchema y animeDetailSchema (que lo extiende)
family: mediaFamilySchema.optional(),
format: mediaFormatSchema.optional(),
mediaType: mediaTypeSchema.optional(),   // se conserva; se lee y no se escribe

// animeSummarySchema, recommendationSchema, candidateSchema y continueWatchingItemSchema
family: mediaFamilySchema.optional(),
format: mediaFormatSchema.optional(),
```

`mediaType` **no se retira**: hay manifiestos y filas guardadas que lo usan. Se deja de escribir en
lo nuevo y se sigue leyendo para siempre; retirarlo es una limpieza posterior, no este cambio.

## 2. `provider-core`: qué sirve un proveedor

`providerMediaSchema` (`anime | movies | both`) no puede expresar «sirve anime y acción real pero no
animación occidental», que es un caso real. Se añade una capacidad y se conserva la vieja:

```ts
export const providerCapabilitiesSchema = z.strictObject({
  // …
  /** Qué sirve, como conjunto. Si está, gana sobre `media`. */
  families: z
    .array(mediaFamilySchema)
    .min(1)
    .refine((familias) => new Set(familias).size === familias.length)
    .optional(),
  media: providerMediaSchema.optional(),   // legado
  mediaPerTitle: z.boolean().optional(),   // ya existe
})
```

Mapeo de lo que ya está publicado:

| `media` | `families` equivalentes |
|---|---|
| ausente o `anime` | `['anime']` |
| `movies` | `['animation', 'live']` (el «todo lo que no es anime» de hoy) |
| `both` | `['anime', 'animation', 'live']` |

- **`families` y `media` en el mismo manifiesto**: gana `families`, y `assertConforms` no lo impide
  —es una declaración, no un método—. Se documenta en `docs/providers.md`.
- **`mediaPerTitle`** ya significa «digo qué es cada título». Se extiende a `family` y `format`; no
  hace falta una capacidad nueva. Un plugin que ya la declara puede mandar los campos nuevos; uno
  que no, no los manda.
- **Sin subir `apiVersion`**: los tres campos son opcionales y la app vieja rechaza el manifiesto
  **al cargar** si ve `families`, que es el gate que ya usan `seasons` y `episodePages`. Subir a
  `'2'` sigue reservado al contrato de manga.

### El fixture

`packages/providers-fixture` declara hoy `media: 'both'` y reparte por `kind`. Pasa a declarar
`families: ['anime', 'animation', 'live']` y a clasificar cada título:

- «Aurora Nocturna» y el resto de anime: `family: 'anime'` (con `kind: 'tv'` → `format: 'series'`).
- «El Jardín de Hierro»: `family: 'live'`, `format: 'movie'`.
- Dos títulos nuevos: una serie de animación occidental (`family: 'animation'`, `kind: 'tv'`) y una
  película de anime (`family: 'anime'`, `kind: 'movie'`). Sin ellos, la regla nueva no tiene una
  prueba que la distinga de la vieja.

## 3. `discovery` y `recsys`: qué se pide

Las lecturas aceptan dos parámetros **opcionales y aditivos**:

```
GET /api/trending?family=anime|animation|live&format=series|movie
GET /api/feed?family=&format=
GET /api/catalog/recent?family=&format=
GET /api/recommendations?family=&format=
GET /api/search?q=&provider=&family=&format=
GET /api/discover/top?family=&format=
GET /api/discover/airing?family=&format=
GET /api/discover/recent?family=&format=
```

- `media` sigue aceptándose como alias de una versión anterior:
  `anime` → `families=['anime']`; `movies` → `families=['animation', 'live']` (el «no anime» de
  hoy); `both` → sin filtro. El alias se traduce en `routes/media.ts` y no se propaga.
- Un valor fuera del vocabulario es **400** con el valor delante y las opciones, como hoy.
- **El filtro del proveedor va antes de preguntar y el del título después de la caché**, igual que
  hoy. A una fuente que no sirve una familia no se le pide.
- **AniList sólo sirve anime.** Las tres rutas de descubrimiento (`top`, `airing`, `recent`) con
  `family=animation|live` devuelven `items: []` sin preguntar al tercero. Con `family=anime` el
  formato manda:
  - `top`: `series` pide los cinco formatos seriados, `movie` pide `MOVIE`, y sin formato pide los
    seis. Hoy la pestaña Anime pide sólo los cinco y deja las películas de anime al otro lado; con
    el eje separado, la pestaña Anime sin filtro las incluye, que es el arreglo.
  - `airing`: `movie` devuelve `[]` sin consultar —una película no tiene parrilla de episodios— y
    `series` o la ausencia piden la parrilla de siempre.
  - `recent`: `movie` pide los estrenos de películas, `series` la emisión reciente y **sin formato
    se piden las dos y se deduplican**, porque «Todo» en la pestaña Anime significa las dos.
  `FORMATOS` pasa a ser una función de `MediaFormat | undefined` y no de la media, que es lo que
  siempre fue.
- En `/api/search` el formato va en la petición y no en la interfaz, por el mismo motivo que hoy:
  filtrar al llegar deja el gasto hecho y los recuentos mintiendo.
- En `/api/recommendations` el filtro de candidatos va antes de recomendar.

### Lo que hay que saber de un título guardado

`animeSummarySchema` gana `family` y `format` opcionales, y `continueWatchingItemSchema` también
(hoy no lleva ni `kind`, y por eso lo visto a medias de una fuente mixta cae siempre del lado del
anime). `candidateSchema` y `recommendationSchema` ganan los mismos dos campos, validados contra el
vocabulario en `gatherSignals` —como ya se hace con `kind`—.

**No hay migración.** `anime.raw_json` guarda el detalle entero y `search_cache.results_json` el
resultado entero, así que `recent` puede leer `$.family` y `$.format` con `json_extract`. Una fila
vieja sin ellos se clasifica con la regla de compatibilidad de la sección 1.

El **contrato** de `catalog-store` no cambia de forma, pero cinco lecturas que arman un
`AnimeSummary` —favoritos, vistos, quiero ver, historial y relacionados— pasan a extraer los dos
campos del `raw_json`. Se hace con **un helper único** en vez de repetir el `kindOf` que ya está
copiado cinco veces, y así la regla de compatibilidad no se escribe cinco veces.

## 4. `web`: tres pestañas y un filtro

- El conmutador pasa a **tres enlaces**: `Anime` · `Animación` · `Acción real`. Siguen siendo
  enlaces con `aria-current` y la familia vive en la dirección (`?tipo=anime|animation|live`).
- Debajo, un **filtro de formato**: `Todo` · `Series` · `Películas`, en la dirección
  (`?formato=series|movie`; ausente es `Todo`). Se pinta siempre en las tres pestañas: es una
  consulta válida aunque una familia no tenga películas, y esconderlo según los resultados haría
  que apareciera y desapareciera al cambiar de familia. La lista vacía se explica con el estado de
  siempre.
- **Los nombres.** El humano eligió «Anime · Series animadas · Series y películas». Con el filtro de
  formato dentro, los dos últimos rótulos describen mal una pestaña que incluye películas, así que
  quedan como **descripción** de cada pestaña y el rótulo dice la familia:
  - Anime — «Series y películas de anime»
  - Animación — «Series animadas que no son anime»
  - Acción real — «Series y películas con personas»
- **La dirección vieja no rompe.** `?tipo=movies` se lee como `live` (el sucesor natural de
  «Películas») y la navegación la reescribe. Es una ruptura menor y declarada: no hay una familia
  nueva que signifique «todo lo que no es anime», porque esa era justamente la confusión.
- Las filas de AniList (`descubrir`, `parrilla`, `emisiones`) sólo se piden en Anime. En Animación y
  Acción real no se pintan: no hay dato de AniList que las llene, y una fila vacía permanente se
  lee como un fallo.
- `enElTipo` se parte en `enLaFamilia` y `enElFormato`; `useMedias` pasa a `useFamilias`, con el
  mapeo de `media` heredado en un solo sitio.
- `pathConTipo` conserva la familia y el formato al cambiar de pestaña y de pantalla, como hoy
  conserva el tipo; el formato sólo se queda en las pantallas que listan (home y búsqueda) y se cae
  al abrir una ficha o el reproductor.
- `sinFuenteQueSirva` cuenta familias: una instalación sólo de anime avisa en las otras dos
  pestañas, como hoy avisa en películas.
- El alta de proveedor (`RegisterProvider`) cambia el desplegable de `media` por tres casillas
  —Anime, Animación, Acción real— que escriben `families`. Al editar un plugin viejo, sus familias
  heredadas salen ya marcadas. `ProviderList` pinta las familias declaradas y no la media heredada.
- Los textos nuevos van en `packages/web/src/i18n/es.ts`: `media.anime`, `media.animation`,
  `media.live`, `media.format.all|series|movie`, y las tres descripciones.

## 5. Lo que no cambia

- **`titleKindSchema`** sigue siendo el formato que publica la fuente (`tv`, `movie`, `ova`, `ona`,
  `special`). No se toca: es un dato del proveedor, no una clasificación de la aplicación.
- **Las rutas de reproducción, el catálogo de episodios, las descargas y el watch party** no saben
  de familias. Un episodio sigue siendo un episodio.
- **`/api/providers` y `/api/settings`** no cambian de forma: las capacidades viajan enteras.
- **La conformidad** no gana una comprobación: `families` es una declaración sin método detrás.

## 6. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Tres valores en `MediaFilter` y nada más (`anime\|animation\|live`) | Arregla la familia pero deja el formato fuera: una película de anime y una serie de anime no se pueden separar, que es la mitad del problema |
| Un `mediaType` de seis valores (`anime-series`, `anime-movie`, …) | Aplana dos ejes en un vocabulario que crece con cada combinación; filtrar por familia obliga a enumerar valores y añadir manga duplica la tabla |
| Renombrar «Películas» a «No anime» | Es honesto y no cuesta, pero no da sitio a la animación occidental ni a la acción real, y deja la película de anime donde estaba |
| Deducir la familia del título con AniList o TMDB | Una consulta de red por título, un emparejamiento que ya falla con homónimos (F7) y una heurística que acierta casi siempre y falla en silencio |
| Que el usuario clasifique cada título | Trabajo manual por título, y el autor del plugin ya sabe la respuesta |

## 7. Qué se mide al integrarlo

Cada punto se marca con la mutación que lo hace fallar, como pide el DoD.

1. **`core`**
   - `mediaFamilySchema` y `mediaFormatSchema` aceptan su vocabulario y rechazan `'documental'` y
     `'miniserie'`.
   - `familyOf`: cada fila de la tabla, incluida la fuente mixta sin dato por título → `movie` a
     `live`, `tv` a `anime`.
   - `formatOf`: `kind: 'movie'` → `movie`; `ova`/`ona`/`special` → `series`; `mediaType` gana a
     `kind`; sin nada, `series`.
   - Una película de anime con `family: 'anime'` y `format: 'movie'` pasa el filtro
     `{families: ['anime'], format: 'movie'}` y no el de `{families: ['live']}`.
   - **Mutaciones**: invertir la precedencia de `family` (1 fallo), volver a deducir la familia del
     `kind` cuando hay `family` (1), contar `movie` como serie (1).

2. **`provider-core`**
   - Un manifiesto con `families: ['anime', 'live']` se acepta; con `families: []` o
     `['anime', 'anime']` se rechaza nombrando el campo.
   - `familiesOf` y el mapeo heredado dan las tres filas de la tabla.
   - Un plugin viejo sin `families` sigue conformando.
   - **Mutaciones**: ignorar `families` cuando está (1), mapear `movies` a sólo `live` (1).

3. **`server`**
   - `?family=anime&format=movie` devuelve sólo películas de anime; sin `format`, series y películas.
   - Una fuente `['anime']` no recibe la petición de `family=live` —lo dice el contador del fixture—.
   - `?family=animation` en `/api/discover/top` devuelve `items: []` y **no** llama a AniList.
   - `?format=series` en `/api/discover/top` pide los cinco formatos seriados; `movie` pide `MOVIE`.
   - `?media=movies` (alias viejo) sigue devolviendo lo de hoy.
   - Un valor inventado es 400 con las opciones.
   - `recent` reparte por `family`/`format` leídos de `raw_json` y cae a la regla heredada si no
     están.
   - **Mutaciones**: no filtrar por familia (varias), preguntar a AniList en Animación (1), ignorar
     `format` en `FORMATOS` (1).

4. **`recsys`**
   - Un candidato con `family: 'animation'` no entra en la pestaña Anime; uno sin familia cae por la
     regla heredada.
   - `recommendationSchema` devuelve los dos campos y `gatherSignals` descarta un valor inventado.
   - **Mutaciones**: filtrar después de recomendar (1), no validar el valor (1).

5. **`web`**
   - El conmutador tiene tres enlaces, el activo lleva `aria-current="page"` y la familia está en la
     dirección.
   - El filtro de formato escribe `?formato=` y sigue visible en las tres familias.
   - `?tipo=movies` abre Acción real y se reescribe.
   - Los favoritos y lo visto a medias se reparten por familia y formato.
   - **Mutaciones**: quitar `family` de la dirección (1), no reescribir `movies` (1), volver a
     `enElTipo` (1).

6. **`providers-fixture`**
   - Declara las tres familias y clasifica cada título; `assertConforms` sigue aceptándolo.
   - El e2e de la home comprueba que el mismo título no sale en dos pestañas y que una película de
     anime sale en Anime con el filtro «Películas».

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un proveedor mixto publicado no clasifica sus títulos y conserva la regla vieja | Es la compatibilidad; el fixture y `docs/providers.md` enseñan el camino nuevo. No se inventa la familia |
| Un plugin usa `families` y una app vieja lo rechaza | Es el gate buscado: falla al cargar con el campo delante, no en la primera respuesta |
| La home de Animación y Acción real queda vacía sin proveedores | Es el estado honesto: `sinFuenteQueSirva` lo explica y Ajustes dice qué falta |
| Un marcador viejo con `?tipo=movies` cae en Acción real | Se declara la ruptura y se reescribe la dirección; no hay una familia que signifique «lo que no es anime» |
| El formato de un OVA o un especial queda como serie | Es la lectura que el usuario espera; si algún día importa, `format` gana un tercer valor sin romper |

## 9. Decisiones del humano

- **2026-11-16 — navegación**: tres pestañas por familia y filtro de formato dentro. Descartadas las
  dos pestañas con subfiltro.
- **2026-11-16 — nombres**: el humano eligió «Anime · Series animadas · Series y películas». Como el
  formato pasa a ser un filtro, «Series animadas» y «Series y películas» quedan como descripción y
  los rótulos son «Anime · Animación · Acción real». Si prefiere los suyos en el rótulo, es un
  cambio de i18n, no de contrato.

## 10. Aprobación y fases

Aprobada por el humano el **2026-11-16**, con una condición: se hace **una fase por task** y cada una
con su commit. El estado a día de hoy:

| Fase | Qué | Estado |
|---|---|---|
| 1 | Contrato en `core`: vocabulario, `familiesOf`, `familyOf`, `formatOf`, `pasaElFiltro`, `capabilities.families`, campos opcionales y specs | **hecha** (T257a) |
| 2 | Servidor: rutas `family`/`format`, alias `media`, AniList por formato, `catalog-store` leyendo `raw_json`, `recsys` con los campos | **hecha** (T257b) |
| 3 | Interfaz: tres pestañas, filtro de formato, dirección, i18n, alta de proveedor | pendiente |
| 4 | Fixture y e2e: película de anime, serie de animación occidental y serie de imagen real | pendiente |

La fase 1 es **aditiva y opcional**: ningún consumidor publicado deja de compilar ni de conformar.
`mediaType` se conserva; `media` se conserva; `apiVersion` sigue en `'1'`. La fase 2 añade los dos
parámetros a las ocho lecturas con el alias viejo traducido en `routes/media.ts`, hace que AniList
sólo conteste a Anime y por formato, y saca la clasificación de `raw_json` con un helper único.

## Criterios de aceptación

- [ ] `mediaFamily` y `mediaFormat` existen en `core`; `familyOf` y `formatOf` son la única regla y
      `mediaTypeOf` deja de deducir una cosa de la otra.
- [ ] `capabilities.families` existe y gana sobre `media`; un manifiesto viejo sigue conformando.
- [ ] Una película de anime de una fuente mixta aparece en Anime y se aísla con el filtro de
      formato.
- [ ] Una serie de imagen real de una fuente mixta aparece en Acción real y no en Anime.
- [ ] Las tres pestañas, el filtro de formato y la dirección comparten la misma clasificación que el
      servidor.
- [ ] AniList no se consulta en las familias que no sirve.
- [ ] El fixture cubre una película de anime, una serie de animación occidental y una serie de
      imagen real.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes tocados.
