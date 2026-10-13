# Cómo busca ani-cli-mx, y por qué sus búsquedas no se parecen a las de nn-anime

Estudio de la búsqueda de [`Gildedboy/ani-cli-mx`](https://github.com/Gildedboy/ani-cli-mx) —un CLI en
POSIX `sh` que reproduce anime, películas, series y doramas de sitios con subtítulos en español— para
poder replicar su comportamiento en los plugins de nn-anime. 12 de octubre de 2026.

## Alcance y método

- **Fuente única de verdad**: el repositorio en su rama por defecto, árbol
  `e689e51ea5cb3fabefd12c63c0e10a3f31189bb7`, descargado como tarball. El programa entero es
  `ani-cli-mx-core`, **5075 líneas de `/bin/sh`**; todo lo demás son documentos, pruebas y
  empaquetado. Cada afirmación se cita como `ani-cli-mx-core:<línea>`.
- **No se ejecutó el programa ni se hizo una sola petición de red**: necesita `mpv`, `yt-dlp`,
  `curl-impersonate` y sitios que están detrás de Cloudflare. Todo lo que hay aquí es lectura del
  código; lo deducido va marcado como **deducción** y lo que no se pudo determinar está en las
  secciones «Dudas».
- Las **citas** del documento se comprobaron una a una contra la línea que nombran —que exista y
  que el rango no se salga del fichero—, no contra lo que la línea dice: eso último es leer, y es lo
  que hace quien use este documento.
- **Alcance**: la búsqueda de anime (partes A y B), la de películas, series y doramas, que en
  ani-cli-mx es un camino aparte (parte B, «PelisPlus (HD)»), la comparación con este repositorio
  (parte C) y la receta para servir las tres cosas desde un plugin de nn-anime (parte D).
- La comparación final es con este repositorio (`nn-anime`) y con
  [`zxuru/nn-anime-plugins`](https://github.com/zxuru/nn-anime-plugins), que es donde viven los
  proveedores reales. Las dos copias se descargaron como tarball en `.tmp/` —que está ignorado— con
  `curl` no basta en esta máquina (`schannel` no tiene credenciales para el almacén de certificados) y
  se usó el `fetch` de Bun, que trae su propia pila TLS:
  `bun -e "await Bun.write('x.tar.gz', await (await fetch(url)).arrayBuffer())"`.

## Resumen en dieciséis líneas

1. La búsqueda se hace **en el cliente y por fuente**: cada sitio se consulta por separado y los
   resultados se concatenan en un selector interactivo (`ani-cli-mx-core:2998-3028`).
2. La consulta se pliega con dos normalizaciones: `normalize_romanized_text` (vocales largas →
   dobles: `Ō`→`ou`) y `normalize_romanized_text_plain` (sin doblar). De ahí salen **dos** formas, y
   solo dos (`:571-617`).
3. Esas dos formas son las «variantes»: `search_jkanime_variants` y `search_animeav1_variants` las
   piden en serie y deduplican (`:1540-1550`).
4. Cada fuente tiene **una** ruta de búsqueda; no hay respaldo a un listado ni caché de búsqueda en
   disco (`:1535`, `:1745`, `:3043`).
5. La puntuación de títulos (`title_match_score`, `:718-768`) **no ordena el menú de resultados** —se
   muestra lo que devolvió cada sitio, en su orden—: sirve para **identificar la misma obra en otra
   fuente**, sumando coincidencia exacta de la clave alfanumérica, prefijo, solapamiento de palabras
   distintivas y coherencia de temporada.
6. Esa identificación se acepta solo si pasa de **140 puntos** (`cross_source_match_is_confident`,
   `:770-773`); si no, se descarta la fuente.
7. Los cuatro selectores automáticos (`select_jkanime_slug` `:1552`, `select_animeav1_slug` `:1750`,
   `select_anidb_ref` `:2102`, `select_animex_ref` `:2197`) son ese umbral sobre el mejor candidato, y
   en empate gana el primero de la lista.
8. Las temporadas se reconocen a mano —`season N`, `temporada N`, `part N`, `cour N`, `sN`— tanto en
   el texto como en el slug (`:628-667`).
9. Fuera del sitio, hay dos catálogos autoritativos que permiten buscar en inglés: AniDB (con
   `curl-impersonate`) y AnimeX (GraphQL).
10. **No se cachea ninguna búsqueda**: cada ejecución vuelve a pedir a las cuatro fuentes. Lo único
    persistente es el catálogo de episodios de JKAnime (300 s) y el castigo de 65 s tras un HTTP 429.
11. Un 429 de JKAnime deja un fichero de *back-off* que bloquea hasta los diagnósticos (`:469-484`).
12. Cuando la búsqueda agregada sale vacía, `diagnose_empty_search` **sondea los endpoints** para
    distinguir «no hay red» de «no hay resultados» (`:544-556`).
13. nn-anime hace lo contrario en los puntos 2, 5, 6 y 12: manda **una** consulta literal —sin plegar
    acentos ni macrones—, no identifica por puntuación (esa decisión la toma el usuario al elegir) y no
    diagnostica el vacío (`packages/server/src/search/aggregate.ts:199`).
14. Lo que sí hace mejor nn-anime: consulta a todos los proveedores **en paralelo** y pinta lo que
    llega, y cachea por consulta normalizada para no repetir red.
15. Lo que explica que «no salgan búsquedas parecidas», por orden: los **acentos y macrones sin
    plegar**; que solo haya **dos fuentes, las dos españolas**; que el **vacío se cachee 900 s**; y que
    la URL y el parser del plugin no sean los mismos que los de ani-cli-mx. El detalle y la
    comprobación de cada uno, en la parte C.
16. **Películas, series y doramas no pasan por el camino del anime**: ani-cli-mx pregunta el tipo
    antes que la consulta y los manda todos a una sola fuente, PelisPlusHD, donde una película es un
    solo elemento y una serie se lista por `/temporada/N/capitulo/M`. En nn-anime ese menú no hace
    falta —el contrato ya admite `kind: 'movie'` y la ficha ya separa «Películas y especiales»—, así
    que la parte D dice cómo se escribe el plugin y ese plugin **ya está escrito**; lo que no hay hoy
    es sitio: los dominios de `pelisplushd` están retirados o aparcados (parte D, «Estado»).

## Índice

- **Parte A — La consulta y la decisión**: normalización, variantes, temporadas, puntuación,
  umbral y selección del resultado.
- **Parte B — Peticiones y parseo por fuente**: JKAnime, AnimeAV1, PelisPlusHD, AniDB, AnimeX y
  HentaiLA, con URL, método, cabeceras, cookies, cifrado y bloques de parseo.
- **Parte C — nn-anime frente a ani-cli-mx**: qué falta en este repositorio, qué no es culpa del
  plugin, y la receta concreta para `providers/jkanime.ts` y `providers/animeav1.ts`.
- **Parte D — Películas, series y doramas**: qué soporta ya el contrato, las tres decisiones que hay
  que tomar (episodio único, temporadas, etiqueta del tipo) y la receta del plugin `pelisplushd.ts`.

---

## Parte A — ani-cli-mx: la consulta y la decisión

Alcance: cómo `ani-cli-mx` convierte lo que escribe el usuario en peticiones de búsqueda y cómo elige
un resultado entre muchos (menús, normalización de texto, variantes de consulta, pistas de temporada,
puntuación, umbrales, elección de slug/ref y orden de fuentes). No cubre endpoints HTTP, parseo por
sitio, resolución de mirrors ni reproducción: eso es la parte B. Todas las citas son
`ani-cli-mx-core:<línea>`.

---

### 1. Punto de entrada

#### 1.1 La secuencia de preguntas

El programa es una máquina de estados (`while :; do case "$app_state" in ...`, `ani-cli-mx-core:4775`).
El orden que ve el usuario es:

1. **Inicio** — `main_menu` (`ani-cli-mx-core:107`), opciones en `main_menu_options`
   (`ani-cli-mx-core:101-105`): `1 search / 2 history / 3 exit`. `history` solo se ofrece si el
   fichero de historial no está vacío (`ani-cli-mx-core:4784-4789`).
2. **Tipo de contenido** — `media_type_menu` (`ani-cli-mx-core:122`), opciones en
   `media_type_menu_options` (`ani-cli-mx-core:114-120`): `anime`, `movie`, `series`, `dorama`,
   `__nav_home`. Devuelve el campo 1 del menú (`ani-cli-mx-core:126`). Al elegir tipo se vacía la
   consulta (`query=""`) y se pasa a `search_query` (`ani-cli-mx-core:4794-4807`).
3. **Consulta de texto** — `search_query_menu` (`ani-cli-mx-core:159`).
   - Con menú interno (`use_external_menu = 0`, `ani-cli-mx-core:161`) usa `fzf --phony
     --print-query --no-sort` con una única línea ficticia: `Escribe el titulo y presiona Enter`
     (`ani-cli-mx-core:162-166`). **No hay sugerencias, autocompletado ni historial de consultas**:
     es texto libre. El encabezado es `"$app_name · Buscar $search_kind_label"` y el prompt
     `Buscar: ` (`ani-cli-mx-core:165-166`), donde la etiqueta del tipo sale de `media_kind_label`
     (`ani-cli-mx-core:139-147`).
   - Teclas: `--expect=esc,ctrl-c`; `esc` → código 10 (volver al menú de tipo),
     `ctrl-c` → 130 (salir) (`ani-cli-mx-core:164`, `ani-cli-mx-core:170-173`).
   - La consulta es la **primera** línea de la salida de fzf (`ani-cli-mx-core:174`).
   - Con menú externo (`--rofi`/`--dmenu`, `ani-cli-mx-core:4702-4703`) se delega en
     `external_menu` con el mismo prompt `Buscar <tipo>: ` (`ani-cli-mx-core:178`).
   - Consulta vacía: `[ -n "$query" ] || continue` vuelve a preguntar (`ani-cli-mx-core:4816`).
4. **Resultados** — `search_anime` (o `search_pelisplus` si el tipo no es anime,
   `ani-cli-mx-core:4824-4830`) y, si hay resultados, el menú de `build_media_menu`
   (`ani-cli-mx-core:4838`) con prompt `Selecciona <tipo>: ` (`ani-cli-mx-core:4839`).
5. **Episodios** — `episodes_list` + `choose_episode` (`ani-cli-mx-core:4911`, `ani-cli-mx-core:4918`).
   Si se pasó `-e/--episode`, `ep_no` ya está fijado y el menú de episodios se salta
   (`ani-cli-mx-core:4681-4685`, `ani-cli-mx-core:4917`).

La consulta se **codifica una sola vez**: `encoded_query="$(printf '%s' "$query" | sed 's| |+|g')"`
(`ani-cli-mx-core:4823`). Es decir, la codificación de espacios a `+` es responsabilidad de esta
línea; a partir de aquí todo el pipeline recibe texto con `+` en lugar de espacios.

#### 1.2 Dos entradas posibles

| Entrada | Efecto | Cita |
|---|---|---|
| Argumentos posicionales | Se acumulan: `query="$(printf "%s" "$query $1" \| sed "s\|^ \|;\|s\| \|+\|g")"` — espacios → `+` ya en el parseo | `ani-cli-mx-core:4712` |
| Interactiva | `search_query_menu` devuelve texto con espacios; `+` se aplica después | `ani-cli-mx-core:4809`, `ani-cli-mx-core:4823` |

Con consulta por argumentos el estado inicial es `search_results` (`ani-cli-mx-core:4756`), así que se
saltan inicio, tipo y consulta. La búsqueda directa **exige** `-t/--type` (`ani-cli-mx-core:4718-4719`);
`-t` normaliza el tipo con `normalize_media_kind` (`ani-cli-mx-core:129-137`, `ani-cli-mx-core:4686-4690`).
`hentaila_mode` (argumento oculto `-ha`) fuerza `media_kind=anime` (`ani-cli-mx-core:4544-4547`,
`ani-cli-mx-core:4716`).

#### 1.3 `search_anime`, `search_anime_for_source` y `get_episode_url`

- `search_anime "$1"` (`ani-cli-mx-core:2998-3028`):
  - Si `hentaila_mode=1` busca **solo** en Hentaila y retorna (`ani-cli-mx-core:2999-3003`).
  - Si `preferred_info_source != auto`, delega en `search_anime_for_source "$preferred_info_source" "$1"`
    y retorna (`ani-cli-mx-core:3005-3008`).
  - En modo `auto` **concatena** los resultados de cuatro fuentes en este orden fijo:
    animeav1 (`ani-cli-mx-core:3011`), jkanime (`ani-cli-mx-core:3015`), anidb si hay
    curl-impersonate (`ani-cli-mx-core:3019-3023`), animex (`ani-cli-mx-core:3024`). Cada bloque se
    envuelve en `prefix_search_results` con el nombre de la fuente. No hay deduplicación entre
    fuentes ni reordenación por puntuación.
- `search_anime_for_source "$1" "$2"` (`ani-cli-mx-core:2975-2996`): `case` sobre el nombre de
  fuente; solo jkanime, animeav1, anidb, animex. jkanime y animeav1 usan las variantes; anidb y animex
  reciben la consulta tal cual. anidb hace `die` si falta curl-impersonate
  (`ani-cli-mx-core:2986-2987`).
- `get_episode_url` (`ani-cli-mx-core:2844-2973`) **no busca catálogo**: resuelve enlaces. Se llama
  desde `play` cuando `$episode` está vacío (`ani-cli-mx-core:4052`) y desde la descarga
  (`ani-cli-mx-core:5005`). Usa los globales `$id`, `$title`, `$ep_no`, `$quality`. Su orden:
  pelisplus si el `id` lo autoriza (`ani-cli-mx-core:2849-2881`) → hentaila si `hentaila_mode=1`
  (`ani-cli-mx-core:2886-2897`) → AniDB si es la fuente autoritativa (`ani-cli-mx-core:2899-2912`) →
  AnimeX si es autoritativa (`ani-cli-mx-core:2914-2926`) → `seed_fast_mode_source`
  (`ani-cli-mx-core:2928`) → fuente rápida (`ani-cli-mx-core:2930-2934`) → `jkanime` y luego
  `animeav1` (`ani-cli-mx-core:2936-2945`) → `pick_spanish_source_links`
  (`ani-cli-mx-core:2947`) → respaldo en inglés AniDB y luego AnimeX (`ani-cli-mx-core:2952-2965`) →
  `select_quality` (`ani-cli-mx-core:2967`). Si no hay enlace, distingue "ya publicado" de "no
  disponible todavía" consultando `$ep_list` (`ani-cli-mx-core:2968-2972`).

**El punto clave**: dentro de `get_episode_url` la selección de contenido vuelve a ocurrir, porque
`store_spanish_links_for_source` → `resolve_spanish_source_links` → `resolve_jkanime_episode
"$title" "$ep_no"` (`ani-cli-mx-core:2493-2505`, `ani-cli-mx-core:2507-2526`,
`ani-cli-mx-core:1736-1742`) y `resolve_jkanime_episode` empieza por
`select_jkanime_slug "$1"` (`ani-cli-mx-core:1737`). Es decir: el título elegido en el menú se
**re-identifica** en la otra fuente española mediante el buscador de esa fuente y la puntuación de
la sección 5. La caché de esa decisión es `cache_key="$1|$id"`
(`ani-cli-mx-core:1560-1561`), con `$1` = título, por lo que la decisión tomada al listar episodios
(`ani-cli-mx-core:4911` → `episodes_list` → `episodes_list_jkanime "$id" "$title"` →
`select_jkanime_slug "$2"`, `ani-cli-mx-core:3254-3257`) se reutiliza en la reproducción sin volver a
puntuar.

---

### 2. Normalización de la consulta

Siete funciones, todas de texto plano sobre `sed`/`tr`. **Ninguna baja a minúsculas** salvo
`normalize_match_key` y `normalize_match_words` (`ani-cli-mx-core:619-626`); la consulta que se envía
al sitio conserva las mayúsculas que escribió el usuario.

#### 2.1 `normalize_romanized_text` (`ani-cli-mx-core:571-586`)

Transcripción literal:

```sed
s/[Āā]/aa/g
s/[Ēē]/ei/g
s/[Īī]/ii/g
s/[Ōō]/ou/g
s/[Ūū]/uu/g
s/[ÂÀÁÄÃÅâàáäãå]/a/g
s/[ÊÈÉËêèéë]/e/g
s/[ÎÌÍÏîìíï]/i/g
s/[ÔÒÓÖÕôòóöõ]/o/g
s/[ÛÙÚÜûùúü]/u/g
s/[Çç]/c/g
s/[Ññ]/n/g
```

Efecto: las vocales con **macrón** se expanden a la romanización de tipo Hepburn con vocal doble
(ā→aa, ē→ei, ī→ii, ō→ou, ū→uu); las vocales con acento/circunflejo/diéresis/tilde se reducen a la
vocal simple; `ç`→`c`; **`ñ`→`n`**. No toca mayúsculas (no hay `y`/`s` de transliteración), no elimina
puntuación y no trata otros caracteres latinos extendidos (`Ø`, `Ł`, `Æ`, `Œ`, `ß`, `Đ`, `Š`, `Ž`,
`Ý`, `Ć`, `Ą`, `Ę`…), que quedan intactos.

#### 2.2 `normalize_romanized_text_plain` (`ani-cli-mx-core:588-598`)

```sed
s/[ĀāÂÀÁÄÃÅâàáäãå]/a/g
s/[ĒēÊÈÉËêèéë]/e/g
s/[ĪīÎÌÍÏîìíï]/i/g
s/[ŌōÔÒÓÖÕôòóöõ]/o/g
s/[ŪūÛÙÚÜûùúü]/u/g
s/[Çç]/c/g
s/[Ññ]/n/g
```

Idéntico **salvo** que el macrón cae a la vocal simple (`Ā`→`a`, `Ō`→`o`, `Ī`→`i`…). Es la única
diferencia entre las dos normalizaciones: `ō` → `ou` frente a `ō` → `o`.

#### 2.3 `compact_search_query` (`ani-cli-mx-core:600-602`)

```sed
s|[[:space:]]\+|+|g; s|^+||; s|+$||
```

Colapsa cualquier racha de espacios a un único `+` y recorta `+` sobrantes al principio y al final.
No toca otra puntuación: `K-On!` sigue siendo `K-On!`.

#### 2.4 `search_query_from_text` (`ani-cli-mx-core:604-607`) — **no se usa**

```sh
search_query_from_text() {
    normalize_romanized_text "$(printf '%s' "$1" | sed 's|+| |g')" |
        compact_search_query
}
```

Deducción verificada por búsqueda: la única aparición de `search_query_from_text` en el fichero es su
definición (`ani-cli-mx-core:604`); nadie la llama. Es código muerto. La ruta viva es la siguiente.

#### 2.5 `search_query_candidates_from_text` (`ani-cli-mx-core:609-617`) — el generador de variantes

```sh
search_query_candidates_from_text() {
    query_text="$(printf '%s' "$1" | sed 's|+| |g')"
    {
        normalize_romanized_text "$query_text" | compact_search_query
        printf '\n'
        normalize_romanized_text_plain "$query_text" | compact_search_query
        printf '\n'
    } | sed '/^$/d' | awk '!seen[$0]++'
}
```

Pasos: (1) `+` → espacio; (2) se emiten **dos** consultas, la de macrón expandido y la de macrón
simple; (3) se descartan líneas vacías; (4) `awk '!seen[$0]++'` deduplica **conservando el orden de
primera aparición**. Como la variante expandida va primero, sus resultados aparecerán antes en el
menú.

Consecuencia central: **si la consulta no lleva macrones, las dos variantes salen idénticas y queda
una sola consulta**. No hay conversión inversa (`ou`→`o`) ni tabla de alias: si el usuario escribe
`Hero` en ASCII, no se genera `Hirou`.

#### 2.6 Claves de comparación

- `normalize_match_key` (`ani-cli-mx-core:619-621`):
  ```sh
  normalize_romanized_text "$1" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]'
  ```
  Deja una cadena sin espacios ni signos, en minúsculas: `"Shingeki! Kyojin Chuugakkou"` →
  `"shingekikyojinchuugakkou"`.
- `normalize_match_words` (`ani-cli-mx-core:623-626`):
  ```sed
  s/[^[:alnum:]]\+/ /g; s/^ *//; s/ *$//; s/[[:space:]][[:space:]]*/ /g
  ```
  Tras romanizar y bajar a minúsculas: todo lo que no sea alfanumérico pasa a espacio, se recortan los
  extremos y se colapsan espacios. `"Shingeki! Kyojin Chuugakkou"` → `"shingeki kyojin chuugakkou"`.
  **No deduplica palabras.**

#### 2.7 Ejemplo paso a paso: `"Shingeki no Kyojin"`

Camino A (argumento): `ani-cli-mx -t anime "Shingeki no Kyojin"`.

1. `ani-cli-mx-core:4712` acumula el posicional: `query="Shingeki+no+Kyojin"`.
2. `ani-cli-mx-core:4756` deja `app_state="search_results"`; no hay menús.
3. `ani-cli-mx-core:4823`: `sed 's| |+|g'` sobre algo sin espacios → `encoded_query="Shingeki+no+Kyojin"`.
4. `ani-cli-mx-core:4825`: `search_anime "Shingeki+no+Kyojin"`.
5. `ani-cli-mx-core:3011` → `search_animeav1_variants "Shingeki+no+Kyojin"` →
   `ani-cli-mx-core:1547` → `search_query_candidates_from_text "Shingeki+no+Kyojin"`:
   - `ani-cli-mx-core:610` `sed 's|+| |g'` → `"Shingeki no Kyojin"`;
   - `ani-cli-mx-core:612` `normalize_romanized_text` → **identidad** (ni macrones ni acentos);
   - `ani-cli-mx-core:601` `compact_search_query` → `"Shingeki+no+Kyojin"`;
   - `ani-cli-mx-core:614` `normalize_romanized_text_plain` → misma cadena → `awk` la deduplica;
   - resultado: **una sola candidata**, `"Shingeki+no+Kyojin"`.
6. `ani-cli-mx-core:1745` construye `.../catalogo?search=Shingeki+no+Kyojin`; el parser
   `ani-cli-mx-core:1747` devuelve pares `slug<TAB>título`.
7. Igual para jkanime (`ani-cli-mx-core:1535`, `?q=Shingeki+no+Kyojin`), anidb
   (`ani-cli-mx-core:3020`) y animex (`ani-cli-mx-core:3024`).
8. `ani-cli-mx-core:3012-3027` prefija y concatena en el orden animeav1 → jkanime → anidb → animex.

Camino B (interactivo): idéntico desde el paso 3, porque `ani-cli-mx-core:4823` es la única línea que
convierte espacios en `+` (`search_query_menu` devolvió `"Shingeki no Kyojin"` con espacios,
`ani-cli-mx-core:174`).

Contraste con macrones: `"Boku no Hīrō Akademia"` → candidata 1
`"Boku+no+Hiirou+Akademia"` (`ī`→`ii`, `ō`→`ou`), candidata 2
`"Boku+no+Hiro+Akademia"`. Se piden las dos, en ese orden, y se unen los resultados
(`ani-cli-mx-core:612-616`).

**Pérdida conocida (deducción):** un `+` literal escrito por el usuario se destruye. `"c++"` →
`ani-cli-mx-core:4823` (sin espacios, sin cambio) → `ani-cli-mx-core:610` convierte los `+` en espacios
→ `"c  "` → `ani-cli-mx-core:601` colapsa y recorta → `"c"`. La codificación de espacios y el carácter
`+` comparten representación.

---

### 3. Variantes de búsqueda

Las tres funciones son el mismo patrón: iterar las candidatas de
`search_query_candidates_from_text` y unir resultados.

`search_hentaila_variants` (`ani-cli-mx-core:1463-1471`):

```sh
for variant_query in $(search_query_candidates_from_text "$1"); do
    current_results="$(search_hentaila "$variant_query")"
    [ -n "$current_results" ] && variant_results="${variant_results}${current_results}
"
done
printf '%s' "$variant_results" | sed '/^$/d' | stable_unique_lines
```

`search_jkanime_variants` (`ani-cli-mx-core:1540-1544`) y `search_animeav1_variants`
(`ani-cli-mx-core:1546-1550`) son idénticas entre sí salvo la función base:

```sh
for candidate_query in $(search_query_candidates_from_text "$1"); do
    search_jkanime "$candidate_query"        # o search_animeav1
done | awk '!seen[$0]++'
```

De dónde salen las variantes:

- **No hay fichero de alias ni tabla de sinónimos.** Una búsqueda de `alias` en todo el fichero no
  devuelve ninguna coincidencia; el único generador de variantes es
  `search_query_candidates_from_text` (`ani-cli-mx-core:609`).
- **No hay expansión por temporadas** en la consulta: las temporadas se usan solo para puntuar
  (§5), no para generar consultas.
- Son exactamente **dos** candidatas como máximo (macrón expandido y macrón simple,
  `ani-cli-mx-core:612-614`), y una sola si la consulta es ASCII puro.
- Orden de prueba: el del `awk '!seen[$0]++'`, es decir la variante expandida primero
  (`ani-cli-mx-core:612`), la simple después (`ani-cli-mx-core:614`).
- Deduplicación de resultados: `stable_unique_lines` (`ani-cli-mx-core:2070-2086`) para Hentaila y
  `awk '!seen[$0]++'` para jkanime/animeav1. Ambas conservan la **primera** aparición, así que los
  aciertos de la variante expandida quedan antes.

**Asimetría importante**: en la ruta de resolución de slug, `select_animeav1_slug` llama a
`search_animeav1` con **una sola** consulta, re-codificada a `+`
(`ani-cli-mx-core:1761`), mientras que `select_jkanime_slug` usa `search_jkanime_variants`
(`ani-cli-mx-core:1563`). Es decir, la expansión de variantes se aplica al listado de resultados y a
la re-identificación en JKAnime, pero no a la re-identificación en AnimeAV1.

Fuera del `auto`, `search_anime_for_source` (`ani-cli-mx-core:2975-2996`) envía la consulta sin
expandir a anidb (`?q=$1`, `ani-cli-mx-core:2094`) y a animex, cuya única transformación es
`s|+| |g; s|["\\]| |g` (`ani-cli-mx-core:2183`) y un `limit:12` en el GraphQL
(`ani-cli-mx-core:2184-2186`) — el único recorte de resultados explícito en todo el pipeline.

---

### 4. Temporadas y pistas

#### 4.1 `extract_season_hint` (`ani-cli-mx-core:628-650`)

Trabaja sobre `normalized_words=" $(normalize_match_words "$1") "` (con espacios de relleno, que es
lo que hace posible el patrón de una sola letra). Transcripción literal:

```sed
s|.* season ([0-9]+) .*|\1|p
s|.* ([0-9]+)(st|nd|rd|th) season .*|\1|p
s|.* temporada ([0-9]+) .*|\1|p
s|.* ([0-9]+)(a|da|ra) temporada .*|\1|p
s|.* part ([0-9]+) .*|\1|p
s|.* cour ([0-9]+) .*|\1|p
s|.* stage ([0-9]+) .*|\1|p
s|.* s([0-9]+) .*|\1|p
```

seguido de `head -n1` (`ani-cli-mx-core:639`): se imprimen todas las sustituciones que casen y se
toma la **primera en orden de script**, es decir la precedencia es
`season` > `Nth season` > `temporada` > `Na temporada` > `part` > `cour` > `stage` > `sN`.
`.*` es codicioso, así que gana la última aparición dentro del texto.

Si nada casa, un `case` reconoce formas sin número (`ani-cli-mx-core:642-649`): `first season`,
`primera temporada`, `ichi gakki` → 1; `second season`, `segunda temporada`, `2nd season`,
`2da temporada`, `2a temporada`, `ni gakki` → 2; y análogos para 3 (`third`/`tercera`/`3rd`/`3ra`/`3a`/
`san gakki`), 4 (`fourth`/`cuarta`/`4th`/`4ta`/`4a`/`yon gakki`) y 5
(`fifth`/`quinta`/`5th`/`5ta`/`5a`/`go gakki`). Si no, `return 1` (`ani-cli-mx-core:648`).

Detalle: `2nd season` casa antes en el `sed` (`ani-cli-mx-core:632`) que en el `case`
(`ani-cli-mx-core:644`); el `sed` gana.

#### 4.2 `extract_slug_season_hint` (`ani-cli-mx-core:652-667`)

Primero `tr '[:upper:]' '[:lower:]'` (`ani-cli-mx-core:653`) y luego:

```sed
s#.*[-_/]s([0-9]+)$#\1#p
s#.*[-_/](1st|2nd|3rd|4th|5th)[-_/]season$#\1#p
s#.*[-_/]season[-_/]?([0-9]+)$#\1#p
s#.*[-_/]part[-_/]?([0-9]+)$#\1#p
s#.*[-_/]([1-9])$#\1#p
```

y después un segundo `sed` que normaliza los ordinales ingleses (`s/^1st$/1/` … `s/^5th$/5/`,
`ani-cli-mx-core:660-666`), con `head -n1` final.

Formatos reconocidos (con `/`, `-` o `_` como separador): `...-s2`; `...-2nd-season`; `...-season-3` y
`...-season3`; `...-part-2` y `...-part2`; y un **dígito único 1-9 al final tras separador**
(`...-2`, `...-4`). Nota: `s01` produce la cadena `01`, sin quitar el cero
(`ani-cli-mx-core:655`), que no casará con una pista de consulta `1` (deducción).

Uso combinado en la puntuación (`ani-cli-mx-core:747-750`): para la consulta se intenta primero
`extract_season_hint "$query_context"` y, si no hay, `extract_slug_season_hint "${id#*:}"` (el `id`
sin el prefijo `sitio:`); para el candidato, `extract_season_hint "$candidate_context"` y si no
`extract_slug_season_hint "$candidate_id"` (el slug desnudo).

---

### 5. Puntuación y desambiguación

#### 5.1 `match_token_overlap_score` (`ani-cli-mx-core:669-680`)

```sh
query_words="$(normalize_match_words "$1")"
candidate_words=" $(normalize_match_words "$2") "
overlap_score=0
for word in $query_words; do
    [ "${#word}" -lt 3 ] && continue
    case "$candidate_words" in
        *" $word "*) overlap_score=$((overlap_score + 35)) ;;
    esac
done
```

- Palabras de **menos de 3 caracteres se ignoran** (no puntúan ni penalizan).
- Coincidencia **exacta de palabra completa** (el candidato va rodeado de espacios, y cada palabra de
  la consulta busca `" $word "`): **35 puntos por cada ocurrencia**, incluidas palabras genéricas y
  repetidas.
- Sin coincidencia parcial: `kyojin` no casa con `kyojinchuugakkou`.

#### 5.2 `match_word_is_generic` (`ani-cli-mx-core:682-691`)

```sh
case "$1" in
    a | an | and | the | of | no | ni | to | de | del | la | las | el | los | y | en | un | una) return 0 ;;
    season | temporada | movie | pelicula | film | ova | special | specials | episode | episodio) return 0 ;;
    part | cour | stage | first | second | third | fourth | fifth | primera | segunda | tercera | cuarta | quinta) return 0 ;;
    school | gakki | sub | dub) return 0 ;;
    1st | 2nd | 3rd | 4th | 5th | 1ra | 2da | 3ra | 4ta | 5ta | 1a | 2a | 3a | 4a | 5a) return 0 ;;
    *) return 1 ;;
esac
```

Lista cerrada: artículos y preposiciones (en inglés y español), palabras de formato
(`season`, `temporada`, `movie`, `pelicula`, `film`, `ova`, `special(s)`, `episode`, `episodio`),
partes (`part`, `cour`, `stage`, ordinales 1º-5º en inglés y español), `school`, `gakki`, `sub`,
`dub`, y los ordinales abreviados. Todo en minúsculas ya, porque el llamador normaliza.

#### 5.3 `count_distinctive_query_words` (`ani-cli-mx-core:693-702`) y `count_distinctive_overlap` (`ani-cli-mx-core:704-716`)

Ambas recorren **todas** las palabras de la consulta (sin deduplicar) y cuentan solo las que pasan dos
filtros: longitud ≥ 3 (`ani-cli-mx-core:697`, `ani-cli-mx-core:709`) y no genéricas
(`ani-cli-mx-core:698`, `ani-cli-mx-core:710`). La primera cuenta cuántas hay; la segunda, cuántas
aparecen en el candidato (mismo `case` de palabra completa).

#### 5.4 `title_match_score` (`ani-cli-mx-core:718-768`)

```sh
query_key="$(normalize_match_key "$query_title")"
candidate_key="$(normalize_match_key "$candidate_title")"
query_context="$(normalize_match_words "$query_title $(printf '%s' "$id" | tr ':|_-' '     ')")"
candidate_context="$(normalize_match_words "$candidate_title $(printf '%s' "$candidate_id" | tr ':|_-' '     ')")"
```

Detalle crítico: el contexto de la **consulta** no se construye con un parámetro, sino con el global
`$id` (`ani-cli-mx-core:724`), y `$id` ya viene prefijado (`jkanime:shingeki-no-kyojin`). Por tanto el
contexto de la consulta contiene el **título duplicado** (una vez como título y otra descompuesta del
slug) **más la palabra del sitio** (`jkanime`, `animeav1`, `anidb` o `animex`), que el candidato nunca
contiene. El contexto del candidato duplica igual el título (`ani-cli-mx-core:725`).

Componentes de la puntuación, en orden:

1. **Coincidencia exacta de clave**: `+1000` (`ani-cli-mx-core:728`).
2. **La clave del candidato contiene la de la consulta**: `+400` (`ani-cli-mx-core:729-731`).
3. **La clave de la consulta contiene la del candidato**: `+200` (`ani-cli-mx-core:732-734`).
   Los tres son acumulativos y **no excluyentes**: una coincidencia exacta suma 1000+400+200 = 1600.
4. **Solape de palabras**: `+35` por palabra del contexto de la consulta presente en el candidato
   (`ani-cli-mx-core:736`).
5. **Palabras distintivas**: si la consulta tiene alguna (`>0`), entonces
   `+120` por cada solape distintivo (`ani-cli-mx-core:741`) o **`-1500` si no hay ningún solape
   distintivo** (`ani-cli-mx-core:743`). Este es el castigo duro del algoritmo.
6. **Temporada** (`ani-cli-mx-core:747-765`):
   - Si la consulta tiene pista de temporada: `+350` si coincide, `-900` si el candidato tiene otra
     distinta, `-450` si el candidato no tiene ninguna.
   - Si la consulta no tiene pista pero el candidato sí: `+60` si es la temporada `1`, `-260` en
     cualquier otro caso.
   - Si ninguno tiene pista: nada.

Umbral: `cross_source_match_is_confident "$1"` exige `[ "$1" -ge 140 ]` y además no vacío
(`ani-cli-mx-core:770-773`). Con el castigo de `-1500`, un candidato sin ninguna palabra distintiva en
común **nunca** alcanza el umbral; con al menos un solape distintivo (35 y 120 por cada repetición)
sí puede, incluso sin coincidencia de clave.

#### 5.5 Ejemplo numérico (aritmética del código, no de la red)

Consulta: título `"Shingeki no Kyojin"`, `$id = "jkanime:shingeki-no-kyojin"`.
Contextos:
`query_context = "shingeki no kyojin jkanime shingeki no kyojin"`;
candidato A `("shingeki-no-kyojin", "Shingeki no Kyojin")` →
`candidate_context = "shingeki no kyojin shingeki no kyojin"`.

| Término | Candidato A | Candidato B (`shingeki-no-kyojin-2`, `Shingeki no Kyojin 2`) | Candidato C (`shingeki-kyojin-chuugakkou`, `Shingeki! Kyojin Chuugakkou`) |
|---|---|---|---|
| Clave exacta | 1000 | 0 | 0 |
| Candidato contiene consulta | 400 | 400 | 0 |
| Consulta contiene candidato | 200 | 0 | 0 |
| Solape (35 × palabras ≥3) | 4 × 35 = 140 | 4 × 35 = 140 | 4 × 35 = 140 |
| Distintivas (120 × solape) | 4 × 120 = 480 | 4 × 120 = 480 | 4 × 120 = 480 |
| Temporada | 0 (ninguno) | −260 (`...-2`, `ani-cli-mx-core:659`) | 0 |
| **Total** | **2220** | **760** | **620** |

Palabras de la consulta con longitud ≥3: `shingeki`, `kyojin`, `jkanime`, `shingeki`, `kyojin`
(`no` ×2 se descartan por medir 2). El sitio (`jkanime`) es distintivo y nunca aparece en el
candidato: infla el recuento de distintivas de la consulta (5) sin poder sumar solape.

**Consecuencia (deducción):** el solape se cuenta por **ocurrencia**, no por palabra única, porque el
contexto del título está duplicado (`ani-cli-mx-core:724-725`). Con una sola palabra distintiva que
coincida dos veces, el total es 2×35 + 2×120 = 310 ≥ 140 → "confianza" suficiente aunque la clave no
se contenga y el resto del título no aparezca. Un candidato como `Kyojin Chuugakkou` para
`Shingeki no Kyojin` obtendría 310 y sería aceptado. El corte duro solo se activa con solape
distintivo **cero** (`ani-cli-mx-core:743`): p. ej. una consulta sin ninguna palabra en común con el
candidato suma como mucho los 35 de alguna coincidencia suelta y −1500, quedando muy por debajo de
140.

**Empates:** los cuatro selectores comparan con `-gt` estricto
(`ani-cli-mx-core:1577`, `ani-cli-mx-core:1774`, `ani-cli-mx-core:2127`, `ani-cli-mx-core:2220`), así
que **en empate gana el primero de la lista**, y la lista está ordenada por: variante de consulta
(expandida antes que simple, `ani-cli-mx-core:612-614`) y luego orden de aparición en la página del
sitio. No hay criterio de desempate adicional (salvo el `+100` de JKAnime descrito abajo).

---

### 6. Elección de resultado

#### 6.1 Listado y presentación

`prefix_search_results` (`ani-cli-mx-core:840-853`) convierte cada par `id<TAB>título` en tres campos:
`sitio:id<TAB>título<TAB>título [Etiqueta]`, descartando entradas sin id o sin título
(`ani-cli-mx-core:848-849`). `info_source_label` (`ani-cli-mx-core:902-912`) da la etiqueta
(`JKAnime`, `AnimeAV1`, `AniDB`, `AnimeX`, `Hentaila`).

`build_media_menu` (`ani-cli-mx-core:855-874`) numera secuencialmente y añade el idioma según el
prefijo: `pelisplus:*` → `[ESPAÑOL/LATINO]`, `anidb:*` y `animex:*` → `[ENGLISH]`, el resto →
`[ESPAÑOL]` (`ani-cli-mx-core:862-864`). Después **siempre** añade tres filas de navegación:
`__nav_search` ("Buscar de nuevo"), `__nav_home` ("Volver al inicio") y `__nav_exit` ("Salir")
(`ani-cli-mx-core:868-873`). `build_anime_menu` es un alias de `build_media_menu`
(`ani-cli-mx-core:876-878`).

`title_for_anime_id` (`ani-cli-mx-core:880-889`) relee la lista **sin numerar** (los campos de
`prefix_search_results`) y devuelve el campo 2 (el título desnudo) del id elegido. En el flujo, el id
sale del menú (`result_id`, `ani-cli-mx-core:4847`) y el título se recupera con esta función
(`ani-cli-mx-core:4855`); si fallara, el respaldo es el campo 2 de la línea del menú, ya con el idioma
y la etiqueta (`ani-cli-mx-core:4856`). Ese título es el que después usa todo el pipeline de
resolución (`ani-cli-mx-core:4911`, `ani-cli-mx-core:2496-2499`).

#### 6.2 ¿Automático o interactivo?

- **El menú de resultados es siempre interactivo**: `nth` solo auto-selecciona cuando la entrada tiene
  **exactamente una línea** y `force_menu_selection != 1` (`ani-cli-mx-core:185-186`). Como
  `build_media_menu` añade incondicionalmente tres filas de navegación
  (`ani-cli-mx-core:868-873`), el menú de resultados tiene **cuatro o más líneas siempre**, de modo que
  el atajo de una línea nunca se dispara aquí (deducción a partir de ambas líneas). El atajo sí aplica
  a otros menús de una sola opción (p. ej. calidad).
- **Atajo no interactivo**: con `-S/--select-nth N` (`ani-cli-mx-core:4652-4656`) se toma directamente
  la línea `N` de la lista de resultados, sin menú (`ani-cli-mx-core:4834-4836`). El índice cuenta
  líneas de la lista cruda, que coinciden con la numeración de `build_media_menu` para los resultados.
- **Cancelaciones**: código 10 vuelve atrás (a la consulta, `ani-cli-mx-core:4842-4845`), 130 sale
  (`ani-cli-mx-core:4841`). `__nav_*` se despachan por el id (`ani-cli-mx-core:4848-4852`).
- **Sin resultados**: en la ruta anime se llama a `diagnose_empty_search`
  (`ani-cli-mx-core:4826`), que sondea los endpoints de AnimeAV1 y JKAnime para distinguir "no hay
  red/TLS/proxy" de "no hay resultados", y termina siempre en `die` (`ani-cli-mx-core:544-556`). Si el
  tipo no es anime, `die` directo (`ani-cli-mx-core:4829`).

#### 6.3 Los cuatro selectores: automáticos y con umbral

`select_jkanime_slug` (`ani-cli-mx-core:1552-1588`), `select_animeav1_slug`
(`ani-cli-mx-core:1750-1785`), `select_anidb_ref` (`ani-cli-mx-core:2102-2135`) y
`select_animex_ref` (`ani-cli-mx-core:2197-2228`) comparten forma:

1. **Slug/ref explícito del `id`**: si el `id` es de esa fuente, se usa su valor sin buscar
   (`ani-cli-mx-core:1553-1558`, `ani-cli-mx-core:1751-1756`, `ani-cli-mx-core:2107-2113`,
   `ani-cli-mx-core:2201-2207`).
2. **Caché de sesión** por `"$1|$id"` (título + id), `ani-cli-mx-core:1560-1561`,
   `ani-cli-mx-core:1758-1759`, `ani-cli-mx-core:2103-2105`, `ani-cli-mx-core:2198-2200`.
3. **Búsqueda y recorrido lineal** de todos los resultados puntuando con `title_match_score`,
   quedándose con el mejor (**estrictamente mayor**, primero en caso de empate):
   `ani-cli-mx-core:1571-1578`, `ani-cli-mx-core:1769-1775`, `ani-cli-mx-core:2122-2128`,
   `ani-cli-mx-core:2216-2221`.
4. **Umbral**: `cross_source_match_is_confident "$best_score" || return 1`
   (`ani-cli-mx-core:1581`, `ani-cli-mx-core:1778`, `ani-cli-mx-core:2130`,
   `ani-cli-mx-core:2223`). Si no llega a 140, **la fuente se descarta** (no se pregunta al usuario).
5. **Respaldo**: si `best_slug` quedase vacío se toma el primero de la lista
   (`ani-cli-mx-core:1582`, `ani-cli-mx-core:1779`); en anidb/animex simplemente `return 1`
   (`ani-cli-mx-core:2131`, `ani-cli-mx-core:2224`).
6. Guardado en caché del resultado (`ani-cli-mx-core:1585-1587`, `ani-cli-mx-core:1782-1784`,
   `ani-cli-mx-core:2132-2134`, `ani-cli-mx-core:2225-2227`).

Diferencias entre ellos:

- JKAnime añade `+100` si el slug coincide con el global `$id` (`ani-cli-mx-core:1576`). Como `$id`
  viene prefijado (`jkanime:slug`) y el slug es desnudo, la comparación rara vez puede darse
  (deducción); sería efectiva solo con un `id` sin prefijo.
- JKAnime busca con las **dos variantes** (`ani-cli-mx-core:1563`); AnimeAV1 con una sola, y la
  re-codifica a `+` (`ani-cli-mx-core:1761`); AniDB con una sola, `+` (`ani-cli-mx-core:2115`); AnimeX
  con la consulta tal cual (`ani-cli-mx-core:2209`), que su buscador ya trata como texto
  (`ani-cli-mx-core:2183`).
- Quién los usa: `select_jkanime_slug` desde `episodes_list_jkanime` (`ani-cli-mx-core:3256`) y
  `resolve_jkanime_episode` (`ani-cli-mx-core:1737`); `select_animeav1_slug` desde
  `episodes_list_animeav1` (`ani-cli-mx-core:3092`) y `resolve_animeav1_episode`
  (`ani-cli-mx-core:2043`); `select_anidb_ref` desde `anidb_episode_maps` (`ani-cli-mx-core:2139`);
  `select_animex_ref` desde `episodes_list_animex` (`ani-cli-mx-core:2232`) y
  `resolve_animex_episode` (`ani-cli-mx-core:2466`).
- Todos reciben **el título desnudo** como consulta (el `$title` de `ani-cli-mx-core:4855`), no el id
  ni el texto originalmente tecleado: la consulta del usuario se pierde tras elegir en el menú. La
  siguiente búsqueda usa el título del resultado elegido.

Resumen de la decisión: **la elección del contenido ante el usuario es interactiva** (o forzada con
`-S`), y **la elección del slug por fuente es automática con umbral**, usada como
re-identificación entre fuentes al listar episodios y al resolver enlaces.

---

### 7. Fuentes y prioridad

#### 7.1 Normalización y etiquetas

`normalize_info_source` (`ani-cli-mx-core:891-900`): minúsculas y luego
`"" | auto` → `auto`; `jkanime | jk` → `jkanime`; `animeav1 | av1` → `animeav1`;
`anidb | ani-db | english` → `anidb`; `animex | anime-x` → `animex`; cualquier otra cosa → `return 1`
(el llamador hace `die`, `ani-cli-mx-core:4558`, `ani-cli-mx-core:4694-4695`). Hentaila **no** tiene
clave aquí: solo se activa con el argumento oculto `-ha` (`ani-cli-mx-core:4547`).

`info_source_label` (`ani-cli-mx-core:902-912`) da el nombre mostrable; `site_name_from_ref`
(`ani-cli-mx-core:775-787`) extrae el prefijo del `id` (`pelisplus:`, `hentaila:`, `jkanime:`,
`animeav1:`, `anidb:`, `animex:`) y falla para cualquier otra cosa; `source_key_from_label`
(`ani-cli-mx-core:914-920`) hace lo inverso solo para JKAnime y AnimeAV1.

#### 7.2 Qué es "fuente española"

`is_spanish_source` (`ani-cli-mx-core:922-927`): **solo** `jkanime` y `animeav1`. Es la definición que
usan tanto el sembrado de fast mode como la selección interactiva de fuente.

#### 7.3 Fast mode: sembrar y desactivar

`seed_fast_mode_source` (`ani-cli-mx-core:929-943`):

```sh
[ "$fast_mode" = "1" ] || return 0
[ -n "$fast_mode_source" ] && return 0
selected_fast_source="$(site_name_from_ref "$id" 2>/dev/null || true)"
if ! is_spanish_source "$selected_fast_source" && is_spanish_source "$preferred_info_source"; then
    selected_fast_source="$preferred_info_source"
fi
is_spanish_source "$selected_fast_source" || return 0
```

Es decir: en fast mode se fija la fuente del `id` elegido; si esa no es española pero
`--source`/`ANI_CLI_INFO_SOURCE` sí lo es, se usa esa; cualquier otra combinación no siembra nada. Si
siembra, guarda `preferred_spanish_site` con la etiqueta y calcula la lista de episodios
(`ani-cli-mx-core:940-942`).

`source_is_disabled` (`ani-cli-mx-core:945-950`) consulta la lista `disabled_spanish_sources` con
búsqueda con espacios de relleno; `disable_spanish_source` (`ani-cli-mx-core:952-962`) la añade, y si
la fuente desactivada era la de fast mode, la limpia y **recalcula** `ep_list` con
`episodes_list "$id" "$title"`.

#### 7.4 `source_status`

`source_status` (`ani-cli-mx-core:1003-1010`) es un **impresor de estado en stderr** para la
resolución de enlaces, con cuatro estados: `ok` (verde, "Links Fetched"), `fallback` (amarillo,
"Fallback Only"), `skip` (rojo, "No Valid Link") y `disabled`, que **no imprime nada**
(`ani-cli-mx-core:1008`). Sus usos están en la resolución de mirrors (p. ej.
`ani-cli-mx-core:1655`, `ani-cli-mx-core:1702`, `ani-cli-mx-core:1947`), no en la búsqueda. La
distinción `disabled` silenciosa es la que evita ruido cuando el usuario ya desactivó una fuente.

#### 7.5 Orden de fuentes

- **Búsqueda de catálogo** (`auto`): animeav1 → jkanime → anidb → animex
  (`ani-cli-mx-core:3011-3026`). AnimeAV1 va primero por eso.
- **Lista de episodios** (`auto`): primero la fuente del `id` (`selected_site`), luego
  animeav1, jkanime, anidb, animex (`ani-cli-mx-core:3424-3430`).
- **Enlaces** (`get_episode_url`): pelisplus → hentaila → AniDB autoritativo → AnimeX autoritativo →
  fast mode → jkanime → animeav1 → elección interactiva → respaldo inglés AniDB → AnimeX
  (`ani-cli-mx-core:2849-2965`).
- **Elección interactiva entre fuentes españolas**: `pick_spanish_source_links`
  (`ani-cli-mx-core:1231-1257`) construye las opciones con `available_site_entries`
  (`ani-cli-mx-core:1196-1208`, orden fijo JKAnime, AnimeAV1, y solo las que tienen enlaces:
  `count_quality_links > 0`). Si hay una fuente preferida de la sesión y está disponible, se usa sin
  preguntar (`ani-cli-mx-core:1236-1237`); si **solo hay una** disponible, se elige sola
  (`ani-cli-mx-core:1240-1241`); si hay varias, se pregunta (`ani-cli-mx-core:1243`). `set_links_for_site`
  (`ani-cli-mx-core:1210-1229`) fija `links`, `selected_spanish_site` y `preferred_spanish_site`, y en
  fast mode siembra `fast_mode_source`/`fast_mode_ep_list`.
- **Reinicio por sesión**: `reset_provider_session_selection` limpia fuente, lista y deshabilitadas al
  elegir contenido nuevo (`ani-cli-mx-core:4761-4768`, llamado en `ani-cli-mx-core:4858` y
  `ani-cli-mx-core:4899`).

---

### Receta replicable

Pasos a implementar para reproducir el comportamiento, en lenguaje neutral:

1. **Pedir el tipo de contenido antes que la consulta**, con opciones cerradas (anime / película /
   serie / dorama) y navegación de vuelta; reiniciar la consulta al cambiar de tipo.
2. **Pedir una consulta de texto libre**, sin autocompletado ni sugerencias, con cancelación distinta
   para "volver" y "salir"; ignorar consultas vacías.
3. **Codificar los espacios como `+` en un único punto** del flujo, y decidir explícitamente si se
   permite un `+` literal en la consulta (aquí no: se pierde).
4. **Convertir `+` de vuelta a espacio** al entrar en cualquier función de normalización o de consulta
   a un sitio.
5. **Definir dos normalizaciones de texto**: una que expanda los macrones a vocal doble
   (ā→aa, ē→ei, ī→ii, ō→ou, ū→uu) y otra que los reduzca a vocal simple, y en ambas reducir los
   acentos latinos a la letra base, `ç`→`c` y `ñ`→`n`; sin bajar a minúsculas en esta fase.
6. **Generar como máximo dos variantes de consulta** (la expandida primero, la simple después),
   descartando vacías y duplicados conservando el orden; no inventar alias ni transliteración inversa.
7. **Consultar cada fuente con cada variante en orden** y concatenar los resultados, deduplicando por
   línea con "primera aparición gana", de modo que los aciertos de la variante expandida queden antes.
8. **Etiquetar cada resultado con su fuente** en el identificador (`fuente:slug`), exigir id y título
   no vacíos, y conservar el título desnudo por separado del texto mostrado.
9. **En la búsqueda agregada, recorrer las fuentes en orden fijo** (españolas primero, luego las
   inglesas) sin deduplicar entre fuentes y sin reordenar por puntuación.
10. **Construir el menú numerado** conservando el orden, añadiendo una etiqueta de idioma derivada del
    prefijo de la fuente y **filas de navegación fijas** ("buscar de nuevo", "inicio", "salir"); que la
    navegación sea siempre la última.
11. **No auto-seleccionar** cuando el menú tenga más de una opción (y tener en cuenta que las filas de
    navegación cuentan como opciones, así que un único resultado nunca se auto-selecciona); permitir
    forzar el índice por parámetro para saltarse el menú.
12. **Recuperar el título desnudo del resultado elegido** y usarlo como consulta para todo lo demás;
    la consulta original tecleada deja de usarse.
13. **Definir dos funciones de clave**: una sin espacios ni signos (todo junto) para comparaciones
    exactas o de contención, y otra en palabras separadas por espacio, ambas en minúsculas, para
    solapes. No deduplicar palabras en la segunda.
14. **Construir el contexto de comparación** como título + identificador descompuesto en palabras, en
    los dos lados, aceptando conscientemente que las palabras del título se cuentan dos veces.
15. **Puntuar con una suma acumulativa**: coincidencia exacta 1000, candidato contiene consulta 400,
    consulta contiene candidato 200, 35 por palabra (≥3 caracteres) del contexto presente en el
    candidato, y si la consulta tiene palabras distintivas (≥3 caracteres y no genéricas)
    120 por cada solape distintivo o **−1500 si no hay ninguno**.
16. **Mantener una lista cerrada de palabras genéricas** (artículos, preposiciones, "season",
    "temporada", "movie", "part", "cour", "school", "gakki", "sub", "dub", ordinales) y excluirlas solo
    del recuento de distintivas, no del solape general.
17. **Extraer la pista de temporada** de la consulta y del candidato: primero por palabras clave con
    número (con precedencia fija season > Nth season > temporada > Na temporada > part > cour > stage >
    sN), después por formas escritas (first/primera/ichi gakki…), y si no, por el slug
    (`-sN`, `-Nth-season`, `-seasonN`, `-partN`, dígito final 1-9).
18. **Ajustar por temporada**: +350 si coinciden, −900 si difieren, −450 si el candidato no tiene y la
    consulta sí; +60 si el candidato es la temporada 1 sin pista en la consulta, −260 si es otra.
19. **Elegir el máximo con comparación estricta** (en empate gana el primer resultado de la lista, es
    decir el de la variante expandida y luego el orden del sitio) y **descartar la fuente entera** si
    el mejor no alcanza 140.
20. **Cachear la decisión por (título, identificador)** y reutilizarla al listar episodios y al
    resolver enlaces, de modo que la re-identificación se haga una sola vez por título y sesión.
21. **Ordenar la prioridad de fuentes en tres sitios independientes**: búsqueda de catálogo
    (españolas en un orden fijo, luego inglesas), lista de episodios (primero la fuente del
    identificador y después el orden fijo) y resolución de enlaces (españolas → inglés de respaldo).
22. **Definir "fuente española" como una lista explícita** (aquí: jkanime y animeav1) y usarla para
    sembrar la fuente de la sesión rápida, para preferir una fuente si el identificador no es
    española, y para la elección interactiva.
23. **En la elección interactiva entre fuentes**, usar la preferida de la sesión si sigue disponible,
    elegir sola si solo hay una con enlaces y preguntar si hay varias; reiniciar esa preferencia y las
    deshabilitadas al cambiar de contenido.
24. **Al distinguir "sin red" de "sin resultados"**, sondear los buscadores antes de fallar, para no
    reportar "no encontrado" cuando el problema es de conectividad.

---

### Dudas

Todo lo siguiente queda **no verificado**: no se ejecutó `ani-cli-mx-core` (requiere mpv, yt-dlp,
curl-impersonate y red) ni se consultaron los sitios.

1. **Multibyte en los `sed`.** Las clases de caracteres de `ani-cli-mx-core:572-585` y
   `ani-cli-mx-core:589-597` contienen caracteres no ASCII dentro de expresiones de corchetes. No he
   podido comprobar el comportamiento de `sed` fuera de un locale UTF-8 (en locale C/POSIX el
   resultado sería distinto). Tampoco el de `[[:alnum:]]` en `ani-cli-mx-core:620` y
   `ani-cli-mx-core:625` con alfabetos no latinos (japonés, cirílico, hangul): si `[[:alnum:]]` los
   considera alfanuméricos, `normalize_match_key` los conservaría y `normalize_match_words` los
   trataría como palabras. Es dependiente del locale y no verificado.
2. **Caracteres no cubiertos.** No hay reglas para `Ø`, `Ł`, `Æ`, `Œ`, `ß`, `Đ`, `Š`, `Ž`, `Ý`, `Ć`,
   `Ą`, `Ę` ni para apóstrofos tipográficos, comillas curvas, guiones largos (`—`) o puntos suspensivos
   (`…`). Deduzco que quedan tal cual en la consulta enviada y que `normalize_match_words` los
   convierte en separadores (o los conserva como palabra, según el caso de `[:alnum:]`), pero no lo he
   verificado contra los sitios.
3. **Significado de `+` en cada buscador.** El pipeline envía `?search=Shingeki+no+Kyojin`
   (`ani-cli-mx-core:1745`) y `?q=...` (`ani-cli-mx-core:1535`). No he podido comprobar si cada sitio
   interpreta `+` como espacio, si además hace su propia normalización de macrones/acentos, ni si su
   buscador hace coincidencia parcial. Parte de esto es alcance de la parte B, pero condiciona la
   eficacia real de las variantes.
4. **`search_query_from_text` muerta.** Confirmado por búsqueda que solo se define
   (`ani-cli-mx-core:604`) y no se llama; se desconoce si fue un resto de una versión anterior o si
   algo la invoca desde fuera del fichero (no hay más ficheros de programa en el repositorio).
5. **Falsos positivos de `extract_season_hint`.** El patrón `.* s([0-9]+) .*`
   (`ani-cli-mx-core:638`) casa cualquier ` sN ` en el título normalizado. No he medido con títulos
   reales cuántas veces aparece esa secuencia sin ser una temporada.
6. **El `+100` de `select_jkanime_slug`.** `[ "$slug" = "$id" ]` compara un slug desnudo con el global
   `$id`, que en todos los flujos que he leído viene prefijado (`sitio:slug`,
   `ani-cli-mx-core:1553`, `ani-cli-mx-core:4853`). Deduzco que es inalcanzable en la práctica, pero no
   he agotado todos los caminos que fijan `$id`.
7. **Ceros a la izquierda en slugs.** `extract_slug_season_hint` devuelve la cadena tal cual
   (`s01` → `01`, `ani-cli-mx-core:655`), que no casa con una pista de consulta `1`. Deduzco un fallo
   de emparejamiento en esos casos; no verificado.
8. **Orden real de resultados por sitio.** El desempate depende del orden en que el sitio devuelve las
   coincidencias y de que el parser no las reordene. Solo puedo afirmar el orden del pipeline
   (variantes y concatenación), no el del sitio.
9. **`limit:12` de AnimeX** (`ani-cli-mx-core:2186`): no he comprobado si 12 resultados bastan para
   títulos ambiguos ni si ese límite puede excluir el candidato correcto antes de puntuar.
10. **Umbral 140 en casos límite.** La aritmética indica que basta una palabra distintiva repetida
    (310 puntos) o un solape de clave (200 sin distintivas compartidas) para superar el umbral. No he
    podido medir la tasa real de aciertos/errores; la comparación exacta de clave (1600) es el caso
    dominante esperado.
11. **Repetición en los contextos.** El castigo `-1500` y los multiplicadores por repetición dependen
    de que el título aparezca duplicado en el contexto (`ani-cli-mx-core:724-725`). Es una deducción
    directa del código, pero no verificada con datos: si en algún flujo `$id` fuese una cadena sin
    palabras del título (p. ej. un identificador numérico puro), el contexto de la consulta tendría
    menos palabras y las puntuaciones cambiarían.
12. **Título de respaldo.** En `ani-cli-mx-core:4856` el respaldo del título es el campo 2 de la línea
    del menú construido, que es la etiqueta con idioma y fuente, no el título desnudo. No he
    determinado en qué condiciones `title_for_anime_id` puede fallar (deduzco que solo si el id no
    estuviera en la lista sin numerar).
13. **`hentaila` sin variantes propias.** `search_hentaila_variants` (`ani-cli-mx-core:1463-1471`)
    usa el mismo generador `search_query_candidates_from_text`, así que hereda las dos variantes de
    macrones; no hay tratamiento específico por fuente. Tampoco he
    verificado el filtro `hentaila_result_allowed` (`ani-cli-mx-core:1446-1449`) más allá de su
    expresión regular.

---

## Parte B — ani-cli-mx: peticiones y parseo por fuente

Alcance: **la petición y la respuesta** de cada fuente de `ani-cli-mx-core` (5075 líneas de `/bin/sh`): URL exacta, método, parámetros, cabeceras, cookies/CSRF, prueba de trabajo, formato de respuesta y los bloques de parseo transcritos literalmente. Queda fuera la normalización de la consulta, las variantes de título y la puntuación (`normalize_romanized_text`, `search_query_candidates_from_text`, `title_match_score`): eso es la parte A. Toda línea se cita como `ani-cli-mx-core:<n>`; lo deducido se marca como deducción.

### Constantes de petición compartidas

| Qué | Valor | Cita |
|---|---|---|
| User-Agent general | `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0` | ani-cli-mx-core:4522 |
| User-Agent sólo para AniDB | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36` | ani-cli-mx-core:4523 |
| Cabeceras de Zilla (AnimeAV1 HLS) | `Origin:https://player.zilla-networks.com,Sec-Fetch-Dest:empty,Sec-Fetch-Mode:cors,Sec-Fetch-Site:same-origin` | ani-cli-mx-core:4535 |
| Base JKAnime | `https://jkanime.net` | ani-cli-mx-core:4536 |
| Base AnimeAV1 | `https://animeav1.com` | ani-cli-mx-core:4539 |
| Base HentaiLA | `https://hentaila.com` | ani-cli-mx-core:4542 |
| Base PelisPlusHD | `${ANI_CLI_PELISPLUS_URL:-https://pelisplushd.bz}` | ani-cli-mx-core:4543 |
| Base AniDB | `https://anidb.app` | ani-cli-mx-core:4524 |
| API REST de AnimeX | `https://pp.animex.one` | ani-cli-mx-core:4528 |
| GraphQL de AnimeX | `https://graphql.animex.one` | ani-cli-mx-core:4529 |
| Referrer/sitio de AnimeX | `https://animex.one` | ani-cli-mx-core:4530 |
| Proxy de espejo de AnimeX | `https://cx.aniwatchtv.site` con clave `10b06cdc1ca48c9fb0b94af97cc040cf` | ani-cli-mx-core:4531, ani-cli-mx-core:4532 |
| `resolver_timeout` por defecto | `15` s (`ANI_CLI_RESOLVER_TIMEOUT`) | ani-cli-mx-core:4554 |
| `pelisplus_resolver_timeout` | `45` s por defecto | ani-cli-mx-core:4556 |
| `pelisplus_probe_timeout` | `45` s por defecto | ani-cli-mx-core:4557 |
| Directorio de estado (`hist_dir`) | `default_hist_dir()`: `LOCALAPPDATA/<nombre>` en Windows, si no `${XDG_STATE_HOME:-$HOME/.local/state}/<nombre>` | ani-cli-mx-core:4611, ani-cli-mx-core:345-351 |
| Directorio de caché (`default_cache_dir`) | `LOCALAPPDATA/<nombre>/cache` o `${XDG_CACHE_HOME:-$HOME/.cache}/<nombre>` | ani-cli-mx-core:353-359 |

Deducción: `default_cache_dir` **no se invoca en ningún punto del script** (búsqueda de `default_cache_dir` sólo devuelve su definición, ani-cli-mx-core:353). Todo lo que se persiste en disco vive bajo `hist_dir`.

---

### JKAnime

JKAnime tiene **dos caminos independientes**: una búsqueda directa por HTML y un **catálogo de episodios paginado con caché en disco** cuya puerta de entrada son dos peticiones POST autenticadas con CSRF.

#### Transporte y búsqueda

| Qué | Valor | Cita |
|---|---|---|
| URL base | `https://jkanime.net` | ani-cli-mx-core:4536 |
| Función de transporte | `jkanime_request()` (ani-cli-mx-core:466) | ani-cli-mx-core:466-487 |
| Método | `curl -f -L … -o <tmp> -w '%{http_code}'`; el método HTTP lo fija el llamante con `$@` (GET por defecto, `-X POST` en el catálogo) | ani-cli-mx-core:475-476 |
| Tiempos | `--connect-timeout 10 --max-time $resolver_timeout` (15 s) | ani-cli-mx-core:475 |
| Cabecera | `-A "$agent"` (Firefox 121) | ani-cli-mx-core:476 |
| Cookies | sólo si el llamante pasa `-b`/`-c`; la búsqueda no las usa | ani-cli-mx-core:476 |
| `-f` | Convierte cualquier HTTP ≥ 400 en salida distinta de cero, así que el `if` de ani-cli-mx-core:475 sólo entra en 2xx/3xx | ani-cli-mx-core:475 |
| Back-off persistente | Fichero `$hist_dir/jkanime-blocked-until`; si contiene un epoch futuro, la petición **no se envía** y devuelve 1 | ani-cli-mx-core:469-473 |
| Reacción al 429 | Escribe `ahora+65` en ese fichero y avisa de esperar 65 s | ani-cli-mx-core:481-484 |
| Ruta de búsqueda | `GET ${jkanime_refr}/buscar?q=$1` | ani-cli-mx-core:1535 |
| Formato de respuesta | HTML (tarjetas con `div class="col-lg-2 col-md-6 col-sm-6"`) | ani-cli-mx-core:1536 |
| Campos extraídos | slug (`\1`) y título (`\2`) separados por tabulador | ani-cli-mx-core:1537 |
| Página de episodio | `GET ${jkanime_refr}/${slug}/${ep}/` | ani-cli-mx-core:1738 |

Parseo literal de la búsqueda (ani-cli-mx-core:1535-1537):

```sh
jkanime_request "${jkanime_refr}/buscar?q=$1" | tr '\n' ' ' |
    sed 's|<div class="col-lg-2 col-md-6 col-sm-6"|\n&|g' |
    sed -nE 's|.*<a[[:space:]]+href="https://jkanime\.net/([^"/]+)/".*<h5><a[[:space:]]+href="https://jkanime\.net/[^"]+/">([^<]+)</a></h5>.*|\1\t\2|p'
```

- Línea 1: colapsa el HTML a una sola línea (el `sed` posterior es *greedy* y necesita una línea por resultado).
- Línea 2: corta antes de cada tarjeta. La marca es la clase Bootstrap exacta; si el sitio cambia de clases, no hay resultados.
- Línea 3: exige `<a href="https://jkanime.net/<slug>/">` seguido de `<h5><a href="…">Título</a></h5>` y emite `slug<TAB>título`.

#### Catálogo paginado (endpoint AJAX + CSRF + caché)

| Qué | Valor | Cita |
|---|---|---|
| Directorio de caché | `$hist_dir/jkanime-episodes/<cksum>` donde el número es `cksum` de la cadena `${jkanime_refr}/${slug}` | ani-cli-mx-core:3110-3113 |
| Caducidad | 300 s: `meta` línea 1 es el epoch de creación y `age < 300` reutiliza la generación | ani-cli-mx-core:3123-3126 |
| Invalidación | Al expirar borra `page-*.json`, `meta`, `cookies` y `view.$$` antes de pedir de nuevo | ani-cli-mx-core:3129 |
| 1.ª petición | `GET ${jkanime_refr}/${slug}/` guardando cookies: `-c "$jkc_dir/cookies"` | ani-cli-mx-core:3130 |
| Extracción de ID | De `anime_checks('<algo>', '<id>')` (sólo dígitos) | ani-cli-mx-core:3100-3103 |
| Extracción de CSRF | De `<meta name="csrf-token" content="…">` | ani-cli-mx-core:3105-3108 |
| 2.ª petición | `POST ${jkanime_refr}/ajax/episodes/<anime_id>/1` con `-b cookies -c cookies -X POST --data "_token=$jkc_csrf" -H 'X-Requested-With: XMLHttpRequest'` | ani-cli-mx-core:3134-3136 |
| Formato de respuesta | JSON con `"last_page":N` y objetos con `"number":N` | ani-cli-mx-core:3116, ani-cli-mx-core:3137 |
| Cuántas páginas | `last_page` se lee de la **primera** página; cada página adicional se pide sólo bajo demanda | ani-cli-mx-core:3137, ani-cli-mx-core:3165-3176 |
| Ritmo | Antes de cada página nueva, si `request-time` tiene menos de 1 s, duerme 1 s (límite autoimpuesto de 1 req/s) | ani-cli-mx-core:3168-3172 |
| Petición de página N | Mismo POST con `/<N>`, `-b "$jkc_dir/cookies"` y el mismo `_token`, sin `-c` | ani-cli-mx-core:3175-3176 |
| Qué se guarda | Un `page-N.json` por página, `meta` (6 líneas), `cookies`, `request-time`, `view.$$` | ani-cli-mx-core:3139-3159, ani-cli-mx-core:3187 |
| `meta` | línea 1 epoch, 2 `anime_id`, 3 `csrf`, 4 `last_page`, 5 último episodio visto en el HTML, 6 orden `ascending`/`descending` | ani-cli-mx-core:3157-3158 |
| Detección del orden | Descendente si el primer `number` de la página 1 es el máximo, o si el máximo del catálogo iguala el «último» del HTML | ani-cli-mx-core:3150-3156 |
| Localización de un episodio | Búsqueda binaria sobre `1..last_page` comparando el rango `[min,max]` de cada página, con la dirección del orden | ani-cli-mx-core:3192-3237 |
| Números finales | Unión de todos los `page-*.json` cacheados más el último del `meta`, ordenados y únicos | ani-cli-mx-core:3240-3245 |
| Rangos | `jkanime_range_numbers` pide todas las páginas entre los dos extremos y filtra por rango | ani-cli-mx-core:3274-3291 |

Parseo literal de números de página (ani-cli-mx-core:3115-3117):

```sh
jkanime_page_numbers() {
    grep -oE '"number":[0-9]+(\.[0-9]+)?' "$1" | cut -d: -f2 | sort -n -u
}
```

- Captura el número de episodio conservando decimales (`12`, `7.5`), los ordena numéricamente y los deduplica. Es el único parser de la respuesta AJAX.

Parseo literal del `last_page` y del último episodio del HTML (ani-cli-mx-core:3137, ani-cli-mx-core:3143-3149):

```sh
jkc_last="$(printf '%s' "$jkc_first" | sed -nE 's|.*"last_page":([0-9]+).*|\1|p' | head -n1)"
```

```sh
    jkc_latest="$(printf '%s' "$jkc_html" | tr '\n' ' ' |
        grep -oE 'href="https://jkanime\.net/[^"/]+/[0-9]+(\.[0-9]+)?/"[^>]*id="uep"' |
        sed -nE 's|.*\/([0-9]+(\.[0-9]+)?)/".*|\1|p' | head -n1)"
    # Some layouts put the ID before href. Limit the fallback to this series.
    [ -n "$jkc_latest" ] || jkc_latest="$(printf '%s' "$jkc_html" |
        grep -oE "https://jkanime\.net/${jkc_slug}/[0-9]+(\.[0-9]+)?/" |
        sed -nE 's|.*/([0-9]+(\.[0-9]+)?)/$|\1|p' | sort -n | tail -n1)"
```

- El primero busca el enlace marcado `id="uep"` (último episodio publicado) y saca su número.
- El respaldo, limitado al slug de la serie, recoge todos los enlaces de episodio y se queda con el mayor.

Búsqueda binaria literal (ani-cli-mx-core:3220-3236):

```sh
    while [ "$jkc_low" -le "$jkc_high" ]; do
        jkc_mid=$(((jkc_low + jkc_high) / 2))
        jkc_numbers="$(jkanime_catalog_page "$jkc_dir" "$jkc_mid")" || return 1
        if printf '%s\n' "$jkc_numbers" | grep -Fxq "$jkc_target"; then
            printf '%s\n' "$jkc_mid"
            return 0
        fi
        jkc_relation="$(printf '%s\n' "$jkc_numbers" | awk -v n="$jkc_target" '
            NR == 1 { min=$0 } { max=$0 } END { if (n < min) print -1; else if (n > max) print 1; else print 0 }')"
        [ "$jkc_relation" != 0 ] || return 1
        if { [ "$jkc_relation" = -1 ] && [ "$jkc_order" = ascending ]; } ||
            { [ "$jkc_relation" = 1 ] && [ "$jkc_order" = descending ]; }; then
            jkc_high=$((jkc_mid - 1))
        else
            jkc_low=$((jkc_mid + 1))
        fi
    done
    return 1
```

- `min` es el primer número de la página y `max` el último: si el objetivo cae dentro del intervalo pero no está, el episodio no existe en el catálogo real y aborta (`0` → `return 1`). La dirección de descarte depende de `jkc_order`.

También hay extracción de enlaces del reproductor: la página del episodio se parsea buscando `video[N] = '<iframe … src="…"'` (ani-cli-mx-core:1634-1636), y si no hay nada, el array `var servers = [...]` con `"remote"` en base64 (`base64 -d`) (ani-cli-mx-core:1669-1683).

---

### AnimeAV1

No hay JSON ni GraphQL: la búsqueda es HTML y la página del episodio es HTML con **objetos JavaScript embebidos** (`embeds:{SUB:[…]},downloads:{…}`).

| Qué | Valor | Cita |
|---|---|---|
| URL base | `https://animeav1.com` | ani-cli-mx-core:4539 |
| Transporte | `curl -L --connect-timeout 10 --max-time $resolver_timeout -s "$1" -A "$agent"` — sin referrer, sin cookies, sin reintentos, sin `-f` | ani-cli-mx-core:489-491 |
| Ruta de búsqueda | `GET ${animeav1_refr}/catalogo?search=$1` | ani-cli-mx-core:1745 |
| Cabecera | sólo `User-Agent` | ani-cli-mx-core:490 |
| Formato de respuesta | HTML (`<article class="group/item…`) | ani-cli-mx-core:1746 |
| Campos usados | slug (`/media/<slug>`) y texto de `<h3>` | ani-cli-mx-core:1747 |
| Página del episodio | `GET ${animeav1_refr}/media/${slug}/${ep}` | ani-cli-mx-core:2044 |
| Campos del episodio | `embeds:{…}` y `downloads:{…}` (blobs de objetos JS) | ani-cli-mx-core:2046-2047 |
| Idioma | `pick_animeav1_language` busca la primera clave presente en el blob | ani-cli-mx-core:1787-1801 |
| Orden en `sub` | `SUB ESP LAT DUB` | ani-cli-mx-core:1795 |
| Orden en `dub` | `LAT ESP DUB SUB` | ani-cli-mx-core:1790 |
| Regla de detección | `grep -q "${lang}:\\["` sobre `embeds+downloads` | ani-cli-mx-core:1791, ani-cli-mx-core:1796 |
| Entradas por servidor | cada entrada tiene `server:"…"` y `url:"…"` | ani-cli-mx-core:1936-1937 |
| HLS | `https://player.zilla-networks.com/m3u8/<id>` a partir de `/play/<id>` | ani-cli-mx-core:1817-1820 |
| Cabeceras de HLS | `zilla_header_fields` (Origin + Sec-Fetch-*) | ani-cli-mx-core:4535, ani-cli-mx-core:1958 |

Parseo literal de la búsqueda (ani-cli-mx-core:1745-1747):

```sh
animeav1_request "${animeav1_refr}/catalogo?search=$1" | tr '\n' ' ' |
    sed 's|<article class="group/item|\n&|g' |
    sed -nE 's|.*<h3[^>]*>([^<]+)</h3>.*href="/media/([^"/?]+)".*|\2\t\1|p'
```

- Idéntico al de HentaiLA salvo que aquí el salto es `\n` dentro del reemplazo de `sed`. Emite `slug<TAB>título`; `href` es relativo (`/media/…`), a diferencia de JKAnime que lo exige absoluto.

Parseo literal de los blobs de idioma (ani-cli-mx-core:1899-1904):

```sh
extract_animeav1_entries() {
    [ -z "$1" ] && return 1
    printf '%s' "$1" | sed "s|.*$2:\\[||" |
        sed 's|],*[A-Z][A-Z0-9]*:\[.*||; s|]$||; s|},{|}\
{|g'
}
```

- Recorta desde `LANG:[` (el `$2` es `SUB`/`ESP`/`LAT`/`DUB`) hasta el siguiente bloque `XXX:[` o el cierre `]`, y separa cada objeto en su propia línea con `},{` → `}\n{`. Captura las entradas de un idioma concreto.

Parseo literal del HLS (ani-cli-mx-core:1817-1820):

```sh
extract_animeav1_hls_link() {
    hls_id="$(printf '%s' "$1" | sed -nE 's|.*/play/([[:alnum:]]+).*|\1|p')"
    [ -n "$hls_id" ] && printf 'https://player.zilla-networks.com/m3u8/%s\n' "$hls_id"
}
```

- Captura el id hexadecimal de `/play/<id>` y lo reescribe al manifiesto del CDN Zilla con la ruta fija `/m3u8/`.

Prioridad de servidores y filtro de espejos desactivados (ani-cli-mx-core:1925-1930):

```sh
    animeav1_entries="${hls_entries}
${voe_entries}
${pdrain_entries}
${yourupload_entries}
${mp4upload_entries}
$(printf '%s\n' "$embed_entries" | grep -Evi 'server:"(HLS|MP4Upload|PDrain|Pixeldrain|Voe|YourUpload)"' || true)"
```

- Concatenación en el orden HLS → Voe → PDrain → YourUpload → MP4Upload → resto; el `grep -Evi` que alimenta la última línea captura «todo lo demás» invirtiendo la lista.

Resolución del embed Voe, transcripción literal de la cadena de transformaciones (ani-cli-mx-core:1869-1896):

```sh
    printf '%s' "$voe_page" | python3 -c '
from base64 import b64decode
import codecs
import json
import re
import sys
from urllib.parse import urlparse

match = re.search(r"<script\s+type=[\x27\x22]application/json[\x27\x22]>(.*?)</script>", sys.stdin.read(), re.S)
if not match:
    sys.exit(1)
try:
    value = json.loads(match.group(1))[0]
    value = codecs.decode(value, "rot_13")
    for marker in ("@$", "^^", "~@", "%?", "*~", "!!", "#&"):
        value = value.replace(marker, "")
    value = b64decode(value + "=" * (-len(value) % 4)).decode()
    value = "".join(chr(ord(char) - 3) for char in value)[::-1]
    payload = json.loads(b64decode(value + "=" * (-len(value) % 4)))
    media_url = payload.get("source", "")
    parsed = urlparse(media_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or ".m3u8" not in parsed.path:
        sys.exit(1)
except (ValueError, KeyError, IndexError, TypeError, UnicodeError):
    sys.exit(1)
print(media_url)
print(sys.argv[1])
' "$voe_embed"
```

- Extrae el `<script type="application/json">`, toma el primer elemento del array, aplica ROT13, borra siete separadores literales (`@$`, `^^`, `~@`, `%?`, `*~`, `!!`, `#&`), decodifica base64, desplaza cada carácter −3, invierte la cadena, decodifica base64 otra vez y lee `source`. Valida que sea http(s) con netloc y `.m3u8` en la ruta. La segunda línea impresa es el embed final, que se usa como referrer (ani-cli-mx-core:1995).
- Antes de eso, si la página declara un salto JS, se sigue y se vuelve a pedir (ani-cli-mx-core:1862-1867).

Otros resolutores del mismo bloque:

```sh
    mp4upload_page="$(animeav1_request "$1")" || return 1
    printf '%s' "$mp4upload_page" |
        sed -nE 's|.*src:[[:space:]]*"(https?://[^"]+\.mp4[^"]*)".*|\1|p' |
        head -n 1
```

- ani-cli-mx-core:1846-1849: captura la primera URL `.mp4` publicada como `src:"…"`. Antes, la URL `…/<alnum>` se reescribe a `/embed-<alnum>.html` (ani-cli-mx-core:1942).

```sh
    pdrain_id="$(printf '%s' "$1" |
        sed -nE 's|^https://pixeldrain\.com/u/([[:alnum:]]+)(\?.*)?$|\1|p')"
    [ -n "$pdrain_id" ] && printf 'https://pixeldrain.com/api/file/%s\n' "$pdrain_id"
```

- ani-cli-mx-core:1853-1855: convierte la página `/u/<id>` en la API `/api/file/<id>`.

---

### PelisPlus (HD)

Películas, series y doramas. Es la fuente con más mecánica propia: referrer obligatorio, reintentos, **prueba de trabajo SHA-256**, **descifrado AES-256-CBC** y **desempaquetado de un `eval(function(p,a,c,k,e,d)`**.

#### Transporte

| Qué | Valor | Cita |
|---|---|---|
| URL base | `${ANI_CLI_PELISPLUS_URL:-https://pelisplushd.bz}` | ani-cli-mx-core:4543 |
| `pelisplus_request` | `curl -L --connect-timeout 10 --max-time $resolver_timeout --retry 2 --retry-delay 1 -e "$pelisplus_refr/" -sS "$1" -A "$agent"` | ani-cli-mx-core:493-496 |
| `pelisplus_media_request` | Igual pero `--max-time $pelisplus_resolver_timeout` (45 s), sin `--retry`, y `-e "$2"` (referrer variable) | ani-cli-mx-core:498-501 |
| `pelisplus_search_request` | Hasta 3 intentos de `curl -L … --retry 1 --retry-delay 1 -e "$pelisplus_refr/" -sS -G --data-urlencode "s=$1" "$pelisplus_refr/search" -A "$agent"` | ani-cli-mx-core:503-515 |
| Criterio de éxito de la búsqueda | `grep -qE 'href="[^"]*/(pelicula|serie)/'`; si no aparece, reintenta | ani-cli-mx-core:508-511 |
| Cabeceras | sólo `User-Agent`; el referrer es la cabecera crítica (`-e`) | ani-cli-mx-core:495 |
| `pelisplus_search_request` silencia errores | `2>/dev/null \|\| true` para que el bucle no aborte | ani-cli-mx-core:507 |
| Ruta de búsqueda | `GET $pelisplus_refr/search?s=<consulta urlencoded>` | ani-cli-mx-core:507 |
| Página de detalle | `$pelisplus_refr/pelicula/<slug>` o `$pelisplus_refr/serie/<slug>/temporada/<s>/capitulo/<e>` | ani-cli-mx-core:802-814 |
| Lista de episodios | `GET $pelisplus_refr/serie/<slug>` y grep de `/temporada/N/capitulo/M` | ani-cli-mx-core:3398-3403 |
| Formato de respuesta | HTML en todos los pasos | ani-cli-mx-core:2742, ani-cli-mx-core:2748 |

Parseo literal de la búsqueda (ani-cli-mx-core:3043-3072):

```sh
search_pelisplus() {
    pelisplus_query="$(printf '%s' "$1" | tr '+' ' ')"
    pelisplus_kind="$2"
    pelisplus_search_request "$pelisplus_query" |
        tr '\n' ' ' |
        sed 's|<a[[:space:]][[:space:]]*href=|\
&|g' |
        grep -E 'href="[^"]*/(pelicula|serie)/' |
        while IFS= read -r pelisplus_record; do
            pelisplus_path_kind="$(printf '%s' "$pelisplus_record" | sed -nE 's#.*href="[^"]*/(pelicula|serie)/[^"]+".*#\1#p')"
            pelisplus_slug="$(printf '%s' "$pelisplus_record" | sed -nE 's#.*href="[^"]*/(pelicula|serie)/([^"]+)".*#\2#p')"
            pelisplus_title="$(printf '%s' "$pelisplus_record" | sed -nE 's#.*data-title="VER ([^"]+) Online Gratis HD".*#\1#p')"
            [ -n "$pelisplus_title" ] || pelisplus_title="$(printf '%s' "$pelisplus_slug" | tr '-' ' ')"
```

- `tr '+' ' '` deshace el `+` que introdujo la capa de búsqueda (ani-cli-mx-core:4823) para que `--data-urlencode` codifique espacios reales.
- El `grep -E` deja pasar **sólo las líneas que contienen un enlace de película o serie**; cada línea es un registro completo.
- Se extraen: tipo de ruta (`pelicula`/`serie`), slug y `data-title="VER … Online Gratis HD"`; si el título no aparece, se deriva del slug cambiando `-` por espacio.
- El tipo final se decide con una petición extra: para `serie` se llama a `pelisplus_detail_is_dorama` (ani-cli-mx-core:3058-3065), que hace hasta 3 `pelisplus_request` y busca `title="Películas del Genero: Dorama"` (ani-cli-mx-core:3030-3041). Es decir, **una serie puede costar 4 peticiones** antes de emitir el resultado.

#### Del HTML del episodio al enlace cifrado

```sh
    embed_url="$(printf '%s' "$pelisplus_page" | sed -nE "s|.*video\[[0-9]+\][[:space:]]*=[[:space:]]*'([^']*embed69[^']*)'.*|\1|p" | head -n1)"
```

- ani-cli-mx-core:2742: captura la primera asignación `video[N] = '…embed69…'`. El embed se pide con el referrer de la página del episodio (ani-cli-mx-core:2745).

```sh
    vidhide_url="$(printf '%s' "$embed_html" | sed -nE "s|.*playServerVast\('(https?://[^']*vidhide[^']*)'\).*|\1|p" | head -n1)"
```

- ani-cli-mx-core:2748: camino «clásico», captura la URL de Vidhide del `playServerVast`. Si existe, se salta la prueba de trabajo (ani-cli-mx-core:2749).

#### Prueba de trabajo (PoW)

| Qué | Valor | Cita |
|---|---|---|
| Disparador | Ausencia de `playServerVast`, con `POW_CHALLENGE`, `POW_DIFFICULTY` y `POW_SALT` presentes en el embed | ani-cli-mx-core:2749-2753 |
| Variables | `POW_CHALLENGE` (cadena), `POW_DIFFICULTY` (entero), `POW_SALT` (cadena) | ani-cli-mx-core:2750-2752 |
| Objetivo | `sha256(challenge ‖ nonce)` debe empezar por `difficulty` ceros **hexadecimales** | ani-cli-mx-core:2531, ani-cli-mx-core:2535, ani-cli-mx-core:2537 |
| Límite | 200000 intentos (`ANI_CLI_PELISPLUS_POW_LIMIT`) | ani-cli-mx-core:2543, ani-cli-mx-core:2547 |
| Vía rápida | Perl con `Digest::SHA::sha256_hex` si está disponible | ani-cli-mx-core:2532-2545 |
| Vía lenta | Bucle `sh` con `openssl dgst -sha256` por nonce | ani-cli-mx-core:2546-2553 |
| Orden de espejos | `vidhide streamwish` por defecto; `streamwish vidhide` si el idioma pedido es `SUB` | ani-cli-mx-core:2757-2758 |

Transcripción literal (ani-cli-mx-core:2528-2553):

```sh
pelisplus_pow_nonce() {
    pow_challenge="$1"
    pow_difficulty="$2"
    pow_prefix="$(printf '%*s' "$pow_difficulty" '' | tr ' ' 0)"
    if command -v perl >/dev/null 2>&1 && perl -MDigest::SHA=sha256_hex -e 'exit 0' >/dev/null 2>&1; then
        perl -MDigest::SHA=sha256_hex -e '
            my ($challenge, $difficulty, $limit) = @ARGV;
            my $prefix = "0" x $difficulty;
            for (my $nonce = 0; $nonce <= $limit; $nonce++) {
                if (index(sha256_hex($challenge . $nonce), $prefix) == 0) {
                    print "$nonce\n";
                    exit 0;
                }
            }
            exit 1;
        ' "$pow_challenge" "$pow_difficulty" "${ANI_CLI_PELISPLUS_POW_LIMIT:-200000}"
        return $?
    fi
    pow_nonce=0
    while [ "$pow_nonce" -le "${ANI_CLI_PELISPLUS_POW_LIMIT:-200000}" ]; do
        pow_digest="$(printf '%s%s' "$pow_challenge" "$pow_nonce" | openssl dgst -sha256 2>/dev/null | awk '{ print $NF }')"
        case "$pow_digest" in
            "$pow_prefix"*) printf '%s\n' "$pow_nonce"; return 0 ;;
        esac
        pow_nonce=$((pow_nonce + 1))
    done
    return 1
}
```

- El nonce **se concatena en decimal** (`$challenge . $nonce`), no como bytes; empieza en 0. `index(...) == 0` es «empieza por», equivalente al `case "$pow_digest" in "$pow_prefix"*)` del respaldo. Si se agota el límite, devuelve 1 y el resolver abandona (ani-cli-mx-core:2755).

#### Descifrado AES-256-CBC

| Qué | Valor | Cita |
|---|---|---|
| Entrada | El campo `"link"` del espejo elegido, con `\/` normalizado a `/` | ani-cli-mx-core:2558, ani-cli-mx-core:2626 |
| Clave | `sha256(challenge ‖ nonce ‖ salt)` en hexadecimal | ani-cli-mx-core:2559, ani-cli-mx-core:2765 |
| IV | Los primeros 16 bytes del texto cifrado ya decodificado de base64 | ani-cli-mx-core:2567 |
| Cuerpo | El resto, desde el byte 16 | ani-cli-mx-core:2568 |
| Cifrado | `openssl enc -d -aes-256-cbc -K <hex> -iv <hex>` | ani-cli-mx-core:2569-2570 |
| Salida | Se eliminan `\r` y `\n` | ani-cli-mx-core:2571 |
| Validación posterior | El resultado debe empezar por `https://` o `http://` | ani-cli-mx-core:2766 |
| Dependencias | `dep_ch "openssl" "awk" "od" "dd"` antes de resolver | ani-cli-mx-core:2851 |

Transcripción literal (ani-cli-mx-core:2557-2578):

```sh
pelisplus_decrypt_link() {
    encrypted_link="$(printf '%s' "$1" | sed 's|\\/|/|g')"
    aes_key_hex="$(printf '%s%s%s' "$2" "$3" "$4" | openssl dgst -sha256 2>/dev/null | awk '{ print $NF }')"
    encrypted_raw="$(mktemp)"
    encrypted_body="$(mktemp)"
    decrypted_body="$(mktemp)"
    if ! printf '%s' "$encrypted_link" | openssl base64 -d -A >"$encrypted_raw" 2>/dev/null; then
        rm -f "$encrypted_raw" "$encrypted_body" "$decrypted_body"
        return 1
    fi
    aes_iv_hex="$(od -An -tx1 -N16 "$encrypted_raw" | tr -d ' \n')"
    dd if="$encrypted_raw" of="$encrypted_body" bs=1 skip=16 2>/dev/null
    if openssl enc -d -aes-256-cbc -K "$aes_key_hex" -iv "$aes_iv_hex" \
        -in "$encrypted_body" -out "$decrypted_body" 2>/dev/null; then
        tr -d '\r\n' <"$decrypted_body"
        decrypt_status=0
    else
        decrypt_status=1
    fi
    rm -f "$encrypted_raw" "$encrypted_body" "$decrypted_body"
    return "$decrypt_status"
}
```

- La clave es un SHA-256 **en texto hexadecimal** usado como `-K` (32 bytes); el IV son los 16 primeros bytes *crudos* del criptograma, en hexadecimal vía `od`; `-A` evita saltos de línea en el base64. Los tres ficheros temporales se borran siempre.

#### Elección de idioma y espejo dentro del embed

| Qué | Valor | Cita |
|---|---|---|
| Idiomas disponibles | `grep -Eo '"video_language":"[A-Z]+"'` únicos | ani-cli-mx-core:2583 |
| Preferencia | `ANI_CLI_PELISPLUS_LANGUAGE` en mayúsculas; si no está en la lista, se descarta | ani-cli-mx-core:2584-2585 |
| Menú | Sólo si hay más de un idioma y hay TTY; etiquetas LAT→Latino, ESP→Castellano, SUB→Subtitulado | ani-cli-mx-core:2586-2605 |
| Respaldo | `LAT`, luego `ESP`, luego `SUB` | ani-cli-mx-core:2606-2618 |
| Bloque elegido | `"file_id"` separado en líneas y `grep -m1 "\"video_language\":\"$lang\""` | ani-cli-mx-core:2611-2612 |
| Espejo | Dentro de `"sortedEmbeds":[…]`, `grep -F "\"servername\":\"vidhide\""` | ani-cli-mx-core:2621-2627 |
| Salida | `idioma<TAB>link cifrado` | ani-cli-mx-core:2629 |

#### Desempaquetado `eval(function(p,a,c,k,e,d)`

`unpack_pelisplus_packer` (ani-cli-mx-core:2632-2691) implementa el desempaquetador clásico de Dean Edwards **sin ejecutar JavaScript**. Transcripción literal:

```awk
        function digit_value(ch) {
            p = index("0123456789abcdefghijklmnopqrstuvwxyz", tolower(ch))
            return p ? p - 1 : -1
        }
        function base_value(token, radix,    i, value, digit) {
            value = 0
            for (i = 1; i <= length(token); i++) {
                digit = digit_value(substr(token, i, 1))
                if (digit < 0 || digit >= radix) return -1
                value = value * radix + digit
            }
            return value
        }
        {
            packed = packed $0
        }
        END {
            marker = index(packed, "}(\047")
            if (!marker) exit 1
            rest = substr(packed, marker + 3)
            if (!match(rest, /\047,[0-9]+,[0-9]+,\047/)) exit 1
            payload = substr(rest, 1, RSTART - 1)
            metadata = substr(rest, RSTART, RLENGTH)
            gsub(/[^0-9,]/, "", metadata)
            sub(/^,/, "", metadata)
            sub(/,$/, "", metadata)
            split(metadata, numbers, ",")
            radix = numbers[1] + 0
            count = numbers[2] + 0
            dictionary_text = substr(rest, RSTART + RLENGTH)
            dictionary_end = index(dictionary_text, "\047.split(\047|\047)")
            if (!dictionary_end) exit 1
            dictionary_text = substr(dictionary_text, 1, dictionary_end - 1)
            split(dictionary_text, dictionary, "|")
            output = ""
            token = ""
            for (i = 1; i <= length(payload) + 1; i++) {
                ch = substr(payload, i, 1)
                if (ch ~ /[[:alnum:]]/) {
                    token = token ch
                    continue
                }
                if (token != "") {
                    dictionary_index = base_value(token, radix)
                    if (dictionary_index >= 0 && dictionary_index < count && dictionary[dictionary_index + 1] != "")
                        output = output dictionary[dictionary_index + 1]
                    else
                        output = output token
                    token = ""
                }
                output = output ch
            }
            gsub(/\\\047/, "\047", output)
            gsub(/\\\\/, "\\", output)
            print output
        }
```

Paso a paso, con la evidencia:

1. **Concatena todas las líneas** (`packed = packed $0`), ani-cli-mx-core:2647-2649.
2. **Localiza el cierre de la firma**: `index(packed, "}(\047")` — `\047` es la comilla simple, así que busca `}('`, el punto donde empiezan los argumentos `p,a,c,k,e,d` (ani-cli-mx-core:2651-2653).
3. **Extrae los metadatos** con la expresión `\047,[0-9]+,[0-9]+,\047` = `',<a>,<c>,'` (ani-cli-mx-core:2654-2662): `radix` es el primer número (el `a`, base de los índices) y `count` el segundo (el `c`, tamaño del diccionario).
4. **Diccionario**: el texto siguiente, cortado en `'.split('|')` y separado por `|` (ani-cli-mx-core:2663-2667).
5. **Sustitución**: recorre el cuerpo carácter a carácter, acumula tokens alfanuméricos, y al topar con un delimitador interpreta el token como número en base `radix` (`base_value`) y lo reemplaza por `dictionary[idx+1]`; si el índice se sale de rango o la entrada está vacía, deja el token tal cual (ani-cli-mx-core:2670-2685). Nótese que **el delimitador se conserva** en la salida.
6. **Desescape final**: `\'` → `'` y `\\` → `\` (ani-cli-mx-core:2686-2687).

Consumo del resultado (ani-cli-mx-core:2693-2706):

```sh
    if ! packed_host_effective_url="$(curl -L --connect-timeout 10 --max-time "$pelisplus_resolver_timeout" \
        -e "$2" -sS -o "$packed_host_body" -w '%{url_effective}' "$packed_host_url" -A "$agent")"; then
        rm -f "$packed_host_body"
        debug_log "PelisPlusHD: falló la consulta del espejo $packed_host_url"
        return 1
    fi
    packed_output="$(unpack_pelisplus_packer <"$packed_host_body" 2>/dev/null)"
    rm -f "$packed_host_body"
    master_url="$(printf '%s' "$packed_output" | grep -Eo 'https?://[^"'"'"'[:space:]\\]+\.m3u8[^"'"'"'[:space:]\\]*' | head -n1)"
```

- El espejo se pide con el referrer del embed y **`-w '%{url_effective}'`** para conocer la URL final tras las redirecciones: esa URL final es la que se usa después como referrer del manifiesto (ani-cli-mx-core:2709) y para reescribir variantes relativas. Del resultado desempaquetado se extrae el primer `.m3u8`.

Parseo de las variantes HLS (ani-cli-mx-core:2710-2721):

```sh
    variant_links="$(printf '%s\n' "$master_body" | awk -v base="${master_url%/*}/" '
        /#EXT-X-STREAM-INF:/ {
            height = $0
            sub(/^.*RESOLUTION=[0-9]+x/, "", height)
            sub(/[^0-9].*$/, "", height)
            if (getline uri) {
                sub(/\r$/, "", uri)
                if (uri !~ /^https?:\/\//) uri = base uri
                if (height != "") printf "%s >%s\n", height, uri
            }
        }
    ' | sort -nr)"
```

- De cada `#EXT-X-STREAM-INF` con `RESOLUTION=AxB` toma **la altura** (B) y la URI de la línea siguiente, resolviendo URIs relativas contra el directorio del manifiesto. Salida `altura > url`, ordenada de mayor a menor. Si no hay ninguna, usa `720 > <master>` como único candidato (ani-cli-mx-core:2723).

---

### AniDB

| Qué | Valor | Cita |
|---|---|---|
| URL base | `https://anidb.app` | ani-cli-mx-core:4524 |
| Ejecutable | `find_anidb_curl_exe()`: `ANI_CLI_ANIDB_CURL` si es ejecutable; si no, el primero de `curl_firefox135`, `curl_chrome136`, `curl_chrome116`, `curl_ff117` presente en `PATH` | ani-cli-mx-core:2055-2068 |
| Transporte | `"$anidb_curl_exe" -sL -A "$anidb_agent" --max-time "$resolver_timeout" "$@"` | ani-cli-mx-core:2088-2091 |
| Cabecera | `-A "$anidb_agent"` (UA de Chrome 124, distinto del general) | ani-cli-mx-core:4523, ani-cli-mx-core:2090 |
| Tiempo | `--max-time $resolver_timeout` (15 s) | ani-cli-mx-core:2090 |
| Ruta de búsqueda | `GET ${anidb_refr}/browse?q=$1` | ani-cli-mx-core:2094 |
| Detección de Cloudflare | Si la respuesta contiene `Just a moment` (case-insensitive), devuelve 1 sin parsear | ani-cli-mx-core:2095 |
| Formato de respuesta | HTML en la búsqueda; JSON en las dos rutas `api/frontend` | ani-cli-mx-core:2096, ani-cli-mx-core:2141, ani-cli-mx-core:2153 |
| Campos de la búsqueda | id (`anime/<slug>-<num>`) y `alt="Título"` de la miniatura | ani-cli-mx-core:2098 |
| Episodios | `GET ${anidb_refr}/api/frontend/anime/<num>/episodes` | ani-cli-mx-core:2141 |
| Idiomas del episodio | `GET ${anidb_refr}/api/frontend/episode/<id>/languages` | ani-cli-mx-core:2153 |
| Idioma según `mode` | `jpn` por defecto, `eng` en `dub` | ani-cli-mx-core:2151-2152 |
| Embed | `embed_url` de la entrada de idioma elegida | ani-cli-mx-core:2155 |
| Manifiesto | `file: '…'` de la página del embed | ani-cli-mx-core:2159 |
| Referrer final | `$anidb_refr` | ani-cli-mx-core:2172 |
| Requisito | Sin el ejecutable, la búsqueda muere con «AniDB requiere curl-impersonate» | ani-cli-mx-core:2986-2987 |

**Por qué `curl-impersonate`.** El código no lo explica; lo que hace es: (a) buscar exclusivamente binarios con nombre de envoltorio de curl-impersonate, nunca `curl` (ani-cli-mx-core:2061-2066); (b) sustituir el UA general por un UA de Chrome real (ani-cli-mx-core:4523); (c) **detectar y abortar ante la página de desafío** buscando la cadena `Just a moment` (ani-cli-mx-core:2095). El README lo dice explícitamente: AniDB «currently rejects regular `curl` through Cloudflare» (`.tmp/acmx/ani-cli-mx-main/README.md:484`). Deducción: contra Cloudflare el mecanismo no es resolver el desafío sino *parecer* el navegador (TLS/JA3 + UA) para no recibirlo; el chequeo de `Just a moment` es la red de seguridad por si aun así aparece.

**Corrección a la premisa de la tarea**: `anidb_request` **no pasa `--http2`** ni ningún otro flag de protocolo; sus únicos argumentos fijos son `-sL -A … --max-time …` (ani-cli-mx-core:2090). Una búsqueda de `http2` en todo el fichero no devuelve ninguna coincidencia (grep sobre `ani-cli-mx-core`). Si `--http2` es necesario para que curl-impersonate negocie como el navegador, lo aporta el propio envoltorio, no este script.

Parseo literal de la búsqueda (ani-cli-mx-core:2096-2099):

```sh
    printf '%s' "$anidb_page" | tr '\n' ' ' | sed 's|<a href|\
<a href|g' |
        sed -nE 's|.*anime/([a-z0-9-]+-[0-9]+)".*alt="([^"]+)".*|\1\t\2|p' |
        sed -e "s|&#039;|'|g" -e 's|&quot;|"|g' | stable_unique_lines
```

- Línea 1: una línea por enlace. Línea 2: captura el slug con sufijo numérico (`anime/<slug>-<num>`) y el `alt` de la imagen; el `-<num>` es lo que después se usa como id de API. Línea 3: deshace las dos entidades HTML que aparecen en títulos. `stable_unique_lines` deduplica preservando el orden (ani-cli-mx-core:2070-2086).

Parseo literal de episodios y de idiomas (ani-cli-mx-core:2141-2155):

```sh
    anidb_request "${anidb_refr}/api/frontend/anime/${anidb_ref##*-}/episodes" |
        sed 's|},{|}\
|g' | sed -nE 's|.*"id":([0-9]+).*"number":([0-9]+).*|\1\t\2|p'
```

```sh
    anidb_languages="$(anidb_request "${anidb_refr}/api/frontend/episode/${anidb_episode_id}/languages")" || return 1
    anidb_embed="$(printf '%s' "$anidb_languages" | sed 's|},{|}\
|g' | sed -nE 's|.*'"$anidb_lang"'.*embed_url":"([^"]+)".*|\1|p' | sed 's|\\/|/|g' | head -n1)"
```

- El primero separa los objetos JSON con `},{` → `}\n{` y captura `"id"` y `"number"` de cada episodio. El segundo localiza la entrada cuyo idioma coincide (`jpn`/`eng`) y toma su `embed_url`, desescapando `\/`. Ambos dependen del **orden de campos** dentro del objeto JSON, no de un parser real: si el backend reordena `id` y `number`, el `sed` falla en silencio.

Parseo del manifiesto multiformato (ani-cli-mx-core:2159-2162):

```sh
    anidb_master="$(printf '%s' "$anidb_embed_page" | sed -nE "s|.*file: '([^']*)'.*|\1|p" | head -n1)"
    [ -n "$anidb_master" ] || return 1
    anidb_variants="$(anidb_request "$anidb_master" |
        sed 's|^#EXT-X-STREAM.*x||g; s|,.*||g; /^#/d; $!N; s|\n| >|;/EXT-X-I-FRAME/d')"
```

- De la página del embed obtiene el `file:` del reproductor. Del manifiesto: recorta `#EXT-X-STREAM…x` (las líneas de `EXT-X-STREAM-INF`, dejando el número de resolución), borra `,` y todo lo que sigue, elimina las líneas `#` restantes, une cada URI con la línea anterior separándolas con ` >` y descarta los `EXT-X-I-FRAME`. Salida `altura > url` (ani-cli-mx-core:2171).
- Deducción: el `x` de `-x` en el primer `sed` casa con la «x» de `RESOLUTION=1920x1080`, dejando `1080` al principio de la línea; `s|,.*||g` limpia el resto de atributos.

---

### AnimeX

Dos superficies distintas: GraphQL para buscar y una API REST (`/rest/api/…`) para episodios, servidores y fuentes. Formato JSON en las tres.

| Qué | Valor | Cita |
|---|---|---|
| Transporte REST | `curl -L -sS --connect-timeout 10 --max-time $resolver_timeout -A "$agent" -e "${animex_refr}/" -H "Origin: ${animex_refr}" -H "Content-Type: application/json" "$@"` | ani-cli-mx-core:2177-2180 |
| Transporte GraphQL | curl propio, **sin `-e` ni `Origin`**: `curl -L -sS -A "$agent" -H "Content-Type: application/json" -X POST "${animex_graphql}/graphql" --data '{…}'` | ani-cli-mx-core:2185-2186 |
| Ruta de búsqueda | `POST https://graphql.animex.one/graphql` | ani-cli-mx-core:2185 |
| Cuerpo | `{"query":"<FastSearch>","variables":{"query":"<q>","limit":12}}` | ani-cli-mx-core:2186 |
| Documento GraphQL | `query FastSearch($query:String,$limit:Int){catalogAnime(filter:{query:$query},limit:$limit){items{id anilistId titleRomaji titleEnglish episodeCount}}}` | ani-cli-mx-core:2184 |
| Saneado de la consulta | `sed 's\|+\| \|g; s\|["\\]\| \|g'` — `+` a espacio y comillas/backslash a espacio | ani-cli-mx-core:2183 |
| Campos usados de la búsqueda | `id` y `titleRomaji` | ani-cli-mx-core:2189 |
| Episodios | `GET ${animex_api}/rest/api/episodes?id=<slug>` | ani-cli-mx-core:2234 |
| Servidores | `GET ${animex_api}/rest/api/servers?id=<slug>&epNum=<ep>&type=sub\|dub` | ani-cli-mx-core:2241 |
| Fuentes | `GET ${animex_api}/rest/api/sources?id=<slug>&epNum=<ep>&type=<t>&providerId=<id>` | ani-cli-mx-core:2254-2255 |
| Tipo `sub`/`dub` | `animex_server_type="sub"`, `dub` si `mode=dub` | ani-cli-mx-core:2239-2240, ani-cli-mx-core:2252-2253 |
| Proveedores por defecto si falla | `beep`, `uwu`, `kiwi` | ani-cli-mx-core:2469-2471 |
| Campos de `sources` | `Referer`, `Origin`, `User-Agent`, `url`+`quality`, y subtítulos `kind: captions\|subtitles` | ani-cli-mx-core:2256-2265 |

Parseo literal de la búsqueda GraphQL (ani-cli-mx-core:2185-2190):

```sh
    curl -L -sS -A "$agent" -H "Content-Type: application/json" -X POST "${animex_graphql}/graphql" \
        --data "{\"query\":\"${animex_search_gql}\",\"variables\":{\"query\":\"${animex_query}\",\"limit\":12}}" |
        sed 's|},{"id"|}\
{"id"|g' |
        sed -nE 's|.*"id":"([^"]+)".*"titleRomaji":"([^"]*)".*|\1\t\2|p' |
        sed 's|\\/|/|g; s|\\"|"|g' | stable_unique_lines
```

- El primer `sed` separa los elementos de `items` (objetos que empiezan por `{"id"`). El segundo extrae `id` y `titleRomaji` **en ese orden** del mismo objeto. El tercero desescapa `\/` y `\"`. Del resto de campos pedidos al servidor (`anilistId`, `titleEnglish`, `episodeCount`) el cliente **no usa ninguno** (ani-cli-mx-core:2184 frente a ani-cli-mx-core:2189).
- La consulta se construye por interpolación directa de la variable dentro de una cadena JSON, no con un serializador; de ahí el saneado previo que borra `"` y `\` (ani-cli-mx-core:2183).

Parseo literal de proveedores y fuentes (ani-cli-mx-core:2242-2246, ani-cli-mx-core:2256-2265):

```sh
    animex_provider_block="$(printf '%s' "$animex_servers" | tr -d '\n' | sed -nE "s|.*\"${animex_server_type}Providers\"[[:space:]]*:[[:space:]]*\[([^]]*)\].*|\1|p")"
    [ -n "$animex_provider_block" ] || return 1
    printf '%s' "$animex_provider_block" |
        grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' |
        sed -nE 's|.*"id"[[:space:]]*:[[:space:]]*"([^"]+)".*|\1|p'
```

```sh
    animex_data="$(animex_request \
        "${animex_api}/rest/api/sources?id=${animex_slug}&epNum=${ep_no}&type=${animex_type}&providerId=${animex_provider}")" || return 1
    animex_referrer="$(printf '%s' "$animex_data" | sed -nE 's|.*"Referer":"([^"]+)".*|\1|p')"
    animex_origin="$(printf '%s' "$animex_data" | sed -nE 's|.*"Origin":"([^"]+)".*|\1|p')"
    animex_user_agent="$(printf '%s' "$animex_data" | sed -nE 's|.*"User-Agent":"([^"]+)".*|\1|p')"
```

```sh
    animex_subtitles="$(printf '%s' "$animex_data" | sed 's|},{|}\
{|g' | sed -nE 's|.*"url":"([^"]+)".*"kind":"captions".*|\1|p; s|.*"url":"([^"]+)".*"kind":"subtitles".*|\1|p' | sed 's|\\/|/|g')"
    animex_entries="$(printf '%s' "$animex_data" | sed 's|},{"url"|}\
{"url"|g' | sed -nE 's|.*"url":"([^"]+)".*"quality":"([^"]+)".*|\2\t\1|p' | sed 's|\\/|/|g')"
```

- El servidor **devuelve al cliente las cabeceras que debe usar** (`Referer`, `Origin`, `User-Agent`): se leen del propio JSON y se emiten como metadatos `referrer >` y `headers >` para mpv (ani-cli-mx-core:2296-2297). Es la única fuente que negocia cabeceras por respuesta.
- Las calidades se normalizan después: se quita la `p` final y `auto` se convierte en `1080` (ani-cli-mx-core:2272).
- El proveedor `yuki` **se aplaza** al final de la lista por límites por IP de MegaPlay (ani-cli-mx-core:2475-2490, con el comentario en ani-cli-mx-core:2473-2474).

#### Proxy XOR + base64url

| Qué | Valor | Cita |
|---|---|---|
| Usado sólo para | URLs de `kwik.cx` cuando el proveedor es `uwu` | ani-cli-mx-core:2274-2277 |
| Esquema | `printf '%s\0%s' "$1" "$2"` (URL + NUL + referrer) | ani-cli-mx-core:2447 |
| Cifrado | XOR byte a byte con la clave `animex_proxy_key` repetida cíclicamente | ani-cli-mx-core:2450-2459 |
| Codificación | base64, sin saltos, `+`→`-`, `/`→`_`, sin relleno `=` | ani-cli-mx-core:2460 |
| Salida | `https://cx.aniwatchtv.site/uwu/<payload>` | ani-cli-mx-core:2461 |

Transcripción literal (ani-cli-mx-core:2446-2462):

```sh
animex_proxy_url() {
    animex_proxy_payload="$({ printf '%s\0%s' "$1" "$2"; } | od -An -tu1 -v |
        tr -s '[:space:]' '\n' | sed '/^$/d' |
        {
            proxy_key_index=1
            proxy_key_length=${#animex_proxy_key}
            while IFS= read -r proxy_byte; do
                proxy_key_char="$(printf '%s' "$animex_proxy_key" | cut -c "$proxy_key_index")"
                proxy_key_byte="$(printf '%d' "'$proxy_key_char")"
                proxy_encoded_byte=$((proxy_byte ^ proxy_key_byte))
                proxy_encoded_octal="$(printf '%03o' "$proxy_encoded_byte")"
                printf "\\${proxy_encoded_octal}"
                proxy_key_index=$((proxy_key_index % proxy_key_length + 1))
            done
        } | base64 | tr -d '\n' | tr '+/' '-_' | sed 's|=*$||')"
    [ -n "$animex_proxy_payload" ] && printf '%s/uwu/%s\n' "$animex_proxy_base" "$animex_proxy_payload"
}
```

- `od -An -tu1 -v` da los bytes en decimal; cada uno se XOR-ea con el carácter correspondiente de la clave (avanzando en ciclo de 32) y se emite como escape octal para reconstruir el flujo binario antes de `base64`. El payload lleva **la URL y el referrer separados por un byte NUL**.

#### Proxy local de Yuki (SSRF-safe)

`animex_yuki_proxy_url` (ani-cli-mx-core:2302-2444) escribe en tiempo de ejecución `yuki-proxy.py` dentro de `animex_proxy_dir` (ani-cli-mx-core:2313-2315) y lo lanza como servidor HTTP local en un puerto efímero:

| Qué | Valor | Cita |
|---|---|---|
| Requisito | Python 3 (`python3`, o `python` si declara major 3) | ani-cli-mx-core:2304-2312 |
| Escucha | `http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)` — puerto aleatorio | ani-cli-mx-core:2421 |
| Ruta | `/h/<base64url sin relleno de la URL>` | ani-cli-mx-core:2350-2352, ani-cli-mx-core:2373-2374 |
| Guarda SSRF | Sólo `https` con host; resuelve DNS y exige que **todas** las direcciones sean globales | ani-cli-mx-core:2331-2338 |
| Guarda en redirecciones | `SafeRedirect` valida la URL de destino antes de seguirla | ani-cli-mx-core:2341-2344 |
| Cookies | `http.cookiejar.CookieJar` + `HTTPCookieProcessor` | ani-cli-mx-core:2328, ani-cli-mx-core:2347 |
| Cabeceras hacia el origen | `User-Agent`, `Referer` y `Origin` recibidos por argumento | ani-cli-mx-core:2376-2378 |
| HLS | Reescribe cada URI y cada `URI="…"` de las etiquetas a URLs locales | ani-cli-mx-core:2383-2396 |
| MPEG-TS disfrazado de PNG | `png_prefix_length` salta los chunks PNG hasta `IEND` si el byte siguiente es `\x47` (sync de TS) | ani-cli-mx-core:2355-2365, ani-cli-mx-core:2398-2401 |
| Content-Type | `application/vnd.apple.mpegurl` o `video/mp2t` | ani-cli-mx-core:2396, ani-cli-mx-core:2401 |
| Handshake | El script escribe la URL local en un fichero de estado; el shell espera hasta 30 × 0,1 s = 3 s | ani-cli-mx-core:2422-2423, ani-cli-mx-core:2432-2437 |
| Limpieza | El PID se apila en `$animex_proxy_dir/pids` y `cleanup` los mata al salir | ani-cli-mx-core:2431, ani-cli-mx-core:4591-4596 |

#### Estado: es la única fuente viva de las cuatro, y ya tiene plugin

Sondeada el 12 de octubre de 2026 desde esta máquina, AnimeX es la única de las fuentes del bloque de
constantes que responde **y sirve datos** con un cliente HTTP normal:

| Qué se pidió | Resultado |
|---|---|
| `POST graphql.animex.one/graphql` con el `FastSearch` de `ani-cli-mx-core:2184` | 200, 12 elementos con `id` y `titleRomaji` |
| `GET pp.animex.one/rest/api/episodes?id=<id>` | 200, 26 episodios con número, título e imagen |
| `GET …/rest/api/servers?id=<id>&epNum=1&type=sub\|dub` | 200, tres proveedores: `nero`, `yuki`, `loli` |
| `GET …/rest/api/sources?…&providerId=nero` | 200, `url`, `quality`, `type` MIME, `tracks` y `headers` |
| `GET anidb.app/browse?q=baki` | 200, pero **redirige a `anilab.so`**: el catálogo de AniDB ya no está ahí |
| `GET jkanime.net/buscar?q=baki` | 200 con las 30 tarjetas `anime__item` y `page_directorio`: el plugin de jkanime sigue casando |
| `POST animeav1.com/api/search` | 200 con el JSON de siempre: el plugin de AnimeAV1 también |
| `GET cx.aniwatchtv.site` | no resuelve: el proxy XOR de `kwik` está muerto, y no hace falta para `nero` |

Y dos reglas que no se ven en el código de `ani-cli-mx` y que costaron una tarde de medidas:

1. **El host del manifiesto ata el token al `User-Agent` que pidió el token.** La misma URL responde
   200 si el agente de la petición al manifiesto es el mismo que el de la petición a la API, y 403 si
   es otro —o si no hay ninguno—: medido con las cinco combinaciones. Por eso el plugin declara en la
   fuente el mismo agente que usa para hablar con la API.
2. **Las pistas de subtítulos no son alcanzables.** El host que las sirve (`f0ja7.zhaevor.top`)
   contesta 403 «Website Access Blocked» desde Cloudflare a cualquier petición que salga de aquí, con
   agente o sin él, y el contrato no deja dar cabeceras por pista. El plugin no las devuelve: una pista
   que nunca carga es un botón que no lleva a ninguna parte.

El plugin está escrito y medido en vivo: búsqueda, ficha, episodios y enlaces, con el manifiesto
comprobado (`#EXTM3U`) para subtitulado y doblado. Cinco de sus seis mutaciones hacen fallar la
medición; la sexta —leer la lista de servidores de subtitulado cuando se pide doblado— no la
distingue ninguna prueba **con este título**, porque la API devuelve los mismos tres proveedores en
las dos listas, y queda declarada como tal.

---

### HentaiLA

Sólo activa con `-ha` (ani-cli-mx-core:4546-4548); en ese modo la búsqueda automática y la resolución se limitan a esta fuente (ani-cli-mx-core:2999-3003, ani-cli-mx-core:2886-2897).

| Qué | Valor | Cita |
|---|---|---|
| URL base | `https://hentaila.com` | ani-cli-mx-core:4542 |
| Transporte | `curl -L --connect-timeout 10 --max-time $resolver_timeout -s -A "$agent" -e "$hentaila_refr/" "$1"` | ani-cli-mx-core:1441-1444 |
| Cabeceras | `User-Agent` + `Referer: https://hentaila.com/` | ani-cli-mx-core:1443 |
| Ruta de búsqueda | `GET ${hentaila_refr}/catalogo?search=$1` | ani-cli-mx-core:1452 |
| Formato de respuesta | HTML (mismo marcado que AnimeAV1) | ani-cli-mx-core:1453 |
| Campos usados | slug de `/media/<slug>` y texto de `<h3>` | ani-cli-mx-core:1455 |
| Filtro de contenido | Descarta el resultado si slug+título contienen `loli`, `lolicon`, `shota`, `shotacon`, `kodomo`, `underage` o `minor` como palabra completa | ani-cli-mx-core:1446-1449 |
| Lista de episodios | `GET ${hentaila_refr}/media/<slug>` → `episodes:[…]` con `number:N` | ani-cli-mx-core:1476-1480 |
| Página del episodio | `GET ${hentaila_refr}/ver/<slug>-<ep>` | ani-cli-mx-core:1497 |
| Embeds | `embeds:{SUB:[…]}` con `server:"…"` y `url:"…"` | ani-cli-mx-core:1498-1511 |
| Prioridad de servidores | YourUpload 970, Voe 960, Vidhide* 950, MP4Upload 940, Netu 930, resto 800 | ani-cli-mx-core:1483-1492 |

Parseo literal de la búsqueda (ani-cli-mx-core:1452-1460):

```sh
    hentaila_request "${hentaila_refr}/catalogo?search=$1" | tr '\n' ' ' |
        sed 's|<article class="group/item|\
&|g' |
        sed -nE 's|.*<h3[^>]*>([^<]+)</h3>.*href="/media/([^"/?]+)".*|\2\t\1|p' |
        while IFS='	' read -r result_slug result_title; do
            [ -n "$result_slug" ] && [ -n "$result_title" ] || continue
            hentaila_result_allowed "$result_slug" "$result_title" || continue
            printf '%s\t%s\n' "$result_slug" "$result_title"
        done
```

- Nota la diferencia con AnimeAV1: aquí el salto se escribe como **salto real** dentro del literal (`|` seguido de nueva línea), no como la secuencia `\n`; el efecto es el mismo (una tarjeta por línea) pero el escape es distinto.
- El bucle descarta pares incompletos y aplica el filtro de contenido antes de emitir. La salida de la función es `slug<TAB>título`.

Parseo literal de los embeds del episodio (ani-cli-mx-core:1498-1511):

```sh
    embed_entries="$(printf '%s' "$hentaila_page" | tr '\n' ' ' |
        grep -oE 'embeds:\{SUB:\[[^]]*\]' |
        sed 's|^embeds:{SUB:\[||; s|\]$||; s|},{|}\
{|g')"
```

```sh
        server_name="$(printf '%s' "$embed_entry" | sed -nE 's|.*server:"([^"]+)".*|\1|p')"
        remote_url="$(printf '%s' "$embed_entry" | sed -nE 's|.*url:"([^"]+)".*|\1|p' | sed 's|\\/|/|g')"
```

- Recorta el array `embeds:{SUB:[…]}` completo, lo parte por `},{` y luego extrae servidor y URL de cada trozo. La variante de idioma está **fijada a `SUB`**: la expresión literal de ani-cli-mx-core:1499 es `embeds:\{SUB:\[[^]]*\]`, así que cualquier bloque `embeds:{DUB:…}` queda fuera del alcance de la función.

---

### Salud de las fuentes

| Qué | Valor | Cita |
|---|---|---|
| `probe_search_endpoint` | `curl -L --connect-timeout 10 --max-time $resolver_timeout -sS -o /dev/null -w '%{http_code}' "$probe_url" -A "$agent"`; acepta `2??` y `3??` | ani-cli-mx-core:526-527, ani-cli-mx-core:535-541 |
| Respeto al back-off | Si el nombre es `JKAnime` y `$hist_dir/jkanime-blocked-until` está en el futuro, no repite la consulta y devuelve 1 | ani-cli-mx-core:520-525 |
| `diagnose_empty_search` | Prueba AnimeAV1 en `${animeav1_refr}/catalogo?search=<q>` y luego JKAnime en `${jkanime_refr}/buscar?q=<q>` | ani-cli-mx-core:548-549 |
| Si alguna prueba falla | `die "No fue posible consultar las fuentes. Revisa DNS, firewall, proxy, antivirus o certificados TLS"` | ani-cli-mx-core:551-553 |
| Si todas responden | `die "No se encontraron resultados"` | ani-cli-mx-core:555 |
| En modo hentaila | No diagnostica: muere directamente con «No se encontraron resultados» | ani-cli-mx-core:546 |
| `probe_stream_link` | `curl -I -L … -s -e "$1" "$2" -A "$agent"` (HEAD con referrer) y grep de `content-type:` de vídeo o m3u8 | ani-cli-mx-core:1016-1019 |
| `disable_spanish_source` | Sólo en memoria: añade a `disabled_spanish_sources` y, si era la fuente de fast mode, limpia su lista y recalcula `ep_list` | ani-cli-mx-core:952-962 |
| `disable_source_mirror` | Sólo si `fast_mode=1` y es la fuente activa; añade `fuente>espejo` a `$fast_mode_mirror_file` | ani-cli-mx-core:978-988 |
| Persistencia de esa lista | `fast_mode_mirror_file` es un `mktemp` y se borra en `cleanup`: **vive lo que dura el proceso** | ani-cli-mx-core:4581, ani-cli-mx-core:4599 |
| `source_status` | Mensajes coloreados: `ok` = «Links Fetched», `fallback` = «Fallback Only», `skip` = «No valid Link», `disabled` = silencio | ani-cli-mx-core:1003-1010 |
| Desactivación automática en fast mode | Si `store_spanish_links_for_source` falla para la fuente sembrada, se llama a `disable_spanish_source` | ani-cli-mx-core:2930-2934 |
| Desactivación de espejos de AnimeAV1 | Al final de `extract_animeav1_links`, todo espejo fallido que no esté en `ok_mirrors` se desactiva | ani-cli-mx-core:2030-2037 |

#### Qué hay en disco

| Ruta | Contenido | Validez | Cita |
|---|---|---|---|
| `$hist_dir` | Directorio de estado creado al arrancar | Permanente | ani-cli-mx-core:4611-4612 |
| `$hist_dir/ani-hsts` | Historial de reproducción (o `ani-hsts-ha` en modo hentaila) | Permanente | ani-cli-mx-core:4613-4618 |
| `$hist_dir/jkanime-blocked-until` | Epoch hasta el que JKAnime está en pausa; se escribe `ahora+65` tras un 429 | 65 s | ani-cli-mx-core:469, ani-cli-mx-core:482 |
| `$hist_dir/jkanime-episodes/<cksum>/meta` | 6 líneas: epoch, anime_id, csrf, last_page, último episodio, orden | 300 s | ani-cli-mx-core:3112, ani-cli-mx-core:3123-3126, ani-cli-mx-core:3157-3158 |
| `$hist_dir/jkanime-episodes/<cksum>/page-N.json` | Respuesta AJAX de cada página descargada | Se invalida con la generación (300 s) o por borrado explícito | ani-cli-mx-core:3129, ani-cli-mx-core:3139-3142 |
| `$hist_dir/jkanime-episodes/<cksum>/cookies` | Jar de cookies de JKAnime | Igual que la generación | ani-cli-mx-core:3130 |
| `$hist_dir/jkanime-episodes/<cksum>/request-time` | Epoch de la última petición de página, para el límite de 1 req/s | 1 s | ani-cli-mx-core:3168-3172 |
| `$hist_dir/jkanime-episodes/<cksum>/view.$$` | Última página visitada por ese PID | Lo que dure el proceso | ani-cli-mx-core:3267-3269 |
| `quality_cache_file` | `mktemp`; primera línea `id\|ep_no`, luego bloques `validated`/`resolution`/`source`/`site`/`language`/`active` y la marca `prepared` | Sólo la sesión (se borra en `cleanup`) | ani-cli-mx-core:4586, ani-cli-mx-core:4599, ani-cli-mx-core:2872-2877, ani-cli-mx-core:1078-1081 |
| `$animex_proxy_dir` | `mktemp -d`; `yuki-proxy.py`, `state.XXXXXX`, `state.XXXXXX.log`, `pids` | Sólo la sesión (se borra y se matan los procesos en `cleanup`) | ani-cli-mx-core:4582-4583, ani-cli-mx-core:4591-4596 |
| `default_cache_dir` | Definido pero **nunca usado** | — | ani-cli-mx-core:353-359 |

Deducción: **no hay caché en disco de las respuestas de búsqueda** de ninguna fuente. Lo único persistente relacionado con peticiones es el catálogo de episodios de JKAnime y el back-off de 429; todo lo demás son temporales por proceso.

---

### Ciclo de vida de una búsqueda

#### 1. Búsqueda de título (`search_anime`, ani-cli-mx-core:2998-3028)

1. **Modo hentaila** (`hentaila_mode=1`): sólo `search_hentaila_variants` y termina (ani-cli-mx-core:2999-3003).
2. **Fuente forzada** (`preferred_info_source != auto`, opción `--source`): sólo `search_anime_for_source` de esa fuente y termina (ani-cli-mx-core:3005-3008).
3. **Auto**, en este orden estricto y sin cortocircuito (se concatenan todos los que respondan):
   - AnimeAV1 (`search_animeav1_variants`) — ani-cli-mx-core:3011-3013
   - JKAnime (`search_jkanime_variants`) — ani-cli-mx-core:3015-3017
   - AniDB (`search_anidb_catalog`), **sólo si `anidb_curl_exe` existe** — ani-cli-mx-core:3019-3023
   - AnimeX (`search_animex_catalog`) — ani-cli-mx-core:3024-3026
4. Cada bloque se etiqueta con `prefix_search_results`, que produce `fuente:id<TAB>título<TAB>título [Etiqueta]` (ani-cli-mx-core:840-853); el menú añade `[ESPAÑOL]`, `[ENGLISH]` o `[ESPAÑOL/LATINO]` según el prefijo (ani-cli-mx-core:861-866).
5. Si el resultado agregado está vacío, `diagnose_empty_search` prueba los dos endpoints españoles para distinguir «sin red» de «sin resultados» (ani-cli-mx-core:4826, ani-cli-mx-core:544-556).
6. Para películas/series/doramas no se usa nada de lo anterior: `search_pelisplus` con el tipo pedido (ani-cli-mx-core:4828); vacío se traduce en «No se encontraron películas/series» (ani-cli-mx-core:4829).

#### 2. Resolución de un episodio (`get_episode_url`, ani-cli-mx-core:2844-2973)

| Orden | Condición | Acción | Cita |
|---|---|---|---|
| 1 | `authoritative_site = pelisplus` | `resolve_pelisplus_media`; exige `openssl awk od dd`; si no hay enlace, `die` | ani-cli-mx-core:2850-2853 |
| 2 | `hentaila_mode=1` | `resolve_hentaila_episode`; si no hay enlace, distingue «episodio no publicado» de «sin fuentes válidas» | ani-cli-mx-core:2886-2897 |
| 3 | `authoritative_site = anidb` y hay curl-impersonate | `resolve_anidb_episode`; si falla, avisa y sigue | ani-cli-mx-core:2899-2912 |
| 4 | `authoritative_site = animex` | `resolve_animex_episode`; marca `animex_tried=1` para no repetirlo | ani-cli-mx-core:2914-2926 |
| 5 | Fast mode con fuente sembrada | `store_spanish_links_for_source`; si falla, **desactiva la fuente para la sesión** | ani-cli-mx-core:2928-2934 |
| 6 | Siempre que no haya fast source | Bucle `jkanime` → `animeav1`: el primero que devuelva enlaces gana; en fast mode rompe al primero | ani-cli-mx-core:2936-2945 |
| 7 | Uno de los dos produjo enlaces | `pick_spanish_source_links`: si hay varios, menú; si hay uno, automático | ani-cli-mx-core:2947-2948, ani-cli-mx-core:1231-1255 |
| 8 | Ninguno produjo enlaces | Fuente inglesa: AniDB primero, AnimeX después **sólo si no se intentó ya** | ani-cli-mx-core:2949-2965 |
| 9 | Sin enlace al final | `die` distinguiendo episodio ya publicado de episodio no disponible | ani-cli-mx-core:2967-2972 |

Dentro del paso 6, `store_spanish_links_for_source` aplica filtros posteriores a la resolución y, en el caso de AnimeAV1, sólo acepta enlaces «verificados» (ani-cli-mx-core:2507-2526). La lista de episodios autoritativa se calcula antes, con `episodes_list_for_source` de la fuente autoritativa o, en su defecto, con la lista general (ani-cli-mx-core:2882-2884).

#### 3. Qué se cachea y cuándo

- La **búsqueda** no se cachea en ningún momento: cada ejecución vuelve a pedir a las cuatro fuentes (ani-cli-mx-core:3010-3026).
- El **catálogo de episodios de JKAnime** sí: 300 s por serie, con generación completa y `page-N.json` reutilizables (ani-cli-mx-core:3123-3126).
- El **back-off de 429 de JKAnime** es el único estado que sobrevive al proceso, 65 s (ani-cli-mx-core:482, ani-cli-mx-core:520-525).
- El **menú de calidades de PelisPlusHD** se guarda en un temporal de sesión con clave `id|ep_no`, y se invalida si el episodio cambió (ani-cli-mx-core:1078-1081, ani-cli-mx-core:2872-2877).
- Las **desactivaciones de fuente y de espejo** son de sesión y no se persisten (ani-cli-mx-core:952-962, ani-cli-mx-core:978-988).

---

### Dudas

1. **`--http2` en AniDB.** La tarea lo daba por hecho, pero `anidb_request` (ani-cli-mx-core:2088-2091) no lo pasa y no aparece ninguna ocurrencia de `http2` en el fichero. Si el flag es necesario, lo añade el envoltorio `curl_*` de curl-impersonate, no este script.
2. **`jkanime_request` con `-f` y el 429.** Con `-f`, curl falla en HTTP ≥ 400 y el `if` de ani-cli-mx-core:475 no entra; aun así el código usa `$jkr_status` para detectar el 429 en ani-cli-mx-core:481. Deducción: se apoya en que la sustitución de ordenación (`jkr_status="$(…)"`) conserve la salida capturada aunque el comando termine con estado distinto de cero, y en que no hay `set -e`. No lo he probado ejecutando el script.
3. **Caducidad exacta de `view.$$`.** El fichero se reescribe con la página encontrada (ani-cli-mx-core:3267) pero no se borra hasta la siguiente generación (ani-cli-mx-core:3129); no he verificado si se lee entre procesos distintos o sólo dentro del mismo PID.
4. **`default_cache_dir`.** Definida y nunca invocada (ani-cli-mx-core:353-359). Deducción: código muerto o reservado para un uso futuro; ninguna caché de este script vive ahí.
5. **Formato real del bloque `downloads` de AnimeAV1.** El parseo de ani-cli-mx-core:2047 asume que la página contiene literalmente `downloads:{…}},uses:…`; no he visto una muestra real, así que no puedo confirmar el orden ni la ausencia de objetos anidados que rompan el `.*` codicioso.
6. **`packed` del desempaquetador.** Sin una respuesta real del espejo no puedo confirmar que el marcador `}('` y la expresión `',<a>,<c>,'` casen siempre; tampoco si `a` puede ser 1 (donde `digit_value` devolvería 0 para cualquier carácter y el diccionario se indexaría mal).
7. **Cabeceras de la búsqueda de AnimeX.** `animex_request` añade `-e` y `Origin` (ani-cli-mx-core:2178-2179) pero `search_animex_catalog` construye su propio `curl` sin ellos (ani-cli-mx-core:2185-2186). Deducción: o el GraphQL no los exige, o la búsqueda está sujeta a un rechazo que la parte REST no tiene. No verificado.
8. **Umbral de la prueba de trabajo.** El `POW_DIFFICULTY` real no está en el código (llega en el HTML); no sé si 200000 intentos bastan para las dificultades que publica el sitio. El límite es configurable por `ANI_CLI_PELISPLUS_POW_LIMIT` (ani-cli-mx-core:2543).
9. **Alcance del `grep -Evi` de AnimeAV1.** La última línea del bloque de prioridades (ani-cli-mx-core:1930) captura cualquier servidor no listado, pero el orden relativo dentro de ese resto depende del orden del HTML de origen, que no he podido observar.
10. **Nada de esto está verificado en vivo**: por las reglas del encargo no se ha hecho ninguna petición de red ni se ha ejecutado `ani-cli-mx-core`; todas las rutas y formatos son lectura del código.

---

## Parte C — nn-anime frente a ani-cli-mx, y qué hacer con esto

Comparación con el código de **este** repositorio y con el repositorio de plugins
[`zxuru/nn-anime-plugins`](https://github.com/zxuru/nn-anime-plugins) (copia local de la rama `main` en
`.tmp/nnp/nn-anime-plugins-main/`). Los archivos del repositorio de plugins se citan por su ruta
`providers/<archivo>.ts`, porque no viven aquí.

### La cadena de búsqueda de nn-anime, entera

1. **La interfaz** pide `GET /api/search?q=…` y lo consume como SSE
   (`packages/server/src/routes/search.ts:65`, `:134`).
2. **El agregado** normaliza la consulta con `normalizeQuery` —`trim`, minúsculas, NFC; **los acentos
   se quedan**— y llama a cada proveedor activo **en paralelo** con su propio plazo de 8 s
   (`packages/server/src/search/aggregate.ts:199`, `:32`, `packages/core/src/models.ts:162`,
   `docs/specs/SPEC-provider-core.md:236`).
3. **El plugin** recibe esa única cadena y hace lo que sepa (`packages/provider-sdk/src/types.ts:98`).
   Los dos plugins reales hacen **una** petición y devuelven lo que el sitio conteste, en el orden del
   sitio y sin tocarlo:
   - `GET https://jkanime.net/buscar/<encodeURIComponent(consulta)>/` (`providers/jkanime.ts:671-675`).
   - `POST https://animeav1.com/api/search` con `{"query": "<consulta>"}`
     (`providers/animeav1.ts:459-475`).
4. **La presentación** agrupa por obra —título normalizado y año— y dentro del grupo ordena por la
   preferencia de proveedores y por el nombre más largo (`packages/web/src/features/search/useSearchStream.ts:124-178`).
   Entre grupos, **el orden es el de llegada**: el orden en que el plugin devolvió sus resultados sí se
   ve.
5. **La caché** guarda el resultado por proveedor y consulta normalizada, 900 s, con revalidación en
   segundo plano (`packages/server/src/container.ts:542-574`, `docs/specs/SPEC-nn-anime.md:207`).
   Guarda **también la lista vacía**: `readThrough` escribe lo que devuelva el `fetch` sin mirar si
   venía algo (`packages/server/src/cache-read.ts:54-59`, `packages/catalog-store/src/store.ts:287`).

### Qué hace ani-cli-mx en cada uno de esos puntos

| Punto | ani-cli-mx | nn-anime hoy |
|---|---|---|
| Formas de la consulta | dos como máximo: macrones expandidos (`Ō`→`ou`) y macrones colapsados (`Ō`→`o`); acentos, `ç` y `ñ` reducidos en ambas — `ani-cli-mx-core:571-617` | una, tal como la escribió el usuario (solo `trim`+minúsculas+NFC) |
| Espacios | se codifican a `+` en un solo punto — `:600-602` | `encodeURIComponent` en el plugin: `%20` |
| Fuentes que se consultan | **cuatro**: AnimeAV1, JKAnime, AniDB y AnimeX — `:3011-3026` | las que haya instaladas (dos: jkanime y animeav1) |
| Orden del listado | el de las fuentes, concatenado, sin reordenar — `:3011-3027` | el de llegada por proveedor (igual) |
| Puntuación de títulos | `title_match_score` + umbral 140, **para identificar** el título en otra fuente, no para ordenar el menú — `:718-773` | no existe: la identificación la hace el usuario al elegir |
| Temporadas | se extraen del texto y del slug y ajustan la puntuación — `:628-667` | no se miran |
| Caché de búsqueda | **ninguna**: cada ejecución vuelve a preguntar — `:3010-3026` | 900 s por (proveedor, consulta), incluido el vacío |
| Búsqueda vacía | sondea los endpoints y distingue «sin red» de «sin resultados» — `:544-556` | se reporta el vacío del proveedor, sin más |
| Constancia de una fuente caída | *back-off* de 65 s tras un 429, persistido — `:469-484` | el plugin de jkanime ya lo hace en memoria (`providers/jkanime.ts:203-262`) |

### Entonces, ¿por qué no salen búsquedas parecidas?

Por orden de probabilidad, con lo que hay que comprobar en cada caso:

1. **Acentos y macrones.** ani-cli-mx busca `accion`, `Shingeki+no+Kyojin`, `Boku+no+Hiro+Akademia`
   —todo plegado—; los plugins de nn-anime mandan la consulta **tal cual**, y `normalizeQuery` no
   quita acentos a propósito (`packages/core/src/models.ts:150-164`). Si el buscador del sitio no
   pliega por su cuenta, `acción` y `Boku no Hīrō Akademia` devuelven cero en nn-anime y resultados en
   ani-cli-mx. Es la diferencia más fácil de medir y la más probable en consultas escritas en español.
2. **Solo hay dos fuentes, y las dos son españolas.** ani-cli-mx pregunta además a AniDB y a AnimeX,
   que es donde aparecen los títulos en inglés y romaji. Un título que en jkanime está como «Shingeki
   no Kyojin» y en AnimeAV1 como otra cosa se encuentra en ani-cli-mx aunque falle en una; en nn-anime
   solo se pregunta a quien esté instalado.
3. **El vacío se cachea quince minutos.** Una búsqueda que falló —429, plazo de 8 s, consulta con
   acentos— deja la entrada escrita y repetirla no la reintenta. Repetir la búsqueda en la interfaz da
   la impresión de que «el sitio no lo tiene». ani-cli-mx no cachea ninguna búsqueda.
4. **La forma de la URL y el parser no son los mismos.** ani-cli-mx usa
   `GET …/buscar?q=<consulta>` (`:1535`) y `GET …/catalogo?search=<consulta>` con HTML
   `<article class="group/item">` (`:1745-1747`); los plugins usan `…/buscar/<consulta>/` y
   `POST /api/search` (JSON). Si el parser del plugin se apoya en una marca que ya no está —jkanime
   recorta por `page_directorio` y `class="anime__item"` (`providers/jkanime.ts:313-338`)—, el
   resultado es una lista vacía **sin error**, que es exactamente el síntoma.
5. **La puntuación no es lo que falta.** ani-cli-mx tampoco ordena su menú de resultados: muestra lo
   que cada sitio devolvió. Su `title_match_score` sirve para lo otro —elegir la ficha del mismo
   anime en la segunda fuente, y en nn-anime esa decisión la toma el usuario con la tarjeta «También
   en»—. Portarla es útil, pero no explica un vacío.

### Cómo comprobarlo en diez minutos

Con un solo título que falle y otro que funcione (los dos, escritos con acento si es posible):

1. Ver qué manda el plugin y qué contesta el sitio: abrir la búsqueda en la interfaz con las
   herramientas del navegador, o repetir la misma URL a mano y mirar el HTML. Si el HTML trae
   tarjetas y nn-anime no las pinta, el parser es el que falla, no la red.
2. Repetir la misma consulta sin acentos y con acentos. Si la primera trae y la segunda no, es el
   plegado (punto 1).
3. Borrar a mano la fila que corresponda de `search_cache` y repetir la consulta que salió vacía. Si
   ahora sale, era la caché negativa (punto 3). Ojo: `bun run db:prune` **no** la toca —la limpieza
   sólo mira `stream_cache`, `watch_event`, `favorite`, `episode`, `genre` y `anime`
   (`packages/catalog-store/src/prune.ts:82-89`)—, así que la vía es el `DELETE` directo o esperar los
   900 s.

### Receta para el repositorio de plugins (no para este)

Para el `search` de `providers/jkanime.ts` y el de `providers/animeav1.ts`, por orden de coste y de
provecho:

1. **Plegar la consulta en el plugin**: quitar diacríticos (`NFD` + fuera las marcas), colapsar
   espacios y minúsculas. La normalización de la aplicación juega a otra cosa —es la clave de la
   caché— y no se debe cambiar.
2. **Probar dos formas** cuando la consulta traiga caracteres no ASCII: la plegada y la original, en
   serie y con corte en cuanto una devuelva tarjetas. Cubre el caso del macrón (`Hīrō`→`Hiro`) sin
   gastar dos peticiones en consultas que ya son ASCII.
3. **Ordenar antes de devolver** si se quiere que el orden signifique algo. ani-cli-mx no ordena su
   menú, pero en nn-anime el orden del plugin **es** el orden de las tarjetas, así que portar la idea
   de `title_match_score` (`ani-cli-mx-core:718-768`, transcrita en la parte A) es la única forma de
   que el título correcto salga primero.
4. **Que un parser vacío sea un error, no una lista vacía.** Un `search` que devuelve `[]` porque ya
   no encuentra `class="anime__item"` es indistinguible de un sitio sin resultados; lanzar cuando el
   HTML no trae **ninguna** tarjeta pero sí el contenedor de la página convierte un cambio de marcado
   en un mensaje. ani-cli-mx hace lo contrario —parsea y calla—, pero su `diagnose_empty_search`
   (`:544-556`) existe justo porque el silencio cuesta diagnósticos.
5. **No gastar el presupuesto de 8 s**: dos peticiones como mucho, la segunda solo si la primera
   volvió vacía. El contrato permite varias peticiones por búsqueda
   (`docs/specs/SPEC-provider-core.md:234-241`), pero el plazo es por llamada y no se amplía.

### Mejoras que sí son de este repositorio

- **No cachear la lista vacía**, o cachearla con un TTL mucho más corto. Hoy una búsqueda fallida
  bloquea el reintento quince minutos y el síntoma se le achaca al plugin. La decisión es del servidor
  (`packages/server/src/cache-read.ts:54-59`, `packages/server/src/container.ts:557-559`).
- **Decir en la interfaz que la búsqueda salió vacía y ofrecer repetirla**; hoy no hay ningún gesto
  que fuerce una consulta nueva antes del TTL, ni forma de saber que el resultado venía de la caché
  (`packages/web/src/features/search/SearchPage.tsx`).
- **Documentar el presupuesto en `docs/providers.md`**: el autor de un plugin no encuentra ahí ni los
  8 s, ni que puede hacer más de una petición por búsqueda, ni que un `[]` se cachea.

### Lo que ya se construyó a partir de este estudio

| Fuente | Estado |
|---|---|
| `animex` | **Plugin escrito y medido en vivo** (búsqueda, ficha, episodios y enlaces con el manifiesto comprobado). Es la tercera fuente de la instalación y la primera con API: la parte B cuenta lo que se midió, incluidas las dos reglas del `User-Agent` y de los subtítulos |
| `pelisplushd` | Plugin escrito y medido contra un sitio falso; **su dominio ya no existe**, así que hoy no sirve para ver nada. Con un dominio vivo se apunta con `NN_ANIME_PELISPLUS_URL` |
| `jkanime`, `animeav1` | Los plugins que ya existían siguen casando con los sitios vivos, comprobado en el mismo sondeo: quedan pendientes el plegado de acentos y el orden por puntuación de la receta de arriba |

---

## Parte D — películas, series y doramas: cómo servirlos aquí

La búsqueda de anime y la de películas **no comparten camino** en ani-cli-mx, y esa separación es la
primera decisión de diseño que hay que entender: el anime se reparte entre cuatro fuentes, y todo lo
que no es anime va a **una sola**, PelisPlusHD, que además está excluida del anime a propósito
(el `README.md` de ani-cli-mx, líneas 28-29). La buena noticia para nn-anime es que **su contrato ya admite películas hoy**:
lo que falta es un plugin, no una función nueva.

### D.1 Cómo lo hace ani-cli-mx

#### El tipo se pregunta antes que la consulta

`media_type_menu_options` ofrece cuatro tipos cerrados —anime, película, serie, dorama— más «volver»
(`ani-cli-mx-core:114-120`), `media_type_menu` los pinta (`:122-127`) y `normalize_media_kind` acepta
las variantes escritas y en español de cada uno (`:129-137`). Por argumentos se salta el menú
(`--type movie|series|dorama`, `README.md` de ani-cli-mx, líneas 33-40), y con `-e s1e1` se salta también el selector de
episodio.

Preguntar el tipo primero **no es una preferencia de interfaz: es una necesidad de PelisPlusHD**, que
no dice en su buscador si un resultado es película, serie o dorama. El tipo se deduce así:

| Paso | Cómo | Cita |
|---|---|---|
| Tipo grueso | La ruta del enlace: `…/pelicula/<slug>` o `…/serie/<slug>` | `ani-cli-mx-core:3052`, `:3050` |
| Serie o dorama | Una petición extra a la ficha, buscando `title="Películas del Genero: Dorama"` | `ani-cli-mx-core:3030-3041`, `:3058-3065` |
| Coste | Hasta 4 peticiones antes de emitir **un** resultado de serie | `ani-cli-mx-core:3032-3038`, `:3060` |
| El tipo viaja en la referencia | `pelisplus:<movie\|series\|dorama>:<slug>` | `ani-cli-mx-core:789-796`, `:798-800` |

#### Rutas de cada tipo

| Qué | Ruta | Cita |
|---|---|---|
| Búsqueda | `GET <base>/search?s=<consulta urlencoded>`, 3 intentos, éxito si aparece `href="…/(pelicula\|serie)/` | `ani-cli-mx-core:503-515`, `:3043-3050` |
| Película | `<base>/pelicula/<slug>` | `ani-cli-mx-core:805` |
| Serie y dorama | `<base>/serie/<slug>/temporada/<N>/capitulo/<M>` | `ani-cli-mx-core:810-811` |
| Lista de episodios | `GET <base>/serie/<slug>` y `grep -Eo '/serie/<slug>/temporada/[0-9]+/capitulo/[0-9]+'` | `ani-cli-mx-core:3398-3403` |

Y el detalle que decide todo lo demás: **una película es un solo elemento**, literalmente la cadena
`movie` (`episodes_list_pelisplus`, `ani-cli-mx-core:3394-3395`), mientras que una serie se lista
extrayendo pares temporada/capítulo de la página y etiquetándolos `s<N>e<M>` (`:3400-3403`). El
buscador de la búsqueda no hace nada especial con el tipo: se pide la consulta y se filtra lo que
llega.

Lo que **no** cambia entre anime y películas es lo caro: el enlace. PelisPlusHD exige referrer en
todas las peticiones, prueba de trabajo SHA-256, descifrado AES-256-CBC y desempaquetar un
`eval(function(p,a,c,k,e,d){…})` (parte B, «PelisPlus (HD)»). Eso es trabajo del resolutor, no de la
búsqueda.

### D.2 Lo que nn-anime ya soporta (medido, no supuesto)

| Pieza | Evidencia | Consecuencia |
|---|---|---|
| El vocabulario incluye películas | `titleKindSchema = ['tv','movie','ova','ona','special']` (`packages/core/src/schema.ts:130`) | Un plugin puede declarar `kind: 'movie'` |
| `kind` es opcional en búsqueda y ficha | `searchResultSchema` (`packages/core/src/schema.ts:169-176`), `animeDetailSchema` (`:191-197`) | Un plugin que no lo sepa no rompe |
| Ya hay una película en el fixture | `"kind": "movie"`, `"episodeCount": 1` (`packages/providers-fixture/fixtures/catalogo.json:52-54`) | El camino está recorrido; el fixture pasa la conformidad |
| Una película es un título con un episodio | `episodios()` genera de 1 a `episodeCount` (`packages/providers-fixture/src/data.ts:134-139`) | No hace falta un «título sin episodios» |
| La ficha separa temporadas de películas | `TIPOS_DE_SERIE = ['tv','ona']` y `esSerie()` (`packages/web/src/features/detail/SagaRail.tsx:33-44`), con prueba propia (`packages/web/src/features/detail/detail.test.tsx:548-564`) | «Películas y especiales» ya es una sección |
| Reproducir no sabe de anime | `StreamSource = { url, kind: 'hls'\|'file', quality?, headers?, subtitles? }` (`packages/core/src/schema.ts:161-167`) | Un `.mp4` o un `.m3u8` es todo lo que hace falta |
| El upstream puede exigir cabeceras | `StreamSource.headers` (`packages/core/src/schema.ts:165`) y el proxy las reenvía sin que lleguen al navegador (`packages/server/src/routes/stream.ts:319-327`) | El `Referer` obligatorio de PelisPlusHD cabe en el contrato |

**Conclusión: no hay que cambiar el contrato, ni la ficha, ni el reproductor.** Un plugin que devuelva
`kind: 'movie'` y un episodio funciona hoy.

### D.3 Las tres decisiones que sí hay que tomar

#### 1. Una película necesita una referencia de episodio

`StreamRequest` exige `episodeRef` (`packages/core/src/schema.ts:232-234`), así que no existe «reproducir
un título» sin episodio. La forma que ya usa el fixture: `number: 1`, `mode: 'sub'` y un `ref` propio
(`packages/providers-fixture/src/data.ts:130-139`). La ficha pintará una lista de un solo elemento y el
reproductor no ofrecerá «siguiente». El `mode` de una película es una etiqueta: el plugin puede
ignorarlo y devolver el audio que el embed traiga.

#### 2. Cómo numerar las temporadas de una serie

`Episode` **no tiene campo de temporada** (`packages/core/src/schema.ts:215-230`), y el número se usa
como `id` del DOM y como clave de lo visto (`packages/web/src/features/detail/EpisodeList.tsx:167`),
así que dos episodios no pueden compartir número. Las opciones:

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **(a) Una referencia por temporada** — recomendada | `serie/<slug>/temporada/3`, título «X · Temporada 3», episodios 1..N dentro de la temporada | Encaja con el rail de temporadas que ya existe (`SagaRail.tsx`), con «continuar viendo» y con siguiente/anterior, que nunca cruzan de temporada sin decirlo | La búsqueda devuelve una fila por temporada, o hay que elegir cuál exponer |
| (b) Una referencia para toda la serie | Numeración corrida 1..N y el título del episodio con «T3 E7» (el título se pinta: `EpisodeList.tsx:192-193`) | Una sola fila por serie; el parseo de la página es el mismo | El número deja de significar algo para el usuario; «siguiente» cruza de temporada; la ventana de 100 mezcla temporadas |
| (c) Codificar temporada y episodio en el número | `3 * 1000 + 7` | Una sola fila y sin colisiones | La lectura y las ventanas se rompen; descartada |

Con (a) el «slug de temporada» no hace falta inventarlo: la propia ruta del sitio ya lo tiene
(`/serie/<slug>/temporada/<N>/capitulo/<M>`, `ani-cli-mx-core:3400`), y el rail de temporadas agrupa por
título en cuanto los títulos se parezcan —la heurística de la casa, `docs/specs/proposals/SPEC-anime-detail.temporadas.md:8-14`—.

#### 3. El tipo en la tarjeta sale en inglés

`ResultCard` añade el `kind` tal cual a la línea de metadatos
(`packages/web/src/features/search/ResultCard.tsx:40`) y **no hay etiquetas** para él en
`packages/web/src/i18n/es.ts` (la única relacionada es `detail.related.movies`, `:390`): hoy una
película se anuncia con la insignia «movie». Es un arreglo de tres líneas en la interfaz —una clave por
tipo y un mapa—, no un cambio de contrato, y no bloquea nada.

### D.4 Receta: un plugin `pelisplushd.ts` para nn-anime-plugins

Esqueleto, no copia: lo que hay que hacer en cada método y las trampas de cada uno.

#### Constantes y capacidades

```ts
const ID = 'pelisplushd'
const BASE = 'https://pelisplushd.bz'
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'

// El referrer es obligatorio en TODAS las peticiones del sitio, no sólo en el video.
const CABECERAS = { referer: `${BASE}/`, 'user-agent': AGENTE, 'accept-language': 'es-ES,es;q=0.9' }

capabilities: { search: true, sub: true, dub: true, trending: false, feed: false }
```

`dub: true` si el plugin resuelve las pistas `LAT`/`ESP` (que es el «dub» de este sitio) y `sub: true`
si resuelve `SUB`; si sólo sabe hacer una, que lo diga: la interfaz ofrece un botón por capacidad
declarada (`docs/providers.md:285-290`).

#### `search`

Una sola petición, sin la petición extra de dorama de ani-cli-mx:

```ts
async search(query, options) {
  const url = `${BASE}/search?${new URLSearchParams({ s: query })}`
  const html = await (await pedir(url, options)).text()
  return filas(html) // [{ ref: { value: 'pelicula/<slug>' }, title, kind: 'movie'|'tv', coverUrl }]
}
```

- El parseo es el de la parte B: cortar por `<a href=`, quedarse con los enlaces que contienen
  `/(pelicula|serie)/` y leer `data-title="VER … Online Gratis HD"`; si no está, derivar el título del
  slug cambiando `-` por espacio (`ani-cli-mx-core:3046-3055`).
- **El `kind` sí hay que devolverlo aquí**: `'movie'` para `/pelicula/`, `'tv'` para `/serie/`. Sin él,
  la ficha no puede separar «Temporadas» de «Películas y especiales».
- **El `year` también, si el bloque lo trae**: el rail ordena por año y sin año esa fila se va al final
  en vez de inventarse uno (`docs/specs/proposals/SPEC-anime-detail.temporadas.md:12-14`).
- Aquí no hace falta preguntar el tipo antes de buscar: el resultado ya lo dice. Tampoco hay que
  distinguir el dorama —para esta aplicación un dorama es una serie— y eso ahorra hasta tres
  peticiones por resultado.

#### `getAnime`

La referencia lleva el tipo, que es lo que hace falta para saber a qué ruta pedir:

```ts
// pelicula/interstellar#1  ->  no lleva temporada
// serie/elementary/temporada/5#3
```

Con eso, `getAnime` pide `${BASE}/${rutaSinEpisodio}` y lee título, portada (`og:image`), sinopsis
(`og:description`) y año. El `kind` sale de la referencia, no de la página: es el dato que el plugin ya
tenía al buscar, y volver a deducirlo es donde se pierde.

#### `getEpisodes`

| Caso | Qué devolver |
|---|---|
| Película | Un episodio: `number: 1`, `mode: 'sub'`, `ref.value = 'pelicula/<slug>#1'` |
| Serie | `GET ${BASE}/serie/<slug>/temporada/<N>`, `matchAll(/\/temporada\/(\d+)\/capitulo\/(\d+)/g)` y un episodio por capítulo con `number: M` y `ref.value = 'serie/<slug>/temporada/<N>#<M>'` |

- El `number` puede ser decimal (el contrato lo permite: `packages/core/src/schema.ts:218-226`) y el
  sitio numera con enteros.
- El `title` del episodio es opcional y se pinta si está (`EpisodeList.tsx:192-193`): es el sitio
  natural para «Temporada 5 · Episodio 2» si se elige la opción (b) de D.3.

#### `resolveStream`: la cadena, portada a TypeScript

Es el 90 % del trabajo del plugin, y todo está transcrito en la parte B. En orden:

1. `GET` la página del episodio con el `Referer` de la propia página.
2. Sacar el embed: `video[N] = '…embed69…'` (`ani-cli-mx-core:2742`) y pedirlo con el referrer de la
   página del episodio (`:2745`).
3. **Camino barato primero**: si el embed trae `playServerVast('…vidhide…')`, ya hay host
   (`ani-cli-mx-core:2748`) y no hay que resolver nada.
4. Si no, **prueba de trabajo**: `POW_CHALLENGE`, `POW_DIFFICULTY`, `POW_SALT` del embed, y buscar el
   primer nonce decimal tal que `sha256(challenge + nonce)` empiece por `difficulty` ceros
   hexadecimales (`:2528-2553`). En Node o Bun: `createHash('sha256').update(...)`, unos 200 000
   intentos (`ANI_CLI_PELISPLUS_POW_LIMIT`) que en JavaScript se resuelven en décimas de segundo.
5. **Descifrado**: `link` en base64 → los 16 primeros bytes son el IV, el resto el cuerpo;
   `createDecipheriv('aes-256-cbc', sha256hex(challenge + nonce + salt), iv)` (`:2557-2578`). El
   resultado tiene que empezar por `http`.
6. Pedir el espejo con el referrer del embed, **siguiendo redirecciones y quedándose con la URL
   final**, que es el referrer del manifiesto (`:2693-2709`).
7. **Desempaquetar** el `eval(function(p,a,c,k,e,d){…})` con el algoritmo de la parte B
   (`:2632-2691`): localizar `}('`, leer `',<radix>,<count>,'`, el diccionario entre `'.split('|')`, y
   sustituir cada token alfanumérico por `diccionario[valor en base radix]`. Son unas treinta líneas.
8. Quedarse con el primer `.m3u8` (o `.mp4`) y **devolver la fuente con cabeceras**:
   `{ url, kind: 'hls', headers: { Referer: <url final del embed> } }`.

Dos cosas que **no** hay que portar de ani-cli-mx:

- El menú de calidades ni el parseo de `#EXT-X-STREAM-INF`: en nn-anime el reproductor elige la
  variante y no hay selector de calidad.
- El *back-off* persistente en disco tras un 429: el plugin de jkanime ya lo hace en memoria y con eso
  basta (`providers/jkanime.ts:203-262`).

Y una que sí conviene copiar: **acotar cada petición por su cuenta**. El plazo de `CallOptions.timeoutMs`
es una sugerencia y ni la ruta ni el contenedor imponen una carrera a `resolveStream`
(`packages/server/src/routes/stream.ts:306-310`, `packages/server/src/container.ts:237-261`), así que
una cadena de seis peticiones puede durar más de ocho segundos, pero sin acotar cada paso se cuelga
entera.

#### Cómo comprobar que el plugin conforma

```bash
# el plugin vive en el directorio del usuario, no aquí
# ~/.config/nn-anime/providers/pelisplushd.ts   (%APPDATA% en Windows)
```

El SDK trae la prueba de conformidad, que es la misma que corre el plugin de ejemplo
(`docs/providers.md:292-311`): `assertConforms(miProveedor)` dice si el plugin se carga, e
`inspectConformance(miProveedor).problems` dice **qué** falta. Un plugin que no conforma no se carga y
aparece rechazado en Ajustes con el motivo.

#### Estado: escrito, y el dominio ya no existe

Esta receta ya está implementada: el plugin vive en
[`nn-anime-plugins/providers/pelisplushd.ts`](https://github.com/zxuru/nn-anime-plugins), con 828
líneas. Se midió así:

| Medición | Resultado |
|---|---|
| `assertConforms` del SDK (la misma comprobación que hace el cargador al arrancar) | conforma; la aplicación lo cargaría |
| `tsc --noEmit` con el `tsconfig.base.json` de este repositorio | sin errores |
| 25 comprobaciones de punta a punta contra un **sitio falso local** —buscador, ficha, capítulos, embed con prueba de trabajo, espejo caído, espejo empaquetado, dominio retirado y dominio que no contesta— | las 25 en verde: busca películas y series, una película da un episodio, una serie da sus capítulos con temporada en el título, y resuelve el enlace por los dos caminos (atajo de Vidhide y prueba de trabajo + AES + desempaquetado) con el `Referer` correcto |
| Ocho mutaciones de la implementación | siete hacen fallar la medición. La octava —admitir sólo minúsculas como token del empaquetador— no la distingue ninguna prueba, y es correcto: los tokens del cuerpo empaquetado son índices en base 36 y siempre van en minúsculas, así que ese camino no existe con un cuerpo bien formado |
| **Sondeo del sitio real** (una petición por dominio, la única vez que este estudio tocó la red) | el sitio no está: ver abajo |

**Los dominios de la familia no existen ya.** Medido el 12 de octubre de 2026 desde esta máquina:

| Dominio | Qué contesta |
|---|---|
| `pelisplushd.mx`, `.bz`, `.to` | resuelven los tres a `20.127.234.48`; el 443 no conecta y el 80 no contesta |
| `pelisplushd.nu` | 200 con un certificado que no valida; el cuerpo redirige a `router.parklogic.com` — aparcado |
| `pelisplushd.com` | `hugedomains.com`: el dominio está en venta |
| `pelisplushd.net` | 301 a `alliance4creativity.com/watch-it-legally` — la página que deja una retirada de dominio |
| `pelisplus.lat`, la marca hermana | redirige a esa misma página |

Es decir: no es que el marcado haya cambiado, es que **no hay sitio al que pedirle nada**. Por eso el
plugin lleva dos guardas que no son adorno, y que se miden en la batería de arriba:

1. **Una página del propio sitio que acaba en otro host se denuncia.** Es lo que hacen los dominios
   retirados —contestar 200 y mandarte a otra casa—, y sin esa comprobación la búsqueda devuelve cero
   fichas y el síntoma es «no encuentra nada».
2. **Un error de red se cuenta con la dirección delante** y con la variable que la cambia
   (`NN_ANIME_PELISPLUS_URL`), en vez de con el «The operation timed out» del que no se puede deducir
   nada.

Lo que **sigue sin comprobarse**, porque hace falta un sitio vivo de esta familia: el marcado real de
las tarjetas del buscador y de la lista de capítulos, que salen de las expresiones de `ani-cli-mx`. En
cuanto haya una casa, `NN_ANIME_PELISPLUS_URL` la apunta sin tocar el archivo.

### D.5 Lo que falta en la aplicación, si se quiere ir más allá

Nada de esto bloquea a un plugin de películas; son mejoras de interfaz y de contrato, en orden de
coste:

1. **La etiqueta del tipo en español** (`ResultCard.tsx:40` + `packages/web/src/i18n/es.ts`): hoy la
   insignia dice «movie».
2. **Un filtro por tipo en la búsqueda**: `/api/search` sólo acepta `q` y `provider`
   (`packages/core/src/api.ts:537-540`), así que una búsqueda mezcla anime y películas y no hay dónde
   pedir «sólo películas». Lo barato es un filtro en el cliente sobre `kind`; lo caro, un parámetro
   nuevo en la ruta y en el esquema.
3. **Un tipo para el dorama**: el vocabulario del contrato no lo tiene (`packages/core/src/schema.ts:130`),
   así que hoy un dorama es `tv`. Distinguirlo es cambio de contrato —evento de versión mayor— y no
   aporta nada que el usuario no vea ya en el título.
