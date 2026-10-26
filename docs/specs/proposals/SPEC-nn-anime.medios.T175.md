# Propuesta · el modelo de medios y las temporadas

**Task T175 (roadmap 0.2).** Sobre `d917f59`. Origen: `docs/roadmap.md` y el diagnóstico
`docs/diagnostico-peliculas-series.md` (hallazgos F1–F4, F8 y F10).

**Estado:** implementado en T176 (commits `48ffbda`, `718d577`, `ea391d6`, `f5c8072`, `9a91ded`).
La migración es la `0013` y la propuesta no sube la versión del contrato.

Toca tres contratos y por eso va en una propuesta: **`SPEC-provider-core`** (el episodio y la
capacidad), **`SPEC-catalog-store`** (la migración y la lectura del visionado) y **`SPEC-web-ui`**
(la navegación por temporada). Ninguno se edita aquí: los integra su dueño.

## El problema, en una línea

Hoy la temporada es **una etiqueta en el título** (`T2 E1 · …`) y el número de episodio es **la
identidad**; en cuanto la fuente numera por temporada —como PelisPlusHD— el número se repite y el
salto, los vecinos, «último» y «continuar viendo» eligen el episodio de otra temporada. La
referencia opaca del episodio ya es única; lo que falta es dejar de usar el número para todo lo
demás.

## Lo que ya existe y no se rehace

- `Episode.ref` es opaca y única por proveedor (`packages/core/src/schema.ts:304-319`).
- `episode.provider_ref` se guarda en la base desde el esquema inicial
  (`packages/catalog-store/src/migrations/0001-initial.sql:48-59`).
- `watch_event` apunta a `episode_id`, no a un número
  (`0001-initial.sql:63-73`): **los datos para arreglar «continuar viendo» ya están guardados**.
- La API ya tiene `seasons` y `?season=` (`packages/core/src/api.ts:794-820`);
  `episodeSeasonOf` ya lee `T<n> E<m>` (`packages/core/src/episodes.ts:30`).
- `mediaOf`, `puedeServir` y `pasaElFiltro` ya existen (`packages/core/src/media.ts`).

Lo que cambia es **qué significa `number` cuando hay temporada**, cómo se identifica un episodio en
las lecturas del usuario y cómo se declara el tipo de un título.

## 1. `core`: el tipo de medio del título

Un tipo nuevo, sin tocar el vocabulario del proveedor:

```ts
export const mediaTypeSchema = z.enum(['anime', 'movie', 'series', 'manga'])
export type MediaType = z.infer<typeof mediaTypeSchema>

/** Qué es un título, a partir de lo que declara la fuente y de su formato. */
export function mediaTypeOf(
  item: { readonly mediaType?: MediaType; readonly kind?: TitleKind },
  providerMedia: ProviderMedia,
): MediaType
```

Reglas, en este orden:

| Entrada | Resultado |
|---|---|
| `item.mediaType` declarado | ese valor |
| proveedor `manga` (reservado para 2.2) | `manga` |
| proveedor `movies` | `kind === 'movie' ? 'movie' : 'series'` |
| proveedor `anime`, o sin declarar | `anime` |
| proveedor `both` | `kind === 'movie' ? 'movie' : 'anime'` (compatibilidad: un `tv` de una fuente mixta sigue siendo anime) |

`mediaTypeOf` es **la única** regla de clasificación. `esDeMedia`, `pasaElFiltro` y la interfaz
(`enElTipo`) la usan en vez de repetir la tabla. `MediaFilter` sigue siendo `anime | movies` en esta
tarea: `series` cae del lado de películas y la tercera pestaña (`manga`) es 2.7.

### El campo `mediaType` y su capacidad

```ts
// searchResultSchema (y animeDetailSchema, que lo extiende)
mediaType: mediaTypeSchema.optional()

// providerCapabilitiesSchema
mediaPerTitle: z.boolean().optional()
```

**Por qué hace falta el campo.** Una fuente `both` no puede decir hoy que un `tv` suyo es una serie
de acción real: todo `tv` cae del lado del anime. Con `mediaType` por título, la fuente mixta lo
declara y F8 deja de ser una limitación.

**Por qué la capacidad.** `searchResultSchema` es estricto: una app vieja rechazaría el campo en
cada respuesta. `mediaPerTitle` hace que la rechace **al cargar el plugin**, con un motivo, en vez
de aceptarlo y fallar en la primera búsqueda. Es el mismo patrón de `episodePages` y `seasons`.

