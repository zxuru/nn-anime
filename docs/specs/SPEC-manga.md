# Spec: manga (leer manga y tenerlo descargado)

Estado: **propuesta de contrato para la tarea 2.1 de `docs/roadmap.md` — pendiente de aprobación
humana** · 2026-11-15.

**No se escribe código de la Fase 2A hasta que este documento lo apruebe el humano.** La regla
está en `docs/specs/proposals/README.md`: cambiar un contrato es un evento de versión mayor y
requiere aprobación. `docs/specs/CAPABILITY-MAP.md` es el índice que dice dónde vive cada contrato,
y ahí se ve que este todavía no está aprobado. Este fichero describe el contrato; no lo implementa.

- **Origen:** tarea **T234** de `tasks/deuda.md`, que abre la tarea **2.1** de `docs/roadmap.md`.
- **Revisión humana:** **pendiente a 2026-11-15**. No hay aprobación escrita todavía; hasta que la
  haya, ninguna tarea 2.2–2.7 empieza.
- **Sitio:** vive en `docs/specs/SPEC-manga.md`, que es donde lo mandan la tarea y el roadmap. Si
  eso lo convierte en canónico antes de estar aprobado, o si hay que moverlo a
  `docs/specs/proposals/`, es una **decisión pendiente** que se razona al final, en «Dónde vive
  este documento».

Decisiones del humano **ya tomadas**, que este spec respeta y no vuelve a abrir:

- **D5** — el formato offline es **CBZ**: un archivo por capítulo, interoperable con otros
  lectores (`docs/roadmap.md:262`).
- **D4** — manga antes que watch party, por riesgo y por reutilización del motor de descargas
  (`docs/roadmap.md:261`).

Lo que este spec **propone** y que el humano tiene que confirmar está en «Las que este spec propone
y que esperan aprobación», con su alternativa descartada y el motivo de descartarla. Lo que este
spec **mide** está en «Lo que se midió hoy» y en «Verificación por tarea».

Módulos que toca: `core` (modelo y medios), `provider-sdk`/`provider-core` (contrato de plugin),
`catalog-store` (capítulos, volúmenes y progreso de lectura), `media-proxy` (proxy de imágenes),
`server` (rutas y composición), `web-ui` (lector e índice), `providers-fixture` (una fuente de
manga de prueba). `recsys` **no se toca** en la 2A: leer no es ver, y escribir un `watch_event`
por cada página sería inventar una afinidad que nadie tiene.

Enmiendas que este spec propone a otros documentos y que **no se aplican** hasta que el humano
apruebe: `SPEC-provider-core.md` (contrato de plugin), `SPEC-media-proxy.md` (ruta y caché de
imágenes), `SPEC-catalog-store.md` (repositorios nuevos), `SPEC-web-ui.md` (lector e índice) y
`CAPABILITY-MAP.md` (capacidad `manga` y su build order).

## Objective

Que en `nn-anime` se pueda buscar una obra de manga, abrir un capítulo, leerlo con calma y
quedarse en la página en la que se estaba, y que ese capítulo se pueda tener en el disco para
leerlo sin red.

Éxito significa:

1. La aplicación tiene una tercera pestaña, **manga**, y se llega a ella con un enlace
   (`/?tipo=manga`) que se puede recargar, compartir y deshacer con el botón de atrás.
2. Un plugin que declara servir manga puede entregar capítulos y páginas; el resto de la
   aplicación no sabe de qué fuente vienen ni qué formato tienen las imágenes.
3. El lector sirve las páginas **desde el proxy**, nunca desde el host de la fuente: el navegador
   recibe direcciones de `127.0.0.1` y el servidor es el único que habla con el tercero.
4. Al cerrar un capítulo y volver a abrirlo, se abre en la página en la que se estaba.
5. Un capítulo descargado se lee **sin red**, y el archivo es un CBZ que se puede abrir en
   cualquier lector del sistema.

Lo que **no** es el objetivo, y por qué está escrito:

- **No es un catálogo de manga.** No hay búsqueda por tags, ni filtros por autor, ni listas
  curadas, ni integración con bibliotecas externas. La Fase 2A es «buscar, abrir, leer y
  recordar dónde lo dejaste».
- **No es un espejo de contenido.** La base sigue guardando metadatos y señales, nunca bytes. El
  disco del usuario tiene lo que él pidió descargar; el resto se tira.
- **No es una biblioteca con DRM.** Si una fuente no deja bajar una página, no se intenta
  saltarse nada.

## Qué es manga aquí, y qué no

La palabra «manga» en este proyecto significa **una obra por capítulos, leída por páginas de
imagen**. Concretamente:

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Obra** (`manga`) | Un título con capítulos. Comparte la fila de `anime` —la tabla es la tabla de títulos— y se distingue por `mediaType: 'manga'`. | `anime` (fila existente) |
| **Volumen** (`volume`) | Un agrupamiento de capítulos. **Opcional**: muchas fuentes no los tienen. | tabla `volume` (nueva) |
| **Capítulo** (`chapter`) | La unidad que se lee y la que se descarga. Un archivo CBZ por capítulo. | tabla `chapter` (nueva) |
| **Página** (`mangaPage`) | Una imagen del capítulo. Es lo que se ve y lo que baja el proxy. | no se persiste: se sirve por ticket |

Lo que **no** se modela, y por qué:

- **Página suelta (una «página suelta» de una revista).** El roadmap no la pide y duplicaría el
  capítulo. Una fuente que sólo tenga páginas sueltas no es una fuente de manga que este
  proyecto sepa leer.
- **Novela con ilustraciones.** AniList distingue `NOVEL` de `MANGA`. El proyecto no: una obra
  de texto no tiene imágenes que leer. La fase 2A es **manga**, no novelas —ver «Decisiones que
  esperan aprobación», D-M9.
- **Doujinshi / material adulto.** El filtro de adultos que ya existe en el camino de AniList se
  aplica igual; no se abre una puerta nueva.

## De dónde viene: el análisis de `docs/estudio-busqueda-ani-cli-mx.md`

El análisis **no tiene una sección de manga**: las fuentes que estudia son de vídeo y ninguna sirve
páginas de una obra. No se copia ninguna de sus fuentes, ni se convierte ninguna en plugin de manga;
lo que se copia es la **disciplina de transporte**, que sí se midió allí:

| Lo que enseñó el análisis | Dónde | Cómo entra aquí |
|---|---|---|
| Una fuente exige `Referer` y un `User-Agent` concretos, y sin ellos no sirve | PelisPlus: el referrer es la cabecera crítica (`estudio`, líneas 1136–1147); AnimeX negocia `Referer`, `Origin` y `User-Agent` **por respuesta** (`estudio`, líneas 1485–1526); el host de AnimeX **ata el token al `User-Agent`** (`estudio`, líneas 1599–1604) | La página lleva sus cabeceras en `MangaPageSource.headers`, y el proxy reenvía **sólo ésas**. No hay un `User-Agent` global que valga para todas |
| Un proxy local con guarda de destinos que **revalida cada redirección** | «Proxy local de Yuki (SSRF-safe)» (`estudio`, líneas 1564–1581) | Se reutiliza el guardián de `media-proxy`; no se escribe otro. La revalidación en el salto ya está en el proxy de bytes |
| Un catálogo paginado con **ritmo autoimpuesto de 1 req/s** | JKAnime (`estudio`, línea 941) | El plugin declara; el ritmo y el presupuesto los pone el cliente de la aplicación, no un `sleep` dentro del plugin. Un plugin que se auto-limita no protege a los demás |
| Una caché en disco de las páginas del catálogo, con **generación de 300 s** | JKAnime (`estudio`, líneas 1696–1699) | La caché de metadatos es la de `catalog-store`, con su TTL (6 h para capítulos); la de imágenes es del proxy. No se inventa una tercera |
| **No hay caché en disco de las respuestas de búsqueda**, y el `default_cache_dir` del script nunca se usó | `estudio`, líneas 1703–1705 | Por eso la caché de imágenes vive en el proxy, con tope y desalojo, y no se deja al plugin: una caché que nadie limpia es un disco lleno |

Lo que el análisis **no** puede decir, y este spec no finge que diga: cuánto pesa una página real,
cuántas páginas tiene un capítulo real, ni qué fuentes de manga existen hoy. Eso está declarado en
«Lo que no se midió», y el fixture lo sustituye por imágenes locales.

## Modelo

El modelo vive en `packages/core/src/schema.ts` (las formas) y `packages/core/src/models.ts` (los
tipos derivados). Se sigue la convención del repositorio: **una sola definición**, de la que
salen el tipo y el validador, y ninguna copia escrita a mano al lado.

### Las formas nuevas

```ts
// packages/core/src/schema.ts

/**
 * Un capítulo de manga.
 *
 * `number` es un número **real**, no un entero: las fuentes numeran con decimales
 * («12.5», un especial entre el 12 y el 13) y con números que no son ni enteros ni
 * decimales. Exigir entero descarta el capítulo en el plugin, que es donde se
 * pierde sin que nadie lo note —el mismo motivo por el que `Episode.number` se
 * ensanchó en T85.
 */
export const chapterSchema = z.strictObject({
  ref: providerRefSchema,
  /** La obra a la que pertenece el capítulo. */
  mangaRef: providerRefSchema,
  number: z.number().nonnegative(),
  /**
   * La etiqueta que puso la fuente, cuando no es un número: «Extra», «One-shot»,
   * «Capítulo especial». Se guarda porque el número es la identidad y la etiqueta
   * es lo que el usuario lee; una sin la otra no se puede pintar.
   */
  label: z.string().min(1).optional(),
  /** El volumen, cuando la fuente agrupa por volúmenes. */
  volume: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
  /** Cuántas páginas tiene, cuando la fuente lo dice. */
  pageCount: z.number().int().positive().optional(),
  /** Cuándo se publicó, en ISO-8601. */
  releasedAt: z.iso.datetime().optional(),
})

/** Un volumen de una obra. */
export const volumeSchema = z.strictObject({
  ref: providerRefSchema,
  mangaRef: providerRefSchema,
  number: z.number().int().positive(),
  title: z.string().min(1).optional(),
  /** El rango de capítulos que cubre, si la fuente lo declara. */
  chapterFrom: z.number().nonnegative().optional(),
  chapterTo: z.number().nonnegative().optional(),
})
```

Y la página, que es la única forma que **cambia según quién la mira**: dentro del proceso lleva
la dirección del tercero y las cabeceras que la fuente exige; hacia el cliente lleva la
dirección del proxy.

