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
  `porGenero`—, cada uno con `format_in` según la mitad, `sort: POPULARITY_DESC` y el filtro de
  adultos cuando el interruptor está apagado. El alias del género **se omite cuando el término no es
  un género**: `genre:` sólo acepta un nombre de la lista cerrada de AniList y un valor que no está
  en ella no devuelve vacío, devuelve un error que tumba la consulta entera —la lista del estudio
  incluida—.
- `ANILIST_GENRES` y `anilistGenre(term)` en `packages/core/src/anilist.ts`: la lista cerrada de los
  18 géneros de AniList, con sus alias en español —«Acción» → `Action`, «Recuentos de la vida» →
  `Slice of Life`— y la comparación de siempre —sin acentos, sin mayúsculas—. Sin esta traducción,
  pulsar un género en la vitrina no podría pedirle su lista a AniList, que es la mitad de lo que esta
  entrega viene a hacer.

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