**Compatibilidad.** El campo es opcional y sin defecto; una fuente que no lo declara se clasifica
como hoy. `capabilities.media` ausente sigue siendo `anime`, y no se toca su vocabulario.

## 2. `provider-core`: la temporada del episodio

### El campo

```ts
export const episodeSchema = z.strictObject({
  // …
  season: z.number().int().positive().optional(),
})
```

- Presente: la temporada **de la fuente**, base 1. `number` es el ordinal **dentro de la
  temporada**.
- Ausente: `number` es la etiqueta de siempre —global o la que la fuente use— y la temporada se
  lee del título `T<n> E<m>` como hoy. **No se asume 1**: una lista sin temporadas no las tiene.
- La temporada explícita **gana** al marcador del título (`seasonOf = episode.season ?? título`).
  El marcador queda como compatibilidad, no como fuente de verdad.

La regla vive en `core`:

```ts
export function seasonOf(episode: Pick<Episode, 'season' | 'title'>): number | undefined
export function episodeSeasons(episodes): readonly EpisodeSeason[] | undefined
```

`episodeSeasons` deja de exigir el marcador si **todos** los episodios traen `season`; y sigue
devolviendo `undefined` si alguno no la declara (agrupar escondería lo que no tiene temporada).

### La capacidad

```ts
seasons: z.boolean().optional()
```

Declara que el plugin **numera por temporada** y devuelve `season`. Sin la capacidad, la app usa el
marcador del título y no promete nada. Un plugin que la declare y no devuelva `season` en todos sus
episodios es un fallo del plugin: `assertConforms` no puede saberlo —la lista es dinámica—, así que
se dice en `docs/providers.md` y la interfaz cae al marcador cuando falta.

### La identidad no cambia: es `ref`

Ninguna ruta, clave de base ni URL nueva identifica un episodio por `number`. `number` y `season`
son **etiquetas para leer y navegar**; `ref.value` es la identidad. Esto ya era cierto en el
contrato y se rompe en cuatro sitios que esta tarea corrige.

## 3. `server`: las rutas que usan la temporada

| Ruta | Hoy | Propuesta |
|---|---|---|
| `GET /episodes` | índice de temporadas y filtro por título | índice por `seasonOf`; `total` es **el de la temporada pedida**, no el del título; sin `?season`, el de todo |
| `GET /episodes/latest` | máximo `number` | con `?season`, el último de esa temporada; sin él, el último de la temporada más alta (orden `season`, luego `number`); sin temporadas, máximo `number` como hoy |
| `GET /episodes/number/:n` | primer episodio con ese número | acepta `?season`; con él, `season + number`; sin él, si hay más de uno devuelve **409** nombrando las temporadas, en vez de abrir la primera |
| `GET /watch/recent` | agrupa por `animeRef + number` y reconstruye `animeRef#number` | agrupa por `episode_id` y devuelve la **referencia real** (`episode.provider_ref`) y `season` |
| `GET /watch/history` | igual | igual |
| `GET /api/search` | filtra proveedores, no resultados | filtra también los resultados con `pasaElFiltro` cuando el tipo se conoce (F8) |

El 409 del salto es deliberado: un cliente viejo que pida el número 2 de una serie de tres
temporadas no puede recibir «el de la T1» sin mentir. El mensaje dice qué temporadas hay y que se
pida `?season=`. La interfaz de esta tarea pasa siempre la temporada.

### Fuentes que paginan sus episodios

Sigue el **400** de `?season=` con `capabilities.episodePages` (`routes/episodes.ts:135-145`). Es
una limitación declarada, no un fallo silencioso: el índice de temporadas necesita la lista entera.
Se resuelve en 0.4/0.5 añadiendo `season` a `getEpisodesPage` y un índice por página; fuera del
alcance de 0.2.

## 4. `catalog-store`: la migración

**Una sola columna nueva, nullable, sin reescribir filas:**

```sql
-- 0013-temporadas.sql
ALTER TABLE episode ADD COLUMN season INTEGER;
```

- Las filas existentes quedan en `NULL` y se leen con el marcador del título: **no hay pérdida de
  datos** y no hace falta backfill.
- `writeEpisodes` guarda `episode.season` cuando el contrato lo trae; `readEpisodes` lo devuelve.
- `WatchRecord` gana `episodeRef` y `season`. La lectura hace `JOIN episode` y toma
  `provider_ref` y `season`; **no** reconstruye la referencia.
- `unaPorEpisodio` usa `episode_id` como clave. Dos temporadas con el mismo número dejan de
  colapsar.
