# Spec: episode-rail (carrusel de últimos episodios)

Estado: **propuesta · pendiente de aprobación humana** · 2026-10-12.
Esta entrega **no crea un módulo**: extiende contratos y paquetes ya aprobados. No toca
`docs/specs/CAPABILITY-MAP.md` ni su build order.

Módulos que toca: `provider-sdk` / `provider-core` (contrato del feed, campo opcional),
`catalog-store` (una lectura y, sólo en la opción B, la caché del feed que ya existe), `server`
(una ruta), `web-ui` (la fila y su carrusel), `providers-fixture` (datos para la prueba).
`recsys` **no se toca**.

Antecedente: `docs/specs/SPEC-discovery.md`, que dejó fuera «la fila de episodios nuevos por
episodio» con este motivo textual: *el feed da fecha de publicación del título, no la de emisión
de cada episodio*. Esta entrega ataca ese hueco con el dato que sí existe: **cuándo la fuente
publicó ese episodio**, no cuándo se emitió.

## Objective

Que la home tenga una **tira horizontal corta** —no una sección que come media página— con los
últimos episodios publicados por las fuentes, cada uno con su número, su portada y **cuánto hace**
que salió. El usuario la recorre hacia el lado sin salir de la home.

Lo que se busca es lo de la captura de referencia: tarjeta con «Episodio 2», «hace 12 horas»,
título debajo. Es información que hoy no existe en ninguna pantalla: `Novedades` dice *qué título*
es nuevo, nunca *qué episodio*.

Éxito significa:

1. Con un proveedor que publica episodios, la home muestra la tira con contenido sin una sola
   búsqueda previa.
2. La tira ocupa **una banda de tarjetas**, no una cuadrícula: se desplaza hacia el lado y el resto
   de la home sigue visible sin bajar dos pantallas.
3. Cada tarjeta dice el número de episodio y el tiempo relativo («hace 3 horas»), no una fecha
   cruda.
4. Sin fuente que publique episodios, la fila se **explica**, no desaparece (regla de `rows.ts`).
5. Todo el recorrido es posible con teclado, y con `prefers-reduced-motion: reduce` el salto es
   instantáneo.

## Supuestos declarados

1. El dato existe **en el plugin**, no en la aplicación. La aplicación no descarga nada nuevo: sigue
   siendo el plugin quien lee su fuente. No hay URL que añadir a la lista blanca del proxy.
2. «hace 3 horas» es presentación: se calcula en el cliente desde un ISO-8601 que ya viene en el
   contrato. No se persiste texto relativo.
3. La captura muestra también un contador de comentarios. **No entra en esta entrega** (ver
   Open Questions 2).
4. No se añade ninguna dependencia de UI. El carrusel es CSS (`overflow-x`) más dos botones.
5. La tira es **un componente nuevo**, no un modo de `FeedRow`: una fila de pósters verticales y una
   tira de miniaturas con número de episodio tienen estructura, datos y accesibilidad distintos.

→ Si alguno de estos cinco supuestos no es el que se quiere, se corrige **antes** de escribir código.

## Contrato

### `provider-sdk`: `FeedEntry` gana un episodio opcional

```ts
// packages/provider-sdk/src/types.ts

/**
 * El episodio que la fuente publicó, cuando lo que publica es un episodio
 * y no un título completo.
 *
 * Opcional: el feed que sólo conoce títulos —el caso de hoy— sigue siendo
 * válido y no declara nada aquí.
 */
export interface FeedEpisode {
  /** Número de episodio dentro del título. Entero ≥ 0. */
  readonly number: number
  /** Título del episodio, si la fuente lo da. Texto no confiable. */
  readonly title?: string
  /**
   * Cuántos comentarios lleva en la fuente, si los publica.
   * Campo opcional y **no usado por la interfaz en esta entrega**; viaja en el
   * contrato para no volver a migrar el schema si se decide pintarlo.
   */
  readonly comments?: number
}

export interface FeedEntry extends SearchResult {
  readonly publishedAt?: string
  /** Presente cuando la entrada describe un episodio concreto. */
  readonly episode?: FeedEpisode
}
```

