# Descubrimiento: el top de la fuente

Commits: T57 `b864077` · T63 `370c98e`.

Verificación medida sobre ese commit, con el árbol que comparte otra sesión: `bun run typecheck` 0 ·
`bun run lint` 0 en los archivos de esta tarea · `bun test` 1741 pasan, 0 fallan · e2e de las dos
rutas tocadas **10 pasan, 0 fallan**.

Una entrega: T57. Toca sólo `packages/web`, no cambia ninguna ruta HTTP ni el contrato de ningún
módulo.

Motivo: la fila del top de la home pintaba **cinco recomendaciones del motor** con su motivo. Lo que
el usuario reconoce de una fuente —y lo que `jkanime` publica en `/top`— es otra cosa: el ranking de
la fuente, entero, en su orden y con su puesto. Los motivos no se pierden: se mudan al panel, que es
donde el motor se explica.

---

## T57 — `web`: el top es el de la fuente

**Descripción:** La fila `section--top` de la home pinta el ranking que publica el proveedor
(`getTrending`, ya cacheado en `/api/trending`), numerado del uno al N, en su orden y sin reordenar.
Se ven los primeros puestos y «Mostrar más» despliega el resto, como el `#loadmore` de la fuente.
`TopFive` —cinco recomendaciones con motivo— y `TrendingRow` —la misma lista de tendencias, sin
puesto— desaparecen: eran dos filas para el mismo dato, y la que se queda es la que se lee como un
ranking.

**Aceptación:**
- [x] El top sale de `filas.trending`, no del motor, y **no reordena**: el puesto es el del índice de
      la lista que devolvió el servidor. Unit: 12 puestos → 10 números y `puesto-11` fuera del HTML.
- [x] «Mostrar más» aparece **exactamente** cuando queda un puesto y desaparece al desplegarlo. Unit
      en la frontera: 10 puestos → sin botón; 11 → con botón. E2e: 15 puestos por intercepción de
      `/api/trending`, 10 tarjetas → clic → 15 y el botón ya no está.
- [x] El número es el de la fuente y no el de la lista pintada: al desplegar, la última tarjeta dice
      «15». Comprobado en el e2e, que es el único sitio donde se puede pulsar.
- [x] Sin proveedor que publique un top, la fila lo dice en vez de quedarse en blanco.
- [x] Las razones del motor siguen a la vista, ahora en el panel: el e2e de recomendaciones abre el
      desplegable y lee `.panel .reason`, cada una con texto de más de diez caracteres.
- [x] El catálogo de textos no deja claves huérfanas: `home.trending*` y `home.top.meta.cold` se van
      con las filas que las usaban, y `i18n.test.ts` (que falla si sobra una) lo comprueba.

**Verificación:** `bun run typecheck` 0 · `bun run lint` 0 (dos avisos de especificidad descendente
que ya venían de HEAD) · `bun test` **1681 pasan, 0 fallan** · e2e de las dos rutas tocadas
—`home.e2e.ts` y `recommendations.e2e.ts`— **10 pasan, 0 fallan**, incluido el caso nuevo.

**Medición por mutación** (el listón del repo: una prueba que pasa con el código roto no mide nada):

- Quitar el recorte de `puestosVisibles` (`return [...items]`): fallan 2 pruebas unitarias —«numera
  los puestos y corta en los visibles» y «el corte es de lo que se pinta, no de la lista»—.
- Dejar el botón sin efecto (`onClick={() => undefined}`): las 41 unitarias de la carpeta siguen
  verdes —`renderToString` no pulsa botones— y **falla el e2e** «el top se despliega con "Mostrar
  más"». Es la razón de que ese caso viva en el navegador y no en unitario.

**Depende de:** T48 (`trending` en el contrato) y T51 (la home del diseño).

**Archivos:** `packages/web/src/features/home/TopRow.tsx` (nuevo, sustituye a dos),
`packages/web/src/features/home/{TopFive,TrendingRow}.tsx` (borrados),
`packages/web/src/features/home/HomePage.tsx`, `packages/web/src/i18n/es.ts`,
`packages/web/src/styles/shell.css`.

**Ampliación declarada:** seis archivos de implementación en vez de cinco. Las dos bajas son
sustituciones —una fila nueva ocupa el sitio de dos viejas—, no trabajo añadido.

**Tamaño:** M.

