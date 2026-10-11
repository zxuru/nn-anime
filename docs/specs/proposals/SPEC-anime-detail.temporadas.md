# Propuesta: `SPEC-anime-detail` — temporadas, franquicia y listas largas

Estado: **propuesta · pendiente de aprobación humana** · 2026-10-11.
Decide el dueño de `docs/specs/SPEC-anime-detail.md`; este archivo se integra en él y se borra.

Decisiones del humano ya tomadas el 2026-10-11:

1. **Rail de dos niveles**: primero la saga (Dandadan T1/T2, Bleach TTYBW, Shingeki, Frieren) y
   después la franquicia (Naruto↔Shippuden, Dragon Ball↔Z/GT/Super) en una sección aparte.
2. **Listas largas por ventanas y salto a episodio**, sin arcos declarados y sin tabla de arcos en
   el repositorio.
3. **Los plugins rellenan `year` en los resultados de búsqueda**: jkanime ya rellena `kind`, nunca
   `year`; animeav1 no rellena ninguno de los dos. El rail ordena por año y no por heurística de
   título.

Motivo, medido sobre una copia de la base real (`~/.local/share/nn-anime/nn-anime.db`) con el
servidor de HEAD:

| Medición | Resultado |
|---|---|
| `GET /api/anime/jkanime/dandadan/related` | devuelve «Dandadan 2nd Season»: la captura del usuario era de un servidor anterior al merge de T65 |
| `GET /api/anime/animeav1/dandadan-2nd-season/episodes` | 12 episodios |
| `sagaTitle('Naruto Shippuden')` vs `sagaTitle('Naruto')` | `naruto shippuden` ≠ `naruto`: no se relacionan |
| `sagaTitle('Dragon Ball Z')` vs `sagaTitle('Dragon Ball')` | `dragon ball z` ≠ `dragon ball` |
| `kind` y `year` en `search_cache` de jkanime | `kind` sí (tv/movie/special/ova), `year` nunca |
| `kind` y `year` en `search_cache` de animeav1 | ninguno de los dos |
| `animeRefOf('dandadan/12')` | `dandadan/12`: la fila basura `jkanime\|dandadan/12` existe en la base real con el `<title>` de la página del episodio |

## Objective

Que la ficha de un título sirva para **recorrer la obra entera** —sus temporadas, sus películas y,
cuando el nombre las separa, las series hermanas de la misma franquicia— y que una serie de mil
episodios se pueda recorrer sin un `<ol>` de mil filas.

Éxito significa:

1. En la ficha de «Dandadan» hay una sección **Temporadas** con «Dandadan 2nd Season», y pulsarla
   abre su ficha. Hoy ya ocurre por «Relacionados»; la sección nueva lo dice con la forma correcta.
2. En la ficha de «Bleach» las entregas salen **ordenadas** —Bleach, Sennen Kessen-hen, Ketsubetsu,
   Soukoku, Kashin— y las películas y especiales van **aparte**, no intercalados.
3. La entrega que se está viendo aparece **marcada y no como enlace**: saber dónde se está es la
   mitad de la función.
4. En la ficha de «Naruto» hay una sección **Más de esta franquicia** con «Naruto Shippuden», y al
   revés.
5. La lista de episodios de One Piece (1180), Naruto Shippuden (500), Bleach (366) y Dragon Ball Z
   (291) se recorre por ventanas y se salta a un número concreto, sin pintar mil filas de golpe.
6. Nada de esto añade una petición de red nueva: todo sale de la base local.

## Supuestos declarados

- **La franquicia es una heurística más, y se dice.** La clave es el título de saga **sin el sufijo
  de la secuela**, con una lista cerrada —`shippuden`, `super`, `daima`, `gt`, `kai`, `z`,
  `brotherhood`, `heroes`—: `Naruto Shippuden` vuelve a `naruto` y `Dragon Ball Z` a `dragon ball`.
  No es «la primera palabra», y la diferencia importa: con la primera palabra, «One Piece» y «One
  Punch Man» acabarían en la misma franquicia. Los falsos negativos declarados son los sufijos que
  no están en la lista —«Naruto SD: Rock Lee no Seishun Full-Power Ninden» queda en `naruto sd`, y
  eso es lo que se quiere— y el falso positivo es un spin-off cuyo nombre sea exactamente
  «<serie> Shippuden». El daño de no hacerlo es que media biblioteca de estos catálogos no se pueda
  encadenar.
- **El rail de temporadas no pide nada a la red.** Los candidatos son los que ya están en `anime` y
  en los listados cacheados, la misma regla que los relacionados de hoy.
- **Sin año, el orden se declara aproximado.** Con `year` en la búsqueda (decisión 3) el orden es
  cronológico; sin él, manda el marcador de temporada del título y después el orden estable de la
  lectura. No se inventa un año.
- **Las ventanas son de 100 episodios y no se guardan.** Es estado de la pantalla, no de la base.
- **La lista completa de episodios sigue existiendo en la respuesta HTTP.** El tope es de pintado,
  no de datos: la ficha recibe los 1180 y pinta 100, porque el reproductor necesita los vecinos y la
  posición.

