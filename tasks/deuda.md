# Deuda técnica y de proceso (análisis del 2026-11-14)

> **Estado:** **abierto** — es el lote de deuda que salió del análisis del 2026-11-14, y se está
> cerrando tarea a tarea: cada una tiene su fragmento de cierre en [`tasks/done/`](done/) y su
> reparto, su oleada y su orden, más abajo.

Origen: análisis del estado actual del repositorio, hecho con cuatro subagentes (backend, frontend,
escritorio/CI, estado del proyecto) más mediciones propias ejecutadas en la raíz:

| Medición | Resultado | Cómo se midió |
|---|---|---|
| `bun run typecheck` | 0 errores | ejecutado |
| `bun test` | **3680 pasan, 0 fallan**, 13 075 aserciones, 218 ficheros | ejecutado (75 s) |
| `bun run lint` | sale 0; 37 avisos, todos en tests (`noReactStringRefs`) o CSS (`noDescendingSpecificity`) | ejecutado |
| `bun run coverage:gate` | objetivo cumplido (80 %) | ejecutado |
| Cobertura por líneas | `recsys` 99,65 % · `provider-sdk` 99,18 % · `core` 98,97 % · `catalog-store` 95,41 % · `media-proxy` 93,20 % · `cli` 91,50 % · `server` 88,23 % · `web` 65,21 % | calculada del LCOV |
| `any` / `@ts-ignore` / `as any` en producción | 0 | grep |
| Tests saltados (`.skip`/`.only`/`todo`) | 0 | grep |
| e2e | **no medido**: faltan los navegadores de Playwright en la máquina; los instala el CI | — |

**Este archivo es el plan, no el tablero.** La fuente de verdad de una tarea abierta sigue siendo
`tasks/todo.md` y el fragmento de cierre va a [`tasks/done/`](done/README.md). Aquí van el detalle,
la partición y el orden.

Rige el **Definition of Done** de [`tasks/plan.md`](plan.md) sin cambios: `bun run typecheck`,
`bun run lint` y `bun test` en verde, criterios marcados **con la medición que los sostiene**, sin
`any` implícito ni `@ts-ignore` ni `as` para silenciar, sin tests saltados, **máximo 5 archivos de
implementación por task** y commit atómico que cita el task.

## Los ids

Los ids de este lote van del **T218 al T247**, reservados aquí porque las tareas se van a repartir
entre varios agentes a la vez y `scripts/agente.ts abrir <id>` necesita un id que reclamar.
La regla de `tasks/roadmap.md` —«los ids se asignan al abrir, no se reservan»— queda suspendida
sólo para este lote: **un id de esta tabla que no se abra se libera y se anota aquí**, no se
convierte en un hueco.

## Reparto: una ruta, un dueño

`AGENTS.md` avisa de que dos agentes sobre el mismo directorio chocan aunque estén aislados, y
que el merge lo revela tarde. Por eso **cada ruta de este plan tiene un único dueño**, y dos
tareas que tocan el mismo archivo van **en el mismo agente y en serie**, nunca en paralelo.

Los agentes son los de la tabla de oleadas, más abajo. Cada agente abre su worktree con
`bun run scripts/agente.ts abrir T<id>` y cierra con `cerrar`.

---

## Oleada 1 — sin choques: se pueden abrir todos a la vez

Once agentes, once rutas distintas.

| # | Tarea | Rutas del dueño | Tamaño |
|---|---|---|---|
| **T218** | `docs/roadmap.md` dice «fase 0 abierta»; el código va por la 0.8.0 | `docs/roadmap.md` | S |
| **T219** | `CAPABILITY-MAP.md` no registra `downloads` ni `watch-party` | `docs/specs/CAPABILITY-MAP.md` | S |
| **T220** | Tres specs-propuesta conviven en la carpeta canónica | `docs/specs/SPEC-{anime-detail,episode-rail,watch-party}.md` → `proposals/` | S |
| **T221** | `docs/v1-report.md` mide la v1, no el árbol de hoy | `docs/v1-report.md` | S |
| **T222** | `tasks/` tiene planes viejos que ya no dicen la verdad | `tasks/*.md` (salvo `todo.md`, `plan.md`, `done/`) | S |
| **T223** | 77 worktrees restos y ningún comando para podarlos | `scripts/agente.ts`, `scripts/agente.test.ts` | M |
| **T224** | El gate de cobertura no corre en el CI | `.github/workflows/ci.yml` | S |
| **T225** | `server` y `web` no tienen umbral de cobertura | `scripts/coverage-gate.ts` | M |
| **T226** | `shell.css` es un monolito de 7 584 líneas | `packages/web/src/styles/` | L |
| **T227** | `WatchPage.tsx` (1 252 l.) y `Player.tsx` (1 214 l.) | `packages/web/src/features/player/` | L |
| **T228** | `VirtualGrid.tsx` no lo usa nadie | `packages/web/src/components/` | S |
| **T229** | `AniListResults` y `AniListCards` son el mismo componente dos veces | `packages/web/src/features/search/` | S |
| **T230** | `/api/settings` se lee dos veces en la misma pantalla | `packages/web/src/features/settings/`, `packages/web/src/lib/`, `packages/web/src/app.tsx` | M |
| **T231** | El botón «Probar con {proveedor}» no se pinta (TODO T210) | `packages/web/src/features/detail/` | S |
| **T232** | El servidor queda vivo si el anfitrión muere (T155) | `desktop/src-tauri/src/` | M |
| **T233** | Dos comentarios del código dicen lo contrario de lo que hay | `packages/media-proxy/src/index.ts`, `packages/cli/src/index.ts` | S |
| **T234** | La Fase 2A arranca por un spec que no existe | `docs/specs/SPEC-manga.md` | L |

### T218 — `docs/roadmap.md` dice «fase 0 abierta»; el código va por la 0.8.0

**Descripción:** `docs/roadmap.md:7` abre con «**fase 0 abierta**», pero la fase 0 (T174–T180) y la
fase 1 (T181–T187) están cerradas y la 0.8.0 está publicada. El documento se usa como fuente de
la fase siguiente y manda a construir manga sobre un estado que ya no existe.