```ts
/**
 * Una página de un capítulo, **tal como sale del proceso**.
 *
 * `url` es la dirección del upstream y `headers` las cabeceras que la fuente
 * exige. Nunca sale del proceso: hacia el cliente viaja la misma forma sin
 * `headers` y con la dirección del proxy, igual que `PublicStreamSource` hace con
 * los streams.
 */
export const mangaPageSourceSchema = z.strictObject({
  /** La página dentro del capítulo, base 1. */
  index: z.number().int().positive(),
  url: httpUrlSchema,
  headers: streamHeadersSchema.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/** La misma página, **tal como la ve el cliente**: sin cabeceras y con ruta propia. */
export const mangaPageSchema = z.strictObject({
  index: z.number().int().positive(),
  /** Una ruta del propio servidor: `/api/manga/image/<ticket>`. Nunca la del tercero. */
  url: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})
```

### La relación con lo que ya existe

| Lo que ya hay | Qué pasa con manga |
|---|---|
| `Episode` (`ref`, `animeRef`, `number`, `season?`, `mode`, `durationS?`) | **No se reutiliza.** Un capítulo no tiene modo de audio ni duración en segundos: `mode` es `NOT NULL` en la tabla `episode` y `duration_s` es la duración de un vídeo. Un capítulo tiene **su propia** forma y **su propia** tabla. |
| `AnimeDetail` (`SearchResult` + `synopsis`, `status`, `episodeCount`, `genres`, `studios`) | **Se reutiliza tal cual** para la ficha de un manga, con `mediaType: 'manga'` en el resultado. `episodeCount` **no** se usa para el número de capítulos: la cuenta sale de la lista de capítulos. Un campo con dos significados es el tipo de cosa que este repositorio ya ha pagado. |
| `ProviderRef` (`providerId`, `value`) | **Se reutiliza tal cual.** La referencia de un capítulo es opaca para el resto de la aplicación; la reconstruye el plugin, nunca la aplicación. |
| `SearchResult` | **Se reutiliza**, con `mediaType: 'manga'` opcional. El esquema ya lo admite (`mediaTypeSchema` ya incluye `'manga'`). |
| `mediaTypeSchema` (`anime`, `movie`, `series`, `manga`) | **Ya está**. `packages/core/src/schema.ts:185`. No hay que tocarlo. |
| `anime` (la tabla de títulos) | **Se reutiliza**. Un manga es una fila más. El tipo sale de la fuente, como ya sale para películas y series. |
| `watch_event`, `watch_progress` | **No se reutilizan** para manga. Leer no es ver. Ver «Datos». |

### Por qué un tipo nuevo y no `Episode` reutilizado

Reusar `Episode` con `mode: 'raw'` parece más barato y es peor:

1. **La tabla `episode` declara `number INTEGER NOT NULL`**
   (`packages/catalog-store/src/migrations/0001-initial.sql:52`) y no está pensada para un
   capítulo. SQLite guardaría `12.5` por afinidad —el valor no se pierde—, pero el esquema dice
   «entero» y cualquier lectura que lo crea (un `CAST`, un consumidor que lea la columna como
   `int`) lo trunca. El capítulo merece una columna `REAL` que lo diga. Cambiar la columna ya
   aplicada es lo que la migración `0002` dejó escrito que no se hace: una migración aplicada no
   se edita.
2. **`mode` es `NOT NULL` y no significa nada aquí.** Habría que escribir `'raw'` en todos los
   capítulos de manga para admitir una columna que no aplica.
3. **`duration_s` es la duración de un vídeo.** Una página no dura segundos.
4. **La biblioteca distingue lo que se ha visto de lo que se ha leído.** Con una tabla única, «lo
   visto» y «lo leído» se mezclan en la misma fila y el botón de la ficha no sabe qué marcar.

Un tipo nuevo cuesta una tabla y un esquema; reutilizar el equivocado cuesta un `mode: 'raw'`
que no significa nada y un `duration_s` mentiroso en cada capítulo.

## Contrato de plugin

Este apartado **propone una enmienda a `SPEC-provider-core.md`**. No se aplica hasta que el
humano apruebe este spec.

### Las capacidades

`capabilities.media` pasa a admitir `manga` y a admitir **un conjunto**:

```ts
/**
 * Qué sirve un proveedor.
 *
 * Antes era una sola cosa: 'anime', 'movies' o 'both' (las dos mitades de
 * siempre). Con manga hay una tercera mitad, y un proveedor puede servir más de
 * una —un portal con anime y manga—, así que el valor admite **las dos
 * formas**:
 *
 * - la **cadena** de siempre ('anime', 'movies', 'both'), para no romper los
 *   plugins ya instalados; 'both' sigue significando «anime y películas»;
 * - la **lista** ('anime', 'movies', 'manga', sin repeticiones), que es lo que
 *   dice un proveedor de manga.
 *
 * La lista no admite 'both': 'both' era un atajo de la era de dos mitades y en
 * una lista de tres no tiene sentido —la lista que dice las dos cosas se dice
 * con sus dos nombres—. Un valor desconocido en la lista es un rechazo, como
 * cualquier otro.
 */
export const providerMediaSchema = z.enum(['anime', 'movies', 'both', 'manga'])
export const providerMediaListSchema = z
  .array(z.enum(['anime', 'movies', 'manga']))
  .min(1)
  .refine((lista) => new Set(lista).size === lista.length)
```

Y la normalización, en `packages/core/src/media.ts`, que es donde la regla vive hoy:

```ts
/**
 * Las tres mitades que la aplicación distingue.
 *
 * No es `MediaType`: ése es el tipo de un **título** (`anime`, `movie`, `series`,
 * `manga`); éste es el tipo de **lo que un proveedor sirve**. Una fuente de
 * manga sirve `manga`; una de películas sirve `movies`, que agrupa `movie` y
 * `series`.
 */
export type ProviderMediaKind = 'anime' | 'movies' | 'manga'

/**
 * Qué sirve un proveedor, como conjunto.
 *
 * Ausente significa «anime», que es lo que son los plugins que ya existen.
 * 'both' se traduce a sus dos partes, porque es un atajo de la era de dos
 * mitades. El orden es el canónico (`anime`, `movies`, `manga`), no el que el
 * plugin escribió en su lista: dos plugins que sirven lo mismo tienen que
 * producir el mismo conjunto.
 */
export function mediasOf(
  capabilities: Pick<ProviderCapabilities, 'media'>,
): readonly ProviderMediaKind[]
```

`mediaOf()` —la función de hoy, que devuelve un solo valor— **se queda**, porque hay llamadas suyas
que no cambian, y se documenta como «el primero de `mediasOf()` en el orden canónico», no «el
primero de la lista»: el orden de la lista lo elige el plugin y un valor de presentación no puede
depender de eso. Las que sí cambian son las que reparten títulos: `mediaTypeOf`, `esDeMedia` y
`puedeServir` pasan a trabajar con el conjunto.

`mediaTypeOf` es la que decide **qué es un título** cuando el resultado no lo dice. Su regla pasa a
ser: el `mediaType` explícito gana; si no lo hay y el proveedor sirve **una sola** mitad, esa mitad
es el tipo (`movies` reparte por `kind`, y `manga` da `manga`); si el proveedor sirve **más de
una**, sin `mediaType` el título cuenta como anime, que es el defecto de siempre. Por eso un
proveedor mixto **tiene que** poner `mediaType` en cada resultado: `kind` no distingue un manga de
un anime, y adivinarlo metería una obra en la pestaña equivocada.

Las llamadas que hoy pasan `mediaOf(...)` a `puedeServir`/`pasaElFiltro` —el reparto de la
búsqueda, la discovery y las recomendaciones— pasan a `mediasOf(...)`; `mediaOf` se queda para
presentar «qué es esta fuente» en una etiqueta, donde un solo valor vale.

**El filtro de la interfaz pasa a tres vías**, que es la tarea 2.7:

```ts
/** Lo que se puede pedir. 'movies' es «lo que no es anime»: películas y series. */
export type MediaFilter = 'anime' | 'movies' | 'manga'
```

### Las operaciones

Tres métodos nuevos, **todos opcionales**, y la regla de que la capacidad y los métodos van
juntos —la misma que se escribió para `episodePages` en T86: «declarar la capacidad sin los
métodos, o tener los métodos sin declararla, se rechaza nombrando lo que falta»:

```ts
export interface Provider {
  // … lo que ya hay …

  /**
   * Los capítulos de una obra de manga.
   *
   * **Obligatorio en cuanto el proveedor declare manga**, y opcional en los
   * demás: un plugin de anime no tiene por qué saber de capítulos. La regla la
   * aplica el cargador, que rechaza el manifiesto nombrando el método que falta.
   */
  getChapters?(ref: ProviderRef, options: CallOptions): Promise<readonly Chapter[]>

  /**
   * Las páginas de un capítulo.
   *
   * Devuelve la dirección del tercero y las cabeceras que la fuente exige; de
   * ahí se encarga el proxy. **Obligatorio en cuanto el proveedor declare
   * manga**: un manga sin páginas es una ficha que no se puede leer. Gated por
   * `capabilities.mangaPages`, que también es obligatoria con manga.
   */
  getChapterPages?(
    ref: ProviderRef,
    options: CallOptions,
  ): Promise<readonly MangaPageSource[]>

  /**
   * Los volúmenes de una obra.
   *
   * **Gated por `capabilities.mangaVolumes`.** Una fuente que no agrupa por
   * volúmenes no lo declara y sus capítulos salen en una lista plana.
   */
  getVolumes?(ref: ProviderRef, options: CallOptions): Promise<readonly Volume[]>
}
```

Y las capacidades nuevas, **opcionales y sin valor por defecto**, por el mismo motivo que
`episodePages`: con un valor por defecto el campo pasaría a ser obligatorio en el tipo inferido y
obligaría a tocar cada literal de capacidades del repositorio.

```ts
export const providerCapabilitiesSchema = z.strictObject({
  // … lo que ya hay …
  /** El proveedor sabe servir las páginas de un capítulo. */
  mangaPages: z.boolean().optional(),
  /** El proveedor sabe servir los volúmenes de una obra. */
  mangaVolumes: z.boolean().optional(),
  /** Qué sirve. Ausente es 'anime'. */
  media: z.union([providerMediaSchema, providerMediaListSchema]).optional(),
})
```

Lo que **no** cambia:

- **`search()` y `getAnime()` se reutilizan.** Buscar y abrir la ficha son las mismas
  operaciones que para anime; un proveedor que sirve manga devuelve resultados con
  `mediaType: 'manga'`. Añadir `searchManga` y `getManga` sería duplicar un contrato que ya
  existe y obligaría a todos los plugins a cambiar.