- `episode_number` sigue en la tabla y en el contrato del historial como etiqueta, no como clave.
- Índice nuevo, opcional: `episode_por_temporada (anime_id, season, number)`.

La migración se prueba con una base creada con `0001`–`0012`, se escriben episodios sin `season`,
se aplica `0013` y se leen: los mismos episodios, con `season` nula y la temporada del título. Es
la prueba de «sin pérdida de datos» del criterio de aceptación.

## 5. `web`: lo mínimo para no romper la navegación

Esta tarea **no** rediseña el reproductor (eso es 0.4). Cambia lo justo para que la identidad por
referencia funcione:

- `EpisodeList` pasa `season` en el salto, en «último» y en las páginas; el `id` del DOM es
  `episodio-${season ?? ''}-${number}` para que dos temporadas no colisionen.
- El enlace al reproductor lleva `s=<season>` además de `n=<number>`; `watchPath` lo acepta.
- `loadWatchNeighbours` pide la página **de la temporada** y busca el actual por `ref`, no por
  número; el «siguiente» del final de temporada no salta a otra temporada (0.4 decidirá si lo
  ofrece como «Temporada 2»).
- «Continuar viendo» e historial pintan la temporada si viene y abren la referencia real.
- `enElTipo` usa `mediaTypeOf`, así que una `series` de una fuente `both` con `mediaPerTitle` cae
  del lado de películas.

La etiqueta «Episodio 1 de 1» de una película y el salto entre temporadas son 0.4; aquí sólo se
deja el dato y la navegación sin episodios equivocados.

## 6. Compatibilidad y versión del contrato

**No se sube `PROVIDER_API_VERSION`.** Los tres campos nuevos son opcionales y las dos capacidades
son opcionales. Un plugin que no los usa se comporta exactamente como hoy:

- `capabilities.media` ausente = anime; `kind` opcional; `number` global; temporada por título.
- Un plugin que usa `season` o `mediaType` declara `seasons` o `mediaPerTitle`. Una app vieja
  rechaza **el manifiesto al cargar** (el schema de capacidades es estricto), con el campo delante,
  en vez de aceptarlo y fallar en cada respuesta. Ese es el gate de compatibilidad, y por eso no
  hace falta una versión nueva que rompa a todos los plugins por una función que no usan.

Subir a `'2'` se reserva para el contrato de manga (2.2), que añade métodos y no sólo campos.

## 7. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Deducir la temporada sólo del título | Es lo que hay: falla en cuanto la fuente no escribe `T<n> E<m>` y no distingue una serie de una lista global. El dato lo tiene el plugin |
| Numerar globalmente en el plugin (T2E1 = 7) | Funciona con el código de hoy, pero obliga a cada plugin a inventar una numeración que el sitio no usa y hace que «Episodio 7» no signifique nada para quien lee. Es la opción (b) que el estudio ya descartó (`docs/estudio-busqueda-ani-cli-mx.md:1975-1979`) |
| Usar `number` como identidad y añadir `season` sólo para pintar | Es el estado actual con una columna más: el salto y «continuar viendo» siguen eligiendo mal. No arregla F1/F2 |
| Una referencia por temporada y ninguna temporada en el episodio | Es la opción (a) del estudio y ya funciona si el plugin la usa: la temporada viaja en la referencia. Pero el contrato no puede **leer** esa convención (la referencia es opaca), así que la interfaz no puede agrupar ni numerar por temporada. `season` explícita es lo que hace legible una referencia opaca |
| Subir `apiVersion` a `'2'` | Rompe a todos los plugins instalados por campos que son opcionales. La capacidad nueva ya da un rechazo claro y localizado |

## 8. Qué se mide al integrarlo

Cada punto se marca con la mutación que lo hace fallar, como pide el DoD.

1. **`core`**
   - `episodeSchema` acepta `season: 2` y rechaza `season: 0`, `1.5` y `'2'`.
   - `seasonOf` prefiere `episode.season` al título; sin `season`, lee `T2 E1`; sin ninguno,
     `undefined`.
   - `episodeSeasons` agrupa por `season` explícita, sigue devolviendo `undefined` con un episodio
     sin temporada y con una sola temporada.
   - `mediaTypeOf`: las cinco filas de la tabla; `both` sin `mediaType` sigue dando `anime` para
     `tv`.
   - `pasaElFiltro('movies', 'both', …)` con `mediaType: 'series'` deja entrar la serie y con
     `mediaType` ausente la deja fuera.
   - **Mutaciones**: quitar la precedencia de `season` (1 fallo), invertir `both` (2), aceptar
     `season: 0` (1).
