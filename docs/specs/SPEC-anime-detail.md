# Spec: anime-detail (la ficha: relacionados, hueco, modos y vistos)

Estado: **propuesta · pendiente de aprobación humana** · 2026-10-12 · decisiones del humano ya
tomadas: **heurística local del catálogo** para los relacionados, **visto automático al 90 % o al
llegar al final**, y **dos columnas con barra lateral** para la ficha.

Ampliación aprobada el 2026-10-13 (T64-T66): los relacionados emparejan por **título de saga**,
**cruzan proveedores** y leen también los listados cacheados; y la búsqueda pinta **una tarjeta por
obra** con selector de proveedor. Motivo: sobre la base de desarrollo, «kimetsu no yaiba» devolvía
13 tarjetas para 7 obras antes, y la ficha de `jkanime/kimetsu-no-yaiba` no relacionaba nada aunque
la saga estuviera en la caché.

Ampliación aprobada el 2026-10-15 (T124 y T131): la ficha lee además **lo que AniList declara** de
la obra emparejada —`GET /api/anime/:providerId/:ref/anilist-related`, con la lista blanca de tipos
de relación y el filtro de formato de `core`— y **las dos procedencias se pintan en la misma
lista**, agrupadas por tipo de entrega: Temporadas, Películas, OVA y «Más de esta franquicia». La
base manda y AniList rellena. Motivo: el rail emparejaba por título contra lo que la base conocía y
de una franquicia larga conocía una sola entrega —la que se acababa de abrir—, así que la ficha de
«Danmachi» decía «no hay más títulos de esta saga» con seis temporadas, una película y dos OVA
publicadas; y con la sección de AniList aparte, la misma obra salía dos veces y con dos nombres
distintos. La heurística local **no se retira**: sigue siendo la que resuelve el caso sin red, y lo
de AniList es lo que falta cuando la fuente no declara relaciones.

Esta entrega **no crea un módulo**: extiende contratos y paquetes ya aprobados. No toca
`docs/specs/CAPABILITY-MAP.md` ni su build order.

Módulos que toca: `core` (un normalizador de título, dos schemas y un umbral), `catalog-store`
(dos lecturas nuevas), `server` (dos rutas y el umbral al guardar la posición), `web-ui` (la ficha,
la lista de episodios y la hoja de estilos). `provider-sdk`, `provider-core`, `media-proxy`,
`recsys` y `providers-fixture` **no se tocan**.

Antecedentes, con la captura delante:

1. **No hay relacionados.** `animeDetailSchema` no tiene relaciones y ningún proveedor las declara.
   Ver la segunda temporada de un título no lleva a la primera: hay que volver a buscarla.
2. **La ficha desperdicia el ancho.** `.detail__body` lleva `max-width: var(--measure)` (60ch)
   dentro de una columna que ya es la mitad de `--content-max`; a la derecha quedan cientos de
   píxeles muertos y la lista de episodios se apila en una columna estrecha.
3. **El botón de modo marcado repite color.** `.button[aria-pressed="true"]` se pinta con
   `--color-accent` de fondo **y** con `--shadow-hard-sm`, que en el tema oscuro es
   `4px 4px 0 var(--color-accent)`: un bloque naranja detrás de un botón naranja. El acento sobre
   el acento no se lee como sombra, se lee como un botón duplicado.
4. **Nada dice qué episodio ya se vio.** `watch_event.finished` existe desde `0001-initial.sql` y
   **ninguna línea lo escribe**: la columna es decorativa. La ficha lista episodios como si todos
   estuvieran pendientes, incluso los terminados. El arreglo en curso de la duración del progreso
   (T57) es el prerrequisito: sin `durationS` guardada no hay proporción que calcular.

## Objective

Que la ficha de un título sirva para **encadenar la saga y seguir donde se iba**, no sólo para
leer una sinopsis.

Éxito significa:

1. En la ficha de «Sousou no Frieren 2nd Season» aparece **«Sousou no Frieren»** en Relacionados,
   y pulsarlo lleva a su ficha. Sin plugins nuevos y sin red.
