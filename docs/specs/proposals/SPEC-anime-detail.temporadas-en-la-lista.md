# Propuesta: `SPEC-anime-detail` — las temporadas de un título, en su lista de episodios

Estado: **propuesta · pendiente de aprobación humana** · 2026-10-15 · T120.
Decide el dueño de `docs/specs/SPEC-anime-detail.md`; este archivo se integra en él y se borra.

**Decisión del humano tomada el 2026-10-15**, entre tres alcances: **el índice de temporadas lo
calcula el servidor y viaja con la página**, y la ficha pinta un selector de temporadas que pide la
temporada elegida. Las otras dos opciones —agrupar en la web lo que trae la página, con el límite de
cien episodios, o sólo encabezados de temporada dentro de la misma lista— se descartaron por
incompletas: la primera miente en cuanto la lista no llega entera y la segunda deja los noventa y un
episodios siendo noventa y un episodios.

## Motivo, medido

La ficha real de «Rick y Morty» de cuevana3 (`serie/rick-y-morty-1p1v6`, medida sobre
`~/.local/share/nn-anime/nn-anime.db`) enseña **91 episodios en una sola lista**, y son nueve
temporadas. La fuente sí sabe la temporada: la escribe en el título del episodio —`T1 E1 · Buscando
las semillas`—, que es lo único que la trae. El contrato `Episode` no tiene campo de temporada y el
número del contrato es el del título entero (1..91), así que del número no se puede deducir.

| Medición | Resultado |
|---|---|
| `episode` de cuevana3 para `anime_id=7` | 91 filas, `title` con `T1 E1 · …` … `T9 E10 · …` |
| El separador, byte a byte | `20 C2 B7 20` (espacio, U+00B7, espacio) |
| `providers/cuevana3.ts` (repo de plugins) | `title: \`T${temporada} E${numero} · ${nombre}\`` |
| `providers/pelisplushd.ts` | `title: \`T${capitulo.season} E${capitulo.chapter}\`` |
| Listado de jkanime | `Tsuki ga Michibiku Isekai Douchuu 2nd Season 13`: **sin** marcador |
| `capabilities.episodePages` en el repo de plugins | sólo `jkanime` en `true` |

Que dos plugins escriban la misma forma y que jkanime no la escriba es lo que decide el diseño: la
convención se lee, no se adivina, y las fuentes sin marcador se quedan como están —sus temporadas
son obras distintas del catálogo, que es lo que ya resuelve el rail de saga—.

## Objetivo

Que la lista de episodios de un título que junta varias temporadas **se lea por temporadas**, sin
perder nada por el camino: el selector ofrece todas las temporadas del título desde la primera
página, elegir una pide sus episodios, y cada fila sigue diciendo el número y el título que la
fuente le dio.

Éxito significa:

1. En la ficha de «Rick y Morty» hay nueve botones —`Temporada 1 11 episodios` … `Temporada 9 10
   episodios`— y la lista enseña los de la temporada elegida, no los noventa y uno.
2. Elegir una temporada pide esa temporada al servidor: `GET …/episodes?page=1&season=2`.
3. Las filas siguen numerando contra el título —`Episodio 12 de 91`—, que es la etiqueta de la
   fuente y lo que enseña el reproductor.
4. Un título cuyos episodios no lleven marcador no estrena banda: la lista se lee entera, como hoy.
5. Un título con más de cien episodios por temporada se pagina **dentro** de la temporada.

## Supuestos declarados

- **El índice es del título, no de la página.** Viaja igual en la página 1 y en la 5, porque el
  selector tiene que poder ofrecer todas las temporadas desde cualquier sitio. Se calcula de la
  lista completa, que es la que el servidor ya cachea.
- **Sin índice, no hay banda, y se declara por qué.** El índice sólo se publica cuando **todos** los
  episodios llevan marcador y hay **más de una** temporada. Un episodio sin marcador deshace el
  índice entero: agrupar escondería lo que no declara temporada, y perder contenido es peor que no
  agrupar. Una sola temporada tampoco se publica: una fila de un botón es un mueble.