**Aceptación:**
- [ ] El estado del roadmap coincide con el de `tasks/roadmap.md` (fases 0 y 1 cerradas, fase 3
      implementada) y con `CHANGELOG.md`.
- [ ] La sección «Fase 3: Watch party» deja de decir «sin abrir»: dice qué hay implementado
      (sala LAN con relevo del invitado, `NN_ANIME_PARTY=1`) y qué queda (WebRTC P2P, coincidencia
      de contenido, chat), con el enlace a `docs/specs/SPEC-watch-party.md`.
- [ ] La «Fase 2A: Manga» declara que empieza por el spec que aún no existe (T234).
- [ ] Las cifras que se citen están medidas hoy, no copiadas de la v1.

**Archivos:** `docs/roadmap.md`. **Tamaño:** S. **Depende de:** nada.

---

### T219 — `CAPABILITY-MAP.md` no registra `downloads` ni `watch-party`

**Descripción:** el mapa se autodeclara «la única fuente de verdad sobre qué módulos existen» y
declara 7 capacidades de producto. **Dos de ellas ya están en producción y no aparecen:** las
descargas (14 endpoints, migraciones `0014`/`0015`, motor con ffmpeg y `mux.js`) y el watch party
(17 endpoints, `packages/server/src/party/`). Peor: `downloads` sigue en la tabla «Enmiendas
pendientes de aprobación», que dice «no se escribe su spec ni su código hasta que el humano
apruebe la enmienda» — pero la spec se escribió y aprobó (D2, `proposals/SPEC-descargas.T181.md`)
y el código lleva en la release desde la 0.5.

**Aceptación:**
- [ ] `downloads` sale de «Enmiendas pendientes de aprobación» y entra en el grafo de capacidades
      con su build order y sus dependencias, como `SPEC-descargas.T181.md` las fijó.
- [ ] `watch-party` aparece como capacidad con su módulo y su nota de experimental.
- [ ] `metadata-enrichment` se decide: o sale de pendientes (la ruta TMDB ya existe y es
      aditiva), o se anota que el código llegó antes que la aprobación y se pide la aprobación
      retrospectiva. **La decisión se escribe, no se deja tácita.**
- [ ] El documento sigue siendo cierto: se comprueba contra el árbol, no contra la memoria.

**Archivos:** `docs/specs/CAPABILITY-MAP.md`. **Tamaño:** S. **Depende de:** nada.

---

### T220 — Tres specs-propuesta conviven en la carpeta canónica

**Descripción:** `docs/specs/proposals/README.md` distingue los contratos canónicos de las
propuestas: las propuestas viven en `proposals/` y las integra su dueño. Pero `SPEC-anime-detail.md`,
`SPEC-episode-rail.md` y `SPEC-watch-party.md` están **en la carpeta canónica** y su propio
encabezado dice «propuesta · pendiente de aprobación humana» o «propuesta de contrato para la
tarea 3.1». Un lector que aplique la regla al revés —«lo que está en `docs/specs/` es
canónico»— los toma por aprobados.

**Aceptación:**
- [ ] Cada uno de los tres está en un lado o en el otro, con una razón escrita: o seintegra al
      `SPEC-*` canónico (con la aprobación anotada) o se mueve a `proposals/` con el sufijo de task.
- [ ] `docs/specs/proposals/README.md` se actualiza si el caso nuevo no estaba previsto.
- [ ] Ningún fichero queda duplicado en los dos sitios.

**Archivos:** `docs/specs/SPEC-anime-detail.md`, `SPEC-episode-rail.md`, `SPEC-watch-party.md`,
`docs/specs/proposals/`. **Tamaño:** S. **Depende de:** nada.

---

### T221 — `docs/v1-report.md` mide la v1, no el árbol de hoy

**Descripción:** el informe dice «1450 pruebas», «74 unitarios + 5 de e2e», «55 de 55 tareas» y da
por buena una cobertura que era la de entonces. Hoy hay **3680 pruebas en 218 ficheros** y 16
ficheros de e2e. El informe es la fuente de la auditoría de trazabilidad spec ↔ plan y de los seis
casos de «comprobaciones que no medían lo que decían». Congelarlo con las cifras viejas lo
convierte en un documento que se cita mal.

**Aceptación:**
- [ ] Se decide —y se dice en el propio documento— si `v1-report.md` queda como **histórico
      congelado** (con un aviso arriba: «cifras de la v1; el estado vigente está en «X») o si se
      actualiza a las cifras de hoy.
- [ ] Si se actualiza, las cifras se **miden** (no se copian): número de pruebas, de ficheros, de
      casos de e2e, cobertura por paquete y estado de las tareas.
- [ ] La sección de los seis casos de método **se conserva**: es historia del proyecto y no caduca.

**Archivos:** `docs/v1-report.md`. **Tamaño:** S. **Depende de:** nada.

---

### T222 — `tasks/` tiene planes viejos que ya no dicen la verdad

**Descripción:** `tasks/descargas.md:3` dice «spec escrita, **código sin abrir**» (2026-10-26)
aunque T181–T187 están cerradas y las descargas están en la release. Junto a eso hay
`tasks/anilist.md`, `tasks/desktop.md`, `tasks/proveedores-github.md`, `tasks/mejoras-scraper.md` y
**ocho** `tasks/discovery-*.md` sueltos sin índice: nadie sabe si están hechos, pendientes o
caducados.

**Aceptación:**
- [ ] Cada plan de `tasks/` que no sea `todo.md`, `plan.md`, `roadmap.md`, `discovery.md` o `done/`
      lleva **una línea de estado al principio**: «cerrado», «abierto», o «caducado, con la tarea
      que lo sustituye».
- [ ] Los que estén cerrados se archivan o se borran sin perder **la decisión que los dejó
      cerrados**: un enlace a `tasks/done/T<id>.md` basta.
- [ ] Los ocho `discovery-*.md` quedan indexados en una tabla o se fusionan en `discovery.md`.
- [ ] `tasks/todo.md` y `tasks/plan.md` **no se tocan**: son del integrador (AGENTS.md).

**Archivos:** `tasks/descargas.md`, `tasks/anilist.md`, `tasks/desktop.md`,
`tasks/proveedores-github.md`, `tasks/mejoras-scraper.md`, `tasks/discovery-*.md`.
**Tamaño:** S. **Depende de:** nada.

