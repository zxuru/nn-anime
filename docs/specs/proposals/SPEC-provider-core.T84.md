# SPEC-provider-core.T84 — los episodios por página

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-provider-core.md`, que
anota la aprobación y borra este archivo. Las decisiones de forma las elige quien la apruebe.

Módulos que toca: `core` (schema y api), `provider-sdk` (contrato, conformidad y llamada),
`catalog-store` (una tabla y un repositorio), `server` (tres rutas y el contenedor), `web-ui` (el
selector de episodios y los vecinos del reproductor). El **plugin de jkanime** se adapta fuera del
repositorio, como todos los scrapers.

## Antecedente medido

El 2026-10-11, con el plugin de jkanime del usuario, una resolución de
`kimetsu-no-yaiba/1` devolvió cero fuentes y la interfaz dijo «el proveedor no dio ninguna fuente».
La causa se reprodujo con 40 resoluciones seguidas de `kimetsu-no-yaiba/1..26`:
**4 vacíos y 12 errores, 50 respuestas no-ok**, todas 429 de jkanime en `/kimetsu-no-yaiba/N/` y
`/jkplayer/...`. El sitio limita por ráfaga y el plugin, con `getEpisodes` trayendo la lista
completa (una petición POST por cada 16 episodios, 5 en paralelo), es justo lo que dispara la
ráfaga: **Black Clover son 1216 episodios y 76 peticiones** para pintar el selector.

Lo que se pide, entonces, no es un arreglo del 429: es dejar de pedir el catálogo entero para
pintar una ventana.

## Objective

Que el selector de episodios funcione **por páginas**: se pide la página que se va a pintar, se
puede saltar a un número concreto y se puede pedir el último episodio, sin traer la lista completa.
Los vecinos del reproductor —anterior y siguiente— se resuelven sin la lista completa, pidiendo la
página de al lado **sólo** cuando el vecino no está en la página cargada.

Éxito significa:

1. Abrir la ficha de una serie de 1216 episodios no pide 1216 episodios: pide una página.
2. El selector navega entre páginas, salta a un número escrito y lleva al último episodio.
3. Los números **decimales** (12.5) y los **huecos** de numeración se conservan: la página pinta lo
   que la fuente dio, sin renumerar ni rellenar.
4. En el reproductor, las flechas de anterior y siguiente funcionan en los bordes de la página, y
   pedir la página vecina ocurre sólo cuando hace falta.
5. Cada página se guarda **cinco minutos**; dentro de esa ventana, volver a mirarla no toca la red.
6. Un HTTP 429 del sitio **pausa** las peticiones siguientes durante 65 s, y el usuario lo lee en
   el error en vez de un «no dio ninguna fuente».

## Supuestos declarados

1. **La compatibilidad manda.** Un plugin que no declare paginación sigue cargando y sigue
   sirviendo su lista completa por la ruta de siempre. La paginación es una capacidad **opcional**,
   como `feed` y `trending`.
2. **La versión del contrato no sube.** `apiVersion` sigue en `'1'`: `Episode.number` se **ensancha**
   (de entero a número) y un plugin viejo que sólo emite enteros sigue cumpliendo el schema. Un
   método opcional nuevo no rompe a nadie, por el mismo motivo que `getFeed`.
3. **El número de episodio no es un índice.** La página es una ventana sobre el orden que da la
   fuente, no un rango de números: por eso los huecos y los decimales sobreviven sin una regla
   especial.
4. **El sitio manda en el tamaño de página.** El contrato no fija cuántos episodios trae una
   página: jkanime sirve 16 y otro plugin puede servir 30. La interfaz no lo supone.
5. **La caché de cinco minutos es de la aplicación**, no del plugin: vive en `catalog-store`, que es
   donde este repositorio guarda todo lo que cachea. El plugin no guarda estado entre llamadas.

→ Si alguno de estos cinco supuestos no es el que se quiere, se corrige **antes** de escribir código.

## Contrato

### `core`: el número deja de ser entero

```ts
// packages/core/src/schema.ts
export const episodeSchema = z.strictObject({
  ref: providerRefSchema,
  animeRef: providerRefSchema,
  /** Número dentro del título. Decimal cuando la fuente numera 12.5. */
  number: z.number().nonnegative(),
  title: z.string().min(1).optional(),
  durationS: z.number().nonnegative().optional(),
  mode: modeSchema,
})
```

Es la única línea de `core` que cambia de forma, y es un **ensanchamiento**: el entero de antes
sigue pasando. Se retira `.int()` porque el plugin de jkanime descarta hoy los decimales
(`!Number.isInteger(numero)` en `episodiosDe`) y una fuente que numera `7.5` —un recopilatorio— no
tiene por qué perder el episodio.

Lo que **no** cambia y conviene dejar escrito: `episodeNumber` de los ajustes de mapeo
(`packages/core/src/api.ts:270`) sigue siendo entero. Es la ruta de un `fieldPath` para leer una
lista ajena, no el modelo.

### `provider-sdk`: tres métodos opcionales y una capacidad

```ts
// packages/provider-sdk/src/types.ts