- **`resolveStream()` no se toca.** El manga no se reproduce.
- **`getEpisodes()` no se toca.** Los capítulos son capítulos, con su propia operación.

### La regla del cargador

Cuatro reglas, todas verificables con una prueba:

1. **Un plugin que declara manga y no implementa `getChapters` se rechaza**, nombrando el
   método que falta. Un plugin a medias ofrece una pestaña que no lleva a ninguna parte.
2. **Un plugin que declara manga sin `mangaPages` y `getChapterPages` se rechaza**: una ficha sin
   páginas es un lector que no lee. La capacidad y el método van juntos.
3. **Un plugin que declara `mangaPages` y no implementa `getChapterPages` se rechaza**, y al
   revés. Igual que `episodePages` en T86.
4. **Un plugin que declara `mangaVolumes` y no implementa `getVolumes` se rechaza**, y al revés.

### El versionado

**`apiVersion` no sube.** Sube a `'2'` rechazaría todos los plugins publicados, que es un
cambio incompatible sin motivo.

El versionado real está en el **schema**, que es donde el contrato se aplica:

- Un plugin que declara `media: ['anime', 'manga']` **no carga en una aplicación anterior a la
  2A**: su enum no admite `'manga'` y el manifiesto se rechaza. Es el comportamiento correcto: la
  aplicación vieja rechaza el plugin al cargar, en vez de aceptarlo y fallar en cada respuesta —
  el mismo criterio con el que se añadió `mediaPerTitle`.
- Un plugin que declara `media: 'anime'` —o no lo declara— **sigue cargando igual**. El cambio
  es aditivo en la forma y el valor por defecto no cambia.

La nota que va a `docs/providers.md` cuando se implemente:

> Tu plugin puede declarar `media: ['anime', 'manga']` a partir de la versión 2A de nn-anime. En
> una versión anterior **no cargará**: el manifiesto se rechaza al arrancar, con un mensaje que
> nombra el valor que no se admite. Si sólo sirves anime, no cambies nada: `media: 'anime'` y
> `apiVersion: '1'` siguen valiendo.

### El fixture

`providers-fixture` gana una fuente de manga, con **imágenes locales inventadas**: un PNG y un
JPEG pequeños, generados por el propio fixture, servidos por él. Nada de la red, nada de un
tercero, y con **un SVG** para poder probar el 415.

La fuente de manga declara:

```ts
{
  id: 'manga-fixture',
  name: 'Manga de prueba',
  apiVersion: '1',
  capabilities: {
    search: true,
    sub: false,
    dub: false,
    trending: false,
    feed: true,
    media: ['manga'],
    mangaPages: true,
    mangaVolumes: true,
  },
}
```

Ese manifiesto se acompaña de los métodos que promete: `search`, `getAnime`, `getChapters`,
`getChapterPages`, `getVolumes` y `getFeed`. Un manifiesto que declara `feed: true` sin `getFeed`
es la misma promesa a medias que la regla del cargador rechaza, y el fixture no puede ser el
ejemplo que enseña a hacerlo mal.

## Metadatos: AniList

La tarea 2.3 dice «metadatos de manga con AniList (soporta el tipo MANGA), reutilizando el cliente
existente y sus límites». Se reutiliza **el cliente entero**, sin tocarlo:

| Límite | Valor | Dónde |
|---|---|---|
| Hosts permitidos | `graphql.anilist.co`, `s4.anilist.co`, `img.anilist.co` | `packages/server/src/anilist/client.ts:32-36` |
| Intervalo mínimo entre peticiones | 2000 ms | `client.ts:48` |
| Plazo por consulta | 10 000 ms | `client.ts:50` |
| Tope del cuerpo | 2 MiB | `client.ts:52` |
| `Retry-After` obedecido, un reintento como mucho | 60 000 ms de tope | `client.ts:54`, `client.ts:270-285` |
| Interruptor del arnés | `NN_ANIME_ANILIST_OFFLINE=1` | `client.ts:69` |

**El presupuesto se reparte, no se amplía.** AniList cuenta las peticiones, no las franjas de
tipo: el manga usa el mismo presupuesto que el anime, y por eso la caché es lo que hace que la 2A
no dispare el límite. La regla del repo —«no acaparar datos»— se aplica igual que en el resto.

### Qué consultas hacen falta

AniList distingue el tipo con `media(type: …)`. Hoy **todas** las consultas usan `type: ANIME`
(`packages/server/src/anilist/queries.ts`). Para manga hacen falta tres, y sólo tres:

1. **Buscar la obra de un título de manga** (para la ficha enriquecida): `media(search: $q, type:
   MANGA)`.
2. **El top de manga** (fila de la home): `media(type: MANGA, format_in: [MANGA], sort:
   POPULARITY_DESC)`.
3. **Los más populares de manga**, que en el caso de AniList es el mismo ranking con otro filtro:
   `format_in: [MANGA, ONE_SHOT]`. Ver D-M9.

Los campos son **casi** los mismos (`MEDIA_FIELDS`, `queries.ts:33`), con tres diferencias que hay
que escribir y no suponer:

- **`episodes` es el número de capítulos** de la obra, y **`duration` no aplica**: en un manga
  AniList lo devuelve nulo. Se lee con el nombre que AniList le da y **no** se copia a
  `episodeCount`, que en el vídeo es otra cosa.
- **Faltan `chapters` y `volumes`** en `MEDIA_FIELDS`, y son los campos propios del manga. Se
  añaden al fragmento compartido: para un anime vienen nulos, así que la consulta de anime no
  cambia de forma; para un manga son el total de capítulos y de volúmenes.
- **`nextAiringEpisode` no existe para manga**: no se emite, no hay próximo capítulo que anunciar.
  El «último capítulo» sale de la lista de capítulos de la fuente, y por eso `getChapters` es la
  operación que manda, no un campo de AniList. `anilistEntrySchema` **no** necesita el campo y no
  se toca.

### La caché, y el detalle que hay que no perder

La caché de emparejamientos es la tabla `anilist_media`, con clave `title_key`. **Hoy esa clave
no dice de qué tipo es la obra**, y con manga eso se vuelve un bug:

> La obra «Akira» es un manga y una película. Con una clave sin tipo, el emparejamiento del
> manga escribiría la entrada de la película, o al revés, y la ficha de manga enseñaría la
> sinopsis de la película.

Por eso la clave **lleva el tipo**: `matchKey(title, year)` pasa a ser
`matchKey(title, year, tipo)`, y produce `anime:<normalizada>|<año>` o `manga:<normalizada>|<año>`
(el año sigue formando parte de la clave: dos obras homónimas de años distintos son dos obras). La
migración **reescribe las filas existentes** con el prefijo `anime:` —un `UPDATE` que antepone el
prefijo a la clave que ya hay—: las filas existentes son de anime, y sin ese `UPDATE` la caché de la
v1 dejaría de leerse y cada obra se volvería a preguntar.

El TTL de la caché no cambia (un mes para un emparejamiento, `0008-anilist.sql`).

### El filtro de adultos

Se aplica igual que en anime: `isAdult: false` en la consulta, y el interruptor que lo desactiva
sigue siendo el de Ajustes. Una obra marcada para adultos **no se guarda** —ni caché ni
portada—, y sólo queda la marca de su referencia en `adult_ref`, que es la de hoy
(`0010-adulto.sql`).

### El modo offline

`NN_ANIME_ANILIST_OFFLINE=1` corta el cliente. Con manga, la consecuencia es la misma que en el
resto: **el cliente devuelve el mismo error que devolvería un AniList caído**, las filas vuelven a
lo que da la fuente y la parrilla se explica. El e2e de la 2A corre con el interruptor puesto, y
la prueba **cuenta las salidas**: con el interruptor, `calls() === 0`.

## Datos

La tarea 2.4: «capítulos y volúmenes, progreso de lectura (capítulo + página), y reutilización de
la biblioteca».

### La migración

Una migración nueva, la siguiente libre —hoy sería `0016-manga.sql`, pero el número lo fija el
árbol el día que se implemente—, con tres tablas. Los nombres siguen la convención del esquema
(`anime_id` es la clave foránea al título, `provider_ref` es la referencia real de la fuente,
`fetched_at`/`ttl_s` son la caché).

```sql
-- Los capítulos de una obra.
--
-- `number` es REAL y no INTEGER: las fuentes numeran con decimales («12.5») y
-- con capítulos especiales que no son un número entero. SQLite guardaría el
-- decimal en una columna INTEGER por afinidad, pero el esquema diría lo
-- contrario y cualquier CAST lo truncaría a 12; el tipo declara lo que el dato
-- es.
--
-- `label` guarda el texto que puso la fuente («Extra», «One-shot») para cuando
-- el número no lo cuenta todo. `volume` es NULL cuando la fuente no agrupa:
-- nullable y sin valor por defecto, porque un `UPDATE` de relleno inventaría
-- volúmenes que la fuente no declaró.

CREATE TABLE chapter (
  id           INTEGER PRIMARY KEY,
  anime_id     INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  provider_ref TEXT    NOT NULL,
  number       REAL    NOT NULL,
  label        TEXT,
  volume       INTEGER,
  title        TEXT,
  page_count   INTEGER,
  released_at  INTEGER,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL,
  UNIQUE (anime_id, provider_ref)
);

CREATE INDEX chapter_por_anime ON chapter (anime_id, number);

-- Los volúmenes de una obra.
--
-- Una tabla propia y no una columna del capítulo: el volumen tiene su propia
-- identidad en la fuente, y el rango de capítulos que cubre lo declara la
-- fuente, no el cálculo de la aplicación.
--
-- Lleva su propia caché porque es su propia pregunta: una fuente puede
-- publicar un volumen nuevo sin que cambie la lista de capítulos, y al revés.
-- Sin `fetched_at`/`ttl_s` habría que refrescar los dos a la vez o dejar uno
-- viejo para siempre.

CREATE TABLE volume (
  id           INTEGER PRIMARY KEY,
  anime_id     INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  provider_ref TEXT    NOT NULL,
  number       INTEGER NOT NULL,
  title        TEXT,
  chapter_from REAL,
  chapter_to   REAL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL,
  UNIQUE (anime_id, provider_ref)
);

-- La página por la que se va.
--
-- Una fila por capítulo leído: la identidad es el par (obra, capítulo), y la
-- página es lo que se guarda. `page` es base 1, como el índice de una página;
-- 0 significa «no ha empezado» y no una página válida. Es la señal del manga, y
-- **no** escribe en `watch_event`: leer no es ver, y fabricar un visionado por
-- capítulo ensuciaría la afinidad del motor de recomendaciones con algo que
-- nadie reprodujo. El mismo motivo por el que `watched_title` no escribe en
-- `watch_event` (migración 0011).

CREATE TABLE read_progress (
  id          INTEGER PRIMARY KEY,
  anime_id    INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  chapter_id  INTEGER NOT NULL REFERENCES chapter (id) ON DELETE CASCADE,
  provider_id TEXT    NOT NULL,
  page        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  UNIQUE (anime_id, chapter_id)
);
```