---

### T223 — 77 worktrees restos y ningún comando para podarlos

**Descripción:** `.worktrees/` tiene **77 directorios** de sesiones ya integradas (T108…T214, más
`baseline-main` e `instalables`), frente a los 2 que Git tiene registrados. Ocupan disco y
confunden el estado real: `scripts/agente.ts estado` no los ve, y quien los mira cree que hay 77
agentes vivos.

**Aceptación:**
- [ ] `scripts/agente.ts` gana un comando `limpiar` que **borra los worktrees que no están
      registrados en `git worktree list`** ywhose rama ya está integrada, y dice qué va a borrar
      antes de borrarlo.
- [ ] `limpiar` **no borra** un worktree con cambios sin commitear ni una rama sin integrar: para
      esos dice qué hay y no toca nada.
- [ ] Prueba: con un worktree registrado y vivo, y otro directorio suelto, `limpiar` borra el
      segundo y deja el primero.
- [ ] **Mutación**: que `limpiar` borre también el registrado hace fallar la prueba.
- [ ] Tras correrlo, `.worktrees/` queda con lo que Git tiene registrado.

**Archivos:** `scripts/agente.ts`, `scripts/agente.test.ts`. **Tamaño:** M. **Depende de:** nada.

---

### T224 — El gate de cobertura no corre en el CI

**Descripción:** `scripts/coverage-gate.ts` existe, sale con 1 cuando un paquete baja del 80 % y
además **imprime los archivos que la medición no ve** —que es justo lo que faltaba cuando el
objetivo era aspiracional—. Pero `grep coverage .github/workflows/` no da **ninguna** coincidencia:
el gate sólo corre si alguien se acuerda. `docs/roadmap.md` lo exige en cada fase y
`SPEC-nn-anime.md` afirma que «se hace cumplir».

**Aceptación:**
- [ ] El CI ejecuta el gate y **falla el job** cuando un paquete medido baja del objetivo.
- [ ] La salida del gate (la de los archivos que la medición no ve) queda en el log del job.
- [ ] El job no duplica el `bun test` que ya corre: reutiliza el resultado o añade el coste
      justificándolo en el propio workflow.
- [ ] Prueba o comprobación que falle si alguien quita el gate del CI.

**Archivos:** `.github/workflows/ci.yml`. **Tamaño:** S. **Depende de:** nada.

---

### T225 — `server` y `web` no tienen umbral de cobertura

**Descripción:** `MEASURED_PACKAGES = ['core', 'catalog-store', 'recsys', 'provider-sdk']` — cuatro
de nueve. Los dos paquetes más grandes, `server` (107 ficheros) y `web` (227), miden hoy 88,23 % y
65,21 % y **no tienen umbral**, así que pueden bajar a cero sin que nadie se entere. `media-proxy`
(93,20 %) y `cli` (91,50 %) tampoco lo tienen.

**Aceptación:**
- [ ] Los umbrales se fijan **por debajo de la cobertura medida hoy** y con margen escrito: el
      objetivo de cada paquete nuevo va en el código, junto a su número.
- [ ] `web` necesita un objetivo propio y razonado: el 80 % de líneas de un paquete con 65 % medido
      no es un umbral, es una meta lejana; se pone el número que se sostiene y se sube por pasos.
- [ ] `coverage:gate` imprime el umbral de cada paquete medido, para que el log diga qué se exige.
- [ ] **Mutación**: subir el umbral de un paquete por encima de su cobertura hace fallar el gate.

**Archivos:** `scripts/coverage-gate.ts`. **Tamaño:** M. **Depende de:** nada.

---

### T226 — `shell.css` es un monolito de 7 584 líneas

**Descripción:** `packages/web/src/styles/shell.css` tiene **208 KB, 7 584 líneas y 488 selectores
de primer nivel**, sin `@layer` ni sistema de módulos. Es el mayor foco de acoplamiento visual del
proyecto: cada arreglo toca un fichero que nadie puede leer entero, y las reglas se pisan por
orden de cascada en vez de por capa. `tokens.css` (958 líneas, 270 custom properties) está bien
planteado; el problema es la hoja de reglas.

**Aceptación:**
- [ ] `shell.css` se parte en **ficheros por responsabilidad** (por ejemplo: base, disposición,
      navegación, vitrina, ficha, reproductor, ajustes, responsive) con una entrada que los
      importa en un orden declarado.
- [ ] Los tokens de color, espacio, radio y tipografía **siguen saliendo de `tokens.css`**: ningún
      literal nuevo en las hojas partidas (la regla de `shell.css` se traslada al sitio nuevo).
- [ ] El resultado visual **no cambia**: la captura de `docs/captura.png` y la de tema claro se
      regeneran y se comparan con la anterior. Diferencias sólo si la tarea las declara.
- [ ] `packages/web/src/styles/styles.test.ts` sigue en verde: falla si una clase usada en el
      marcado no está definida, y si un `var()` apunta a un token inexistente.
- [ ] Cada fichero nuevo cabe en el **tope de 5 archivos de implementación** del task: si salen
      más de 5, esta tarea se divide (y el plan se actualiza).

**Archivos:** `packages/web/src/styles/`. **Tamaño:** L. **Depende de:** nada.

---

### T227 — `WatchPage.tsx` (1 252 l.) y `Player.tsx` (1 214 l.)

**Hecho en parte, y la tarea se dividió:** `WatchPage.tsx` está partido (401 líneas, con
`useWatchPage`, `useWatchLecturas` y `watch-neighbours`) y `Player.tsx` pasa a **T227b**, porque
1 094 líneas de máquina de HLS no caben en el mismo corte sin romper un reproductor que funciona.
El criterio de la tarea ya preveía dividirla.

**Descripción:** los dos componentes más grandes del frontend. `WatchPage.tsx` tiene 14 `useState`,
8 `useCallback` y 6 `useEffect`, y **es un solo `export function`** con unas 800 líneas. `Player.tsx`
tiene 11 `useState`, 11 `useEffect` y 7 `useRef`. Partirlos no es cosmetía: son la razón de que
cualquier arreglo en el reproductor toque un sitio que nadie encuentra.

**Aceptación:**
- [ ] Cada componente se parte en unidades con nombre, cada una con su tipado y su prueba; el
      behaviour no cambia.
