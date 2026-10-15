# Propuesta · el tipo de contenido: qué sirve un proveedor y cómo se pide una mitad

Sobre `856efa6`. Origen: la petición de dividir la home y la búsqueda con un conmutador entre anime y
películas, y el hueco que el estudio de ani-cli-mx ya dejó escrito
(`docs/estudio-busqueda-ani-cli-mx.md:2149-2159`): `/api/search` sólo acepta `q` y `provider`, así que
una búsqueda mezcla anime y películas y no hay dónde pedir «sólo películas».

Toca tres contratos, y por eso va en una sola propuesta: **`SPEC-provider-core`** (la capacidad),
**`SPEC-discovery`**, **`SPEC-recsys`** y **`SPEC-web-ui`** (el parámetro de las rutas y el `kind` de
una recomendación). Ninguno se edita aquí: los integra su dueño.

## El problema, en una línea

El contrato de hoy **admite** películas —`titleKindSchema` tiene `movie` desde T4 y un plugin puede
devolverlo— pero no tiene dónde decir **quién las sirve** ni cómo pedir una sola mitad: una fuente de
películas y series y una de anime son indistinguibles hasta que responden, y lo que responden no basta
para separarlas.

## Por qué no se deduce de los resultados

| Camino | Por qué se descarta |
|---|---|
| Mirar el `kind` de lo que devuelve cada fuente | Un catálogo mixto —series de anime y películas, que es lo que es jkanime cuando publica una película— daría una pestaña llena y la otra vacía **sin que nadie pueda corregirlo**. Además el `kind` es opcional: una fuente que no lo declare no tendría clasificación |
| Deducirlo de la mayoría de sus títulos | Una fuente de anime con veinte películas de anime pasaría a ser fuente de películas. Una heurística que acierta casi siempre y falla en silencio es la peor clase |
| Que lo marque el usuario en Ajustes | Una decisión que el autor del plugin ya sabe y el usuario no. Se puede equivocar y hay que volver a tomarla en cada instalación |

## 1. `SPEC-provider-core`: la capacidad `media`

Un valor del vocabulario y un miembro **opcional** de `providerCapabilitiesSchema`
(`packages/core/src/schema.ts`):

```ts
export const providerMediaSchema = z.enum(['anime', 'movies', 'both'])

export const providerCapabilitiesSchema = z.strictObject({
  search: z.boolean(),
  sub: z.boolean(),
  dub: z.boolean(),
  trending: z.boolean(),
  feed: z.boolean().default(false),
  episodePages: z.boolean().optional(),
  /** Qué sirve. Ausente es `anime`; la regla vive en `mediaOf`. */
  media: providerMediaSchema.optional(),
})
```

Y las tres reglas que lo leen, en `packages/core/src/media.ts` (una sola vez: las usan el servidor, que
filtra lo que pide a las fuentes, y la interfaz, que filtra lo que ya tiene):

```ts
export const DEFAULT_MEDIA: ProviderMedia = 'anime'
export function mediaOf(capabilities: Pick<ProviderCapabilities, 'media'>): ProviderMedia
export function esDeMedia(filtro: MediaFilter, proveedor: ProviderMedia, kind: TitleKind | undefined): boolean
export function puedeServir(filtro: ProviderMedia | undefined, proveedor: ProviderMedia): boolean
export function pasaElFiltro(filtro: ProviderMedia | undefined, proveedor: ProviderMedia, kind: TitleKind | undefined): boolean
```

`media` es **opcional y sin valor por defecto**, al revés que `feed` y por el mismo motivo que
`episodePages` (`SPEC-provider-core.md:104-106`): con `default('anime')` el campo pasaría a ser
obligatorio en el tipo inferido y el compilador dejaría de aceptar el `Provider` de cada plugin
publicado —y cada literal de capacidades de las pruebas del repositorio, que son decenas— por un dato
que sólo lee el conmutador. Ausente significa `anime`, que es lo que son los plugins que ya existen, y
el defecto vive en `mediaOf`, escrito **una vez**.

`puedeServir` y `pasaElFiltro` son dos preguntas distintas y las dos hacen falta: a una fuente que
sirve las dos cosas **hay que preguntarle** por las películas —y sólo después se sabe cuáles de sus
títulos lo son—, así que el filtro por proveedor no puede usar la regla del título.

### La partición es anime contra lo demás, y no «anime contra películas»

`movies` es «lo que no es anime»: películas, series y doramas. Es la partición que hacen las fuentes de
la familia de PelisPlusHD —sirve las tres por el mismo camino— y la que el estudio ya dio por buena
(«para esta aplicación un dorama es una serie»). Distinguir el dorama del resto es cambio de contrato y
no aporta nada que el usuario no vea en el título (`estudio:2160-2162`).

### Dentro de una fuente mixta decide el `kind`

`both` es una declaración, no una pestaña: un plugin que sirve las dos cosas reparte por el `kind` de
cada título —`movie` a un lado, lo demás al otro—, y un título sin `kind` cuenta como anime, que es el
mismo defecto. Es lo único que hace falta que el plugin devuelva de más, y ya lo puede devolver hoy:
`searchResultSchema.kind` es opcional desde T4.

## 2. `SPEC-discovery`, `SPEC-recsys` y `SPEC-web-ui`: `?media=` en las cuatro lecturas