**El número de tablas pasa de 21 a 24**, y hay **dos** listas que se actualizan con la misma
enmienda: el `Data Model` de `SPEC-nn-anime.md` y el arreglo `TABLAS_POSTERIORES` de
`packages/catalog-store/src/db.test.ts`, que es la prueba que cuenta las tablas contra una lista
escrita a mano —si la lista se sacara del esquema, comprobaría que el esquema es igual a sí mismo—.
La cabecera de `0001-initial.sql` ya avisa de que esa cuenta se desvió una vez.

### Los repositorios

`catalog-store` gana tres grupos, y son la forma en que se habla con las tablas nuevas:

```ts
// chapters
readChapters(ref: ProviderRef): Promise<CacheHit<readonly Chapter[]> | null>
writeChapters(ref: ProviderRef, chapters: readonly Chapter[]): Promise<void>

// volumes
readVolumes(ref: ProviderRef): Promise<CacheHit<readonly Volume[]> | null>
writeVolumes(ref: ProviderRef, volumes: readonly Volume[]): Promise<void>

// progreso de lectura
readProgress(chapterId: number): Promise<ReadProgress | null>
writeProgress(progress: ReadProgressInput): Promise<void>
listReadingProgress(limit: number): Promise<readonly ReadingProgress[]>
```

La política de caché es **la de siempre**, sin excepciones: cache-aside con TTL y
stale-while-revalidate, revalidación en segundo plano con concurrencia 2, y la fila vieja se
conserva si la revalidación falla.

**El TTL de los capítulos.** El de la lista de episodios de anime es 21600 s (6 h). Para los
capítulos se propone **el mismo**: una lista de capítulos cambia cuando se publica el siguiente,
no más a menudo. Los volúmenes llevan su propia fila de caché con el mismo TTL, porque son su
propia pregunta. El TTL de las páginas **no es un TTL de caché**: las páginas no se cachean en la
base (no son metadatos), se cachean en el disco del proxy, y esa es la tarea 2.5.

### La biblioteca: reutilizar, no duplicar

La tarea 2.4 pide «reutilización de la biblioteca (favorito / quiero leer / leído)». La
reutilización es **de las tablas**, y la separación la hace el filtro de la pestaña, que ya
existe:

| Lo que el usuario quiere | Dónde vive | Qué cambia |
|---|---|---|
| **Favorito** | `favorite` (hoy) | Nada. La fila del manga es una fila de `anime` y el botón ya funciona. |
| **Quiero leer** | `plan_to_watch` (hoy) | La **etiqueta**: en la pestaña de manga se dice «quiero leer», en la de anime «quiero ver». Los datos son los mismos: una intención del usuario. |
| **Leído** | `watched_title` (hoy) | La **etiqueta**: en la pestaña de manga se dice «leído», en la de anime «visto». |
| **Por dónde iba** | `read_progress` (nueva) | Es lo único nuevo: la página dentro del capítulo no tiene equivalente en el vídeo. |

**Por qué no tres tablas nuevas.** Con tablas nuevas harían falta seis: favorito / quiero leer /
leído, cada una en dos medios. Tres marcas y un filtro que ya está escrito son menos tablas, menos
botones y menos estados que mantener en paralelo. Y la separación es real: `esDelTipo` —que ya
existe en `packages/web/src/features/tipo/tipo.ts`— reparte por la pestaña, así que un manga
favorito **no** sale en la pestaña de anime.

**El «continuar leyendo» es una fila nueva.** El progreso de lectura no entra en
`watch_event` ni en la fila de «continuar viendo» del vídeo: esa fila trae `mode`, `positionS` y
`durationS`, que no significan nada para una página. La 2A pinta su propia fila, alimentada por
`listReadingProgress`, con el mismo aspecto que la de continuar viendo. Ver D-M8.

### Lo que no se persiste

- **Las páginas.** No hay tabla de páginas ni de direcciones de imagen. La dirección de la fuente
  caduca y el proxy la resuelve en el momento; guardarla en disco sería una dirección de un
  tercero en la base del usuario, que es exactamente lo que la mitigación 6 prohíbe para los
  streams.
- **Los bytes.** Ni en la base ni en el caché de metadatos. El proxy transmite y descarta.

## Proxy de imágenes

La tarea 2.5: «extender `media-proxy` con caché, cabeceras que exija la fuente, límite de tamaño y
tipos MIME permitidos».

### Por qué no se reutiliza `/stream/:ticket`

`/stream/:ticket` existe para el vídeo: fuerza el `Content-Type` desde lo que se pidió
(playlist, segmento, subtítulo) y reenvía un rango de bytes. Para una imagen hacen falta tres
cosas que esa ruta no hace:

1. **El `Content-Type` tiene que salir de una lista blanca de tipos ráster**, no de lo que se
   pidió. Un SVG es un documento con guiones dentro y servirlo desde nuestro propio origen es
   abrir una puerta que no hace falta abrir.
2. **Un tope de bytes por página**, con 413 y sin cachear.
3. **Una caché en disco**, que es lo que hace que releer un capítulo no vuelva a bajar las
   imágenes.

La ruta de portadas (`GET /api/cover/:providerId/:ref`) ya tiene las dos primeras
(`MAX_COVER_BYTES = 5 MB` en `packages/media-proxy/src/byte-proxy.ts:113`, y el 415 del SVG).
La tercera es nueva y por eso va en su propia ruta.

### La ruta

```
GET  /api/manga/image/:ticket      una página de un capítulo, por ticket
```

El `:ticket` es opaco, aleatorio con CSPRNG, y **nunca contiene la dirección del tercero**. La
resolución ticket → (dirección, cabeceras) vive en memoria, como la de los streams.

**El almacén de tickets es otro.** El de streams tiene tope de 500 entradas y vida de 600 s
(`packages/media-proxy/src/ticket-store.ts:26-29`). Un capítulo de 60 páginas son 60 entradas, y
quien lee tres seguidos —con la precarga de dos por delante— ronda las 180: con el almacén
compartido, leer manga **echaría los tickets del vídeo** y el vídeo que se estaba viendo se
quedaría sin él a mitad. Son dos almacenes instanciados del mismo tipo, con topes distintos:

| | Streams | Imágenes |
|---|---|---|
| Tope de entradas | 500 (el de hoy) | 2 000 |
| Vida | 600 s | 1800 s (30 min) |

La vida más larga de las imágenes es porque el lector **precarga** páginas que se van a ver
después, y una vida de 600 s dejaría huérfanas las de un capítulo largo. No es una caché: el
ticket no guarda bytes, sólo dice a dónde ir.

### Lo que hace la ruta

1. **Resuelve el ticket.** Desconocido → 404. Vencido → 410. (Los mismos códigos que usa el
   proxy de streams.)
2. **Revalida el destino** contra la lista blanca: sólo `http` y `https`; loopback, RFC1918,
   link-local y metadata de nube rechazados; **cada salto de redirección revalidado**, con tope de
   5 saltos. Es la misma regla del proxy de bytes, y por eso se **reutiliza** el guardián de
   destinos en vez de escribir uno para manga.
3. **Reenvía al upstream sólo las cabeceras que la fuente declaró**, más las que el plugin
   escribió en `MangaPageSource.headers` (típicamente `Referer` y `User-Agent`). Los nombres y
   los valores se validan con la misma expresión estricta que rechaza `\r`, `\n` y `\0`.
4. **Fuerza el `Content-Type`** desde la lista blanca de tipos ráster (`RASTER_TYPES`,
   `byte-proxy.ts:104`): `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`.
   **Un tipo fuera de la lista se rechaza con 415 antes de enviar un solo byte**, aunque sea
   `image/svg+xml`.
5. **Tope de bytes por página**: 12 MiB. Por encima, **413** y no se cachea. Ver D-M6.
6. **Nunca copia cabeceras del upstream** salvo la lista blanca de respuesta, y **elimina
   `Set-Cookie` siempre**, sin excepción: las cookies ignoran el puerto y un upstream hostil podría
   escribir cookies para todo `127.0.0.1`.
7. **Añade `X-Content-Type-Options: nosniff`.**
8. **Sirve con `Cache-Control`** y `ETag`, como las portadas.

### La caché en disco

Las páginas se cachean en `<cacheDir>/manga/`, donde `cacheDir` es el de `ConfigPaths`
(`packages/core/src/config.ts`): `$XDG_CACHE_HOME/nn-anime` en Linux, `%LOCALAPPDATA%\nn-anime\cache`
en Windows, y `NN_ANIME_CACHE_DIR` lo puede mover. **No se escribe una ruta a mano**: el directorio
ya existe y lo prepara `ensureDirs`.

El nombre del archivo sale de un hash de la dirección (**nunca del nombre de la fuente**: un nombre
de fichero derivado de datos de un tercero es un camino de traversal esperando). El `ETag` es ese
hash.

- **Tope total de la caché**: 512 MiB. Por encima, se desaloja lo más viejo (LRU).
- **Lo que se cachea es la respuesta**, con su tipo y su tamaño; el contenido del upstream no se
  revalida contra nada.
- **Una página que falla no se cachea.** Un 404 del upstream es un 404, no una imagen vacía.

Esta caché es **superficie nueva**: `SPEC-media-proxy.md` pone «cachear segmentos en disco» en
*Ask first*. La 2.5 lo pide explícitamente, así que este spec lo propone como enmienda y espera
la aprobación. Ver D-M3.

### Por qué la caché en disco

Sin ella, releer un capítulo baja todas sus imágenes otra vez, y con una fuente lenta la lectura
se para. Con ella, la segunda lectura sale del disco. Y es lo que hace posible que la descarga
(2B) y la lectura compartan terreno: el archivo CBZ y la caché son copias del mismo byte.

## Lector

La tarea 2.6: «modo paginado (izquierda→derecha y derecha→izquierda), modo vertical continuo,
ajuste de ancho/alto, zoom, teclado y gestos, precarga, recuerda la página».