- [ ] Los hooks con estado se agrupan en hooks de dominio (`useWatchPage`, `usePlayer`), como ya
      se hace en `useDetail.ts` y `useParty.ts`.
- [ ] Ninguna parte nueva supera las ~400 líneas, o la tarea se divide y el plan se actualiza.
- [ ] Las pruebas del reproductor siguen en verde **sin reescribirlas**: si una prueba cambia para
      poder pasar, es que se rompió el comportamiento.
- [ ] **Mutación**: un comportamiento del reproductor (el modo extendido, el `Escape` del menú, la
      recuperación de `fragLoadError`) deja de funcionar cuando se rompe el hook extraído.

**Archivos:** `packages/web/src/features/player/`. **Tamaño:** L. **Depende de:** nada.

---

### T228 — `VirtualGrid.tsx` no lo usa nadie

**Descripción:** `packages/web/src/components/VirtualGrid.tsx` (56 líneas) tiene **0 imports en
producción**: sólo su prueba. Es infraestructura de virtualización escrita y nunca conectada.
O se conecta donde hace falta, o sobra.

**Aceptación:**
- [ ] Se decide con un dato: si la vitrina o el historial llegan a un número de filas que hace
      falta virtualizar, se conecta y se mide el antes y el después; si no, **se borra** el
      componente y su prueba.
- [ ] Si se borra, el `bun test` sigue en verde y no queda ninguna referencia en el árbol.

**Archivos:** `packages/web/src/components/VirtualGrid.tsx` y su prueba.
**Tamaño:** S. **Depende de:** nada.

---

### T229 — `AniListResults` y `AniListCards` son el mismo componente dos veces

**Descripción:** dos componentes casi gemelos pintan el mismo array de catálogo, en dos ramas
distintas de `SearchPage.tsx` (`:322` y `:363`). Mantener los dos es mantener dos veces el mismo
ajuste.

**Aceptación:**
- [ ] Queda **uno**, con las diferencias que existían declaradas como props y no como copia.
- [ ] La captura de la búsqueda antes y después es la misma.

**Archivos:** `packages/web/src/features/search/`. **Tamaño:** S. **Depende de:** nada.

---

### T230 — `/api/settings` se lee dos veces en la misma pantalla

**Descripción:** `useAppTheme()` y `SettingsPage` montan `useSettings` por separado. El dedupe de
`api/client.ts` no las comparte porque no están en vuelo a la vez, así que la pantalla de Ajustes
**hace dos peticiones** a `/api/settings`. Es el punto 9 de `docs/revision-frontend.md`, y el
punto 3 de «Lo que sigue, en orden».

**Aceptación:**
- [ ] Hay **una sola fuente** de los ajustes en la raíz de la aplicación, y las dos pantallas la
      consumen de ahí.
- [ ] Con la pantalla de Ajustes abierta, el servidor recibe **una** petición a `/api/settings`
      (prueba que cuenta las peticiones).
- [ ] **Mutación**: volver a montar `useSettings` en la página hace fallar esa prueba.

**Archivos:** `packages/web/src/features/settings/`, `packages/web/src/lib/`,
`packages/web/src/app.tsx`. **Tamaño:** M. **Depende de:** nada.

---

### T231 — El botón «Probar con {proveedor}» no se pinta (TODO T210)

**Descripción:** `features/detail/DetailError.tsx:81` lleva un `TODO(T210)`: cuando la obra **no
está** en la fuente que se pidió, la interfaz debería ofrecer «Probar con {proveedor}» con las
fuentes donde sí está. No se pinta porque el fallo sólo trae su clase y su mensaje: «las fuentes
de la obra son parte del bundle de la ficha, que es justo lo que aquí no llegó». Es el **único
TODO real** del frontend.

**Aceptación:**
- [ ] El hook expone **las fuentes conocidas de una ficha fallida** (o una lectura aparte que las
      traiga), que es lo que el comentario pide como condición previa.
- [ ] El botón aparece cuando la obra está en otra fuente, y **no** aparece cuando no está en
      ninguna.
- [ ] Lleva a la ficha correcta en la fuente correcta.
- [ ] **Mutación**: quitar el caso que lo habilita hace fallar la prueba.

**Archivos:** `packages/web/src/features/detail/`. ** tamaño:** S. **Depende de:** nada.

---

### T232 — El servidor queda vivo si el anfitrión muere (T155)

**Descripción:** el cierre ordenado del servidor depende del anfitrión, pero si el anfitrión
muere de golpe el servidor sigue vivo: en Linux sólo hay `PR_SET_PDEATHSIG`, en macOS **no hay
nada** y en Windows **el Job Object no está escrito** (pendiente declarado en `tasks/done/T155.md`).
El síntoma es un `nn-anime` huérfano que ocupa el puerto y la cookie de sesión.

**Aceptación:**
- [ ] Windows: el proceso servidor está en un **Job Object** con `KILL_ON_JOB_CLOSE`, y el
      anfitrión cierra el job al morir.
- [ ] macOS: hay un mecanismo equivalente, o el motivo por el que no lo hay está escrito en el
      código y en `SECURITY.md`.
- [ ] Una prueba o comprobación que demuestre que el servidor **no** sobrevive a la muerte del
      anfitrión (en Windows y en Linux; en macOS, la excepción documentada).
- [ ] `SECURITY.md` se actualiza con lo que ahora está cerrado.

**Archivos:** `desktop/src-tauri/src/`. **Tamaño:** M. **Depende de:** nada.

---

### T233 — Dos comentarios del código dicen lo contrario de lo que hay

**Descripción:** `packages/media-proxy/src/index.ts:6-7` dice «Hoy expone el almacén de tickets; el
proxy de bytes llega en T26» — el proxy de bytes existe desde hace meses (`byte-proxy.ts`)—. Y
`packages/cli/src/index.ts:6-8` dice «La migración es un marcador… llega en T16» — `db-migrate.ts`
existe y funciona—. No son bugs; son comentarios que mandan a buscar algo que ya está.

**Aceptación:**
- [ ] Los dos comentarios dicen lo que el módulo hace **hoy**.
- [ ] Se revisan los otros comentarios del mismo estilo en los dos paquetes y se corrigen los que
      quedaron atrás.