## Contrato

### `core` — dos claves y un marcador

```ts
// packages/core/src/titles.ts

/**
 * El número de temporada del título, si lo lleva escrito.
 *
 * «Sousou no Frieren 2nd Season» -> 2
 * «Shingeki no Kyojin Season 3 Part 2» -> 3
 * «Bleach: Sennen Kessen-hen» -> undefined
 */
export function seasonNumberOf(title: string): number | undefined

/**
 * La franquicia: el título de saga sin el sufijo de la secuela.
 *
 * «Naruto Shippuden» -> «naruto»
 * «Dragon Ball Z» -> «dragon ball»
 * «Kimetsu no Yaiba: Mugen Ressha-hen» -> «kimetsu no yaiba»
 */
export function franchiseTitle(title: string): string

// Los marcadores de película ganan la palabra que hoy falta: «film».
// «One Piece Film: Red» hoy queda en «one piece film» y no entra en su propia saga.
```

`seasonNumberOf` lee los mismos marcadores que `baseTitle` ya quita, más los romanos finales
(`Overlord IV` -> 4). Los marcadores de parte (`Part 2`, `Cour 2`) **no** cambian el número de
temporada: son la segunda mitad de la misma, y hay una prueba que fija ese falso positivo. Tampoco
hay número para «The Final Season»: ningún entero significa «la última», y quien ordene tiene el año.

`franchiseTitle` quita el paréntesis calificador —«Dragon Ball Z (Original)», «Ranma ½ (2024) 3rd
Season»— antes de calcular la saga: es un calificador de la fuente, no parte del nombre.

### `catalog-store` — una lectura con dos alcances

```ts
// packages/catalog-store/src/repositories/related.ts

/** Con qué se emparejan los candidatos. */
export type RelatedScope = 'saga' | 'franchise'

list(ref: ProviderRef, limit: number, scope?: RelatedScope): readonly AnimeSummary[]
```

`scope` por defecto `'saga'`, que es el comportamiento de hoy: ninguna llamada existente cambia.
Con `'franchise'` la comparación en memoria usa `franchiseTitle` en vez de `sagaTitle`; la consulta
preparada sigue siendo **la misma** y sigue siendo **una**, porque el prefiltro por la primera
palabra de la saga ya cubre la franquicia.

La franquicia **contiene** a la saga: «Dandadan 2nd Season» sale en los dos alcances. Por eso el
orden de las secciones y el quitar de la franquicia lo que ya está en Temporadas es trabajo de la
interfaz, no de la lectura.

El orden no cambia: sigue siendo `byYearProximity`, el mismo que ya tenía la lectura de
relacionados. **La decisión, corregida al implementar:** el orden por número de temporada es
presentación y vive en la interfaz (T71), que es quien tiene el título, el año y el tipo de cada
entrega en la mano. Moverlo a la lectura habría cambiado el orden de la sección de relacionados de
hoy —la que ya está aprobada— para ganar nada: el rail reordena igual.

La exclusión de la propia referencia y el mapa «una obra, una fila» no cambian.

### `server` — un parámetro, no una ruta

```
GET /api/anime/:providerId/:ref/related?scope=saga|franchise&limit=
```

Un valor desconocido cae a `'saga'`, como `limit`: una petición sin preferencia no es un error.
La ruta sigue siendo local, sin `X-Cache`, y sigue detrás de los guards.

### `web-ui` — la ficha

```
.detail__aside
├─ …
├─ Temporadas            (saga)      — entregas con kind tv, ordenadas
├─ Películas y especiales (saga)     — kind movie/ova/ona/special
└─ Más de esta franquicia (franchise) — sólo si aporta algo nuevo
```

- **La sección no desaparece cuando está vacía**: explica el hueco, la regla de `rows.ts`.
- **La entrega actual sale marcada**, con la palabra, no sólo con color, y sin ser enlace.
- **La etiqueta es el número cuando se conoce** («Temporada 2») y el subtítulo limpio cuando no
  («Sennen Kessen-hen»). Nunca una etiqueta inventada a partir de un año.
- **Una fila por obra**: la misma entrega en dos proveedores sale una vez, con el proveedor de la
  ficha delante.
- **La franquicia no repite lo que ya está en Temporadas**: si la sección de franquicia no aporta
  ninguna entrega nueva, no se pinta en absoluto.

Lista de episodios:

- **Ventana de 100** con «Episodios 1–100», «101–200»… y **salto a número** (campo numérico que
  lleva la ventana al episodio y deja el foco en su fila).
- El resumen de vistos de la ventana visible («3 de 100 vistos»), porque con mil filas el resumen
  global no dice nada útil.
- Con 100 episodios o menos, **no hay controles**: la lista se pinta entera y no aparece una barra
  que nadie necesita.

### `web-ui` — el reproductor deja de deducir el título

`animeRefOf` sólo conoce la convención `#N` del fixture y de animeav1. jkanime numera `slug/N`, así
que al pedir el detalle del episodio el cliente escribió la fila basura `jkanime|dandadan/12` con el
`<title>` de la página del episodio. El arreglo:

- `watchPath` gana el título como parámetro y lo escribe en la consulta (`?anime=<ref>`), que es
  dato que el reproductor **ya tiene**: viene en `Episode.animeRef` de la lista que sirvió la ficha.
- `animeRefOf` queda como último recurso para una dirección escrita a mano, con las dos
  convenciones: `#N` y `slug/N`.
- Una migración **no** borra las filas basura ya escritas; el `pruneOrphans` existente no las ve
  porque no son huérfanas. Se decide en la tarea: o se limpian por patrón (`provider_ref` que
  contiene `/` y termina en número) o se dejan y se declaran inertes.

## Estructura

```
packages/core/src/titles.ts                        seasonNumberOf, franchiseTitle, \bfilm\b
packages/catalog-store/src/repositories/related.ts RelatedScope y la clave del alcance
packages/server/src/routes/detail.ts               ?scope=
packages/web/src/features/detail/SagaRail.tsx      temporadas, películas y franquicia
packages/web/src/features/detail/EpisodeList.tsx   ventanas, salto y resumen
packages/web/src/features/player/watch-route.ts    animeRefOf y watchPath
packages/web/src/features/player/WatchPage.tsx     la referencia del título, en la consulta
packages/web/src/i18n/es.ts                        cadenas nuevas
packages/web/src/styles/shell.css                  .rail, .episodes__windows
```

## Success Criteria

- [ ] `seasonNumberOf('Sousou no Frieren 2nd Season') === 2`, `seasonNumberOf('Shingeki no Kyojin
      Season 3 Part 2') === 3` y `seasonNumberOf('Overlord IV') === 4`. Medido mutando: quitar el
      marcador romano deja en rojo la tercera.
- [ ] `seasonNumberOf('One Piece')` es `undefined`: no se inventa un 1. Mutar el `undefined` a `1`
      deja en rojo la prueba.
- [ ] `franchiseTitle('Naruto Shippuden') === 'naruto'` y `franchiseTitle('Dragon Ball Z') ===
      'dragon ball'`; `franchiseTitle('One Punch Man') !== franchiseTitle('One Piece')`.
- [ ] `sagaTitle('One Piece Film: Red') === 'one piece'`. Medido mutando: sin `film` en los
      marcadores, la prueba cae.
- [ ] `list(ref, 12, 'franchise')` devuelve «Naruto Shippuden» para la ficha de «Naruto» y
      `list(ref, 12)` sin alcance **no** lo devuelve: la mutación que ignora el alcance deja en rojo
      la segunda.
- [ ] El rail marca la entrega actual y no la pinta como enlace; con una sola entrega conocida
      explica el hueco en vez de esconder la sección.
- [ ] La lista de 1180 episodios pinta 100 filas, la ventana cambia y el salto deja el foco en la
      fila del episodio pedido. Medido mutando: sin el recorte de ventana el DOM tiene 1180 filas.
- [ ] Con 100 episodios o menos no se pinta ningún control de ventana.
- [ ] Pedir el detalle de un episodio de jkanime **no** escribe ninguna fila con `/` en
      `provider_ref`. Medido mutando: devolver `animeRefOf` a la versión de una sola convención deja
      en rojo la prueba de la dirección.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes tocados.
- [ ] E2e: en la ficha del fixture con dos temporadas, la sección Temporadas lleva a la segunda y la
      marca al volver.

## Boundaries

**Always**

- Comparar referencias por `providerId` **y** `value`.
- Los textos nuevos en `packages/web/src/i18n/es.ts`, clave explícita una a una.
- Lo local primero: el rail y las ventanas no piden nada a la red.
- `readonly` en las interfaces y funciones puras exportadas para poder mutarlas en la prueba.

**Ask first**

- Cualquier tabla, columna o migración: esta entrega no añade ninguna.
- Cambiar el tope de la ventana (100) o el de `MAX_RELATED_LIMIT` (24).
- Un componente compartido nuevo entre la ficha y la home.

**Never**

- Sembrar el rail con recomendaciones de `recsys`: una razón no es una relación —la regla que ya
  defiende `SPEC-anime-detail.md`—.
- Inventar un año o un número de temporada para llenar una etiqueta.
- Una consulta por candidato o una petición de red por entrega listada.
- Pintar 1180 filas «porque el navegador aguanta».
- Deducir la referencia del título por convención cuando el dato ya está en la mano.

## Open Questions

1. ¿La limpieza de las filas basura (`provider_ref` con `/`) va en esta entrega o en una tarea de
   mantenimiento aparte? Se propone aparte: toca una base que ya existe y merece su propia medición.
2. ¿La franquicia agrupa también por la primera palabra del **título base** cuando el título es un
   nombre corto y común («Kimi», «Blue»)? Se propone no en esta entrega: el rail de saga ya cubre
   ese caso y la franquicia se reserva para nombres propios largos.
3. ¿El salto a episodio lleva al reproductor o sólo desplaza la lista? Se propone sólo desplazar:
   saltar a un episodio no es pedir su stream.
