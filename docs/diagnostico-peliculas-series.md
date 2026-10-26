# Diagnóstico: películas y series no anime

**Tarea 0.1 del roadmap.** Medido sobre `d917f59` (v0.3.1), el 26 de octubre de 2026, en Windows
con Bun 1.4.3 y el proveedor de fixture del repositorio.

**Para qué existe este documento.** El roadmap arranca diciendo que «falla con películas y series
no anime» y que la causa no está diagnosticada. Eso era una hipótesis: aquí se separa lo que
funciona de lo que no, se reproduce cada fallo y se anota el paquete que lo causa. Sin esta
separación, la fase 0 empezaría rehaciendo piezas que ya están probadas y dejaría intactas las que
sí fallan.

## Resumen

- **La película funciona de punta a punta con el fixture**: búsqueda con `?tipo=movies`, ficha con
  «Ver película», reproducción y «continuar viendo». La suite e2e entera pasa (**105 pruebas, 0
  fallos**), incluidas las dos de película de `detail.e2e.ts`.
- **La serie de una temporada también funciona.**
- **Lo que falla es la serie de varias temporadas cuando la fuente numera por temporada**, que es
  justo lo que hace un sitio real como PelisPlusHD (`/serie/<slug>/temporada/<N>/capitulo/<M>`).
  El modelo actual usa el **número de episodio como identidad**, y con numeración por temporada ese
  número se repite: el salto por número, los vecinos del reproductor, «último episodio» y
  «continuar viendo» acaban en la temporada equivocada. Son los hallazgos F1–F4.
- **Los metadatos de no-anime dependen sólo del plugin.** AniList cubre anime y manga, no acción
  real, y no hay fuente alternativa. Es la decisión **D1** del roadmap y el bloqueo de la tarea
  0.3. F7.
- **No hay ninguna fuente real de películas/series viva en este entorno**: el único plugin conocido
  de esa familia apunta a dominios retirados. Eso no es un fallo del código, pero impide verificar
  «tan bien como el anime» contra un sitio real. F9.

La conclusión que cambia el plan: **la fase 0 no es «rehacer el soporte de películas», es
«cambiar la identidad del episodio para que la temporada deje de ser un adorno en el título»**, más
la fuente de metadatos y el fixture multi-temporada.

## Método

Todo lo de abajo se midió sin red salvo donde se dice.

| Medición | Cómo | Resultado |
|---|---|---|
| Línea base e2e | `bun run e2e` | **105 pasan, 0 fallan** (2.9 min) |
| Rutas HTTP de película y serie | Sonda con `conCiclo` de `tests/fixtures.ts` contra el fixture y un proveedor sintético de tres temporadas | Los resultados se citan en cada hallazgo |
| Modelo de temporadas | Lectura de `packages/core/src/episodes.ts`, `packages/server/src/container.ts` y `packages/web/src/features/player/WatchPage.tsx` | F3–F6 |
| Fuente real | `docs/estudio-busqueda-ani-cli-mx.md` (medición del 12/10/2026) y `%LOCALAPPDATA%\nn-anime` | F9 |

La sonda vive fuera del repositorio (`.tmp/probe.ts`) porque **un diagnóstico no deja una prueba en
rojo**: lo que deja es la reproducción escrita. El proveedor sintético declara
`capabilities.media: 'movies'`, tres temporadas de tres episodios y títulos `T1 E1 · …`; sus
referencias son `serie/uno/temporada/<N>#<M>` y su `animeRef` de la lista completa es `serie/uno`.

## Lo que ya está medido y funciona

No hace falta rehacerlo; la fase 0 lo da por bueno salvo que una tarea diga lo contrario.

| Pieza | Evidencia |
|---|---|
| El conmutador de tipo vive en la dirección y sobrevive a recargar | `home.e2e.ts` «la mitad vive en la dirección…» |
| Buscar películas pregunta sólo a las fuentes que pueden servirlas | `selectedProviders` filtra por `puedeServir`; `search.e2e.ts` |
| La ficha de una película dice «Película» y ofrece «Ver película», sin numerar capítulos | `detail.e2e.ts` «la ficha de una película ofrece verla…» |
| Una película sin ninguna parte lo dice y no deja un botón muerto | `detail.e2e.ts` «una película sin ninguna parte lo dice…» |
| La reproducción de una película abre el reproductor con su única parte | `detail.e2e.ts`, mismo caso; `player.e2e.ts` reproduce un archivo local |
| La banda de temporadas se pinta y pide la temporada al servidor | `detail.e2e.ts` «un título con temporadas» (con la respuesta simulada) |
| El fixture trae una película (`el-jardin-de-hierro`) y la conformidad la acepta | `providers-fixture/fixtures/catalogo.json` |