Tres decisiones, y las tres son de compatibilidad:

1. **Ni `feed` ni `getFeed` cambian.** El plugin ya declara la capacidad y ya implementa el método;
   lo único que cambia es que **puede** rellenar `episode` en las entradas que describan un
   episodio. Un plugin que no lo haga sigue cargando y sigue pintando `Novedades` igual.
2. **La versión del contrato sigue en `'1'`.** Un campo opcional dentro de un objeto que ya existía
   no rompe a nadie, por el mismo motivo que `publishedAt` no la subió.
3. **`episode` es un objeto, no tres campos sueltos.** `episodeNumber`, `episodeTitle` y
   `episodeComments` como hermanos de `title` se confunden con un título que empiece por número, y
   en `catalog-store` el JSON cacheado se leería como si el episodio fuera del título. Anidado se
   valida y se descarta como una unidad.

`feedEntrySchema` en `packages/core/src/schema.ts` crece con `episode: feedEpisodeSchema.optional()`
(`strictObject` con `number` entero ≥ 0, `title` opcional de longitud ≥ 1 y `comments` entero ≥ 0).
`RESPONSE_SCHEMAS` y el test de conformidad de `getFeed` **no cambian**: la forma sigue siendo la
misma, con un campo opcional más.

### Rutas HTTP

```
GET /api/feed/episodes?limit=   últimas publicaciones que describen un episodio
```

Suma a la lista de `docs/specs/SPEC-web-ui.md` §Contrato. La forma vive en
`packages/core/src/api.ts`, como todas:

```ts
export const episodeFeedItemSchema = feedItemSchema.extend({
  episode: z.strictObject({
    number: z.number().int().nonnegative(),
    title: z.string().min(1).optional(),
  }),
})

export const episodeFeedResponseSchema = z.strictObject({
  items: z.array(episodeFeedItemSchema),
})
```

Nótese que la respuesta **no repite** `comments`: el schema de la frontera declara sólo lo que la
interfaz usa, y un campo que nadie pinta es un campo que nadie valida. `comments` sigue en el
contrato del plugin, y entra a la respuesta el día que se pinte.

`/api/feed/episodes`, paso a paso:

1. Misma fuente que `/api/feed`: los proveedores que declaran `capabilities.feed` y tienen
   `getFeed`. Ni uno más.
2. **Misma caché** (`feed_cache`, TTL 1800 s). No hay tabla nueva, no hay migración y no se llama
   dos veces al plugin por cargar la home entera: se lee lo cacheado y se filtra.
3. Se descartan las entradas **sin `episode` o sin `publishedAt`**. Una entrada sin fecha no puede
   entrar en una fila que promete decir «hace cuánto»: el tiempo relativo sería una invención.
4. Deduplicación por `providerId#value#episode.number`, orden `publishedAt` descendente, tope del
   `limit` (por defecto 20, máximo `MAX_FEED_ENTRIES`).
5. Un proveedor que falla devuelve lista vacía y no tumba la tira.

La ruta **reutiliza** `orderFeed` y el tope `MAX_FEED_ENTRIES` de `routes/discovery.ts`; el filtro
por episodio es una función pura propia (`filterEpisodeEntries`) con su prueba unitaria, porque es
la única lógica nueva y no necesita una petición para medirse.

### `catalog-store`

**Nada.** La caché del feed ya guarda el JSON completo de cada entrada y `writeFeed` valida contra
el schema de `core`, así que las entradas con `episode` entran solas. Si el schema `strictObject`
de la caché rechazara el campo, se ajusta la validación de `repositories/feed.ts`: es un cambio de
una línea, no una migración.

### UI: la tira

Componente nuevo `packages/web/src/features/home/EpisodeRail.tsx`, montado en `HomePage.tsx` entre
`FeaturedHero` y `Novedades`. Reutiliza `useHomeRows` con una sexta consulta `/api/feed/episodes`.

Reglas de la tira:

- **Estructura**: `<section className="row row--rail">` con `SectionHeader` (mismo titular que el
  resto) y un `<ul className="rail" role="list">` de `<li>`.
- **Desplazamiento lateral**: `.rail { display: flex; overflow-x: auto; scroll-snap-type: x
  proximity; overscroll-behavior-x: contain; }` con `scroll-padding-inline` y `scroll-snap-align:
  start` en cada elemento. La banda **no** crece en alto: una sola fila de tarjetas.
- **Ancho fijo por tarjeta**: `--rail-card-width` en `tokens.css`, no un `minmax` como `.row__list`.
- **Sin barra de scroll visible cuando no hace falta**; cuando hace falta, se estiliza con los
  tokens, sin inventar color.
- **Dos botones** («anterior» / «siguiente») que llaman a `scrollBy({ left: ±ancho visible })`. Se
  deshabilitan en los extremos leyendo `scrollLeft`, `clientWidth` y `scrollWidth`. Con
  `prefers-reduced-motion: reduce` el comportamiento es `'auto'`, no `'smooth'`.
- **A11y**: los botones son `<button>` con `aria-label` traducido (`t()`), nunca iconos sin nombre.
  El `<ul>` no lleva `tabindex`: las tarjetas son enlaces reales y el `Tab` ya desplaza el
  contenedor; añadir foco al contenedor mete un paso de tabulación muerto y una trampa de teclado
  cuando el foco entra en los enlaces. `aria-live` no hace falta aquí: no hay actualización
  incremental.
- **Tarjeta**: enlace real a `/anime/:providerId/:ref` (la ficha, no el reproductor: resolver el
  stream de un episodio que el usuario no pidió es una llamada de red que no toca). Portada por
  `GET /api/cover/:providerId/:ref` con `encodeURIComponent` en la referencia, como el resto.
  Badge de episodio arriba a la izquierda («Ep. 2»), tiempo relativo arriba a la derecha, y el
  título debajo recortado a dos líneas.
- **Entrada hostil**: todo el texto del proveedor se pinta como texto, nunca como HTML, y las URLs
  pasan por la lista blanca de esquemas que ya recorre la guarda de T31a.

Tiempo relativo:

```ts
// packages/core/src/i18n.ts
/**
 * «hace 3 horas», «hace 2 días».
 *
 * `Intl.RelativeTimeFormat` con el locale pedido, no una tabla de textos: añadir
 * un idioma no puede obligar a escribir sus plurales a mano. El umbral es
 * semanas hasta un mes y luego el mes; por debajo, minutos y horas.
 */
export function formatRelativeTime(locale: Locale, iso: string, nowMs: number): string
```

Devuelve la cadena vacía si el ISO no se puede parsear, y la tira cae a la fecha corta en ese caso:
un dato roto no puede pintar «hace NaN horas».

Cadenas nuevas en `packages/web/src/i18n/es.ts` (nada suelto en el JSX):

```
'home.episodes'         'Episodios recientes'
'home.episodes.meta'    'Lo último que publicaron las fuentes'
'home.episodes.empty'   'Ningún proveedor activo publica episodios nuevos.'
'home.episodes.prev'    'Ver episodios anteriores'
'home.episodes.next'    'Ver episodios siguientes'
'home.episode.badge'    'Ep. {number}'
```

## Comandos

```
typecheck: bun run typecheck
lint:      bun run lint
test:      bun test
e2e:       bun run e2e
dev:       bun run dev
```

## Estructura

```
packages/core/src/schema.ts          feedEpisodeSchema; feedEntrySchema + episode
packages/core/src/api.ts             episodeFeedItemSchema, episodeFeedResponseSchema
packages/core/src/i18n.ts            formatRelativeTime
packages/provider-sdk/src/types.ts   FeedEpisode; FeedEntry + episode
packages/server/src/routes/discovery.ts  GET /api/feed/episodes + filterEpisodeEntries
packages/providers-fixture/src/data.ts   entradas de feed con episodio
packages/web/src/features/home/EpisodeRail.tsx  tira y botones
packages/web/src/features/home/useHomeRows.ts   sexta lectura
packages/web/src/features/home/HomePage.tsx     montaje
packages/web/src/i18n/es.ts                      cadenas
packages/web/src/styles/tokens.css               --rail-card-width
packages/web/src/styles/shell.css                .rail
```