**Archivos:** `packages/media-proxy/src/index.ts`, `packages/cli/src/index.ts`.
**Tamaño:** S. **Depende de:** nada.

---

### T234 — La Fase 2A arranca por un spec que no existe

**Descripción:** el siguiente bloque declarado es la **Fase 2A (manga)**,tasks 2.1–2.7 de
`docs/roadmap.md`. La 2.1 es «Spec `docs/specs/SPEC-manga.md` (modelo, contrato, lector,
descargas)» y **ese fichero no existe**. La decisión D5 (formato offline: CBZ) ya está cerrada, y
el modelo ya reserva `mediaType: 'manga'` en `packages/core/src/schema.ts` y
`packages/core/src/models.ts`. Es la tarea que desbloquea la fase.

**Aceptación:**
- [ ] `docs/specs/SPEC-manga.md` existe y cubre: modelo (capítulo, volumen, página), contrato de
      plugin (`capabilities.media` con `manga`), lector (paginado y vertical), descargas (D5: CBZ),
      proxy de imágenes y datos (progreso de lectura).
- [ ] Se apoya en el análisis de `docs/estudio-busqueda-ani-cli-mx.md` y en lo que ya aprendieron
      la 2.1–2.7 de `docs/roadmap.md`.
- [ ] El spec **no se escribe código** hasta que lo apruebe el humano (la regla de
      `docs/specs/proposals/README.md`).
- [ ] La revisión humana queda anotada con su fecha.

**Archivos:** `docs/specs/SPEC-manga.md`. **Tamaño:** L. **Depende de:** nada.

---

## Oleada 2 — dependen de la 1 porque tocan una ruta ya tomada

Un solo agente cada una, y **en serie** con la de su ruta.

| # | Tarea | Depende de | Rutas del dueño |
|---|---|---|---|
| **T235** | `cargo audit` / `cargo deny`: el lado Rust no se audita | T224 | `.github/workflows/ci.yml` |
| **T236** | La deuda visual medida del `shell.css` | T226 | `packages/web/src/styles/` |
| **T237** | El CSS muerto y la cabecera de la lengua vieja | T226 | `packages/web/src/styles/` |
| **T238** | `--font-mono: "Space Mono"` no se sirve | T226 | `packages/web/src/styles/tokens.css`, `fonts/` |
| **T239** | El primer fotograma del tema, el `description` y el pie | T230 | `packages/web/index.html`, `packages/web/src/main.tsx` |
| **T240** | El panel del motor quedó muerto al retirar la puntuación | T229 | `packages/web/src/features/recommendations/` |

### T235 — `cargo audit` / `cargo deny`: el lado Rust no se audita

**Descripción:** `bun audit` corre en el CI, pero el `Cargo.lock` versionado (133 KB) **no se audita
en ningún workflow**. Dependabot actualiza `cargo`, pero nadie mira los avisos. La app de
escritorio carga plugins y descarga binarios: una vulnerabilidad transitiva en Tauri no sale sola.

**Aceptación:**
- [x] El CI corre `cargo audit` (o `cargo deny`) y **falla** ante un aviso de nivel error.
- [x] Si hay avisos today que no se pueden arreglar, se listan en un archivo de excepciones con el
      motivo, en vez de dejar el job en rojo o apagarlo.
- [x] `cargo deny` incluye la política de licencias si procede.

**Cierre:** `ci: auditar las dependencias Rust (T235)` · `tasks/done/T235.md` (indexado en
`tasks/done/INDICE.md`). `deny.toml` con cuatro excepciones de avisos, lista blanca de licencias,
sólo crates.io y el job `auditoria-rust` fijado por SHA en `.github/workflows/ci.yml`.

**Archivos:** `.github/workflows/ci.yml`, `desktop/src-tauri/deny.toml`, `desktop/src-tauri/Cargo.lock`, `scripts/ci.test.ts`. **Tamaño:** S. **Depende de:** T224 (mismo fichero).

---

### T236 — La deuda visual medida del `shell.css`

**Descripción:** cinco deudas que la revisión de frontend ya midió y dejó numeradas
(`docs/revision-frontend.md`, hallazgos 10 a 14, y «Lo que sigue, en orden» 4, 5 y 6):
la cabecera móvil a 320 px no cabe (hallazgo 10), el mosaico de seis columnas deja el tercio derecho
vacío con cuatro títulos (11), la banda de la ficha mide 16 rem y queda vacía sin banner de AniList
(12), cada fila de episodio lleva la sombra dura coral y la lista entera parece seleccionada (13), y
la cinta arranca con el primer título cortado porque la pista no tiene fundido de borde (14).

**Aceptación:**
- [x] Los cinco tienen arreglo **medido**, no a ojo: la captura antes y después, en el ancho donde
      se veía el fallo. Cabecera 320: pistas 61/61/61/75/61 · mosaico: 373 px de hueco → 0 · banda:
      256 → 198 px · episodio: sin sombra, realce de tono · cinta: fundido de 32 px.
- [x] El mosaico se compone para el número de piezas que hay (o se declara la excepción). Compone de
      1 a 6; con más de seis la última fila queda incompleta y se declara.
- [x] La banda de la ficha tiene alto condicional cuando no hay banner.
- [x] La cinta lleva `mask-image` en los dos bordes.
- [x] Las capturas de `docs/` se regeneran con `bun run captura`.
- [x] `a11y.test.ts` sigue en verde: el contraste de la cinta sobre el banner se midió antes.

**Cierre:** `fix(web): la deuda visual medida del shell (T236)` · `tasks/done/T236.md` (indexado en
`tasks/done/INDICE.md`).

**Archivos:** `packages/web/src/styles/`. **Tamaño:** M. **Depende de:** T226.

---

### T237 — El CSS muerto y la cabecera de la lengua vieja

**Descripción:** `shell.css` conserva `.buscador*`, `.home__refresco`, `.section__meta`,
`.poster__cover` y `.row__list > li` (con su escalón que nunca se aplica), que **no tienen ni una
referencia en el marcado**. Su cabecera describe una versión anterior de la hoja (habla de radios
cero). Es el hallazgo 16 de la revisión, y el bloque está «Parcial» desde entonces.

