# Propuesta · `capabilities.media`: qué sirve un proveedor

Sobre `b5d2568`. Origen: la petición de dividir la home y la búsqueda con un conmutador entre anime y
películas, y el hueco que el estudio de ani-cli-mx ya dejó escrito
(`docs/estudio-busqueda-ani-cli-mx.md:2149-2159`): `/api/search` sólo acepta `q` y `provider`, así que
una búsqueda mezcla anime y películas y no hay dónde pedir «sólo películas».

## El problema, en una línea

El contrato de hoy **admite** películas —`titleKindSchema` tiene `movie` desde T4 y un plugin puede
devolverlo— pero no tiene dónde decir **quién las sirve**: una fuente de películas y series y una de
anime son indistinguibles hasta que responden, y lo que responden no basta para separarlas.

## Por qué no se deduce de los resultados

| Camino | Por qué se descarta |
|---|---|
| Mirar el `kind` de lo que devuelve cada fuente | Un catálogo mixto —series de anime y películas, que es lo que es jkanime cuando publica una película— daría una pestaña llena y la otra vacía **sin que nadie pueda corregirlo**. Además el `kind` es opcional: una fuente que no lo declare no tendría clasificación |
| Deducirlo de la mayoría de sus títulos | Una fuente de anime con veinte películas de anime pasaría a ser fuente de películas. Es una heurística que acierta casi siempre y falla en silencio, que es la peor clase |
| Que lo marque el usuario en Ajustes | Una decisión que el autor del plugin ya sabe y el usuario no. Se puede equivocar y hay que volver a tomarla en cada instalación |

## El cambio exacto, en `packages/core/src/schema.ts`

Un valor del vocabulario y un miembro **opcional** de `providerCapabilitiesSchema`:

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

Y las dos reglas que lo leen, en `packages/core/src/media.ts` (una sola vez: las usan el servidor, que
filtra lo que pide a las fuentes, y la interfaz, que filtra lo que ya tiene):

```ts
export const DEFAULT_MEDIA: ProviderMedia = 'anime'
export function mediaOf(capabilities: Pick<ProviderCapabilities, 'media'>): ProviderMedia
export function esDeMedia(filtro: MediaFilter, proveedor: ProviderMedia, kind: TitleKind | undefined): boolean
export function pasaElFiltro(filtro: ProviderMedia | undefined, proveedor: ProviderMedia, kind: TitleKind | undefined): boolean
```

`media` es **opcional y sin valor por defecto**, al revés que `feed` y por el mismo motivo que
`episodePages` (`SPEC-provider-core.md:104-106`): con `default('anime')` el campo pasaría a ser
obligatorio en el tipo inferido y el compilador dejaría de aceptar el `Provider` de cada plugin
publicado —y cada literal de capacidades de las pruebas del repositorio, que son decenas— por un dato
que sólo lee el conmutador. Ausente significa `anime`, que es lo que son los plugins que ya existen, y
el defecto vive en `mediaOf`, escrito **una vez**.

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

## Lo que cambia alrededor, y por qué no es parte de esta propuesta

- **`/api/providers` y `/api/settings`** no cambian de forma: `providerCapabilitiesSchema` viaja entero
  en las dos, así que `media` aparece sola en lo que ya se sirve.
- **La plantilla de proveedor** no cambia de forma: escribe `CAPABILITIES` con el JSON del borrador, así
  que el día que el formulario mande `media` el archivo generado lo lleva.
- **La conformidad** no gana una comprobación: `media` es una declaración sin método detrás, y no hay
  nada que pueda contradecirla. Un valor fuera del vocabulario lo rechaza el schema al cargar, que es
  donde ya se rechaza `trending: 'sí'`.

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
- `mediaOf` y `esDeMedia` con sus seis combinaciones (`packages/core/src/media.test.ts`), medidos
  mutando: quitar el defecto, invertir el reparto por `kind` y aceptar lo que no es `movie` como
  película hacen fallar la prueba.
- El fixture declara `both` y sigue conformando
  (`packages/providers-fixture/src/conformance.test.ts`).
