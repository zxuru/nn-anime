# Spec: discovery (arranque en frío)

Estado: **aprobada e implementada** · 2026-10-11 · posterior a v1 (Checkpoint H cerrado).
Tasks: `tasks/discovery.md` (T48–T52, con su verificación medida). Las enmiendas a specs aprobados
que este documento proponía **se aplicaron** el 2026-10-11 y están marcadas al final.

Módulos que toca: `provider-sdk` (contrato), `catalog-store` (caché del feed y de lo reciente),
`server` (rutas y candidatos), `web` (dos filas y el destacado). `recsys` **no se toca**.

## Objective

Que la primera pantalla tenga contenido sin que el usuario haya buscado nada, por dos caminos:

1. **Lo último que la aplicación ya conoce.** Los títulos que están en la base —abiertos o
   encontrados por una búsqueda— en una fila propia, del más nuevo al más viejo.
2. **Lo que la fuente publica.** Si un proveedor declara que tiene un feed (RSS, Atom o su propia
   lista de novedades), la home se alimenta de él. Es la única fuente del contrato que puede traer
   contenido **sin** que nadie haya buscado, y además la única que trae una fecha.

## El problema, con la causa

La home se queda vacía en una instalación nueva y el motivo está en el código, no en los datos:

- Los candidatos del motor salen de `gatherSignals`, y ese sólo lee la tabla `anime` y los
  favoritos (`packages/server/src/recommend/signals.ts`). La tabla `anime` **se escribe al pedir el
  detalle o los episodios**, no al buscar: `search_cache` guarda los resultados de la búsqueda y no
  los convierte en candidatos. Quien busca y no abre nada no ve nada en la home.
- La única fuente que no depende del usuario es `getTrending`, que es opcional. Un proveedor sin
  `capabilities.trending` deja la página sin una sola tarjeta: `items: []`, sin destacado, sin top
  5 y sin géneros. `TrendingRow` lo explica, pero explicar el hueco no es tener contenido.
- La **fecha de emisión** no existe en el contrato, y por eso la parrilla semanal y la fila de
  episodios nuevos no se pudieron hacer (README). Un feed sí trae fecha: es la pieza que faltaba
  para dejar de adivinar.

## Contrato

### `provider-sdk`: la capacidad `feed` y `getFeed`

```ts
// packages/provider-sdk/src/types.ts

export interface ProviderCapabilities {
  readonly search: boolean
  readonly sub: boolean
  readonly dub: boolean
  readonly trending: boolean
  /**
   * El proveedor publica una lista de novedades que no depende de una búsqueda.
   * Un manifiesto que no lo declare queda en `false`.
   */
  readonly feed: boolean
}

export interface FeedEntry extends SearchResult {
  /**
   * ISO-8601. Cuándo lo publicó la fuente. Es lo que un feed sabe y una
   * búsqueda no, y lo que ordena la fila.
   */
  readonly publishedAt?: string
}

export interface Provider {
  // …los cinco métodos de hoy…
  /** Opcional. Novedades de la fuente, para el arranque en frío de la home. */
  getFeed?(options: CallOptions): Promise<readonly FeedEntry[]>
}
```

Cuatro decisiones, y las cuatro son de compatibilidad:

1. **`feed` lleva `default(false)` en `providerCapabilitiesSchema`, no es obligatorio.** El schema
   de capacidades es `strictObject`: un campo requerido nuevo haría fallar **todo plugin ya
   instalado** al cargar, y el usuario vería su proveedor rechazado por una función que no pidió.
   Con el valor por defecto, un manifiesto viejo carga igual y declara `feed: false`.
2. **La versión del contrato sigue en `'1'`.** Un método opcional y un campo con valor por defecto
   no rompen a nadie: subir a `'2'` obligaría a reescribir cada plugin a mano a cambio de nada.
3. **`publishedAt` es una cadena ISO, no un `Date`.** El dato cruza JSON tres veces —manifiesto,
   caché en disco y respuesta HTTP— y un `Date` se convierte en cadena por el camino y volvería
   como cadena igual: la validación estaría mintiendo sobre el tipo. El plugin que parsee un RSS
   llama a `toISOString()`, y es lo único que tiene que hacer.
4. **El tope de entradas lo pone quien lee, no el plugin.** Un feed con cinco mil entradas se
   recorta a 200 **antes** de cachearlo, para que una fuente no pueda llenar el disco ni hacer que
   la home pinte mil tarjetas.