2. La ficha usa el ancho: barra lateral con portada, acciones, modos, géneros, estudios y
   relacionados; columna principal con título, sinopsis y episodios. La sinopsis mantiene su
   medida de lectura.
3. El modo marcado se distingue del no marcado **sin repetir el color del acento** en fondo y
   sombra a la vez, y sigue distinguiéndose sin color (`aria-pressed`, que es lo que ya lee el
   resto de la interfaz).
4. Un episodio terminado se ve como visto en la lista de la ficha, y uno a medias dice por dónde
   iba. La lista es la misma para sub y dub: lo que se marca es el episodio, no el modo.
5. Cuando no hay relacionados, la sección **se explica** en vez de desaparecer o mentir con una
   fila vacía (la regla de `rows.ts`, aplicada aquí).
6. Nada de esto abre una consulta por fila: los relacionados salen de **una lectura acotada** —dos
   sentencias preparadas, ninguna por candidato— y los vistos de **una**.

## Supuestos declarados

- **La heurística es una heurística, y se dice.** Empareja títulos cuyo *título de saga* coincide
  (`sagaTitle`, que quita el subtítulo de la entrega y el marcador de temporada) y **cruza
  proveedores**: la misma saga suele estar en dos fuentes a la vez. «Sousou no Frieren» y «Sousou
  no Frieren 2nd Season» coinciden, y «Kimetsu no Yaiba» con «Kimetsu no Yaiba: Yuukaku-hen»
  también; «Frieren: Beyond Journey's End» y «Sousou no Frieren» **no**, porque la fuente los
  nombra distinto. Esa limitación es la que hace que la propuesta del plugin —`related` como
  capacidad, con las relaciones que declare la fuente— siga teniendo sentido para otra entrega;
  hoy no hay ni un plugin que pudiera declararlas.
- **Una obra, una fila.** La misma entrega en dos proveedores sale una vez, con el proveedor de la
  ficha delante —pulsarla no cambia de sitio—; la propia ficha no se lista a sí misma aunque otra
  fuente la tenga.
- **Sólo se relacionan títulos que la base ya conoce**, y «la base» son las **fichas abiertas y los
  listados cacheados** —búsquedas, tendencias y novedades—. No se busca en el proveedor para
  rellenar la sección: eso sería una petición de red por ficha abierta, y el spec prohíbe la
  precarga especulativa. Ficha de una saga que no está en ninguno de los dos sitios: sin
  relacionados, y lo dice.
- **Visto es un umbral, no una certeza.** Al 90 % de la duración el episodio se da por terminado.
  Un episodio que se dejó a falta de los créditos cuenta como visto, y quien quiera precisión
  tendrá que pedir el botón manual —fuera de esta entrega—.
- **Sin duración no hay umbral.** Un proveedor que no diga `durationS` deja sus episodios sin
  marcar: preferimos no marcar nada a marcar por lo que no se sabe.

## Contrato

### `core` — el título base y el umbral

```ts
// packages/core/src/titles.ts
/**
 * El título sin su marcador de temporada, normalizado para comparar.
 *
 * «Sousou no Frieren 2nd Season» -> «sousou no frieren»
 * «Bleach: Thousand-Year Blood War Part 2» -> «bleach thousand year blood war»
 */
export function baseTitle(title: string): string

/**
 * El título de la saga: el título base sin el subtítulo de la entrega.
 *
 * «Kimetsu no Yaiba: Mugen Ressha-hen» y «Kimetsu no Yaiba» son la misma saga.
 */
export function sagaTitle(title: string): string

// packages/core/src/watch-progress.ts
/** Proporción vista a partir de la cual el episodio se da por terminado. */
export const FINISHED_RATIO = 0.9
export function watchedRatio(positionS: number, durationS: number): number
export function isFinished(positionS: number, durationS: number): boolean
```