El lector vivirá en `packages/web/src/features/reader/` —**no existe todavía: es la 2.6**—, con su
propio `ReaderPage` y su ruta en la aplicación (`/manga/:providerId/:ref/capitulo/:chapterRef`).

### Los modos

| Modo | Qué se ve | Cómo se avanza |
|---|---|---|
| **Paginado** | Una página cada vez. | Izquierda o derecha, según el sentido de lectura. |
| **Vertical continuo** | Todas las páginas en una columna larga. | Desplazamiento. |

El **sentido de lectura** (derecha→izquierda, que es el de la manga, o izquierda→derecha) es un
**ajuste de la aplicación**, no de la obra: hay manga publicada en los dos sentidos y el usuario
que sabe cuál es el suyo lo dice una vez. Ver D-M7.

### El ajuste

| Ajuste | Qué hace |
|---|---|
| **Ancho** | La página ocupa el ancho disponible; la altura sale. Es el defecto. |
| **Alto** | La página ocupa el alto disponible; el ancho sale. |
| **Original** | El tamaño real en píxeles, con desplazamiento si no cabe. |

### El zoom

De 50 % a 400 %, en pasos. Se puede llegar con `+`/`-`, con el gesto de pinza y con el botón. El
zoom **sobrevive al cambio de página**: un lector que vuelve a encajar la imagen al pasar la
página no deja ampliar nada.

### El teclado

| Tecla | Efecto |
|---|---|
| `→` | Página siguiente (en sentido izquierda→derecha) |
| `←` | Página anterior (en sentido izquierda→derecha) |
| `Espacio`, `AvPág` | Página siguiente |
| `RePág` | Página anterior |
| `Inicio` / `Fin` | Primera / última página |
| `+` / `-` | Zoom |
| `0` | Zoom a 100 % y ajuste «ancho» |
| `g` | Abrir el deslizador de páginas |
| `f` | Pantalla completa |
| `Esc` | Salir del lector |

En sentido derecha→izquierda, `←` avanza y `→` retrocede. **La regla del sentido es el punto
del lector**: una flecha que va al revés de lo que el usuario espera es la queja más común de
cualquier lector de manga.

Las teclas **no hacen nada** cuando el foco está en un campo de texto o con `Ctrl`/`Meta`/`Alt`
pulsados, como ya está escrito en `docs/a11y.md` para el reproductor.

### Los gestos

| Gesto | Efecto |
|---|---|
| Deslizar a la izquierda / derecha | Página siguiente / anterior, según el sentido |
| Pellizcar | Zoom |
| Doble toque | Alterna entre «ancho» y «zoom al doble» |

Los gestos se complementan al teclado, **no lo sustituyen**: el teclado es el camino accesible y
el gesto es el cómodo.

### La precarga

- **Paginado:** las **dos** páginas siguientes.
- **Vertical:** una ventana de **tres** páginas por debajo de la que se está viendo.

La precarga **pide por el proxy**, no a la fuente: la dirección que se precarga es la del
ticket, y el ticket es el que resuelve el proxy. Un capítulo de 60 páginas no se descarga entero
de golpe: eso es lo que distingue una precarga de una descarga.

### Recordar la página

- Al cambiar de página se escribe el progreso (`read_progress`) con un **debounce de 1 s**.
- Al abrir un capítulo, se lee el progreso y se abre en esa página; si el progreso es 0 —no se ha
  empezado— se abre en la primera.
- Si el capítulo ya no existe (la fuente lo quitó), se abre en la primera y **se dice**, no se
  rompe.

### La accesibilidad

La tarea 2.6 pide «checklist de accesibilidad añadida a `docs/a11y.md`». Lo que se añade:

| Qué | Cómo se comprueba |
|---|---|
| Toda la navegación funciona con el teclado | Recorrido con `Tab` y flechas, en el e2e |
| El número de página se anuncia | Región `aria-live="polite"` con «Página 12 de 60» |
| El deslizador de páginas tiene nombre y valor | `aria-label` y `aria-valuenow` |
| Las imágenes tienen texto alternativo | `alt` con el número de página |
| El movimiento reducido se respeta | Sin transiciones con `prefers-reduced-motion: reduce` |
| El foco se ve | El anillo de foco del proyecto, `:focus-visible` |
| El contraste del texto del lector | La misma comprobación de tokens de `packages/web/src/a11y.test.ts` |

Los textos de la interfaz van en `packages/web/src/i18n/es.ts`, como todos los demás: **ninguna
cadena suelta en el componente**.

## Índice

La tarea 2.7: «el conmutador de tipo pasa a tres vías (anime / películas / manga), `?tipo=manga`, top y
populares de manga».

### El conmutador

Tres vías, y la que se está mirando **vive en la dirección**:

```
/                     anime (el defecto: no se escribe)
/?tipo=movies         películas
/?tipo=manga          manga
```

El tipo por defecto **no se escribe** en la dirección: dos direcciones para la misma pantalla
darían dos entradas de historial y dos claves de caché para lo mismo. Esa regla ya está
implementada en `packages/web/src/features/tipo/tipo.ts` (`pathConTipo`) y lo que cambia es que
aprende un tercer valor.

Recargar, compartir y deshacer con el botón de atrás **ya funcionan** y deben seguir funcionando:
es el mismo mecanismo, con una palabra más.

### Las filas de la home

Con la pestaña de manga:

| Fila | De dónde sale |
|---|---|
| **Top de manga** | AniList, `type: MANGA`, `format_in: [MANGA]`, ordenado por popularidad |
| **Populares de manga** | AniList, `type: MANGA`, `format_in: [MANGA, ONE_SHOT]` |
| **Novedades de manga** | El feed de las fuentes que declaren manga, si lo tienen |
| **Continuar leyendo** | `read_progress` |

### La pantalla vacía

Si no hay ninguna fuente que sirva manga, la pestaña **lo dice**: «ningún proveedor instalado
sirve manga» y qué falta. Es el mismo mecanismo que hoy tiene la pestaña de películas
(`sinFuenteQueSirva` en `tipo.ts`).

## Descargas (fase 2B, D5)

La 2B es la tarea 2.8, pero el formato se decide aquí porque el lector y la descarga comparten el
mismo archivo y el mismo modelo de capítulos. D5 está decidida: **CBZ**, un archivo por capítulo,
interoperable con otros lectores.

### El archivo

```
<descargas>/manga/<provider>/<titulo-slug>/<volumen>-<capitulo>.cbz
```

- Cada segmento del nombre se sanea: sólo letras, números, guion y guion bajo. Nada de `..`,
  rutas absolutas, unidades de Windows ni separadores alternativos.
- La ruta final se comprueba con `resolve` y se exige que empiece por la raíz de descargas.
- Se escribe como `.part` y se renombra al terminar.

### El contenido del CBZ

Un CBZ es un ZIP. Dentro:

```
0001.jpg
0002.jpg
...
ComicInfo.xml     (opcional)
```

- Las páginas van numeradas con **cinco dígitos y el orden del capítulo**, porque el orden de las
  entradas dentro de un ZIP es el orden de lectura y el número es lo que un lector externo usa
  para ordenar.
- La extensión es la de la imagen real, no una fija: si la fuente sirve WebP, el CBZ lleva WebP.
- `ComicInfo.xml` es **opcional** y se escribe cuando el motor puede: es el formato que leen
  Comick y Tachiyomi. Si el motor no lo sabe llenar, el CBZ se hace **sin él**, y el capítulo es
  perfectamente válido.

### El motor

**Se reutiliza el motor de descargas de la fase 1** (`packages/media-proxy/src/download/`): la
cola, la concurrencia 2, la pausa, la reanudación, los reintentos con espera creciente, la
comprobación de espacio libre (`MIN_FREE_BYTES = 512 MiB`) y el saneamiento de rutas.

Lo que cambia:

- **La fuente de los bytes es la página**, no el stream: la descarga baja las imágenes por el
  **mismo camino que el lector** —el proxy, con la lista blanca de destinos y el tipo de imagen
  forzado—, nunca por una dirección que venga del cliente.
- **El destino es un ZIP**, no un archivo de vídeo: se escribe el archivo `.part` y se renombra al
  terminar.

### El CBZ se escribe en casa

**El ZIP lo escribe la aplicación, sin dependencias nuevas.** `SPEC-nn-anime.md` no tiene una
librería de ZIP en su Tech Stack y añadir una es *Ask first*; pero un ZIP *store* es un formato
sencillo: cabeceras locales, directorio central y el **CRC-32** de cada entrada. `node:zlib` —que
Bun implementa— trae `crc32` y `deflateRawSync` (medido en este árbol, ver «Lo que se midió hoy»),
así que no hace falta nada más.

Decisión concreta: **las imágenes se guardan sin comprimir** (método *store* del ZIP). Razón: una
página de manga es JPEG o PNG, que ya están comprimidos; volver a comprimir con deflate gasta CPU
para ganar un 1 %. El CRC-32 se calcula igual, porque es lo que valida la entrada al leerla. El ZIP
sin comprimir lo abren igual todos los lectores. Ver D-M4.

### La lectura local

- El lector **prefiere la copia local** cuando el capítulo está descargado, igual que el
  reproductor prefiere el vídeo descargado. Sin red, funciona.
- El servidor sirve las páginas de un CBZ local con una ruta hermana de `/api/downloads/:id/file`
  —`GET /api/downloads/:id/page/:name`—: se abre el ZIP **en memoria**, se busca la entrada por su
  nombre exacto y se sirve. **Nunca** una ruta del cliente: el `:id` sale de la tabla de descargas y
  el `:name` se busca dentro del archivo, no en el disco.
- La vista de descargas es **una sola** para vídeo y manga (tarea 2.9): una pantalla, dos tipos.

## Superficie HTTP

Rutas nuevas del servidor. Todas exigen el token de sesión y el `Host` validado, como las demás
(`SPEC-nn-anime.md`, mitigaciones 1, 2 y 4).

```
GET  /api/manga/:providerId/:ref                       la ficha de la obra
GET  /api/manga/:providerId/:ref/chapters              la lista de capítulos
GET  /api/manga/:providerId/:ref/volumes               la lista de volúmenes
GET  /api/manga/:providerId/:ref/chapter/:chapterRef/pages  las páginas de un capítulo
GET  /api/manga/image/:ticket                          los bytes de una página
GET  /api/manga/progress?limit=20                      el progreso de lectura
PUT  /api/manga/progress                               escribe el progreso de lectura
```