## Hallazgos

| ID | Fallo | Paquete | Severidad |
|---|---|---|---|
| F1 | El número de episodio no identifica la temporada: el salto y los vecinos caen en la T1 | `core`, `server`, `web` | **Alta** |
| F2 | «Continuar viendo» e historial colapsan temporadas y pierden la referencia real del episodio | `server`, `catalog-store` | **Alta** |
| F3 | «Último episodio» elige el mayor número, no el último de la última temporada | `server` | Media-alta |
| F4 | El total que se anuncia es del título, no de la temporada: «Episodio 2 de 9» con 3 en la temporada | `server`, `web` | Media |
| F5 | Una fuente que pagina sus episodios no puede ofrecer temporadas (400) | `server` | Media |
| F6 | El reproductor de una película anuncia «Episodio 1 de 1» y conserva los mandos de episodio | `web` | Media-baja |
| F7 | Los metadatos de no-anime dependen sólo del plugin; no hay fuente alternativa | `server`, `web` | **Alta** |
| F8 | El filtro `media` no se aplica a los resultados de búsqueda en el servidor | `server` | Media-baja |
| F9 | No hay fuente real de películas/series viva: no se puede verificar contra un sitio | entorno | **Bloqueante de verificación** |
| F10 | El fixture y el e2e no cubren numeración por temporada; simulan numeración global | `providers-fixture`, `web` | **Alta como hueco de prueba** |

### F1 — El número de episodio no identifica la temporada

**Reproducción.** Con el proveedor de tres temporadas, cada una numerada 1..3:

```
GET /api/anime/series/serie%2Funo/episodes/number/2
→ episode.ref.value = "serie/uno/temporada/1#2"   (T1 E2)
```

El episodio que se está viendo puede ser el 2 de la temporada 3; el salto devuelve el 2 de la
temporada 1.

**Causa.** `Episode` no tiene temporada (`packages/core/src/schema.ts:304-319`); la temporada se
lee del título `T<n> E<m>` (`packages/core/src/episodes.ts:30`). Eso sirve para **agrupar** la
lista, no para **identificar** un episodio:

- `loadEpisode` busca el primero con ese `number` (`packages/server/src/container.ts:498`);
- `neighboursWithNumber` pide `number - 1` y `number + 1` (`WatchPage.tsx:241-244`), que es el
  mismo `find` por número en el servidor;
- la flecha «siguiente» de una serie con numeración por temporada abre el episodio de otra
  temporada, y la de «anterior», también.

Las referencias sí son únicas (`…/temporada/2#1`), pero la navegación no las usa: usa el número.
Es el fallo más caro de la lista porque **reproduce el episodio equivocado**, no una etiqueta.

**Por qué no lo ve el e2e.** `detail.e2e.ts` simula la lista con numeración **global**:
`aurora-nocturna#7` es T2E1 y el número nunca se repite. Con esa forma, `find(number)` acierta
siempre. El caso real —número que empieza en 1 en cada temporada— no está medido. F10.

### F2 — «Continuar viendo» e historial colapsan temporadas

**Reproducción.** Dos altas de visionado de la misma serie, T1E1 y T2E1, con el avance apuntado:

```
POST /api/watch  animeRef=serie/uno  episodeRef=serie/uno/temporada/1#1   → id 1
POST /api/watch  animeRef=serie/uno  episodeRef=serie/uno/temporada/2#1   → id 2
PATCH /api/watch/1  {positionS: 100, durationS: 3600}
PATCH /api/watch/2  {positionS: 200, durationS: 3600}
GET /api/watch/recent
→ UN solo item, con episodeRef "serie/uno#1" y positionS 200
```

Dos episodios distintos de dos temporadas, una sola tarjeta, y la referencia que se guarda
—`serie/uno#1`— **no es la de ninguno de los dos**: el plugin de temporadas por ref no conoce ese
valor. Al pulsar «continuar» se abre un episodio que el proveedor no tiene.

**Causa.** Dos convenciones a la vez:

- `unaPorEpisodio` agrupa por `providerId + anime.ref.value + episodeNumber`
  (`packages/server/src/routes/watch.ts:87`); con numeración por temporada, T1E1 y T2E1 comparten
  clave.
- `historyItems` reconstruye la referencia como `${anime.ref.value}#${episodeNumber}`
  (`watch.ts:118-121`) en vez de leer la del episodio. La fila de `watch_event` **sí guarda
  `episode_id`** y la tabla `episode` guarda su `provider_ref`; el dato existe y se está tirando.

**Consecuencia.** El historial miente sobre qué episodio se vio y «continuar viendo» no puede
reanudarlo. Afecta a películas sólo si el plugin usa una referencia distinta de `titulo#1`; afecta
a toda serie con temporadas.

