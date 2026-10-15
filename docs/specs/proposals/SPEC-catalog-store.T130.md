# SPEC-catalog-store.T130 — `searchByStudio`

Task: T130 · Spec afectado: `docs/specs/SPEC-catalog-store.md` (el contrato de `CatalogStore`)
Estado: propuesta, sin integrar. La integra el dueño del spec, que anota la aprobación y borra este
archivo.

## Qué cambia

El contrato de la fachada gana una lectura, al lado de la que ya existe para el género:

```ts
// packages/catalog-store/src/store.ts
/**
 * Los títulos cacheados cuyo estudio encaja con el término.
 *
 * La misma pregunta con el otro nombre de la ficha: pulsar «ufotable» lleva a lo
 * que ese estudio tiene en el catálogo local, que es lo único que la aplicación
 * puede abrir sin preguntarle a nadie.
 */
searchByStudio(term: string, limit: number): Promise<readonly SearchResult[]>
```

Y con ella, la misma obligación que las otras ocho lecturas que pueden ofrecer una tarjeta de otro
proveedor: **se acota en `provider-scope.ts`**, que pasa de ocho a nueve entradas. Una lectura que
devuelva referencias y no se acote ofrece una ficha que contesta 404 cuando su plugin está
desmarcado.

No hay migración y no hay tabla nueva: los estudios viven en `raw_json`, que es lo único que los
conserva **en orden** —`list()` ya los lee de ahí para el motor—, y la consulta recorre los pares
(título, estudio) con `json_each` para comparar en memoria. Es la misma decisión que la del género
—SQLite no sabe ignorar los acentos— y el mismo precio, una consulta por búsqueda y no por fila.

### Lo que cambia en `server`, sin cambiar su interfaz

`GET /api/search` no cambia de forma: sigue recibiendo `q`, `provider` y `media`, y sigue contestando
el mismo SSE. Lo que cambia es de dónde sale el evento del catálogo: ahora es la **unión** de las dos
lecturas —género y estudio—, sin repetir por referencia y con el tope de 24 del evento entero. El
identificador `catalog` y su significado no se tocan.

## Por qué

La ficha enseña el nombre de un estudio y no había forma de llegar a lo demás de ese estudio. La
lectura por género ya existía y su consulta no sirve para esto: un estudio no está en la tabla
`genre`, y buscar «Estudio Cobre» entre los géneros devuelve vacío.

Medido en `packages/catalog-store`, `packages/server` y el navegador:

- Ocho casos nuevos en `repositories.test.ts`: caja, tildes, estudio de dos palabras, dos estudios
  que encajan (una sola fila), sin coincidencias, mitad de palabra, tope, y una fila sin `raw_json`
  que no rompe la consulta.
- Tres en `routes/search.test.ts`: el estudio devuelve lo cacheado, se encuentra con otra caja, y
  una consulta que encaja por las dos vías no repite el título.
- Los tres de `detail.e2e.ts` del otro extremo: de la ficha al estudio, al género y a las películas
  del mismo estudio.
- **Medido mutando** (8 mutantes, los ocho los caza la prueba que los sostiene): mirar los géneros en
  vez de los estudios, encajar por cualquier trozo, no plegar las tildes, no preguntar por el
  estudio en la ruta, no descartar lo repetido en la unión, no acotar la lectura nueva en el
  alcance, y las dos mitades del enlace de la ficha.

## Lo que esta propuesta **no** arregla, y se dice

- **La lista de lecturas del spec sigue sin estar.** `searchByGenre` tampoco figura en
  `docs/specs/SPEC-catalog-store.md`: lo añadió T51 sin tocar el contrato. La nota de cabecera de
  `docs/specs/proposals/SPEC-catalog-store.fuentes.md` ya propone lo que corresponde —regenerar esa
  lista desde `packages/catalog-store/src/store.ts`—, y esta lectura es una línea más de lo mismo.
  Integrar `searchByStudio` a mano en una lista desactualizada deja el problema donde estaba.
- **El catálogo local son las fichas abiertas.** Un estudio que sólo conoce AniList —el que la ficha
  enseña cuando el proveedor no lo declara— no tiene títulos que ofrecer por esta vía, porque el
  emparejamiento vive en `anilist_media` con otra clave y no en `anime`. Ampliarlo a AniList es una
  consulta nueva a un tercero, con su caché de listas, y es otra tarea.
- **Sin tabla `studio`.** El recorrido del JSON se paga una vez por consulta sobre un catálogo de
  fichas abiertas —unos miles como mucho—. Si algún día se nota, el paso siguiente es una tabla
  `studio` como la de `genre`, escrita en la misma transacción que el título, y entonces esta
  lectura se reescribe como la del género.

## Alternativas descartadas

- **Una tabla `studio` con su migración.** Cambia el esquema para ahorrar un recorrido que hoy no se
  nota, y añade una migración y su relleno para datos que ya están en `raw_json`. El trabajo de una
  tabla nueva se justifica cuando la lectura se mide lenta, y no se ha medido lenta.
- **Aceptar el estudio como término de la búsqueda por género.** Obligaría a la lectura del género a
  mirar dos sitios y a mentir en su nombre: un estudio no es un género, y la sección de la ficha que
  lo enseña tampoco.
- **Servir el estudio desde la ruta de relacionados.** Los relacionados emparejan por título de saga
  y su contrato lo dice; un estudio no es una saga, y mezclarlos haría que la sección significara dos
  cosas.
