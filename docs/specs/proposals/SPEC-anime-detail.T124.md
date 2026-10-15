# Propuesta: los relacionados de AniList en la ficha

Task: T124 · Spec afectado: `SPEC-anime-detail.md` (y, por la fila de TTL, el modelo de datos)

## El cambio exacto

Una ruta nueva y un schema nuevo. La ruta va en `routes/anilist.ts` —el módulo que ya es dueño del
tercero— y **no** en `routes/detail.ts`, cuyas tres lecturas se declaran locales en su propio
encabezado y no llevan `X-Cache` por eso:

| Método y ruta | Devuelve | Schema |
|---|---|---|
| `GET /api/anime/:providerId/:ref/anilist-related` | Las relaciones que AniList declara de la obra emparejada | `anilistRelatedResponseSchema` |

El schema reutiliza la pieza del descubrimiento y le añade el motivo:

```ts
export const anilistRelationSchema = z.enum([
  'sequel', 'prequel', 'parent', 'sideStory', 'spinOff', 'alternative', 'summary', 'special',
])

/** La pieza de la vitrina más el motivo por el que AniList la relaciona. */
export const anilistRelatedItemSchema = discoverItemSchema.extend({
  relation: anilistRelationSchema,
})

export const anilistRelatedResponseSchema = z.strictObject({
  items: z.array(anilistRelatedItemSchema),
})
```

## Qué se enseña y qué se tira, con la medición delante

AniList publica quince tipos de relación y **no todos son otra obra que ver**. Medido contra su API
el 2026-10-15, para `Media(id: 101922)` —«Kimetsu no Yaiba»—:

| `relationType` | A qué apunta de verdad | ¿Entra? |
|---|---|---|
| `SOURCE` | El manga (`format: MANGA`) | No: no es una ficha que esta aplicación pueda abrir |
| `SEQUEL` | `Kimetsu no Yaiba: Mugen Ressha-hen` (MOVIE) y su versión de TV | Sí |
| `CHARACTER` | Cuatro ONAs de gag y un crossover con la MLB | No: es ruido, y son cuatro de las seis relaciones de esa obra |
| `PREQUEL`, `PARENT`, `SIDE_STORY`, `SPIN_OFF`, `ALTERNATIVE`, `SUMMARY`, `SPECIAL` | Otra entrega de la misma franquicia | Sí |
| `ADAPTATION`, `COMPILATION`, `CONTAINS`, `OTHER` | La obra de la que sale, o un agregado | No |

Dos filtros, y los dos son necesarios: la **lista blanca de tipos** —cerrada y escrita en `core`, con
una prueba por nombre— y el **formato de anime** (`kindOfFormat`, el mismo mapa de siempre): sin el
segundo entra el manga, y sin el primero entran los cortos de gag.

## La pieza y su enlace

Cada elemento lleva lo que ya lleva una pieza de la vitrina —`anilistId`, `title`, `cover` por la ruta
local de la imagen, `year`, `kind`, `format`, `episodes`, `score`— más `ref` **cuando la base conoce
esa obra en alguna fuente**. Es la regla que ya sigue el descubrimiento, y aquí decide lo mismo: con
`ref` la pieza abre una ficha de verdad; sin él, la búsqueda de su título. Sin `ref` no se enlaza a
AniList: esta sección no saca a nadie de la aplicación.

El orden: primero lo que se encadena —secuela, precuela, obra madre—, después el resto de la
franquicia, y dentro de cada grupo por año, lo más antiguo primero. El tope es 24, el mismo techo que
los relacionados locales: una franquicia de verdad no pasa de ahí.

## El motivo y la frontera que se respeta

`SPEC-anime-detail.md` prohíbe por escrito sembrar «Relacionados» con recomendaciones del motor —«una
razón de `recsys` no es una relación»— y aquí se respeta por partida doble: **no se toca la sección de
relacionados**. Ésta es otra sección, con otro nombre y atribuida a AniList, que es de quien es el
dato.

Lo que sí cambia es la promesa de «sólo lo que la base ya conoce». La sección local sigue siendo
local; ésta sale a la red, y lo hace con las tres cautelas de T121: lista blanca de hosts, presupuesto
serializado (una petición cada dos segundos) y caché con TTL. **Nada se pide por adelantado**: la
consulta responde a una ficha que se está abriendo.

La caché reutiliza `anilist_list_cache` con la clave `related:<id de AniList>` y un TTL nuevo (ver la
propuesta del modelo de datos). No hay tabla nueva: el payload guarda cada relación con su media
—`{ relation, media }`— para que la ruta de la imagen resuelva las portadas con el mismo mecanismo que
el top y la parrilla.

## Los dos caminos de la respuesta, dichos

- **Sin emparejamiento o sin relaciones**: `{ items: [] }`, no un 404 y no un error. Un proveedor
  desconocido sigue siendo 404, como en el resto de la ficha.
- **AniList caído**: se sirve lo cacheado, y si no hay caché, `{ items: [] }`. La sección no se pinta y
  la ficha no cambia: un tercero no tumba una pantalla.

## La interfaz, que va en una segunda parte

La sección se pinta en el cuerpo, bajo «De AniList», como carrusel de piezas. Va en **una petición
aparte que no bloquea la ficha**: el cliente de AniList espacia las consultas dos segundos, así que
meterla en el `Promise.all` de la ficha le sumaría esa espera a la carga entera. `T124` entrega
`core`, `catalog-store` y `server`; la interfaz la añade la parte 2.