`getFeed` se añade a `OPTIONAL_PROVIDER_METHODS`, a `RESPONSE_SCHEMAS` y al test de conformidad,
con la misma comprobación que ya existe para `trending`: **declarar la capacidad y no implementar
el método es un rechazo con su motivo**, no un silencio.

### Rutas HTTP nuevas

```
GET /api/feed?limit=            novedades de los proveedores que declaran `feed`
GET /api/catalog/recent?limit=  lo último que la aplicación ya conoce
```

Las formas viven en `packages/core/src/api.ts`, como todas:

```ts
export const feedItemSchema = animeSummarySchema.extend({
  publishedAt: z.iso.datetime().optional(),
})
export const feedResponseSchema = z.strictObject({ items: z.array(feedItemSchema) })
export const recentResponseSchema = z.strictObject({ items: z.array(animeSummarySchema) })
```

`/api/feed`, paso a paso:

1. Sólo se consulta a quien declara `capabilities.feed` **y** tiene `getFeed`: un proveedor sin
   feed no se llama.
2. Primero la caché (`feed_cache` por proveedor, TTL 1800 s). Si está fresca, no hay llamada. La
   lección es de la auditoría de T47: la segunda carga de la home no puede volver a pedir lo mismo.
3. Deduplicación por `providerId#value`, con el primero que llegue.
4. Orden: `publishedAt` descendente; las entradas sin fecha van al final, en el orden de la fuente.
5. Un proveedor que falla o tarda devuelve lista vacía y **no tumba la fila**: lo demás se pinta.

`/api/catalog/recent`, paso a paso:

1. Une dos fuentes locales: las filas de `anime` (con su `fetched_at`) y las de `search_cache`
   (con el suyo, con los resultados en `results_json`).
2. Deduplica por referencia y **se queda con la marca más nueva**.
3. Orden descendente por esa marca, tope 20.
4. Sin escrituras y sin migración: es una lectura.

### Qué entra al motor de recomendación

Los candidatos de `gatherSignals` pasan a incluir **los títulos de `search_cache`**, con sus tags
del corpus cacheado cuando el título ya está en `anime`. Es lo que hace que quien busca y no abre
nada tenga destacado y top 5.

**Las entradas del feed no entran al motor en esta entrega.** Los `reason.kind` son un contrato de
`recsys` (`affinity`, `covisit`, `search`, `rediscovery`, `trending`, `popular`), y un candidato de
feed acabaría con la razón «de moda» cuando no es lo que dice ser. Inventar el tipo `feed` es
trabajo de `recsys`, con su i18n y sus pruebas, y no hace falta para llenar la página: el destacado
y la fila de novedades ya salen del feed.

### `catalog-store`

- Migración `0006-feed-cache.sql`: tabla propia, con la misma forma y el mismo motivo que
  `trending_cache` (una búsqueda la pide el usuario, un feed lo pide la home sola).
- `TTL_SECONDS.feed = 1800` en `cache-policy.ts`, con su comentario.
- `readFeed(providerId)` / `writeFeed(providerId, entries)` en `repositories/feed.ts`, con la
  validación del JSON cacheado y `StoreError` si no cumple.
- `listRecentSummaries(limit)` en `repositories/anime.ts`: la lectura de la unión, con el SQL que
  ya conoce `fetched_at` de las dos tablas.

## Success Criteria

- [ ] Instalación nueva con un proveedor que declara `feed`: la home pinta **Novedades** sin una
      sola búsqueda previa.
- [ ] Instalación nueva con un proveedor sin `feed` ni `trending`: la home **no queda en blanco**;
      explica qué falta y no simula contenido que no tiene.
- [ ] Después de buscar —sin abrir ningún detalle— **Último añadido** muestra títulos y el destacado
      sale de ahí.
- [ ] La segunda carga de la home **no vuelve a llamar** a `getFeed` (contador del fixture).
- [ ] Un plugin que declara `feed` y no implementa `getFeed` se rechaza nombrando el motivo, igual
      que `trending`.
- [ ] Un plugin escrito antes de esta entrega, sin `feed` en `capabilities`, **sigue cargando** y
      aparece como `feed: false`.
- [ ] Un feed de 5 000 entradas se recorta a 200 y no hace crecer la base sin freno.

## Boundaries

- **No hay parrilla semanal ni fila de episodios nuevos por episodio.** El feed da la fecha de
  **publicación del título**, no la de emisión de cada episodio. Se usa para ordenar y para decir
  la novedad; no se convierte en una rejilla de días que el dato no sostiene.