**Aceptación:**
- [x] Cada clase sin referencia se **borra**, con una comprobación que lo compruebe: una regla sin
      selector en el marcado es código muerto. `styles.test.ts` falla si vuelven.
- [x] La cabecera describe la hoja que hay.
- [x] Los selectores que sí se usan pero con reglas que no aplican (el escalón de `.row__list > li`)
      se quitan o se arreglan.

**Cierre:** `refactor(web): borrar el CSS muerto y su escalón (T237)` · `tasks/done/T237.md`.

**Archivos:** `packages/web/src/styles/`. **Tamaño:** S. **Depende de:** T226.

---

### T238 — `--font-mono: "Space Mono"` no se sirve

**Descripción:** el token declara `"Space Mono"` pero **no hay `@font-face` ni archivo**, y la CSP es
`default-src 'self'`. Todo el registro de datos (números de top, tamaños, contadores) cae a la
monoespaciada del sistema: **la interfaz cambia de voz según la máquina**. Es el hallazgo 6 y el
punto 2 de «Lo que sigue, en orden».

**Aceptación:**
- [x] Se decide y se aplica: o la familia entra en `packages/web/src/styles/fonts/` con su licencia
      (como Nunito), o el token se retira y el registro usa la familia del sistema **de forma
      explícita**. Entra: cuatro `.woff2` y `OFL-space-mono.txt`.
- [x] Si entra, la CSP sigue sirviéndola desde el repo (nunca de un CDN) y la licencia va con ella.
- [x] El registro de datos se ve igual en dos máquinas distintas. «0123456789» a 16 px: 97,92 px con
      Space Mono frente a 80 px con la mono del sistema.

**Cierre:** `feat(web): servir Space Mono desde el repo (T238)` · `tasks/done/T238.md`.

**Archivos:** `packages/web/src/styles/tokens.css`, `packages/web/src/styles/fonts/`.
**Tamaño:** S. **Depende de:** T226.

---

### T239 — El primer fotograma del tema, el `description` y el pie

**Descripción:** el tema se aplica **en un efecto, después** de `GET /api/settings`: quien guardó
claro sobre un sistema oscuro ve un destello negro, y los controles nativos no siguen al tema
(hallazgo 8, resuelto a medias). Además el HTML no trae `description` ni `theme-color` ni pie de
aplicación (hallazgo 20). Es el punto 3 de «Lo que sigue, en orden».

**Aceptación:**
- [x] El tema está en el HTML de arranque, antes del primer pintado: sin destello en los dos
      sentidos (claro y oscuro).
- [x] `color-scheme` sigue a los dos temas.
- [x] El HTML lleva `description` y `theme-color`, y la aplicación su pie.
- [x] Se mide: la captura del primer fotograma en tema claro sobre sistema oscuro no sale negra.

**Cierre:** `feat(web): el tema antes del primer pintado, description y pie (T239)` ·
`tasks/done/T239.md` (indexado en `tasks/done/INDICE.md`). Screencast CDP con sistema oscuro y tema
claro guardado: 26 fotogramas `#f2ede3`, ninguno negro; el control sin arranque temprano sí da
`#08080a`.

**Archivos:** `packages/web/index.html`, `packages/web/public/theme-boot.js`,
`packages/web/src/features/settings/{tema-arranque,useSettings}.ts`, `packages/web/src/{app,app.test}.tsx`,
`packages/web/src/arranque-tema.test.ts`, `packages/web/src/i18n/es.ts` y los estilos del pie.
**Tamaño:** S. **Depende de:** T230 (mismo `app.tsx`, vía el proveedor de ajustes).

---

### T240 — El panel del motor quedó muerto al retirar la puntuación

**Descripción:** `features/recommendations/Panel.tsx` **no está montado en ninguna parte**: sólo lo
importa su prueba. Sus dos hijos (`ReasonBadge`, `ScoreDetail`) sólo se usan desde ahí. La pieza dejó
de mostrar la puntuación a propósito (`71009bc`, «la puntuación del motor sale de la pieza»):
`docs/rediseno-vitrina.md` ya no la promete, pero `PRODUCT.md:58` sigue diciendo que cada sugerencia
lleva su puntuación. Montar el panel para recuperar el score contradice esa decisión, así que la
salida lógica es retirarlo y alinear el producto. El motivo de cada recomendación ya se lee en la
pieza sin abrir nada.

**Aceptación:**
- [x] Se retira `Panel.tsx`, `ScoreDetail.tsx` y `ReasonBadge.tsx` con sus pruebas, o se decide un
      sitio real donde montarlos y se justifica por qué vuelve la puntuación.
- [x] `PRODUCT.md` y el texto de `RecommendedRow.tsx` dejan de prometer una puntuación que la pieza
      no muestra.
- [x] `useRecommendations` y sus pruebas siguen en verde; no queda CSS muerto de `.panel*`,
      `.reason` ni `.score`, ni claves `reco.*` sin usar.
- [x] Si se retira, `bun test packages/web` y `bun run lint` quedan en verde.

**Cierre:** `refactor(web): retirar el panel muerto del motor (T240)` · `tasks/done/T240.md`
(indexado en `tasks/done/INDICE.md`). Se retiran los tres componentes con sus pruebas, el CSS muerto
y las claves `reco.*`; `PRODUCT.md` y `RecommendedRow` dejan de prometer la puntuación.

**Archivos:** `packages/web/src/features/recommendations/`, `packages/web/src/i18n/es.ts`,
`packages/web/src/styles/`, `PRODUCT.md`. **Tamaño:** M. **Depende de:** T229.

---

## Oleada 3 — decisiones del humano (el agente no las puede tomar)

`docs/roadmap.md:169`: «las abiertas no las decide el agente: pregunta».

| # | Tarea | Qué hay que decidir |
|---|---|---|
| **T241** | El claim huérfano `refs/claims/T60` y la rama `tarea/T60` | Integrar los 5 commits de *skip-times* de AniSkip, o abandonar la rama y liberar el id |
| **T242** | La rama `rediseno/escritorio` | Integrarla, recuperar su idea (el rediseño de la home, 833 líneas de `shell.css`), o abandonarla |
| **T243** | El updater fuera de Windows | Publicar bundles `darwin-*`/`linux-*` en `latest.json`, o dejar el límite declarado |
| **T244** | Publicar sin `TAURI_SIGNING_PRIVATE_KEY` | Que la publicación no se bloquee entera por falta de la clave de firma |
| **T245** | La firma condicional | Qué sale sin los 9 secretos y cómo se dice en la release |