---

## T63 — `server`: el top no repite el mismo anime

**Motivo:** con dos proveedores activos, la fila del top pintaba **dos veces el mismo anime**. La
causa medida sobre la caché real (`trending_cache` de la base de desarrollo, 52 entradas de `jkanime`
y `animeav1`): `/api/trending` deduplicaba por referencia —`providerId#value`— y cada fuente numera a
su aire, así que `animeav1#one-piece` y `jkanime#one-piece` eran dos entradas distintas. El puesto 1 y
el 3 eran el mismo «One Piece».

**Descripción:** la ruta deduplica por **referencia y por título**. La clave del título quita
mayúsculas, acentos y signos, y no usa `baseTitle`: quitar el marcador de temporada juntaría «Sousou
no Frieren» con «Sousou no Frieren 2nd Season», que son dos puestos que las fuentes publican por
separado. Gana el primero: el orden de las fuentes es la única preferencia escrita.

**Aceptación:**
- [x] Dos fuentes con el mismo anime y referencias propias dejan **una** tarjeta, la de la primera
      fuente. Unit: dos proveedores con top propio → `items` de longitud 1 y `providerId` `uno`.
- [x] El título empareja sin mayúsculas, sin acentos y sin signos: «Sousou no Frieren» y
      «sousou  no frieren!» son la misma tarjeta.
- [x] Títulos distintos de dos fuentes se quedan los dos: la deduplicación no se come la fila.
- [x] La misma referencia repetida en una fuente sigue dejando una tarjeta.
- [x] «Kimetsu no Yaiba», «Kimetsu no Yaiba 2nd Season» y «Kimetsu no Yaiba: Hashira Geiko-hen» son
      tres puestos, no uno.

**Verificación:** `bun run typecheck` 0 · `bun run lint` 0 en los dos archivos de T63 (los cuatro
archivos que quedan en rojo son ajenos: tres ya lo estaban en `HEAD` —`EpisodeList.tsx`,
`detail.test.tsx`, `useDetail.ts`— y `cover-ref.ts` es de la otra sesión) · `bun test` **1754 pasan, 0
fallan**, medido con el trabajo de T54 en el árbol, y las 18 pruebas de la ruta medidas también sobre
el archivo compuesto de `HEAD` + T63, sin T54. Sobre la caché real de la base de desarrollo —52
entradas de `jkanime` y `animeav1`—, `sinRepetir` deja **51**: el puesto 3 pasa de ser el segundo «One
Piece» a «Kimetsu no Yaiba: Hashira Geiko-hen».

**Medición por mutación** (el listón del repo):
- Quitar la comparación por título (`if (false && …)`): fallan 2 pruebas —«dos fuentes con el mismo
  anime dejan una tarjeta» y «el título empareja sin mayúsculas, sin acentos y sin signos»—.
- Cambiar la clave por `baseTitle`: falla «un título y su temporada son dos puestos, no uno», que es
  la que declara el falso positivo.

**Archivos:** `packages/server/src/routes/recommendations.ts` (la clave y el filtro),
`packages/server/src/routes/recommendations.test.ts` (el `describe` de `/api/trending`, que hasta
ahora no tenía pruebas propias en este archivo).

**Nota de coordinación:** el árbol venía sucio con el trabajo de T54 de otra sesión sobre
`packages/server/src/routes/{discovery,recommendations}.ts` y `packages/server/src/container.ts`. El
commit de T63 lleva **sólo** sus propios hunks: la ruta se compuso contra `HEAD` aparte —import, las
dos funciones y el filtro—, se puso en el árbol sólo para commitear y se restauró la copia de la otra
sesión con la suma de comprobación delante. El trabajo de T54 sigue sin commitear en el árbol.

**Depende de:** T57.

**Tamaño:** S.

---

## Fuera de esta entrega

- **Votos y temporadas.** La página de la fuente trae votos, filtros de temporada y de año, y
  `SearchResult` no tiene dónde llevarlos: el esquema es estricto y una clave de más es un error.
  Meterlos es un cambio de contrato —`core`, `provider-sdk` y su spec— y por eso no entra aquí.
- **Los puestos de la fuente en el motor.** `/api/recommendations` da `popularity: 1` a todo lo que
  viene de tendencias, así que el orden del top no puntúa. Tocar eso es `recsys`, no `web`.

---
