# SPEC-catalog-store.fuentes — `listSources`

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-catalog-store.md`.

## Qué cambia

La interfaz gana un método, junto a las lecturas de lo que la base ya conoce:

```ts
/**
 * Las otras fuentes que tienen **esta misma obra**.
 *
 * Una entrada por proveedor, nunca la del `ref` pedido; lista vacía cuando no hay
 * ninguna. La clave es el título normalizado (`titleKey`, en `core`) más el año.
 */
listSources(ref: ProviderRef, limit: number): Promise<readonly AnimeSummary[]>
```

## Por qué

La ficha necesita saber qué otras fuentes tienen la misma obra y resolverlo en el navegador pediría
una búsqueda al proveedor por cada ficha abierta, que es la precarga especulativa que el spec
prohíbe.

## Nota para quien integre

La lista de métodos del spec **ya no es el contrato completo**: le faltan `listRelated` (T65, T70),
`listWatchedEpisodes` (T59), `listFavorites`, `searchByGenre` (T51), `listRecentSummaries` (T50) y
las cuatro de `trending`/`feed`. Esta propuesta añade una línea a una lista que ya iba por detrás;
lo que corresponde es regenerarla desde `packages/catalog-store/src/store.ts` —la nota de cabecera
del spec dice que las dos listas se separaron justo porque una de las dos miente— en vez de añadir
otra línea a mano.