## Estilo de código

```ts
/**
 * Las entradas que describen un episodio y traen fecha.
 *
 * Se exige la fecha: una tira que promete «hace cuánto» y no la tiene mentiría.
 * El orden lo decide el servidor; esta función no reordena.
 */
export function filterEpisodeEntries(
  items: readonly FeedResponse['items'],
): readonly FeedResponse['items'][number][] {
  return items.filter(
    (item) => item.episode !== undefined && item.publishedAt !== undefined,
  )
}
```

Convenciones del repositorio: comentarios en español que explican **por qué**; sin `any`, sin
`@ts-ignore`, sin `as` para silenciar; interfaces `readonly`; funciones puras exportadas para
poder mutarlas en la prueba.

## Estrategia de pruebas

- `bun test` en `packages/core`: `feedEpisodeSchema` acepta y rechaza (número negativo, número
  decimal, `number` como cadena); `formatRelativeTime` con minutos, horas, días, un ISO inválido y
  con `nowMs` fijo —nunca `Date.now()` dentro de la prueba, o el test se vuelve horario.
- `bun test` en `packages/server`: `filterEpisodeEntries` con y sin `episode`, con y sin
  `publishedAt`, y con duplicados; la ruta devuelve 200 con lista vacía si ningún proveedor publica
  episodios; la ruta **no** llama a `getFeed` si la caché está fresca (contador del fixture, como
  T50); un proveedor que falla no rompe la respuesta.
- `bun test` en `packages/web`: `EpisodeRail` pinta la tira, el badge y el tiempo relativo; con
  lista vacía pinta el texto de `home.episodes.empty`; los botones se deshabilitan en los extremos.
- `bun run e2e`: la home muestra la tira con datos del fixture, se desplaza al pulsar «siguiente» y
  el `scrollLeft` cambió de verdad; sin movimiento externo en la red.

**Medición obligatoria**: cada prueba nueva se mide mutando la implementación (quitar el filtro de
fecha, invertir el orden, no deshabilitar el botón) y el registro va al task. Un test que pasa con
el código roto no mide nada.

## Success Criteria

- [ ] Con el fixture, la home pinta la tira con episodios y su «hace X» sin búsqueda previa.
- [ ] La tira ocupa **una** banda: con la ventana a 1280 px el resto de la home sigue a la vista.
- [ ] Pulsar «siguiente» desplaza la tira y `scrollLeft` es mayor que 0; en el extremo el botón
      queda deshabilitado.
- [ ] Recorrer la tira entera con `Tab` es posible y el foco visible **nunca** queda fuera del
      recorte visible del contenedor.
- [ ] Con `prefers-reduced-motion: reduce` el desplazamiento no anima.
- [ ] Un proveedor sin entradas de episodio deja la fila con su texto explicativo, no la esconde.
- [ ] Una entrada sin `publishedAt` **no** aparece en la tira y sí sigue en `Novedades`.
- [ ] La segunda carga de la home no vuelve a llamar a `getFeed` (contador del fixture).
- [ ] Un manifiesto escrito antes de esta entrega **sigue cargando** sin `episode`.
- [ ] Ninguna petición de la tira sale a un origen externo: el e2e lo comprueba igual que hoy.

## Boundaries

**Always**

- Tratar el título del episodio y la portada como datos hostiles: validar en el schema, pintar como
  texto, y pasar las URLs por la lista blanca de esquemas.
- Calcular el tiempo relativo en el cliente desde el ISO, con `nowMs` inyectable.
- Centralizar el ancho de tarjeta y el espaciado en `tokens.css`.
- Traducir todo texto de interfaz con `t()`.
- Recortar el tope de entradas **antes** de que llenen la tira y antes de cachear, como el feed.

**Ask first**

