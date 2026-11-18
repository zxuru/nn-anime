# Propuesta · sólo anime: retirar las familias de contenido

**Sobre** `6de2c86` (después de T371). **Origen:** la crítica de la home del 2026-11-18 (26/40) y una
decisión del dueño del producto: la aplicación sirve **anime y películas de anime**; no sirve imagen
real ni animación occidental.

**Estado:** **propuesta, pendiente de aprobación humana.** Abierta el 2026-11-18. El spec de familias
(`docs/specs/SPEC-web-ui.md`, enmienda T257a) queda congelado hasta que esto se apruebe o se rechace.

Toca **`SPEC-provider-core`** (el enum y `capabilities.families`), **`SPEC-discovery`**
(`?family=`), **`SPEC-recsys`** (el reparto por familia) y **`SPEC-web-ui`** (conmutador, `?tipo=`,
alta de proveedor). Es **versión mayor del contrato de plugin**: un eje entero del manifiesto
desaparece.

## Por qué

1. **El eje nació para separar tres cosas que ya no se sirven.** «Anime» y «Animación» se solapan —la
   distinción sólo existe en un `title`, que en táctil no existe—, «Acción real» se lee como un género
   y el resto del repositorio llama a eso «imagen real» desde `models.ts:49`. La crítica lo midió: es
   el P1 de la pantalla y no se arregla rotulando, se arregla quitando el eje.
2. **La aplicación es de anime.** El propósito del producto es «ver anime —y también películas, series
   y doramas— en el navegador»; lo segundo era alcance prestado, no promesa. Sin imagen real, la
   pestaña deja de ser una promesa y pasa a ser una trampa.
3. **TMDB se queda sin trabajo.** Su ruta existe para rellenar sinopsis, géneros y año de «películas y
   series de acción real» (`packages/server/src/routes/tmdb.ts:11`), porque AniList ya cubre el anime.
   Es una integración opcional, con clave, sección de Ajustes y entrada en el modelo de amenaza, que
   sin imagen real no tiene a quién servir.
4. **Sobra una fila de chrome.** La cabecera pasa de **diez acciones** medidas a siete: marca, cuatro
   destinos, «?» y Perfil. Y el formato —que se queda— puede por fin llevar rótulo visible sin
   competir con una píldora que significa otra cosa.

## El cambio, en una línea

`MediaFamily` deja de ser un eje del producto. Queda **una sola partición**: el **formato**
(`series` / `movie`), que ya vive en `?formato=`.

## Contrato

### `core`

- `mediaFamilySchema` (`schema.ts:123`) y `MediaFamily` (`models.ts:50`) **se retiran**.
- `capabilities.families` **se retira** del manifiesto. `capabilities.media` deja de leerse como alias
  de familia.
- Se retiran `FAMILIES_ANIME`, `FAMILIES_NO_ANIME`, `FAMILIES_TODAS`, `familiesOf`, `familyOf` y el
  reparto por `kind` que acababa en `return 'live'` (`media.ts:56-58,74,101,118,127`).
- `pasaElFiltro` conserva `format` y pierde `families`.
- **`Capabilities` cambia de forma: es versión mayor.** Se declara en `SPEC-provider-core` y en
  `providers.md` con su nota de migración.

### Servidor

- `/api/search`: `family=` se **acepta y se ignora** (un enlace guardado no puede dar 400), con aviso
  en modo `--verbose`.
- `/api/recommendations` deja de partir candidatos por familia.
- AniList: sus filas dejan de estar condicionadas a la familia —siempre fueron sólo de anime—.
- **TMDB se retira entero**: la ruta `/api/anime/:providerId/:ref/metadata`, la clave en la base, su
  sección en Ajustes y su entrada en `SECURITY.md`.

### Interfaz

- `ConmutadorTipo.tsx` **se borra**. Con él, `FAMILIAS`, `familiaFromPath`, `pathConFamilia` y la parte
  de familia de `pathConVista` (`features/tipo/tipo.ts:35-105`).
- `app.tsx:152` pierde la reescritura de `?tipo=movies`.
- `?tipo=anime|animation|live|movies` en la home y en Buscar se **descarta** al entrar y la dirección se
  reescribe sin él: una vista, una URL.
- El **filtro de formato** (`FiltroFormato`) se queda, gana rótulo visible («Formato») y pasa a ser
  pegajoso y alineado al margen del contenido: es el único eje y puede decirlo.