2. **`catalog-store`**
   - Migración sobre una base con datos de `0001`–`0011`: las filas siguen, `season` nula, la
     lectura devuelve la temporada del título.
   - `writeEpisodes`/`readEpisodes` conservan `season`.
   - `listRecentlyWatched` devuelve `episodeRef` real y `season`; dos filas del mismo número en
     temporadas distintas no se agrupan.
   - **Mutaciones**: volver a reconstruir `animeRef#number` (1), agrupar por número (1).
3. **`server`**
   - `?season=2` devuelve 3 episodios de 3 y `total: 3`.
   - `?season=2` en una fuente paginada sigue siendo 400 con su motivo.
   - `episodes/latest` sin temporada devuelve el último de la última; con temporada, el de esa.
   - `episodes/number/2?season=2` devuelve T2E2; sin temporada en una serie de tres, 409.
   - `/api/watch/recent` con T1E1 y T2E1 devuelve **dos** tarjetas y las referencias
     `…/temporada/1#1` y `…/temporada/2#1`.
   - `/api/search?media=movies` no emite los `tv` de una fuente `both` sin `mediaType`; sí emite los
     que la declaran `series`.
   - **Mutaciones**: `max(number)` en latest (1), `find(number)` sin temporada (1), total del título
     (1), clave por número en recent (1).
4. **`web`**
   - Dos temporadas con el mismo número no comparten `id` ni clave de React.
   - El enlace al reproductor lleva `s=2`.
   - Los vecinos no cruzan de temporada y buscan por `ref`.
   - `enElTipo` clasifica una `series` como películas.
   - **Mutaciones**: quitar `s` de la URL (1), buscar por número (1), volver a `kind` (1).
5. **`providers-fixture` (0.5)**
   - Una serie de dos o tres temporadas, con `seasons: true`, `season` en cada episodio y números
     por temporada; `assertConforms` la acepta.
   - Un caso de `resolveStream` que falla para esa serie (`e2e:fallo`).
   - El e2e de la ficha y del reproductor la usa; las pruebas de F1/F2 fallan con el código de hoy.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Filas de caché viejas sin `season` | Se leen con el marcador del título; el TTL las renueva. La migración no reescribe |
| Un plugin declara `seasons` y no manda `season` en algún episodio | `seasonOf` cae al título y `episodeSeasons` no agrupa; se documenta en `docs/providers.md`. No se inventa la temporada |
| El 409 del salto rompe un cliente viejo | Es el comportamiento honesto; la interfaz de esta tarea manda `season` siempre. Un cliente de terceros lee el mensaje |
| Cambiar `number` a ordinal de temporada rompe la etiqueta «de N» | `total` pasa a ser el de la temporada; la etiqueta del reproductor se ajusta en 0.4. En 0.2 la lista ya muestra el total correcto |
| `mediaPerTitle` multiplica los campos de capacidades | Sólo lo usa una fuente mixta; ausente no cambia nada y el coste es una línea en el manifiesto |

## 10. Decisiones del humano

**D1 resuelta el 2026-10-26: clave opcional de TMDB en Ajustes**, con el plugin como respaldo
cuando no hay clave. Consecuencias para 0.3, que no se implementan aquí:

- la clave se guarda en `settings` y **no se devuelve** en `GET /api/settings`;
- TMDB entra en la lista blanca de destinos y su salida se declara en `SECURITY.md`;
- sin clave, la ficha se queda con lo que dé el plugin, como hoy;
- el emparejamiento no puede usar AniList para acción real.

D2–D5 siguen abiertas. Esta propuesta no las toca.

## Criterios de aceptación de 0.2

- [x] `MediaType` y `mediaTypeOf` existen en `core`; `capabilities.media` ausente sigue siendo
      anime y el vocabulario no cambia.
- [x] `Episode.season` y `capabilities.seasons` existen; una fuente sin ellos se comporta como hoy.
- [x] `searchResultSchema.mediaType` y `capabilities.mediaPerTitle` existen y están probados.
- [x] Migración `0013` sobre una base con datos: sin pérdida, con prueba.
- [x] `/episodes`, `/episodes/latest` y `/episodes/number/:n` usan temporada y referencia; el 409
      está probado.
- [x] «Continuar viendo» e historial devuelven la referencia real y no colapsan temporadas.
- [x] La búsqueda filtra resultados por tipo cuando lo conoce.
- [x] La interfaz pasa `season` y no usa el número como identidad.
- [x] El fixture multi-temporada y su caso de fallo son 0.5 (T179), no esta tarea.