- **No se añade una URL de RSS en Ajustes.** La fuente la conoce el plugin, que ya es código del
  usuario ejecutándose con sus permisos. **La aplicación no descarga el feed: lo descarga el
  plugin**, así que no aparece una superficie SSRF nueva ni un destino que haya que meter en la
  lista blanca del proxy. `media-proxy` no se toca.
- **El asistente de Ajustes no ofrece `feed`.** La plantilla genera un plugin a partir de rutas
  JSON; un RSS necesita parseo XML y eso no cabe en una ruta con `$.campo`. La capacidad es para
  plugins escritos a mano, y la guía lo dirá.
- **`recsys` no se toca.** Ni pesos nuevos, ni razones nuevas: las señales entran como candidatos.
- **Nada de bytes.** El feed se cachea como metadatos, igual que las tendencias.

## Seguridad

- El feed es **entrada no confiable** como cualquier respuesta de plugin: se valida con schema al
  recibirlo, al escribirlo y al leerlo de la caché, y las URLs de portada pasan por `safeUrl` en la
  interfaz (la guarda de T31a recorre todos los `src=`/`href=`, así que la fila nueva queda cubierta
  sin tocar la guarda).
- **No se persiste ningún header de upstream**, igual que en `stream_cache`: la caché del feed
  guarda referencias, títulos, portadas y fechas.
- Un feed que devuelve XML no parseado o HTML es un error del plugin y se convierte en fila vacía
  con el motivo en el registro, no en una excepción que tumbe la home.

## Enmiendas aplicadas a specs aprobados (aprobadas el 2026-10-11)

1. **Las dos rutas viven en `docs/specs/SPEC-web-ui.md`**, que es donde estaba la lista de rutas, y
   no en `SPEC-nn-anime.md` como decía esta propuesta: su sección «Contrato HTTP» describe las
   formas compartidas, no el catálogo de rutas. Aplicado allí.
2. `docs/specs/SPEC-nn-anime.md` §Data Model: `feed_cache` como tabla posterior y fila
   `feed de novedades | 1800 | caché normal` en la tabla de TTL. Aplicado.
3. `docs/specs/SPEC-provider-core.md` §Contrato: capacidad `feed` (con valor por defecto `false`),
   `getFeed` opcional y `FeedEntry`. Aplicado.
4. La regla «sin historial no se llama a ningún proveedor salvo `getTrending`» pasa a ser «…salvo
   `getTrending` y `getFeed`». Estaba escrita en el encabezado de
   `packages/server/src/recommend/signals.ts` —donde se aplicó— y en `docs/specs/SPEC-recsys.md`,
   cuyo punto 7 sobre el arranque en frío se amplió con los candidatos de `search_cache`. No estaba
   en `SPEC-nn-anime.md`.
5. `docs/specs/SPEC-web-ui.md` §Contrato: rutas nuevas y la home descrita como «recomendaciones,
   novedades, último añadido, continuar, favoritos, tendencias y géneros». Aplicado.
6. `README.md`: la home gana las dos filas y la nota de la parrilla semanal se matiza — el feed da
   fecha de publicación, no de emisión. Aplicado, junto con la guía de plugins.

## Decisiones tomadas (eran las preguntas abiertas)

1. **«Último añadido» no excluye lo visto ni los favoritos.** Duplicar una tarjeta entre filas es
   menos malo que esconder contenido, y ya hay filas para esas dos cosas.
2. **TTL del feed: 30 minutos**, aplicado en `TTL_SECONDS.feed`. Un feed cambia como mucho a diario
   y la home se abre muchas veces al día.
3. **`publishedAt` sólo ordena** en esta entrega; la tarjeta enseña el año, como el resto de filas.
   Un «hace dos días» pide formato relativo e i18n de fechas y no cambia lo que la fila resuelve.
4. **`reason.kind = 'feed'` queda para otra entrega.** El feed no puntúa en el motor: se enseña. Los
   candidatos que sí entran son los títulos de `search_cache`, y entran sin vector.

## Lo que quedó fuera, y por qué

- **El asistente de Ajustes no ofrece `feed`.** Genera un plugin a partir de rutas JSON; un RSS
  necesita parseo XML. La capacidad es para plugins escritos a mano, y la guía lo dice.
- **La parrilla semanal y los episodios nuevos por episodio** siguen fuera: el feed da fecha de
  publicación del título, no de emisión.
- **La aplicación no descarga el feed.** Lo descarga el plugin, así que no hay URL de RSS en Ajustes
  ni destino nuevo para la lista blanca del proxy: `media-proxy` no se tocó.