### F3 — «Último episodio» elige el mayor número

**Reproducción.**

```
GET /api/anime/series/serie%2Funo/episodes/latest
→ "serie/uno/temporada/1#3"
```

Con tres temporadas de tres episodios, el «último» es el 3 de la T1 porque el código se queda con
el `number` más alto (`container.ts:524-527`). Con temporadas de longitudes distintas ni siquiera
es un empate: una T1 de 24 episodios gana siempre a una T2 de 12.

**Causa.** La misma identidad por número que F1, aplicada al máximo en vez de a la búsqueda.
«Último» significa último de la **última temporada**, y eso no se puede saber sin temporada.

### F4 — El total es del título, no de la temporada

**Reproducción.**

```
GET /api/anime/series/serie%2Funo/episodes?season=2
→ 3 episodios, "total": 9
```

La fila pinta «Episodio 2 de 9» mientras la temporada tiene tres. El servidor lo hace a propósito
—`sliceEpisodesPage(temporada, page, completa.length)` (`container.ts:474`)— y el e2e lo fija como
correcto (`detail.e2e.ts`, «Episodio 7 de 12»). **Ese es el diseño que el roadmap pide cambiar**:
«serie = temporadas con episodios numerados por temporada (no numeración absoluta como en
anime)». No es un bug de una línea: es la decisión de qué significa `number`, y va con 0.2.

Si se mantiene la numeración global, el total del título es correcto; si se adopta la numeración
por temporada, el total tiene que ser el de la temporada —o no anunciarse—.

### F5 — Una fuente que pagina sus episodios no puede ofrecer temporadas

`packages/server/src/routes/episodes.ts:135-145` devuelve **400** cuando llega `?season=` y el
proveedor declara `capabilities.episodePages`. El motivo está escrito y es bueno —el índice sale de
la lista entera y esa lista no se pide—, pero el resultado es que **un plugin de series con API
paginada no tiene selector de temporadas**. La interfaz sólo puede leer la lista entera.

No hay fixture que lo mida. Es una limitación de la tarea 0.2/0.4, no un fallo reproducible aquí.

### F6 — El reproductor no distingue una película

`WatchPage` no recibe el `kind` del título y siempre pinta la etiqueta de episodio
(`WatchPage.tsx:657-676`). Una película se abre con su única parte y el reproductor dice
«Episodio 1 de 1», ofrece los mandos de anterior/siguiente apagados y titula la pestaña con esa
etiqueta. La ficha sí distingue «Película» (`DetailPage.tsx:421` y e2e); el reproductor, no.

No se midió en navegador porque no hay e2e de película **dentro** del reproductor: el caso de
`detail.e2e.ts` comprueba que el `<video>` aparece, no lo que dice el encabezado. Se deja como
leído en el código y se cierra en 0.4.

### F7 — Metadatos de no-anime: sólo el plugin

`AniList` es la única fuente de metadatos y sólo cubre anime y manga (`anilistEntrySchema`,
`formatosDe`). Para una película o una serie de acción real:

- si el plugin devuelve sinopsis, géneros, año y portada, la ficha se ve completa;
- si no, no hay respaldo: la ficha queda con el título y poco más;
- el emparejamiento con AniList es por título y año, así que un título de acción real con un
  homónimo de anime podría enriquecerse con la ficha equivocada. No se reprodujo —haría falta red
  y una obra concreta—, pero el matcher no mira `kind`.

Es la decisión **D1** del roadmap. No se toma aquí. La recomendación inicial del roadmap —clave
opcional del usuario + respaldo del plugin— conserva «sin cuentas» y no amplía la superficie de
red; la alternativa «sólo plugin» es la más simple y la que menos promete.

### F8 — El filtro `media` no se aplica a los resultados de búsqueda

`selectedProviders` (`search.ts:166-176`) decide **a quién preguntar**, pero el flujo SSE emite
todo lo que responde cada fuente. Con el fixture, que declara `both`:

```
GET /api/search?q=&media=movies
→ results de fixture: Mar de Cristal (tv), Aurora Nocturna (tv), … y El Jardín de Hierro (movie)
```

La interfaz los esconde con `enElTipo` (`features/tipo/tipo.ts`), así que el usuario no los ve;
pero el servidor gasta la respuesta entera y los recuentos pueden no cuadrar. Peor: una fuente
`both` **no puede representar** una serie de acción real, porque `kind: 'tv'` en una fuente mixta
cuenta como anime (`core/src/media.ts:52`). Para PelisPlusHD no importa —declara `movies` y todo lo
suyo cae de ese lado—, pero limita a cualquier plugin que mezcle anime y no-anime.

No se arregla con un filtro de una línea: o el contrato gana un tipo de medio por título, o la
fuente sigue declarando su mitad y se acepta la limitación. Va con 0.2.