**El progreso se habla por referencias, no por ids.** El cuerpo del `PUT` es
`{ providerId, mangaRef, chapterRef, page }`, y lo que devuelve el `GET` lleva las mismas
referencias más el título, la portada y la fecha: el cliente no conoce los ids de SQLite y no
tiene por qué. El servidor resuelve `chapterRef` a `chapter_id` antes de llamar al repositorio; un
capítulo desconocido es un 404, no una fila nueva inventada.

Los dos `:ref` no pueden llamarse igual: `:ref` es la obra y `:chapterRef` es el capítulo. Un
enrutador que reciba dos parámetros con el mismo nombre en la misma ruta se queda con uno y la
petición deja de ser lo que dice.

**Quién emite el ticket.** Lo emite la ruta de las páginas, no el plugin: el plugin devuelve la
dirección del tercero y sus cabeceras, y el servidor las cambia por un ticket del almacén de
imágenes antes de responder. El cliente **nunca** ve el resultado de `getChapterPages` tal cual;
sólo la forma pública. Si el plugin mintiera sobre la dirección, el proxy la revalida igual: el
ticket no es una frontera de confianza, es un identificador.

La ruta de las páginas devuelve la forma **pública**: la `url` de cada página es
`/api/manga/image/<ticket>`, del propio servidor. **La dirección del tercero nunca sale del
proceso**, igual que los headers de un stream nunca salen (`SPEC-media-proxy.md`, mitigación 6).

Las rutas de lectura son de sólo lectura; la única que escribe es el progreso, y es `PUT` porque
es idempotente: escribir la misma página dos veces deja la misma fila.

## Decisiones

### Las del humano, ya tomadas

- **D4** — manga antes que watch party, por riesgo y por reutilización del motor de descargas.
- **D5** — el formato offline es **CBZ**: un archivo por capítulo, interoperable con otros
  lectores.

### Las que este spec propone y que esperan aprobación

| ID | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **D-M1** | `capabilities.media` admite la cadena de siempre **y** una lista de `anime`/`movies`/`manga`. `mediasOf()` normaliza a un conjunto. | **Añadir `'manga'` al enum y nada más.** | Un enum de un valor no puede decir «anime y manga»: o se declara una cosa o la otra, y el portal que sirve las dos quedaría sin forma de decirlo. Y `'both'` («las dos mitades») es un atajo de la era de dos mitades que en una lista de tres no significa nada. |
| | | **Una capacidad nueva `manga: boolean`.** | Duplica el mismo eje con otra forma: habría dos reglas para «qué sirve este proveedor» y dos caminos para la misma respuesta. El roadmap pide el cambio **dentro de `media`**. |
| | | **`media` como conjunto de banderas (`servesAnime`, `servesManga`).** | Rompe todos los plugins publicados: el campo deja de ser un valor y pasa a ser un objeto. |
| **D-M2** | El proxy de imágenes tiene **su propio** almacén de tickets: 2000 entradas y 1800 s de vida. | **Compartir el almacén de los streams** (500 entradas, 600 s). | Tres capítulos de 60 páginas con la precarga por delante rondan las 180 entradas: con el almacén compartido, leer manga echaría los tickets del vídeo y el vídeo en marcha se quedaría sin él. |
| **D-M3** | Las páginas se **cachean en disco** en `<cacheDir>/manga/`, con tope de 512 MiB y desalojo LRU. | **Sólo caché HTTP** (la del navegador). | Releer un capítulo volvería a bajar todas sus imágenes, y con una fuente lenta la lectura se para. Es enmienda al *Ask first* de `SPEC-media-proxy.md` («cachear segmentos en disco»), y por eso la pide el humano. |
| **D-M4** | El CBZ lo escribe la aplicación con `node:zlib`, **sin dependencia nueva**, y con las imágenes **sin comprimir** (método *store*). | **Añadir una librería de ZIP.** | `SPEC-nn-anime.md` no tiene una en su Tech Stack y añadirla es *Ask first*. Una página de manga ya viene comprimida; volver a comprimir gasta CPU para ganar un 1 %. |
| **D-M5** | La biblioteca se **reutiliza**: `favorite`, `plan_to_watch` y `watched_title`, con la etiqueta de cada pestaña («quiero leer» en manga, «quiero ver» en anime). Lo único nuevo es `read_progress`. | **Tres tablas nuevas** (`plan_to_read`, `read_title`, y el favorito aparte). | Harían falta seis tablas para tres intenciones, y la separación entre pestañas la hace ya el filtro `esDelTipo`, que existe y funciona. |
| **D-M6** | Tope de **12 MiB por página** y **512 MiB** de caché en disco. | Reusar el tope de 5 MiB de las portadas. | Una portada es una imagen de 200×300; una página de manga es una lámina escaneada de 1500×2200, y a 5 MiB se rechazaría media hoja. |
| **D-M7** | El sentido de lectura (RTL/LTR) es un **ajuste de la aplicación**, con RTL por defecto. | Decidirlo por obra, o por el proveedor. | Hay manga en los dos sentidos y el usuario sabe cuál es el suyo. Un valor por obra obligaría a acertarlo en cada ficha y a corregirlo a mano. |
| **D-M8** | El progreso de lectura **no** escribe en `watch_event`, y la 2A pinta su **propia** fila «continuar leyendo». | Reusar la fila de «continuar viendo». | Esa fila trae `mode`, `positionS` y `durationS`, que no significan nada para una página. Fabricar visionados por capítulo ensuciaría la afinidad del motor, que se calcula con lo que de verdad se reprodujo. |
| **D-M9** | El tipo de AniList que se pide es `MANGA`, y `NOVEL` **queda fuera** de la fase 2A. | Incluir `NOVEL` desde el principio. | Una novela no tiene imágenes que leer: no hay nada que el lector pueda mostrar. Incluirla en el top sería mandar al usuario a una ficha sin capítulos. |
| **D-M10** | El versionado del contrato de plugin **no sube `apiVersion`**; lo que sube es el schema de `capabilities.media`. | Subir `apiVersion` a `'2'`. | Subirlo rechazaría **todos** los plugins publicados, que es un cambio incompatible sin motivo. El schema ya da el comportamiento correcto: un plugin de manga no carga en una aplicación vieja, con un mensaje que lo dice. |

## Verificación por tarea

Cada criterio se mide. «Hecho» no es una medición: un test que pasa con el código roto no mide
nada, y en este repositorio ya ha pasado cinco veces (el registro está en `docs/v1-report.md`).
Cada prueba nueva **se mide mutando la implementación**: se rompe el comportamiento a propósito y
la prueba tiene que fallar.

### 2.1 — Este documento

No hay código que medir: la aceptación de esta tarea es la **revisión humana con fecha**, anotada
en el encabezado y en `tasks/done/T234.md`. Lo que sí se mide hoy es que el documento no invente el
árbol: cada afirmación sobre el estado actual tiene su fila en «Lo que se midió hoy», y las rutas
que cita existen.

### 2.2 — Contrato de plugin

| Criterio | Medición | Mutación que tiene que romperlo |
|---|---|---|
| `capabilities.media` admite `'manga'` y la forma de lista | Un plugin del fixture declara `media: ['anime','manga']`, se carga, y `/api/providers` devuelve la lista | Quitar `'manga'` del enum: el manifiesto se rechaza y la prueba falla |
| La normalización es una sola | `mediasOf` devuelve `['anime','manga']` para esa lista, `['anime','movies']` para `'both'`, `['anime']` para lo que no declara | Cambiar `'both'` por `['both']` en la normalización: la prueba falla |
| Un plugin que declara manga sin `getChapters` se rechaza **nombrando el método** | Se carga un manifiesto así y el error dice `getChapters` | Quitar la comprobación: el manifiesto se acepta y la prueba falla |
| Un plugin que declara manga sin `mangaPages`/`getChapterPages` se rechaza | Se carga un manifiesto que sólo lista capítulos y el error dice `getChapterPages` | Quitar la comprobación: se acepta un manga que no se puede leer |
| La capacidad y los métodos van juntos (`mangaPages`, `mangaVolumes`) | Dos manifiestos mal declarados se rechazan nombrando lo que falta | Quitar la comprobación: la prueba falla |
| Un plugin de anime sin nada de manga sigue cargando | El fixture de anime actual carga igual que antes | Añadir un campo obligatorio: la prueba falla |
| El fixture tiene manga con imágenes locales | El e2e abre un capítulo y ve las páginas | Cambiar la ruta de la imagen del fixture: el e2e falla |
| Un resultado de manga lleva su tipo | El fixture devuelve `mediaType: 'manga'` y la obra sale en la pestaña de manga, no en la de anime | Quitar `mediaType` del resultado: cuenta como anime y la prueba de la pestaña falla |
| El SVG del fixture se rechaza | La ruta devuelve 415 | Quitar el 415: la prueba falla |

### 2.3 — Metadatos con AniList

| Criterio | Medición | Mutación |
|---|---|---|
| El presupuesto de AniList no cambia | Con un reloj inyectado, dos consultas seguidas quedan a **≥ 2000 ms**; `calls()` cuenta las salidas | Poner `ANILIST_MIN_INTERVAL_MS` a 0 en la prueba: la comprobación de espaciado falla |
| La consulta de manga usa `type: MANGA` | El AniList falso recibe la consulta con `type: MANGA` y la devuelve | Cambiar `MANGA` por `ANIME`: la consulta falsa no devuelve manga y la prueba falla |
| El filtro de adultos sigue puesto | Con el interruptor apagado, la consulta lleva `isAdult: false`; una obra marcada no llega a la caché | Quitar `isAdult: false`: la obra marcada llega a la caché y la prueba falla |
| El modo offline no sale a la red | Con `NN_ANIME_ANILIST_OFFLINE=1`, `calls() === 0` y la ruta devuelve el error de AniList caído | Quitar la comprobación de `offline`: el cliente sale y `calls()` deja de ser 0 |
| La caché no mezcla tipos | Una obra con el mismo título buscada como anime y como manga da **dos** entradas distintas | Quitar el tipo de la clave: la segunda búsqueda devuelve la entrada de la primera y la prueba falla |
| La migración no rompe la caché que hay | Una base v1 con filas de `anilist_media` se migra y **todas** quedan con el prefijo `anime:`; la misma obra buscada después no vuelve a preguntar a AniList | Quitar el `UPDATE` de la migración: las filas viejas no se leen, la búsqueda sale a la red y `calls()` sube |

### 2.4 — Datos