- Añadir `comments` a la respuesta HTTP o pintarlo en la tarjeta.
- Añadir una librería de carrusel, de animación o de fechas.
- Cambiar la tira por una fila de pósters verticales dentro de la misma entrega.
- Enlazar la tarjeta al reproductor en vez de a la ficha.

**Never**

- Inventar una fecha para una entrada que no la trae, ni reordenar en el cliente lo que el servidor
  ya ordenó.
- Escribir una URL de proveedor en `src` o `href` sin la lista blanca.
- Añadir una tabla, una migración o una llamada de red nueva al plugin por esta fila.
- Meter el contenedor de scroll en el orden de tabulación.
- Pintar la tira como cuadrícula que empuja el resto de la home fuera de la primera pantalla.

## Seguridad

- El feed es entrada no confiable, como cualquier respuesta de plugin: se valida al recibirlo, al
  escribir la caché y al leerla. `episode.number` es un entero acotado por el schema, así que no
  puede entrar en una expresión de plantilla ni en un `href`.
- **No se persiste nada nuevo**: la caché del feed ya guarda referencias, títulos, portadas y
  fechas, y ahora un número de episodio. Ningún header de upstream, ningún byte de video.
- La portada sigue saliendo por `/api/cover/:providerId/:ref`; el navegador nunca recibe una
  dirección de tercero, así que la tira no abre superficie SSRF.
- `media-proxy` **no se toca**.

## Open Questions

1. **¿De dónde sale la fila?** Se propone **A**, leída de la fuente por el plugin: es lo único que
   puede decir «hace 12 horas» antes de que el usuario busque nada, y es la regla que
   `SPEC-discovery.md` ya fijó. La alternativa **B** —leer `episode.fetched_at` de la base local,
   sin tocar el contrato— sale mucho más barata (una ruta y un componente, cero cambios de plugin)
   pero enseña vacío en una instalación nueva, y una tira vacía en la home no resuelve el problema
   que la motiva. Si se elige B, este spec se recorta a la mitad y hay que decir explícitamente que
   la tira sólo refleja lo ya abierto. **¿A o B?**
2. **¿Entra el contador de comentarios?** La captura lo muestra. Se propone **no** pintarlo: es un
   dato de terceros que la mayoría de feeds no trae, y un hueco al lado del badge que sólo se
   rellena en un proveedor es una interfaz que miente por omisión. El campo queda en el contrato.
   ¿Se pinta o no?
3. **¿La tira va arriba o abajo?** Se propone **arriba**, justo bajo el destacado y antes de
   `Novedades`: es lo más fresco y lo que más rápido envejece. Bajo «continuar viendo» sería una
   disposición de segunda.
4. **¿Cuántas tarjetas se traen?** Se propone 20 (el `limit` por defecto de la ruta). Más tarjetas
   en una tira que se recorre a mano no se ven, y engordan la respuesta.
5. **¿La tira se reutiliza en la ficha del título**, con los episodios de ese título? No se propone
   en esta entrega: la ficha ya tiene su lista de episodios, y duplicarla es trabajo de otra tarea.

## Enmiendas propuestas a specs aprobados

Ninguna se aplica hasta que este documento se apruebe:

1. `docs/specs/SPEC-web-ui.md` §Contrato: la ruta `GET /api/feed/episodes?limit=` y la home
   descrita como «…, novedades, recientes por episodio, …».
2. `docs/specs/SPEC-web-ui.md` §Estructura del módulo: `features/home/EpisodeRail.tsx` y la regla
   de la tira horizontal (`overflow-x`, foco, `prefers-reduced-motion`).
3. `docs/specs/SPEC-provider-core.md` §Contrato: `FeedEpisode`, `FeedEntry.episode` opcional y la
   nota de que la versión del contrato **no** sube.
4. `docs/specs/SPEC-catalog-store.md`: la nota de que la caché del feed gana un campo opcional y
   **no** hay migración.
5. `tasks/discovery.md` §«Fuera de este plan»: la fila de episodios por episodio deja de estar
   fuera y se apunta a este spec.
6. `README.md`, si la home cambia de forma.