### T241 — El claim huérfano `refs/claims/T60` y la rama `tarea/T60`

**Descripción:** `refs/claims/T60` sigue existiendo y `tarea/T60` sigue viva con **5 commits sin
integrar** —el *skip-times* de AniSkip: id de MAL en el modelo, mapeo AniList→MAL, ruta
`/skip-times`, y los botones de saltar intro y ending—. `bun run scripts/agente.ts abrir T60`
falla con «ya está reclamado» aunque el worktree que lo reclamaba ya no existe. La rama va 47
commits por detrás de `main`.

**Aceptación:**
- [ ] Se decide **integrar o abandonar**, y se escribe el motivo.
- [ ] Si se integra: el trabajo se reparte por paquete (toca `core`, `catalog-store`, `server` y
      `web`) o se acepta el merge de la rama tal cual, en cuyo caso se dice.
- [ ] El claim se libera y la rama desaparece si se abandona.
- [ ] Si se integra, los commits citados se anotan en `tasks/done/T60.md` con su verificación.

**Archivos:** — (operaciones de Git). **Tamaño:** M. **Depende de:** decisión humana.

---

### T242 — La rama `rediseno/escritorio`

**Descripción:** rama del 2026-10-14 con **2 commits sin integrar**: el rediseño de escritorio de la
home (833 líneas de `shell.css` y 248 de `tokens.css` cambiados, `app.tsx` tocado) y su nota
`docs/rediseno-escritorio.md`, que **no existe en `main`**. Describe una home con rieles de ancho
fijo, banda por sección, filo de identidad reservado y escala de titulares más baja. Es una
alternativa al diseño actual, no un parche.

**Aceptación:**
- [ ] Se decide: integrar, recuperar la idea (y aplicarla con medición propia), o abandonar.
- [ ] Si se recupera la idea, se aplica **sobre el árbol actual** y se mide el antes y el después;
      no se rebasea a ciegas una rama de hace un mes.
- [ ] La rama y el worktree se limpian al cerrar.

**Archivos:** — (operaciones de Git) o `packages/web/src/styles/` si se recupera la idea.
**Tamaño:** M. **Depende de:** decisión humana; si toca `shell.css`, de T226.

---

### T243 — El updater fuera de Windows

**Descripción:** el auto-actualizador **sólo existe en Windows**: `mod actualizacion` está bajo
`#[cfg(windows)]` porque el updater busca bundles `darwin-*`/`linux-*` en `latest.json` y no los
hay. En macOS y Linux la aplicación se queda atrás sin avisar, aunque el `release.yml` ya compila
esos instaladores.

**Aceptación:**
- [x] Se decide: publicar los bundles de macOS y Linux en `latest.json` (y que el actualizador
      funcione), o dejar el límite **declarado** en el README, en `docs/release.md` y en el
      diálogo de actualizaciones. **Decidido: límite declarado.**
- [x] Si se publica: el `.dmg`, el `.AppImage`, el `.deb` y el `.rpm` llevan firma minisign y su
      entrada en `latest.json`, con la comprobación que hoy sólo hace Windows. **No aplica: se
      decidió no publicar.**
- [x] Si no se publica: la nota es explícita en la ventana de actualizaciones, no un silencio. La
      ventana existe ya en macOS y Linux, dice el límite y enlaza a la release.

**Cierre:** `feat(desktop): el límite del updater, visible fuera de Windows (T243)` ·
`tasks/done/T243.md`.

**Archivos:** `desktop/src-tauri/src/actualizacion.rs`, `scripts/package/portable-manifest.ts`,
`.github/workflows/release.yml`. **Tamaño:** M. **Depende de:** decisión humana.

---

### T244 — Publicar sin `TAURI_SIGNING_PRIVATE_KEY`

**Descripción:** si falta la clave de firma minisign, **no se publica nada**: el job `publicar`
aborta. Los binarios se compilan bien, el `SHA256SUMS.txt` sale, y aun así no hay release. El
updater de Windows necesita la firma para reemplazar el ejecutable, así que separar «publicar» de
«firmar» tiene un coste real: la release sale sin la firma que el auto-actualizador exige.

**Decidido (2026-11-16):** la publicación sigue bloqueada sin la clave. Un `.exe` que el updater no
puede reemplazar es peor que una release que no sale, y `docs/release.md:92-96` ya lo dice. El job
`publicar` avisa con `::warning::` cuando falta el secreto, y su comprobación final exige
`latest.json`, un `.sig` y las dos entradas de Windows antes de quitar el borrador.

**Aceptación:**
- [x] Se decide el comportamiento y se escribe: la publicación sigue bloqueada sin la clave, y el
      motivo se dice en el log del job que publica.
- [x] Lo que se decide está escrito en `docs/release.md` y en el propio workflow, no sólo en la
      cabeza de nadie.
- [x] La comprobación final del release (`latest.json`, un `.sig`, las dos entradas de Windows)
      sigue requisitos del job que publica.

**Cierre:** `chore(release): cerrar T244 y reencuadrar T240 (T244, T240)` ·
`tasks/done/T244.md`.

**Archivos:** `.github/workflows/release.yml`, `docs/release.md`. **Tamaño:** S.
**Depende de:** decisión humana.

---

### T245 — La firma condicional y los 9 secretos

**Descripción:** la release sale **sin firmar** si no están `WINDOWS_CERT_PFX_BASE64`,
`WINDOWS_CERT_PASSWORD`, `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` y `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`. Windows
avisa de «desarrollador no verificado» y macOS frena la primera vez. El propio spec lo llama «una
decisión de dinero, no de código».

**Aceptación:**
- [x] Está escrito qué se publica **sin** firma, para qué plataformas y qué aviso ve el usuario.
      Tabla en `docs/release.md` y nota en la ventana de actualizaciones.
- [x] El README, `docs/release.md` y el diálogo de actualizaciones dicen lo mismo y no se
      contradicen.