La lista de marcadores es **cerrada y escrita**: `season N`, `Nst/2nd/3rd/4th season`, `part N`,
`parte N`, `cour N`, `temporada N`, `Nª temporada`, y los romanos finales (`II`, `III`, `IV`).
Nada de «quitar todo lo que parezca un número»: «86» y «5-toubun no Hanayome» son títulos, no
temporadas. Una prueba por cada marcador y una por cada falso positivo conocido —`Final Fantasy
VII` queda en `final fantasy`, y está escrito en el módulo para que nadie lo descubra en la
interfaz—.

`sagaTitle` corta por el **primer** separador de subtítulo (`:` o guion rodeado de espacios) y
quita el marcador de película delante o detrás (`Movie`, `Movie 1`, `Gekijouban`, `Película`). El
guion suelto no corta: «5-toubun no Hanayome» es un título. Dos falsos positivos declarados en el
módulo y probados: un spin-off con subtítulo propio entra en su saga (`Boku no Hero Academia:
Vigilantes`) y un título que empieza por `Re:` queda en `re`. El daño es una fila de más en una
sección de conveniencia; el de no cortar es que media saga de estos catálogos —la que sólo se
distingue por el subtítulo— no se relacione nunca.

### `catalog-store` — dos lecturas

```ts
listRelated(ref: ProviderRef, limit: number): Promise<readonly AnimeSummary[]>
/**
 * El estado de visionado de cada episodio de un título, por número.
 *
 * Una fila por episodio —la del visionado más avanzado— y **una sola consulta**:
 * el mismo error que el spec del historial prohíbe —una consulta por fila— aquí
 * sería una por episodio, y una temporada de 24 se nota.
 */
listWatchedEpisodes(animeRef: ProviderRef): Promise<readonly WatchedEpisode[]>
```

`listRelated` lee el título de la referencia pedida en una consulta y los candidatos —lo que la
base conoce y empieza por la misma palabra, en `anime` y en los tres listados cacheados— en otra,
normaliza en memoria y ordena por cercanía de año (mismo año primero, luego el más próximo, luego
el más reciente). Excluye la referencia pedida y la propia obra en otra fuente. Sin coincidencias
devuelve lista vacía, no `null`: «no hay» no es «no se pudo».

`updateWatchPosition` pasa a escribir `finished` con `positionS / durationS >= FINISHED_RATIO`.
La proporción se calcula **en el servidor** y contra el mismo umbral que lee la interfaz: con dos
umbrales, un episodio podría salir «visto» en la ficha y seguir en «continuar viendo».

### `server` — dos rutas locales y un umbral

```
GET /api/anime/:providerId/:ref/related   -> { items: AnimeSummary[] }
GET /api/anime/:providerId/:ref/watched   -> { episodes: WatchedEpisode[] }
```

Las dos son locales: no llaman al proveedor y no llevan `X-Cache`. Un proveedor desconocido sigue
siendo 404; una referencia que no está en la base devuelve lista vacía, que es la verdad —nadie
abrió esa ficha todavía—.

La ficha lee además, **por su cuenta y sin bloquearse**, `GET /api/anime/:providerId/:ref/anilist-related`
(`routes/anilist.ts`, ampliación T124): las relaciones que AniList declara de la obra emparejada, ya
filtradas por tipo y por formato, con `ref` local cuando la base conoce esa obra en alguna fuente.
Sin emparejamiento, sin relaciones o con AniList caído responde `{ items: [] }`.

`GET /api/watch/recent` deja de llevar su propio `MAX_CONTINUE_RATIO` y filtra por `finished`:
un episodio terminado no es «continuar viendo» aunque su proporción quepa en la ventana. Las dos
reglas pasan a ser una.

### `web-ui` — la ficha

```
.detail                      grid: barra lateral (minmax(13rem, 17rem)) + principal (1fr)
├─ .detail__aside            portada, acciones, modos, también en, y el rail de la saga
└─ .detail__body             título, meta, sinopsis, episodios (sin `--measure` en el bloque)
```

El **rail de la saga** vive en la barra lateral y pinta grupos por tipo de entrega, y sólo los que
tienen algo dentro:

```
Temporadas            series, ONA y lo que no declara tipo —incluida la que se está viendo—
Películas             película
OVA                   OVA y especial
Más de esta franquicia  lo que la lectura de franquicia aporta y no está ya arriba
```