- **La forma del marcador es cerrada:** `T<n> E<m>`, con el nombre detrás separado por ` · `
  (U+00B7), anclada al título y entera. La `E` es parte del marcador —«T2 · Ruptura» no es un
  marcador— y un título que lo lleve en medio tampoco. **Falsos negativos declarados:** otro
  separador, otra convención (`1x02`), un título que no empiece por el marcador. Adivinar esas
  variantes sería adivinar por quien escribe el plugin, que es quien tiene el dato.
- **El número no se renumera.** `Episode.number` es la etiqueta de la fuente y la que viaja al
  reproductor (`?n=`); la temporada no la sustituye ni la recorta. `total` sigue siendo el del
  título aunque la página sea la de una temporada.
- **La fuente que pagina por su cuenta no da temporadas.** Con `capabilities.episodePages` la lista
  no se lee entera —son 76 peticiones en una serie de mil doscientos episodios—, así que no hay de
  dónde sacar el índice: `?season=` se rechaza con un 400 que lo explica, y sin índice la ficha no
  ofrece banda. Hoy es jkanime, que además no escribe marcadores.
- **La temporada elegida es estado de la pantalla**, como la ventana de cien: no va en la dirección.

## Contrato

### `core` — un lector y un índice

```ts
// packages/core/src/episodes.ts

/**
 * La temporada del título del episodio, si la lleva escrita.
 *
 * `undefined` cuando no la lleva: no se asume 1.
 */
export function episodeSeasonOf(title: string | undefined): number | undefined

/**
 * Las temporadas de una lista de episodios, con cuántos tiene cada una.
 *
 * En el orden de la primera aparición. `undefined` cuando la lista no se puede
 * agrupar: algún episodio sin marcador, una sola temporada o una lista vacía.
 */
export function episodeSeasons(
  episodes: readonly { readonly title?: string | undefined }[],
): readonly EpisodeSeason[] | undefined
```

```ts
// packages/core/src/api.ts

/** Una temporada de un título, tal como la ve el selector. */
export const episodeSeasonSchema = z.strictObject({
  season: z.number().int().nonnegative(),
  count: z.number().int().positive(),
})

export const episodesResponseSchema = z.strictObject({
  episodes: z.array(episodeSchema),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  total: z.number().int().nonnegative().optional(),
  /** El índice del título entero. Opcional: su ausencia es una lista sin temporadas. */
  seasons: z.array(episodeSeasonSchema).min(1).optional(),
})
```

### `server` — un parámetro, no una ruta

```
GET /api/anime/:providerId/:ref/episodes?page=&season=
```

- **Sin `season`**, exactamente lo de hoy: la lista entera, troceada de cien en cien.
- **Con `season=N`** —entero ≥ 1; cualquier otra cosa es un 400 con el motivo, como la página—, los
  episodios de esa temporada, **troceados dentro de ella**: `page` y `hasMore` son suyos, `total`
  sigue siendo el del título y `seasons` sigue siendo el del título entero.
- **La temporada que no está es un 404** con su motivo, no una página vacía: es el mismo criterio
  que el episodio suelto que no existe.
- **Con un proveedor que pagina por su cuenta, `?season=` es un 400** —la fuente sí tiene la
  temporada; lo que no puede es contestar por ella sin leer su catálogo entero—.
- El índice se calcula en el contenedor, donde vive la lista completa, y sale por fuera de
  `StoredEpisodePage`: una página es una ventana de cien episodios y el índice es del título.

### `web-ui` — la banda y la lista

```
.episodes__seasons   Temporada 1 11 episodios | Temporada 2 10 episodios | …
.episodes            (los episodios de la temporada elegida)
```

- **La primera lectura no lleva temporada** —la ficha no sabe que el título las tiene— y, si la
  respuesta trae índice, la pantalla pide la primera temporada **antes de pintar nada**: pintar los
  noventa y un episodios y cambiarlos dos milisegundos después es el parpadeo que la banda existe
  para evitar.
- **Cada botón lleva `aria-pressed`** —lo que ya lee el resto de la interfaz, sin depender del
  color— y su número de episodios: sin él, saber si una temporada son doce capítulos o cuarenta
  cuesta entrar en cada una.