| Criterio | Medición | Mutación |
|---|---|---|
| La migración añade lo que dice | El recuento de tablas pasa de **21 a 24** y las de la v1 siguen ahí | Renombrar una tabla: el recuento falla |
| El progreso sobrevive al proceso | Se escribe (capítulo, página), se cierra la base, se reabre con un proceso nuevo y sale la misma página | Quitar la escritura del progreso: la relectura sale vacía |
| Los decimales se guardan | Un capítulo «12.5» se guarda y se lee como 12.5 | Cambiar la columna a `INTEGER`: el capítulo se pierde |
| El favorito de un manga sale en su pestaña y no en la de anime | `enElTipo` reparte: el manga entra en `manga` y no en `anime` | Hacer que `esDeMedia('manga', …)` devuelva siempre `true`: el anime enseña el manga y la prueba falla |
| Leer no escribe un visionado | Tras leer un capítulo, `watch_event` tiene **0** filas nuevas | Escribir un `watch_event` por capítulo: la cuenta falla |
| La caché de capítulos es la de siempre | El TTL de la lista de capítulos es 21600 s y una lectura vencida devuelve el valor viejo y revalida en segundo plano | Cambiar el TTL: la prueba del TTL falla |

### 2.5 — Proxy de imágenes

| Criterio | Medición | Mutación |
|---|---|---|
| El SVG se rechaza | 415 y **0 bytes** de cuerpo | Quitar la lista blanca de tipos: el SVG se sirve y la prueba falla |
| El tope de bytes se aplica | Una página de 13 MiB → 413 y **no** se cachea | Subir el tope: la prueba falla |
| La lista blanca de destinos se aplica | Una página cuya dirección es `http://127.0.0.1:22/` se rechaza; una redirección hacia ella se rechaza en el salto | Quitar la revalidación del salto: la redirección se sigue y la prueba falla |
| La caché funciona | La **segunda** petición de la misma página hace **0** llamadas al upstream (contadas con un `fetch` inyectado) | No escribir la caché: la segunda petición llama al upstream y la prueba falla |
| El tope de la caché desaloja | Llena la caché por encima del tope y el elemento más viejo sale | Quitar el desalojo: la caché crece y la prueba falla |
| El tercero no se ve | Ninguna respuesta contiene la dirección del upstream, ni sus cabeceras, ni `Set-Cookie` | Copiar la cabecera del upstream: la prueba de la tabla de rutas falla |
| El ticket expira | Un ticket vencido → 410; uno inexistente → 404 | Quitar la comprobación de la caducidad: la prueba falla |

### 2.6 — Lector

| Criterio | Medición | Mutación |
|---|---|---|
| El sentido de la flecha es el del ajuste | En RTL, `←` avanza; en LTR, `→` avanza | Invertir la condición del sentido: el e2e falla |
| Se recuerda la página | Se lee hasta la 12, se recarga y se abre en la 12 | No escribir el progreso: la relectura abre en la 1 |
| La precarga pide lo que debe | Con un contador de peticiones en el fixture, al abrir la página 1 se han pedido **2** páginas más | Quitar la precarga: el contador da 0 y la prueba falla |
| El zoom funciona | `+` cambia el tamaño medido de la imagen en el e2e | Quitar el manejador de `+`: el tamaño no cambia |
| El ajuste funciona | «Alto» hace que la imagen quepa en el alto; «Ancho», en el ancho | Cambiar la regla de ajuste: la medida falla |
| El teclado no secuestra | Con el foco en un campo de texto, las flechas no cambian de página | Quitar la guarda: la página cambia y la prueba falla |
| La accesibilidad está documentada | `docs/a11y.md` tiene la lista del lector, y la comprobación de nombres accesibles sigue en verde | Borrar la sección del lector: la prueba que la exige falla |

### 2.7 — Índice

| Criterio | Medición | Mutación |
|---|---|---|
| El conmutador tiene tres vías | La barra marca la que está activa, y el enlace de la activa lleva su `?tipo=` | Dejar dos vías: la prueba del conmutador falla |
| La URL conserva el tipo | `/?tipo=manga` se recarga, se comparte y el botón de atrás deshace el cambio | Quitar `manga` de `pathConTipo`: el enlace sale sin tipo |
| El defecto no se escribe | La pestaña de anime es `/`, sin `?tipo=` | Escribir siempre el tipo: la prueba de la dirección falla |
| El top de manga es de manga | El AniList falso recibe `type: MANGA` y la fila sale | Cambiar `MANGA` por `ANIME`: la fila no sale |
| La pantalla vacía avisa | Sin ninguna fuente de manga, la pestaña lo dice y no parece una aplicación rota | Quitar el aviso: la prueba falla |

### 2.8 — Descargas (2B, CBZ)

| Criterio | Medición | Mutación |
|---|---|---|
| El archivo es un CBZ | El archivo descargado **se abre como ZIP** y contiene las páginas en orden, con la extensión real de cada imagen | Escribir las páginas en orden inverso: el orden del ZIP deja de ser el de lectura y la prueba falla |
| `ComicInfo.xml` es opcional y válido | Con el motor que lo sabe, el ZIP lo lleva y se puede leer; sin él, el ZIP sigue abriéndose y el capítulo se lee | Hacer obligatoria su ausencia: la prueba del contenido falla; hacerlo obligatorio: falla la del capítulo sin él |
| Es un archivo por capítulo | Un capítulo descarga un `.cbz`; un rango, uno por capítulo | Agrupar en un solo archivo: la prueba falla |
| El motor se reutiliza | Pausa, reanudación, cancelación y disco lleno se comportan como en el vídeo | Saltarse el motor: la prueba de reanudación falla |
| El nombre es saneado | Un título con `..`, `/` y `:` no escribe fuera de la carpeta | Quitar el saneado: la ruta sale de la carpeta y la prueba falla |
| Se lee sin red | Con el upstream caído, un capítulo descargado se abre y se ven sus páginas | Quitar la preferencia por la copia local: el lector pide la red y falla |
| La descarga va por el proxy | La página baja por la ruta de imagen, con la lista blanca de destinos | Bajar la imagen por la dirección directa: la prueba de destinos falla |

## Criterios de aceptación

Los de la fase, en una frase cada uno. Todos se apoyan en las mediciones de arriba.

- [ ] **Este documento está aprobado por el humano con fecha**, y el encabezado lo dice. Hasta
      entonces no se escribe código de la 2A.
- [ ] Un plugin que declara `media: ['anime', 'manga']` carga, y `capabilities.media` sigue
      aceptando los manifiestos que ya existen sin cambios.
- [ ] La ficha de un manga trae sinopsis, géneros y portada de AniList, y con
      `NN_ANIME_ANILIST_OFFLINE=1` el proceso **no sale a la red** (`calls() === 0`) y la pantalla
      dice lo que tiene que decir.
- [ ] Los capítulos de un manga se guardan con su número **real** (los decimales incluidos), y el
      progreso de lectura sobrevive a cerrar y reabrir el proceso.
- [ ] Las páginas de un capítulo se sirven **por el proxy**: el navegador recibe direcciones de
      `127.0.0.1`, el SVG se rechaza con 415, una página de más de 12 MiB con 413, y la segunda
      lectura de un capítulo **no** baja las imágenes otra vez.
- [ ] El lector pagina en los dos sentidos, tiene modo vertical continuo, ajuste de ancho y alto,
      zoom, teclado y gestos, precarga las dos páginas siguientes y **recuerda la página** en la que
      se estaba.
- [ ] El conmutador de tipo tiene tres vías, `?tipo=manga` sobrevive a recargar y a compartir, y la
      home tiene top y populares de manga.
- [ ] Un capítulo descargado es un **CBZ** que se abre en otro lector, y la aplicación lo lee sin
      red.
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, `bun run e2e` y `bun run coverage:gate` en
      verde, y ninguna prueba mutada pasa sin que se note.
- [ ] `SECURITY.md` recoge la superficie nueva —imágenes servidas por el proxy, CBZ en disco— y
      `docs/a11y.md` tiene el apartado del lector.

## Boundaries

**Always**

- Resolver la dirección de la imagen **en el servidor**, a partir de un ticket. El cliente nunca
  aporta ni ve la dirección del tercero.
- Validar con Zod toda respuesta de proveedor antes de que salga del módulo, y toda entrada HTTP
  antes de que entre.
- Escribir en la base **sólo** a través de `catalog-store`.
- Reutilizar el motor de descargas y el guardián de destinos del proxy: no escribir un segundo
  motor ni una segunda lista blanca.
- Recordar la página en cuanto se cambia, con debounce, para que cerrar la pestaña a mitad no
  pierda el sitio.
- Poner los textos nuevos de la interfaz en `packages/web/src/i18n/es.ts`.

**Ask first**

- Cambiar cualquier tipo del contrato de plugin de la sección «Contrato de plugin».
- Añadir una dependencia fuera de la tabla de Tech Stack.
- Cachear en disco algo que no sean páginas de manga (D-M3 es la excepción que se pide).
- Cambiar el TTL de un recurso existente, o el de los capítulos (21600 s).
- Subir `apiVersion` del contrato de plugin.

**Never**

- Servir un SVG, ni dejar que el `Content-Type` del upstream decida el que se sirve.
- Devolver al cliente la dirección de una imagen del tercero, ni sus cabeceras, ni sus cookies.
- Escribir bytes de imagen en la base de datos.
- Fabricar un `watch_event` por un capítulo leído.
- Meter una URL de la fuente en un nombre de archivo.
- Bajar una imagen sin pasar por el proxy, ni desde el cliente.

## Seguridad

La Fase 2A **amplía la superficie**: por primera vez la aplicación pide **imágenes** a un tercero
y por primera vez **escribe archivos que el usuario abre con otro programa**. Las dos cosas
tienen su mitigación, y las dos van a `SECURITY.md`.

| Riesgo | Mitigación |
|---|---|
| Una página es un **SVG** con guiones dentro, servido desde nuestro origen | Lista blanca de tipos ráster; 415 antes de enviar un byte. La CSP lo detendría también, pero esa defensa es indirecta y no debe ser la única |
| Una página apunta a **loopback**, a la red privada o a la metadata de nube | La lista blanca de destinos, revalidada en cada salto de redirección, con tope de 5 saltos |
| Una redirección lleva a un destino prohibido | La revalidación en el salto, no sólo en la primera URL |
| El upstream manda **cabeceras** o `Set-Cookie` | Lista blanca de cabeceras de respuesta; `Set-Cookie` fuera, siempre |
| Una página **enorme** | Tope de 12 MiB con 413, y no se cachea |
| Un **nombre de archivo** traversal en la descarga | Saneado por segmento y comprobación de prefijo con `resolve`, lo mismo que el vídeo |
| Un **CBZ** con rutas extrañas (zip slip) | El zip se abre **en memoria**, se leen las entradas por su nombre exacto y no se escribe nada en disco al abrir |
| La **dirección del tercero** se queda en la base | No se persisten direcciones de páginas; el proxy las resuelve en el momento |
| Un plugin de manga pide **imágenes de cualquier sitio** | El plugin corre sin sandbox, como todos: el riesgo es el de siempre, mitigado por la lista blanca del proxy y avisado en la UI al instalar |