/**
 * Una página de episodios.
 *
 * `hasMore` es del contrato y no se deduce del tamaño: una fuente puede servir
 * una página incompleta en el borde del catálogo y eso no significa que no haya
 * más. `total` es opcional porque hay fuentes que no lo saben y porque el
 * selector puede vivir sin él —sólo lo usa el rótulo «episodio 3 de 26».
 */
export interface EpisodePage {
  readonly episodes: readonly Episode[]
  /** La página pedida, tal como la numeró el proveedor: base 1. */
  readonly page: number
  readonly hasMore: boolean
  readonly total?: number
}

export interface ProviderCapabilities {
  readonly search: boolean
  readonly sub: boolean
  readonly dub: boolean
  readonly trending: boolean
  readonly feed: boolean
  /**
   * El proveedor sabe servir los episodios de uno en uno y por páginas.
   *
   * Con valor por defecto, como `feed`: este schema es estricto y lo leen los
   * manifiestos de plugins ya instalados.
   */
  readonly episodePages: boolean
}

export interface Provider {
  // …lo de siempre…
  /**
   * Opcionales y con la capacidad por delante, como `getFeed`: quien no los
   * declare sigue sirviendo `getEpisodes` y la interfaz usa la lista completa.
   */
  getEpisodesPage?(ref: ProviderRef, page: number, options: CallOptions): Promise<EpisodePage>
  getEpisode?(ref: ProviderRef, number: number, options: CallOptions): Promise<Episode>
  getLatestEpisode?(ref: ProviderRef, options: CallOptions): Promise<Episode>
}
```

En `packages/provider-sdk/src/schema.ts`:

- `providerEpisodePageSchema` (strict: `episodes` con `episodeSchema`, `page` entero ≥ 1,
  `hasMore` booleano, `total` entero ≥ 0 opcional) y su fila en `RESPONSE_SCHEMAS` — la tabla
  indexa por método, así que las tres entradas nuevas son una línea cada una.
- `getEpisodesPage` exige `capabilities.episodePages`; `getEpisode` y `getLatestEpisode` **también**:
  son la misma capacidad, y declararla a medias ofrecería un salto que no lleva a ninguna parte.

En `packages/provider-sdk/src/call.ts`: tres funciones nuevas, calcadas de las que ya hay —ejecutar,
convertir la excepción en `Result` y **validar antes de salir**—. Una página con un episodio que no
cumple el schema se rechaza nombrando el campo, igual que hoy.

En `packages/provider-sdk/src/conformance.ts`: si el manifiesto declara `episodePages`, se comprueba
que los tres métodos existen y que la página 1 trae `page: 1`; si no lo declara, que **ninguno** está
presente. Un plugin a medias no se acepta a medias.

### Rutas HTTP

```
GET /api/anime/:providerId/:ref/episodes?page=N       -> { episodes, page, hasMore, total? }
GET /api/anime/:providerId/:ref/episodes/latest       -> { episode, stale? }
GET /api/anime/:providerId/:ref/episodes/number/:n    -> { episode }
```

Cuatro decisiones:

1. **La ruta de siempre no cambia de forma.** `?page=` ausente significa la página 1, y la respuesta
   gana tres campos. Un cliente viejo —o el `useDetail` de hoy— sigue leyendo `episodes` y sigue
   funcionando. La forma la posee `packages/core/src/api.ts`, como todas.
2. **La normalización es del servidor.** Con un plugin que declara `episodePages` se pide esa página
   al proveedor. Sin él, se pide la lista completa **una vez** (como hoy), se cachea con su TTL de
   siempre y el servidor la **trocea** en páginas de `EPISODES_PER_PAGE` (100, el mismo número que
   ya usa `episode-window.ts` para pintar). Así la interfaz tiene **un solo camino**, y un plugin
   viejo no se queda sin selector.
3. **`number/:n` lleva el prefijo `number/`** para no depender del orden en que Hono registre
   `latest` y el comodín de un segmento. Un número que no está es 404 con su mensaje, nunca una
   página vacía.
4. **`latest` no es «la última página»**: es el último episodio del título, y para un plugin que no
   sabe decirlo se responde con el de mayor número de la lista cacheada —devolviendo `stale: true`
   cuando la lista hubo que pedirla para poder contestar—.

### `catalog-store`: una tabla para las páginas

```sql
CREATE TABLE episode_page (
  anime_id    INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  episodes_json TEXT  NOT NULL,
  has_more    INTEGER NOT NULL,
  total       INTEGER,
  fetched_at  INTEGER NOT NULL,
  ttl_s       INTEGER NOT NULL,
  PRIMARY KEY (anime_id, page)
);
```

- `TTL_SECONDS.episodePage = 300`, **cinco minutos**, el número que pide el enunciado. Vive en
  `cache-policy.ts` con los demás.
- Se guarda el JSON de la página ya validado con `episodeSchema` al escribir y al leer: la caché es
  una frontera más, no un atajo.
- La migración es aditiva. Las filas de `episode` **siguen** escribiéndose —el historial, «continuar
  viendo» y los vecinos leen de ahí— pero dejan de ser la condición para pintar el selector.
- `anime_id` no nulo: la página pertenece a un título, y sin fila del anime la escritura falla
  nombrando lo que falta, como ya hace `replaceEpisodes`.

### UI: el selector y los vecinos

**`EpisodeList`** (`packages/web/src/features/detail/`):

- Estado: `page`, la página cargada. Las flechas «página anterior» y «página siguiente» se
  deshabilitan con `page === 1` y `!hasMore`.
- **Saltar a un número**: el campo que hoy salta de ventana (`windowForNumber`) salta de **página**;
  si el número no está en la página cargada se pide la página que lo contiene —el proveedor recibe
  el número por `number/:n` cuando la fuente sabe resolverlo, y si no, se prueba con la página
  siguiente hasta `hasMore`. El salto no inventa el número que falta.
- **Último episodio**: botón que llama a `latest` y abre ese episodio.
- La ventana de pintado de 100 (`episode-window.ts`) **no se toca**: sigue recortando lo que se
  dibuja dentro de la página.

**`WatchPage`**: los vecinos salen de la página que contiene el episodio en curso. Si el vecino no
está en esa página, se pide **la de al lado** una vez; si el episodio es el primero de la primera
página o el último de la última, la flecha queda apagada como hoy. En ningún caso se pide la lista
completa para pintar dos flechas.

### El plugin de jkanime (fuera del repositorio)

Este repositorio no escribe scrapers; el archivo vive en `~/.config/nn-anime/providers/`. Lo que el
contrato le exige, y lo que se le va a pedir al del usuario:

1. `getEpisodesPage(ref, page, options)` → `POST /ajax/episodes/{id}/{page}` con el token CSRF y las
   galletas de la ficha, y `hasMore = page < last_page`. Una petición por página, no 76.
2. `getEpisode(ref, number, options)` → el episodio `number` de esa serie, o error nombrando que no
   está. `getLatestEpisode` → `last_page` y el último de esa página.
3. **Decimales y huecos**: `episodiosDe` deja de exigir `Number.isInteger`, y ninguna función
   renumera: la página pinta los números que vinieron.
4. **Pausa por 429**: un contador por plugin; tras un 429, toda petición a jkanime espera hasta que
   pasen **65 s** y entonces se reintenta. Mientras la pausa está viva, el error que se lanza dice
   el motivo y el segundo en que se reanuda, en vez de devolver una lista vacía.
5. La caché de cinco minutos **no** se implementa en el plugin: la pone la aplicación.

## Estrategia de pruebas

- `bun test packages/core`: `episodeSchema` acepta `7.5` y rechaza negativos; la api rechaza
  `page: 0` y `hasMore` no booleano.
- `bun test packages/provider-sdk`: un manifiesto que declara `episodePages` con los tres métodos
  pasa la conformidad; con dos, se rechaza nombrando el que falta; sin la capacidad y con un método
  presente, también. `getEpisodesPage` sin la capacidad devuelve `unsupported`, como `getFeed` hoy.
- `bun test packages/catalog-store`: una página escrita se lee dentro de los 300 s y deja de leerse
  después (con reloj inyectado, nunca `Date.now()` dentro de la prueba); un JSON que no cumple el
  schema no se sirve.
- `bun test packages/server`: con un plugin paginado, `?page=2` llama al proveedor **una** vez y la
  segunda petición no lo llama (contador del fixture); con un plugin no paginado, `?page=1` trocea
  la lista completa y `hasMore` es verdadero sólo si quedan trozos; `latest` con lista cacheada no
  llama al proveedor; `number/7.5` devuelve el episodio decimal.
- `bun test packages/web`: las flechas de página se deshabilitan en los extremos; el salto a un
  número que no está en la página pide la siguiente; los vecinos piden una página adyacente **una**
  vez (contador del `fetch` falso) y no la piden cuando el vecino está en la página.
- `bun run e2e`: con el fixture, el selector navega entre páginas y el reproductor salta al
  siguiente sin haber pedido la lista completa —medido contando las peticiones del fixture—.

**Medición obligatoria:** cada prueba nueva se mide mutando la implementación —devolver `hasMore`
siempre en falso, no trocear la lista, ignorar el TTL de 300 s, pedir la lista completa en los
vecinos— y el registro va al task. Un test que pasa con el código roto no mide nada.

## Success Criteria

- [ ] Abrir la ficha de una serie de 1216 episodios hace **una** petición al proveedor, no 76.
- [ ] El selector navega a la página siguiente y a la anterior, y las flechas se apagan en los
      extremos (`page === 1`, `hasMore === false`).
- [ ] Escribir `743` lleva a la página que contiene el 743, y escribir un número que no existe lo
      dice sin quedarse en blanco.
- [ ] El botón de último episodio abre el último de la fuente, no el mayor de la página cargada.
- [ ] Un episodio `12.5` se pinta con su número decimal y no se descarta.
- [ ] Una serie con huecos (1, 2, 4) se pinta con los números que la fuente dio, sin rellenar el 3.
- [ ] La segunda visita a la misma página dentro de los cinco minutos **no** llama al proveedor.
- [ ] Pasados los cinco minutos, sí lo llama.
- [ ] El reproductor salta al episodio siguiente cuando está en la página y pide la adyacente
      cuando no lo está, una sola vez.
- [ ] Un plugin que no declara `episodePages` sigue pintando su selector completo, troceado por el
      servidor.
- [ ] Un HTTP 429 del plugin pausa las peticiones siguientes y el error dice el motivo.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde; e2e del fixture en verde.

## Boundaries

**Always**

- Validar la página del plugin con el schema antes de cachearla y antes de servirla.
- Mantener un solo camino en la interfaz: el troceado de un plugin no paginado lo hace el servidor.
- Numerar las páginas en base 1, como el contrato y como el sitio.
- Respetar el TTL: la caché de la página es de cinco minutos y no se estira por conveniencia.

**Ask first**

- Añadir un método al contrato que no sea de episodios.
- Cambiar el tamaño de página de 16 (el del sitio) o el tope de troceado de 100.
- Que la pausa por 429 sea de la aplicación en vez del plugin.
- Tocar `episode-window.ts` o el pintado de la lista.

**Never**

- Pedir la lista completa cuando el plugin sabe paginar.
- Renumerar, rellenar huecos ni redondear un decimal.
- Devolver una página vacía como éxito cuando el número pedido no existe: eso es 404.
- Guardar la página sin pasar por el schema, ni saltarse el TTL porque «ya estaba».
- Meter la pausa por 429 en el hilo de la interfaz: es del plugin y del servidor.

## Seguridad

- La página es entrada no confiable: se valida al recibirla, al escribirla en la caché y al leerla.
- `number` es un número acotado por el schema y no entra en ninguna plantilla ni `href` sin
  `encodeURIComponent`.
- No se persiste nada nuevo de la fuente: números, títulos y referencias, como ya hacía `episode`.
  Ningún header de upstream, ningún byte de vídeo.
- `media-proxy` **no se toca**.

## Decisiones y Open Questions

1. **¿La paginación sustituye a `getEpisodes`?** No. Se suma. `getEpisodes` sigue siendo el camino
   de un plugin que tiene la lista entera y el respaldo del selector.
2. **¿Se pagina por `mode`?** No. El modo se resuelve al reproducir, como hoy; la lista no cambia
   con el modo en ninguna de las fuentes conocidas.
3. **¿Se pinta el total?** Sólo si el proveedor lo da. `episode 3 de 26` con un total inventado es
   peor que `episode 3`.
4. **¿La pausa por 429 es del plugin o de la aplicación?** Se propone del plugin: el límite es del
   sitio, no del catálogo, y la aplicación no sabe qué petición lo disparó.
5. **Open question:** si un plugin paginado devuelve páginas de tamaño distinto al de la anterior,
   ¿la interfaz renumera las flechas o las deja como vienen? Se propone **dejarlas como vienen** y
   confiar en `hasMore`, que es lo único que el contrato promete.

## Enmiendas a specs aprobados

Ninguna se aplica hasta que este documento se apruebe:

1. `docs/specs/SPEC-provider-core.md` §Contrato: `episode.number` sin `.int()`, la capacidad
   `episodePages`, `EpisodePage`, los tres métodos opcionales y su validación de conformidad.
2. `docs/specs/SPEC-web-ui.md` §Contrato: el `?page=` de la ruta de episodios y las dos rutas
   nuevas (`latest`, `number/:n`).
3. `docs/specs/SPEC-catalog-store.md`: la tabla `episode_page` y `TTL_SECONDS.episodePage = 300`.
4. `docs/specs/SPEC-provider-core.md` §«Lo que un plugin ve de fuera»: la nota de que la versión del
   contrato **no** sube.
5. `README.md`, si la lista de capacidades de un plugin se escribe ahí.

## Reparto en tasks

| Task | Paquete | Qué |
|---|---|---|
| T84 | — | esta propuesta y su aprobación |
| T85 | `core`, `provider-sdk` | el ensanchamiento de `number`, la capacidad y los tres métodos |
| T86 | `catalog-store`, `server` | la tabla de páginas, el TTL de 300 s, el troceado y las tres rutas |
| T87 | `web-ui` | el selector por páginas, el salto a un número, el último y los vecinos |
| — | fuera del repo | el plugin de jkanime: páginas, decimales, huecos y la pausa de 65 s |