- **Paginar dentro de una temporada no la pierde**: «Página siguiente» pide `?page=2&season=N`.
- **Las filas no cambian**: el mismo enlace, el mismo número de la fuente y el mismo título, con su
  marcador, tal como lo escribió el plugin.
- Sin índice no hay banda ni cambio de comportamiento.

## Estructura

```
packages/core/src/episodes.ts                      episodeSeasonOf, episodeSeasons
packages/core/src/api.ts                           episodeSeasonSchema, seasons
packages/server/src/container.ts                   EpisodesPageRequest, EpisodesPageOutcome
packages/server/src/routes/episodes.ts             ?season=, parseSeason
packages/web/src/features/detail/useDetail.ts      EpisodesQuery y episodesPath
packages/web/src/features/detail/EpisodeList.tsx   SeasonPicker y la petición por temporada
packages/web/src/i18n/es.ts                        detail.seasons, detail.season.count
packages/web/src/styles/shell.css                  .episodes__seasons
```

## Success Criteria

- [ ] `episodeSeasonOf('T1 E1 · Buscando las semillas') === 1`, el de `'T2 E5'` es 2 y el de
      `'Episodio 12'` es `undefined`. Medido mutando: aflojar el ancla del marcador deja en rojo la
      prueba de las formas que no valen.
- [ ] `episodeSeasons` cuenta cada temporada, y devuelve `undefined` con un episodio sin marcador,
      con una sola temporada y con una lista vacía. Medido mutando, una vuelta por caso: `< 2` por
      `< 1`, `return undefined` por `continue` y el corte de la lista vacía.
- [ ] El índice viaja **igual** en la página 1 y en la 2, y la página de una temporada trae sus
      episodios con `total` del título. Medido mutando: pasar el trozo como `total` deja en rojo la
      prueba del número.
- [ ] `?season=9` de un título de dos temporadas es 404; `?season=abc` es 400 y no lee la lista;
      `?season=2` de un proveedor con `episodePages` es 400 y no llama al proveedor. Medido mutando,
      una vuelta por caso.
- [ ] En el navegador, con una respuesta con índice: la banda sale con sus dos temporadas, la lista
      son los episodios de la primera, «Página siguiente» pide `page=2&season=1` y elegir la otra
      temporada pide `page=1&season=2`; las cuatro rutas, y ninguna de más. Medido mutando: pedir la
      página sin la temporada y elegir con otro número dejan en rojo la prueba.
- [ ] Sin temporadas marcadas no hay banda y la lista se lee entera.
- [ ] La ficha real de «Rick y Morty» de cuevana3: nueve botones, y la temporada 2 enseña los diez
      episodios `Episodio 12 de 91` … `Episodio 21 de 91`.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes tocados.

## Boundaries

**Always**

- La temporada se lee del marcador o no se agrupa: nunca se inventa desde el número del título.
- El número y el título del episodio son los de la fuente; la temporada no los renumera.
- El índice describe el título entero y se calcula de la lista completa.
- Lo local primero: ni el índice ni la elección de temporada piden una petición nueva al proveedor.
- Los textos nuevos en `packages/web/src/i18n/es.ts`, clave explícita una a una.

**Ask first**

- Cambiar la forma del marcador que se lee, o aceptar más de una.
- Publicar el índice con la lista incompleta (una fuente que pagine y marque a la vez).
- Guardar el índice en la base: hoy se calcula al vuelo de la lista cacheada.

**Never**

- Agrupar escondiendo episodios que no declaran temporada.
- Renumerar las filas por temporada: `Episode.number` es la etiqueta de la fuente.
- Inventar el índice para una fuente que pagina por su cuenta leyendo su catálogo entero.
- Una petición de red por temporada listada.

## Open Questions

1. ¿El reproductor numera alguna vez por temporada? Hoy dice `Episodio 12 de 91`, que es el número
   con el que pide los vecinos; cambiarlo es otra tarea y toca su carga de vecinos.
2. ¿La lista de un título con **una sola** temporada debería quitar igualmente el `T1 E1 · ` del
   título? Hoy el marcador se enseña tal cual, porque lo puso la fuente.
3. ¿Un índice persistido en `anime`/`episode` ahorraría el cálculo? Se mide en microsegundos sobre
   noventa y un episodios; no se hace hasta que se note.