**Riesgo residual, explícito:**

- **Un CBZ es un archivo que otro programa abre.** Un CBZ con rutas malformadas podría intentar
  escribir fuera del directorio de lectura en un lector con permisos de escritura. Por eso el CBZ se
  escribe **sin rutas**: sólo nombres de archivo planos, sin directorios. Un lector que no lo
  respete es un problema de ese lector, pero el archivo que escribimos no le da la oportunidad.
- **La caché en disco de imágenes** son archivos del usuario que no ha pedido: 512 MiB como tope,
  en el directorio de caché desechable, que la aplicación puede vaciar.
- **Un plugin de manga** es código arbitrario con los permisos del usuario, como todos los
  plugins. Puede pedir imágenes de cualquier sitio que pase la lista blanca. Eso ya era posible
  con un `fetch` dentro del plugin; la mitigación no vive aquí.

## Open Questions

Lo que el humano tiene que responder, y que este spec **no** decide por su cuenta:

1. **¿La 2A incluye `ONE_SHOT`?** Las obras de un solo capítulo (y las antologías) son un tipo
   propio en AniList. El top de manga con `format_in: [MANGA]` las deja fuera; con
   `[MANGA, ONE_SHOT]` entran. La recomendación de este spec es **incluirlas en el top** —son
   manga— pero **no** como un filtro de la ficha.
2. **¿El tope de 12 MiB por página es suficiente?** Es una cifra de diseño, no una medición: no
   hay ninguna fuente real de manga con la que medir la distribución de tamaños de página en este
   repositorio. Si en la práctica hay láminas de mayor resolución, el número sube —y sube con una
   medición, no con una impresión.
3. **¿La caché de imágenes en disco (D-M3) se aprueba?** Es la única parte de este spec que pide
   una excepción al *Ask first* de `SPEC-media-proxy.md`.
4. **¿El CBZ incluye `ComicInfo.xml` desde el primer día?** El formato es conocido y el motor
   puede llenarlo con lo que ya sabe (título, número de capítulo, volumen), pero los campos
   completos que leen Comick y Tachiyomi —guionista, editorial, dibujante — no los tiene nadie. La
   recomendación es **sí, con lo que haya**, porque un CBZ sin él también es un CBZ válido.
5. **¿El sentido de lectura debería poder depender de la obra** (D-M7)? La recomendación es que no:
   un ajuste global, y una excepción por obra si el usuario lo pide.

## Lo que se midió hoy

Lo que este spec **comprueba contra el árbol**, con la forma de comprobarlo. Ninguna afirmación de
este documento sobre el estado actual es una suposición.

| Afirmación | Cómo se midió |
|---|---|
| `mediaTypeSchema` ya admite `'manga'` | `packages/core/src/schema.ts:185`: `z.enum(['anime', 'movie', 'series', 'manga'])` |
| `mediaType` es un tipo exportado | `packages/core/src/models.ts:46` |
| `capabilities.media` es hoy `'anime' \| 'movies' \| 'both'`, sin `manga` | `packages/core/src/schema.ts:111` |
| La interfaz ya tiene el concepto de mitad, con dos valores | `packages/core/src/media.ts:32`: `MediaFilter = 'anime' \| 'movies'` |
| El filtro de la interfaz ya separa por pestaña | `packages/web/src/features/tipo/tipo.ts`: `esDelTipo`, `enElTipo`, `sinFuenteQueSirva` |
| El tipo de la interfaz ya vive en la dirección | `packages/web/src/features/tipo/tipo.ts`: `tipoFromPath`, `pathConTipo` |
| `esDeMedia` **ya excluye** el manga de las dos mitades | `packages/core/src/media.ts:80`: la regla dice `tipo === 'anime'` para la mitad de anime |
| La tabla `episode` no admite decimales | `packages/catalog-store/src/migrations/0001-initial.sql`: `number INTEGER NOT NULL` |
| `watched_title` y `plan_to_watch` no escriben en `watch_event` | Sus cabeceras, en `0011-visto.sql` y `0012-quiero-ver.sql` |
| El esquema tiene **21** tablas | `grep -h "CREATE TABLE" packages/catalog-store/src/migrations/*.sql \| wc -l` → 21 |
| La última migración es la `0015` | `packages/catalog-store/src/migrations/0015-descarga-en-segmentos.sql` |
| El cliente de AniList: 2000 ms, 10 s, 2 MiB, tres hosts, `NN_ANIME_ANILIST_OFFLINE` | `packages/server/src/anilist/client.ts:32-69` |
| Las consultas de AniList usan todas `type: ANIME` | `packages/server/src/anilist/queries.ts`: `topQuery`, `AIRING_QUERY`, `AIRED_QUERY`, `moviesReleasedQuery`, `moviesUpcomingQuery`, `RELATED_QUERY`, `matchQuery`, `crossQuery` |
| El proxy: tickets de 500 y 600 s | `packages/media-proxy/src/ticket-store.ts:26-29` |
| El proxy: tope de 5 MiB y tipos ráster | `packages/media-proxy/src/byte-proxy.ts:104-113` |
| El motor de descargas: 512 MiB de espacio libre, 8 GiB por archivo | `packages/media-proxy/src/download/engine.ts:27` y `download/file.ts:23` |
| La ruta de portadas ya rechaza el SVG con 415 y el exceso con 413 | `packages/server/src/routes/cover.ts` y su prueba |
| El runtime trae lo que un ZIP *store* necesita: `crc32` y `deflateRawSync` de `node:zlib` | `bun -e "const z=require('node:zlib'); console.log(typeof z.crc32, typeof z.deflateRawSync)"` → `function function` |

### Lo que **no** se midió, y por tanto no se afirma

- **El tamaño real de una página de manga.** No hay ninguna fuente real de manga con la que
  medirlo en este repositorio: el fixture usa imágenes inventadas de unos pocos KiB. El tope de
  12 MiB es una decisión de diseño y está declarado como pregunta abierta (2).
- **Cuántas páginas tiene un capítulo de verdad.** El fixture usa capítulos de 3 y 5 páginas.
  La precarga de 2 páginas y el tope de 2000 tickets salen de una estimación, no de una
  medición.
- **Que AniList sirva manga con la calidad de metadatos que se espera.** La API admite
  `type: MANGA` —es lo que dice su documentación—, pero **en esta sesión no se hizo ninguna
  petición de red**: la comprobación de los términos y del formato de la respuesta es de la
  documentación de AniList y de la forma del esquema, no de una respuesta observada. La primera
  tarea de la 2A que hable con AniList de manga tiene que mirar lo que llega de verdad y ajustar
  el esquema si el formato no es el esperado.
- **El rendimiento del lector con un capítulo largo.** No hay medición de memoria, de tiempo de
  pintado ni de lisura. La 2.6 lo mide con el e2e, y el resultado puede obligar a cambiar la
  ventana de precarga.

### Por qué el fixture no usa la red

`SPEC-nn-anime.md` es explícito: «ningún test puede tocar la red». La fuente de manga del fixture
sirve **imágenes locales generadas por el propio fixture**, y todo lo que se mide de la 2A se
mide contra ellas: el SVG que se rechaza, la imagen enorme que da 413, el contador de
peticiones de la precarga y el destino hostil que el guardián bloquea. Una prueba que dependiera
de un sitio de manga de verdad sería una prueba rota, y además una petición a un tercero que no
es un proveedor configurado por el usuario.

## Dónde vive este documento (decisión pendiente)

Aquí hay una tensión que no se resuelve sola, y se deja escrita en vez de escondida:

- `docs/specs/proposals/README.md` dice que los demás agentes proponen en `proposals/` y que el
  dueño integra. Su regla es que `docs/specs/SPEC-*.md` es el contrato de un módulo, y cambiarlo es
  un evento de versión mayor que **requiere aprobación**.
- `docs/roadmap.md` (tarea 2.1, línea 175) y `tasks/deuda.md` (T234) piden, con la ruta exacta,
  `docs/specs/SPEC-manga.md`. La fase 2A entera se cita contra esa ruta.
- `docs/specs/CAPABILITY-MAP.md` dice que cada módulo tiene su `SPEC-<id>.md` en `docs/specs/`
  «salvo los que siguen en `proposals/`, que se señalan en Interfaces en la frontera». Y
  `SPEC-watch-party.md` es el precedente de un fichero canónico cuyo **contrato sigue pendiente de
  aprobación** (CAPABILITY-MAP, «`watch-party` y su revisión»).

Se escribió donde la tarea manda, y **no se declara canónico**. Las dos opciones, con lo que
cuesta cada una:

| Opción | Qué se hace | A favor | En contra |
|---|---|---|---|
| **A. Se queda en `docs/specs/SPEC-manga.md`** | El fichero vive en la ruta canónica y su encabezado dice «propuesta pendiente»; al aprobarse se cambia el estado y se anota la fecha | El roadmap, T234 y las citas de la 2A siguen siendo válidas; el precedente de `watch-party` ya existe; nadie tiene que mover enlaces | Un `SPEC-*` sin aprobar donde el mapa dice que están los contratos. Se mitiga con el estado del encabezado, con esta sección y con que **ninguna tarea de código arranca sin la aprobación escrita** |
| **B. Se mueve a `docs/specs/proposals/SPEC-manga.T234.md`** | La ruta canónica queda libre hasta la aprobación; el dueño lo integra después | Cumple `proposals/README.md` al pie de la letra y el mapa no gana un contrato sin aprobar | El roadmap, `tasks/deuda.md` y las tareas 2.2–2.7 citan `docs/specs/SPEC-manga.md`; habría que corregir esas rutas o dejar un puntero, y un puntero es otra cosa que se queda viejo |

**La decisión está pendiente del humano.** Recomendación de quien escribe: **A**, por el precedente
de `watch-party` y porque la ruta ya está citada en tres sitios; el riesgo de A no es que el
fichero exista, sino que alguien lo lea como aprobado, y para eso está el encabezado. Si el humano
elige B, el movimiento lo hace el integrador con el resto del cierre, y este apartado se actualiza
con la ruta nueva.

Ninguna de las dos opciones cambia el fondo: **este documento no autoriza código**. La autorización
es una aprobación humana con fecha, escrita en el encabezado.