- Cada fila es una entrega: portada, título, año, y la insignia de temporada cuando el título la
  lleva. La que se está viendo va marcada, con la palabra «viendo», y sin enlace.
- Las filas salen de **tres** lecturas ya existentes —hermanos de saga, hermanos de franquicia y
  las relaciones de AniList— y `filasDeSaga` las junta **sin repetir obra**: primero lo que la base
  conoce —por referencia y por título normalizado— y después lo que AniList declara y falta. Una
  fila de AniList que la base conozca en otra fuente enlaza a esa ficha y usa la portada del proxy;
  la que no conoce ninguna enlaza a la búsqueda de su título y usa la portada de AniList.
- La fila que viene de AniList lleva **su motivo** («Secuela», «Historia paralela»…) como insignia,
  y si hay alguna, el rail cierra con la atribución: el dato es de un tercero y se dice.
- La sinopsis conserva `max-width: var(--measure)`: una línea de 120 caracteres no se lee.
- La lista de episodios ocupa el ancho de la columna principal.
- `.episode--visto` y `.episode__progress` (barra fina con `ratio`) se pintan con los tokens que
  ya existen; el «visto» lleva además la palabra, no sólo el color.
- El marcado de modo usa un token nuevo `--shadow-hard-pressed`, que en oscuro es crema y en claro
  es tinta: la sombra dura sigue ahí, deja de ser del color del relleno.

## Estructura de los archivos nuevos

```
packages/core/src/titles.ts                       baseTitle + sagaTitle + FINISHED_RATIO
packages/core/src/titles.test.ts
packages/catalog-store/src/repositories/related.ts
packages/catalog-store/src/repositories/watched-episodes.ts
packages/web/src/features/detail/RelatedList.tsx
packages/web/src/features/detail/saga.ts          las filas del rail y sus grupos (T131)
```

## Success Criteria

- [ ] `baseTitle('Sousou no Frieren 2nd Season') === 'sousou no frieren'` y
      `baseTitle('86') === '86'`. Medido mutando: quitar el marcador `season` de la lista rompe la
      primera; normalizar los números rompe la segunda.
- [ ] `sagaTitle('Kimetsu no Yaiba: Mugen Ressha-hen') === 'kimetsu no yaiba'` y
      `sagaTitle('Kimetsu no Yaiba Movie 1: Mugenjou-hen - Akaza Sairai') === 'kimetsu no yaiba'`.
      Medido mutando: sin el corte por `:` fallan 6 pruebas; sin el marcador de película, 2;
      aceptando el guion suelto como separador, 1.
- [x] Con dos títulos de la misma saga en la base, `listRelated` devuelve el hermano y **no** la
      referencia pedida; la mutación que quite la exclusión lo delata.
- [x] `listRelated` cruza proveedores, lee también los listados cacheados y saca **una fila por
      obra**, con el proveedor de la ficha delante. Medido mutando: emparejar por `baseTitle` en
      lugar de `sagaTitle` deja 4 pruebas en rojo; quitar la mitad de la caché de búsqueda, 1;
      devolver el filtro de proveedor, 5; quitar el mapa por obra, 1. Verificado además contra la
      base real de desarrollo: la ficha de `jkanime/kimetsu-no-yaiba` pasa de 0 relacionados a 6,
      todas distintas.
- [x] `listRelated` no prepara ninguna consulta por candidato (contador de consultas, como en
      `user.test.ts`): dos sentencias preparadas en el alta y ninguna durante la lectura.
- [ ] `updateWatchPosition` con 90 % marca `finished`; con 89 % no. Mutar el umbral a `>` lo delata.
- [ ] `GET /api/anime/:p/:ref/watched` devuelve una fila por episodio con el visionado más
      avanzado, no una por visionado.
- [ ] Un episodio terminado **no** sale en `GET /api/watch/recent`.
- [ ] La ficha, con relacionados, los pinta como enlaces a su ficha; sin relacionados, explica el
      hueco.