Las cuatro rutas que leen del catálogo o de las fuentes aceptan un parámetro nuevo, **opcional y
aditivo** —sin él la respuesta es la de hoy, que es lo que mantiene a quien ya las pedía sin
conocerlo—:

```
GET /api/trending?limit=&media=anime|movies|both
GET /api/feed?limit=&media=
GET /api/catalog/recent?limit=&media=
GET /api/recommendations?limit=&media=
```

- Un valor **fuera del vocabulario es un 400** con el valor delante y las opciones
  (`tipo inválido: «anime-y-peliculas»; se esperaba anime, movies o both`). Devolver todo en silencio
  haría que el filtro pareciera roto desde la interfaz, que es donde se ve el síntoma.
- `both` y la ausencia significan lo mismo —traer lo que haya—: una fuente mixta sirve las dos mitades
  y un cliente viejo no pide ninguna.
- **El filtro del proveedor va antes de preguntar y el del título después de la caché.** A una fuente
  que no puede tener esa mitad no se le pide nada (se mide con el contador del fixture), y lo que se
  guarda en la caché de tendencias y de feed es lo que publica la fuente entera, no la mitad: guardar
  una mitad dejaría la otra sin datos.
- En `/api/recommendations` el filtro de candidatos va **antes de recomendar**: recortar después deja
  la pestaña con menos piezas de las que hay, porque el motor ya habría llenado su tope con la otra
  mitad.
- En `/api/catalog/recent` el filtro se aplica sobre la misma ventana de lectura de siempre. La fila
  es «lo último que la aplicación conoce» y no un ranking: una fuente que copa las últimas fichas se
  lleva su mitad y la otra enseña lo que haya. Leer el catálogo entero para llenar una fila sería pagar
  la lectura por lo que no se va a pintar.

## 3. `SPEC-recsys`: el `kind` del candidato y de la recomendación

`candidateSchema` gana `kind: titleKindSchema.optional()` y `/api/recommendations` lo devuelve en cada
`item` —`recommendationSchema.kind` ya existía y la ruta no lo rellenaba—.

Sin él, lo que entra por tendencias o por la caché no se puede repartir cuando la fuente sirve las dos
cosas: el candidato no sabría de qué es. `gatherSignals` lo valida contra el vocabulario antes de
meterlo en el corpus, porque en la base es texto libre y un valor inventado por un plugin haría que el
schema estricto de la respuesta rechazara el cuerpo entero.

## Lo que no cambia

- `/api/providers` y `/api/settings` no cambian de forma: `providerCapabilitiesSchema` viaja entera en
  las dos, así que `media` aparece sola en lo que ya se sirve. Un proveedor rechazado sigue sin
  declarar capacidades que nadie declaró.
- **La plantilla de proveedor** no cambia de forma: escribe `CAPABILITIES` con el JSON del borrador, así
  que el día que el formulario mande `media` el archivo generado lo lleva.
- **La conformidad** no gana una comprobación: `media` es una declaración sin método detrás y no hay
  nada que pueda contradecirla. Un valor fuera del vocabulario lo rechaza el schema al cargar, que es
  donde ya se rechaza `trending: 'sí'`.
- `/api/search` no gana parámetro: quien filtra es el cliente, que ya elige la lista de proveedores con
  `?provider=` y descarta por `kind` lo que llegue de una fuente mixta.

## Alternativa descartada

**Un campo de primer nivel del manifiesto** (`media` junto a `id` y `name`, fuera de `capabilities`)
con un campo nuevo en `providerSummarySchema` y en `settingsResponseSchema`. Separa mejor las dos cosas
—qué sabe hacer y qué sirve—, y se descarta por coste: obliga a tocar las dos respuestas de la API, la
plantilla, el formulario y el registro, para un dato que ya viaja en las capacidades enteras. El
vocabulario de `capabilities` ya tiene un miembro que no es un método (`feed` es «publico novedades»),
así que no es un cajón nuevo.

## Qué se mide al integrarlo

- `providerCapabilitiesSchema` acepta un manifiesto sin `media` y uno con los tres valores, y rechaza
  `'anime-y-peliculas'` nombrando el campo (`packages/core/src/schema.test.ts`).
- `mediaOf`, `esDeMedia`, `puedeServir` y `pasaElFiltro` con sus combinaciones
  (`packages/core/src/media.test.ts`), medidos mutando: quitar el defecto, invertir el reparto por
  `kind`, aceptar lo que no es `movie` como película y no filtrar nada hacen fallar la prueba.
- `mediaFrom`, `mediaPorProveedor` y `enMedia` (`packages/server/src/routes/media.test.ts`).
- Las cuatro rutas (`trending.test.ts`, `discovery.test.ts`, `recommendations.test.ts`): una fuente
  mixta reparte por el `kind`, a una de un solo tipo **no se le pregunta** por la otra mitad —lo dice el
  contador de llamadas—, sin el parámetro las dos mitades siguen saliendo y un valor inventado es un
  400. Medido mutando `pasaElFiltro`, `puedeServir` y el rechazo del vocabulario: cada uno hace fallar
  entre una y diez pruebas.
- El fixture declara `both` y sigue conformando
  (`packages/providers-fixture/src/conformance.test.ts`).