### F9 — No hay fuente real viva

El plugin `pelisplushd` de `nn-anime-plugins` está escrito y conforma, pero **sus dominios ya no
existen** (medido el 12/10/2026 en `docs/estudio-busqueda-ani-cli-mx.md:2125-2147`): los tres
`.mx/.bz/.to` no conectan, `.net` redirige a una página de retirada y `.com` está en venta. En este
entorno no hay ningún plugin instalado (`%LOCALAPPDATA%\nn-anime` no tiene `plugins/`). El e2e usa
el fixture, no un sitio.

Consecuencia honesta: **no se puede aceptar «películas y series funcionan tan bien como el anime»
contra contenido real** hasta que exista una fuente viva. Lo que sí se puede cerrar es que el
mecanismo no pierda episodios ni temporadas, que es lo que miden F1–F4.

### F10 — El fixture y el e2e esconden el caso que falla

El fixture tiene **una** película y **ninguna** serie multi-temporada. El e2e de temporadas simula
la respuesta y lo hace con numeración global (`aurora-nocturna#7` para T2E1), que es la forma en la
que F1 y F2 no se manifiestan. La tarea 0.5 del roadmap —ampliar el fixture con temporadas y un
caso de proveedor en fallo— no es cosmética: **es la que convierte F1 y F2 en pruebas**.

## Límites de este diagnóstico

- **Sin red.** No se probó AniList ni un sitio real. El enriquecimiento de una película concreta y
  el emparejamiento erróneo de F7 quedan como riesgo, no como hecho medido.
- **Sin audio/vídeo real.** El e2e reproduce un WAV local; las pistas múltiples de audio y los
  subtítulos de una película no se midieron. Es 0.4.
- **Un proveedor sintético.** La sonda imita la forma que el estudio atribuye a PelisPlusHD
  (referencia por temporada), no un plugin real.
- **La suite e2e no cubre el reproductor de una película.** Pasa entera, pero eso no dice nada de
  F6.

## Consecuencias para la fase 0

| Tarea | Qué cambia tras el diagnóstico |
|---|---|
| **0.2** | La decisión central es **qué identifica un episodio**. Añadir `season` a `Episode` (o a la referencia) y dejar de usar `number` como clave de búsqueda, navegación y progreso. Migración de `watch_event`/`history`: el `episode_id` ya existe, así que no hay pérdida de datos; lo que hay que migrar es la lectura que reconstruye la referencia. Spec previa obligatoria. |
| **0.3** | D1 sin resolver. Sin fuente, el trabajo es dejar el hueco preparado y no inventar metadatos. |
| **0.4** | Cubre F1–F4 y F6: película sin etiqueta de episodio, serie que cambia de temporada, reanudar por la referencia real. |
| **0.5** | Añadir al fixture una serie de dos o tres temporadas con numeración por temporada y referencias por temporada; un caso de proveedor que falla en `resolveStream` para ese tipo. Es lo que hace fallar F1/F2 antes de arreglarlos. |
| **0.6** | Parcial: `SourcePicker` existe en la ficha y el e2e mide que ofrece la otra fuente; **no** hay cambio automático cuando la fuente activa falla en el reproductor, ni conserva la posición. |

## Decisión D1

**Decidida el 2026-10-26: clave opcional de TMDB en Ajustes, con el plugin como respaldo.** La
implementa 0.3; la clave no se devuelve en `GET /api/settings`, TMDB entra en la lista blanca y su
salida se declara en `SECURITY.md`. Sin clave, la ficha se queda con lo que dé el plugin.

Las tres opciones que se barajaron, para que la decisión se lea con su coste:

| Opción | Coste | Qué respeta |
|---|---|---|
| Sólo lo que entregue el plugin | Bajo | «Sin cuentas» al pie de la letra; la ficha depende de la calidad del plugin |
| TMDB con clave del usuario en Ajustes | Medio; clave en `settings`, nueva salida de red y lista blanca | Mantiene «sin cuentas» pero añade una superficie que `SECURITY.md` debe declarar |
| Respaldo en el plugin + caché local de lo recibido | Bajo-medio | Nada nuevo que abrir; no mejora un plugin pobre |

## Criterios de aceptación de 0.1

- [x] Tabla con cada fallo, pasos para reproducirlo, causa probable, paquete y severidad.
- [x] Cubre búsqueda (F8), ficha (F6, F7), selección de temporada/episodio (F1, F3, F4, F5),
      reproducción (F1, F6) y «continuar viendo» (F2).
- [x] Dice qué funciona, con la medición que lo sostiene, para no rehacerlo.
- [x] Separa el fallo de código del bloqueo de verificación (F9) y del hueco de prueba (F10).