- [x] El rail de la saga agrupa por tipo —Temporadas, Películas, OVA, Más de esta franquicia— y
      **una obra sale una vez** aunque llegue por dos procedencias. Verificado contra el servidor de
      verdad: la ficha de «Danmachi» (`jkanime`, una sola fila en la base) enseña «Secuela» de la
      segunda temporada en Temporadas, dos OVA en su grupo y la película en Películas, con
      «Sword Oratoria» una sola vez —estaba en la base y AniList también la declara—.
- [x] La fila que no es de la base enlaza a la búsqueda de su título y enseña su portada de AniList;
      la que la base conoce en otra fuente enlaza a esa ficha. Medido mutando: darle la portada de
      AniList a la fila que tiene referencia local deja 2 pruebas en rojo; quitarle el motivo a la
      fila de AniList deja 4.
- [x] El dato de AniList se atribuye: el rail cierra con la línea de AniList **si y sólo si** alguna
      fila suya sobrevivió al filtro. Medido mutando: encender la atribución siempre deja 6 pruebas
      en rojo.
- [x] La misma obra sale **una vez** aunque llegue por dos procedencias: por su referencia —el
      servidor ya la emparejó— o por `sameWork`, que la reconoce cuando cada fuente la publica con
      otro nombre y otra referencia. Medido mutando: quitar el filtro de duplicados deja 4 pruebas en
      rojo y quitarle la identidad de `sameWork`, otras 4.
- [x] `listRelated` saca **una fila por obra** también cuando las dos fuentes la nombran distinto:
      «Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka Gaiden: Sword Oratoria» y «Danmachi:
      Sword Oratoria» son la misma y salían las dos —visto en la ficha real de «Danmachi»—. Medido
      mutando: quitar el agrupado por obra deja 2 pruebas en rojo.
- [ ] La lista de episodios marca el terminado con la palabra «visto» y la barra de progreso del
      que está a medias; sin `durationS`, ninguna de las dos cosas.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes tocados.

## Boundaries

**Always**

- Texto del proveedor como texto: ni `dangerouslySetInnerHTML` ni HTML en atributos.
- Los textos de interfaz nuevos en `packages/web/src/i18n/es.ts`, con clave explícita una a una.
- Comparar referencias por `providerId` **y** `value`.
- Todo lo local primero: si la base ya lo sabe, no se pide a la red.
- **Decir de quién es el dato ajeno.** Una fila que no sale de la base se atribuye —el motivo de
  AniList en la fila y la línea de atribución en la sección—: mezclar lo local con lo de un tercero
  sin decirlo hace que el catálogo parezca saber más de lo que sabe.

**Ask first**

- Cualquier tabla o columna nueva. Esta entrega **no añade ninguna**: usa `watch_event.finished`.
- Cambiar el umbral del 90 %, o el 2 % con el que empieza «continuar viendo».
- Cruzar proveedores en los relacionados.
- Añadir la capacidad `related` al contrato de plugins.

**Never**

- Sembrar la sección de relacionados con recomendaciones del motor: una razón de `recsys` no es una
  relación, y mezclarlas hace que «Relacionados» signifique dos cosas. Las relaciones que **declara
  AniList** no son recomendaciones: son la franquicia de la obra, y la lista blanca de tipos está en
  `core` para que sólo entre eso.
- Marcar como visto un episodio que nadie reprodujo —la regla que ya defiende `useWatchEvents`—.
- Redondear el umbral hacia arriba con `Math.ceil` o sumar segundos de gracia a ojo.
- Una consulta por episodio o por candidato.
- Listar dos veces la misma obra por venir de dos procedencias.

## Open Questions

1. ¿Los relacionados cruzan proveedores cuando el mismo título está en dos? Se propone no: la
   comparación de títulos entre fuentes distintas multiplica los falsos positivos.
2. ¿Se marca «visto» a mano, y se puede deshacer? Fuera de esta entrega; pide ruta, columna
   `manual` y su prueba.
3. ¿La barra de progreso de la ficha y la de la home deben compartir componente? Se propone que no
   todavía: la de la home es de una fila y la de aquí es de un episodio con estado.