- `FAMILY_OPTIONS` y las tres casillas del alta de proveedor (`features/settings/draft.ts:36`) se
  retiran; el formulario conserva las capacidades que siguen significando algo.
- `HomePage` pierde los vacíos por familia (`AVISO_SIN_FUENTE`, `home.parrilla.empty.animation|live`) y
  la condición de familia de `ParrillaRow`.
- `es.ts`: salen `media.anime`, `media.animation`, `media.live`, sus `.desc`, `media.switch`,
  `media.empty.*` y `home.parrilla.empty.animation|live`. Se quedan `media.format.*`.

### Fixture y e2e

- Se retiran la serie de animación occidental y la de imagen real del fixture, y con ellas el e2e que
  demostraba que un título no sale en dos pestañas.
- El e2e de navegación de tres familias se reduce a: el filtro de formato aísla una película de anime,
  y una dirección vieja con `?tipo=` no rompe.
- Entra un e2e de **tolerancia de manifiesto**: un plugin que declara `families: ['live']` carga, deja
  su aviso y no rompe el arranque.

### Documentación

`SPEC-web-ui.md` (enmienda nueva; la de T257a se queda como historia), `providers.md` (versión mayor y
migración), `PRODUCT.md` (propósito, capacidades, usuarios, TMDB), `README.md:35`, `DESIGN.md`
(Navigation y el «empujado al borde» del conmutador) y `SECURITY.md` (TMDB).

## Migración de plugins: no romper el arranque

Un manifiesto con `families` o con `media: 'movies' | 'both'`:

1. **carga** — el cargador no lo rechaza;
2. emite un **aviso de compatibilidad** con el campo retirado;
3. `ProviderList` y el alta lo muestran como «declara familias retiradas»;
4. sus títulos entran y se filtran sólo por formato.

Es la misma regla que ya usó `capabilities.download`: se acepta, se ignora y se dice. **Simular
aislamiento o romper el arranque de un plugin instalado está prohibido** por las restricciones del
producto.

## Lo que no cambia

`MediaFormat` (`series` / `movie`), `TitleKind`, `mediaType`, la búsqueda, el motor de recomendación,
las descargas, el reproductor, la guía y el resto de la vitrina.

## Fases

| Fase | Qué | Depende de |
|---|---|---|
| **T372** | Esta propuesta y su aprobación | — |
| **T372a** | `core`: retirar el enum y el eje, tolerancia de manifiestos, tests de mutación | T372 |
| **T372b** | Servidor: rutas de búsqueda y motor, AniList, retirada de TMDB | T372a |
| **T372c** | Interfaz: borrar el conmutador, rótulo y forma del filtro, redirección de `?tipo=`, alta de proveedor | T372a |
| **T372d** | Fixture, e2e y documentación | T372b, T372c |

Cada fase toca cinco archivos de implementación o menos, como pide el Definition of Done.

## Criterios de aceptación

1. `?tipo=live`, `?tipo=animation` y `?tipo=movies` en `/` y en `/search` **no dan error**: la
   dirección se reescribe sin el parámetro y la pantalla es la misma.
2. La cabecera tiene **siete interactivos** a 1707 px y no rompe entre 320 y 1920 (medido, sin
   desbordamiento horizontal).
3. Un manifiesto con `families: ['live']` **carga**, deja aviso, y su título se ve; uno con
   `capabilities.media: 'movies'` también.
4. No queda ninguna cadena «Acción real», «Animación» ni «familia» en el catálogo de textos; una
   prueba de `i18n.test.ts` lo impide.
5. TMDB no existe: sin ruta, sin clave, sin sección en Ajustes, sin entrada en `SECURITY.md`.
6. El filtro de formato se puede alcanzar con teclado, mide 44 px de alto y su estado no desaparece al
   hacer scroll.
7. `bun run typecheck`, `bun run lint`, `bun test`, `bun run coverage:gate` y `bun run e2e` en verde.

## Riesgo residual

- **Enlaces guardados con `?tipo=`**: se descartan en silencio y el usuario vuelve a la misma lista.
  No hay estado que perder porque la familia deja de existir.
- **Plugins del usuario que sólo servían imagen real**: siguen cargando, pero no tienen dónde enseñar
  sus títulos. El aviso lo dice y `README.md` explica el retiro, en vez de borrarlo sin más.
- **El modo LAN y el watch party**: no dependen de la familia; no se tocan.