- [x] La detección del secreto es robusta: el propio código admite que «`secrets` no está
      disponible en el `if` de un paso de forma fiable» (`release.yml:190-193`) y se resuelve con
      una forma que no dependa de esa suposición. El job compara en su `env` desde `release.yml:189`.

**Cierre:** `docs(release): la firma condicional y sus avisos (T245)` · `tasks/done/T245.md`.

**Archivos:** `docs/release.md`, `README.md`, `.github/workflows/release.yml`.
**Tamaño:** S. **Depende de:** decisión humana.

---

## Oleada 4 — del integrador (toca `tasks/todo.md` o `tasks/plan.md`)

| # | Tarea | Rutas |
|---|---|---|
| **T246** | `tasks/roadmap.md` y los 22 criterios de aceptación sin marcar | `tasks/roadmap.md`, `tasks/todo.md` |
| **T247** | Los 179 fragmentos de `tasks/done/` | `tasks/done/`, `tasks/todo.md` |

### T246 — `tasks/roadmap.md` y los 22 criterios de aceptación sin marcar

**Descripción:** dos cosas que sólo puede tocar el integrador. (a) `tasks/roadmap.md:40` sigue
diciendo «Fase 3 Watch party | sin abrir» aunque la fase está en la release 0.8.0, y su cabecera
(fases 0 y 1 cerradas) contradice a `docs/roadmap.md` (fase 0 abierta) —que es T218—. (b) En
`tasks/todo.md` hay **22 casillas de aceptación sin marcar, en 13 tareas**: T4, T8a, T15, T19, T21,
T22, T24, T32, T39, T41, T42, T44 y T47. Siete son revisiones humanas; el resto son criterios que
el propio documento marca «**no medido**» o «**pendiente**» (por ejemplo T22: «Segunda ejecución
sirve desde la base con 0 llamadas a proveedores, **medido**» — sin marcar).

**Aceptación:**
- [ ] `tasks/roadmap.md` refleja la fase 3 como implementada, con lo que queda.
- [ ] Cada una de las 22 casillas está **medida y marcada**, o **convertida en una tarea nueva** de
      este plan con su id: una casilla sin marcar que nadie va a medir no es deuda viva, es ruido.
- [ ] Las revisiones humanas llevan su fecha y su veredicto.

**Archivos:** `tasks/roadmap.md`, `tasks/todo.md`. **Tamaño:** M. **Depende de:** T218 (para que los
dos documentos digan lo mismo).

---

### T247 — Los 179 fragmentos de `tasks/done/`

**Descripción:** `tasks/done/` tiene **179 fragmentos** (T56…T217) más su README. El README dice que
el integrador pega el bloque en `tasks/todo.md`, lo anota y **borra el fragmento en el mismo
commit**. Nadie lo ha hecho: el directorio crece sin parar y ya no es un índice, es un archivo.

**Aceptación:**
- [x] Cada fragmento está **pegado en `tasks/todo.md`** o identificado en un índice; el README se
      cumple. `tasks/done/INDICE.md`: 213 filas con id, título, commit y verificación.
- [x] Los que son el cierre de una tarea ya cerrada hace tiempo y no aportan nada, se archivan
      (fuera del árbol de trabajo) en vez de borrarse sin más. 211 retirados; su contenido queda en
      la historia de git y el índice dice con qué commit.
- [x] `tasks/done/` queda con lo que sirve para algo: README, INDICE, el informe de medición de
      AniSkip y este cierre. `scripts/done-index.test.ts` impide que vuelva a crecer sin índice.

**Cierre:** `docs(tasks): indexar y podar los fragmentos de cierre (T247)` · `tasks/done/T247.md`.

**Archivos:** `tasks/done/`, `tasks/todo.md`. **Tamaño:** S. **Depende de:** T246 (los dos tocan
`tasks/todo.md`).

---

## Resumen por dueño

Once dueño, once rutas. Cada ruta aparece **una sola vez** en esta tabla.

| Dueño | Rutas | Tasks |
|---|---|---|
| Documentación | `docs/roadmap.md`, `docs/specs/`, `docs/v1-report.md` | T218, T219, T220, T221, T234 |
| Plan | `tasks/*.md` (salvo `todo.md`, `plan.md`, `done/`) | T222 |
| Higiene | `scripts/agente.ts` | T223 |
| CI | `.github/workflows/ci.yml`, `scripts/coverage-gate.ts` | T224, T225, **T235** |
| Estilos | `packages/web/src/styles/` | T226, **T236**, **T237**, **T238** |
| Reproductor | `packages/web/src/features/player/` | T227 |
| Componentes | `packages/web/src/components/`, `features/search/`, `features/recommendations/` | T228, T229, **T240** |
| Ajustes y detalle | `features/settings/`, `features/detail/`, `lib/`, `app.tsx`, `index.html` | T230, T231, **T239** |
| Escritorio | `desktop/src-tauri/src/` | T232 |
| Release | `.github/workflows/release.yml`, `scripts/package/` | **T243**, T244, T245 |
| Backend | `packages/media-proxy/src/index.ts`, `packages/cli/src/index.ts` | T233 |
| Integrador | `tasks/todo.md`, `tasks/plan.md`, `tasks/done/`, `tasks/roadmap.md` | **T241**, **T242**, T246, T247 |

**En negrita**, las tareas de la oleada 2 y 3: van **en serie** detrás de la de su ruta.

## Orden sugerido

1. **Oleada 1 entera**, en paralelo: once agentes, once rutas. Es donde está el 80 % del valor.
2. **Oleada 2**, en el mismo agente que su tarea de la oleada 1, cuando aquélla cierre.
3. **Oleada 3**, cuando el humano decida. Los agentes **preguntan**, no eligen.
4. **Oleada 4**, al final, cuando el resto de los commits ya están integrados: `tasks/todo.md` se
   pega una sola vez, no en paralelo con once mergeos.

## Cómo se cierra

Cada tarea, al abrirse, se reclama con `bun run scripts/agente.ts abrir T<id>` y al terminar deja
su fragmento en [`tasks/done/`](done/README.md) con el formato de allí y el commit que lo sostiene.
**El integrador** pega el bloque en `tasks/todo.md` y borra el fragmento. El tablero local
(`tareas/Tablero.md`) mueve la tarjeta a *En desarrollo* al empezar y a *Completado* al terminar.
