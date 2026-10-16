# Propuesta: la búsqueda cruzada en el catálogo de AniList

Task: T138 · Spec afectado: `SPEC-discovery.md` (el catálogo de AniList)

Estado: propuesta, sin integrar. La integra el dueño del spec, que anota la aprobación y borra este
archivo.

## El cambio exacto

El catálogo de AniList —el de T121, en `packages/server/src/anilist/catalog.ts`— gana una lectura:

```ts
/**
 * La búsqueda cruzada: lo que AniList tiene de un término como estudio y como
 * género, en una sola lista y sin repetir.
 */
cross(
  term: string,
  media: ProviderMedia | undefined,
  adultAllowed: boolean,
  signal?: AbortSignal | undefined,
): Promise<Result<readonly AniListEntry[], AppError>>
```

Con dos piezas nuevas en `queries.ts` y en `core`:

- `crossQuery(adultAllowed, genero)` compone **una** consulta con dos alias —`porEstudio` y
  `porGenero`—. El del género es el de siempre: `media(type: ANIME, genre: $genero, format_in:
  $formatos, sort: POPULARITY_DESC)` con el filtro de adultos cuando el interruptor está apagado, y
  **se omite cuando el término no es un género**, porque `genre:` sólo acepta un nombre de la lista
  cerrada de AniList y con otro devuelve un error.
- El del estudio **no se pide con `Media(studio:)` porque ese argumento no existe**: los filtros de
  `Media` son `genre`, `tag`, `search`, `licensedBy`… y ninguno es el estudio —medido en la
  referencia de la API el 2026-10-16—. Se pide por donde sí se puede: `Page.studios(search: $q)`
  busca el estudio por nombre y cada estudio publica su conexión de obras,
  `media(isMain: true, sort: POPULARITY_DESC)`. Esa conexión **no acepta `format_in` ni `isAdult`**
  —sus argumentos son `sort`, `isMain`, `page`, `perPage` y `onList`—, así que la mitad y el
  interruptor de adultos se filtran **después**, sobre lo que llegue (`crossEntries`), y no en la
  consulta. El estudio que manda es el del nombre exacto cuando está entre los que devuelve la
  búsqueda.
- `ANILIST_GENRES` y `anilistGenre(term)` en `packages/core/src/anilist.ts`: la lista cerrada de los
  18 géneros de AniList, con sus alias en español —«Acción» → `Action`, «Recuentos de la vida» →
  `Slice of Life`— y la comparación de siempre —sin acentos, sin mayúsculas—. Sin esta traducción,
  pulsar un género en la vitrina no podría pedirle su lista a AniList, que es la mitad de lo que esta
  entrega viene a hacer.

**Corregido en T139, y se dice aquí porque esta propuesta describe lo que hay que integrar:** la
primera versión pedía `media(type: ANIME, studio: $q, …)`, un argumento que `Media` no tiene. AniList
contestaba un error de validación **de la consulta entera** —y con él caía también la lista del
género que viajaba al lado, que es lo que se reportó: «solicité un género y no me dio ningún
resultado»—. El doble de las pruebas lo aceptaba, así que nada lo dijo: ahora ese doble contesta el
error, como AniList, y hay una prueba que falla si la consulta vuelve a pedirlo.

La caché es la de T121, con su propia clave —término normalizado, mitad y eje del interruptor— y un
TTL nuevo (`anilistSearch`, seis horas), que va en su propia propuesta.

## Por qué

Las fuentes de este proyecto **buscan por título**. Ninguna entiende «ufotable» ni «acción», así que
una búsqueda por estudio o por género sólo podía devolver los títulos que ya estuvieran en la base y
ahí se acababa la lista: es el hueco que se reportó —«elijo un género y no carga más contenidos»—.
AniList sí sabe qué obras tiene un estudio y qué obras son de un género, y esa lista es la que
rellena el hueco.

El cruce con lo que hay en los proveedores **no se inventa aquí**: cada entrada vuelve por el mismo
camino que las del top y la parrilla, y la ruta que la sirve le pone la referencia local con
`localRefs`. Lo que esta lectura añade es de dónde salen las obras, no cómo se cruzan.

## La alternativa descartada

**Buscar por título en AniList además de por estudio y género.** Es lo que ya hacen los proveedores, y
una tercera lista de los mismos títulos duplicaría piezas sin añadir nada: lo que falta no es el
título, es el estudio y el género.

**Pedir el género con el término tal cual, sin traducción.** Ahorra una tabla y deja fuera el caso
normal —los catálogos en español publican «Acción», no «Action»—, y con un valor que AniList no
reconoce la consulta entera falla, no devuelve vacío. La tabla es cerrada, tiene prueba por género y
es la única forma de que el filtro no rompa lo que sí valía.
