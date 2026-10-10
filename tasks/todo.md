# Task List: nn-anime v1

Plan: `tasks/plan.md` · Specs: `CAPABILITY-MAP.md`, `SPEC-nn-anime.md`, `SPEC-<module-id>.md`
Regla: todo task cierra el Definition of Done de `tasks/plan.md`. Tope de 5 archivos de
implementación por task; el andamiaje de T1 y T16 lo declara explícitamente.

53 tareas: T1–T47 más las seis insertadas tras la revisión de seguridad (T6a, T6b, T26a, T26b,
T29a, T31a). Los ids con sufijo no se renumeran: el orden de ejecución lo da la tabla de
dependencias del final.

Fuera de este plan: `downloads` (v1.5) y `metadata-enrichment` (sin aprobar).

---

## Fase 0 — Fundación

### T1 — Esqueleto del monorepo y tooling

**Descripción:** Crear la raíz del workspace Bun con los nueve paquetes vacíos, la configuración
compartida de TypeScript, Biome y los scripts del proyecto.

**Aceptación:**
- [x] `bun install` termina sin errores y `bun run --filter '*'` reconoce los nueve workspaces.
- [x] `bun run typecheck`, `bun run lint` y `bun test` salen con código 0.
- [x] Los scripts `dev`, `build`, `start`, `typecheck`, `lint`, `lint:fix`, `test`, `e2e` y
      `db:migrate` existen en el `package.json` raíz.
- [x] `tsconfig.base.json` tiene `strict: true`, `noUncheckedIndexedAccess: true` y
      `verbatimModuleSyntax: true`.
- [x] `scripts/workspaces.test.ts` cubre `isRecord`, `scriptOf` y `listWorkspaces`.

**Verificación:** `tsc --noEmit` 0 · `biome check .` 0 · `bun test` 8 pasan, 0 fallan ·
`bun run dev` y `bun run build` informan que ningún workspace declara el script todavía y salen
con 0.

**Estado:** hecho.

**Nota de entorno:** en un sandbox sin escritura en `/tmp`, `bun install` necesita
`BUN_TMPDIR` y `BUN_INSTALL_CACHE_DIR` apuntando dentro del workspace. No es un requisito del
proyecto, es una particularidad del entorno de desarrollo.

**Depende de:** ninguno.

**Archivos:** `package.json`, `tsconfig.base.json`, `tsconfig.json`, `biome.json`, `.gitignore`,
`scripts/{workspaces,dev,build}.ts`, `scripts/workspaces.test.ts`,
`packages/{core,provider-sdk,catalog-store,media-proxy,recsys,server,web,cli,providers-fixture}/`
con su `package.json` y su `src/index.ts` de marcador.

**Tamaño:** M. Andamiaje: crea más de cinco archivos, pero no contiene lógica de dominio.

---

### T2 — `core`: `Result`, errores y logger

**Descripción:** Kernel compartido de manejo de errores como valores y logging estructurado con
redacción de datos sensibles.

**Aceptación:**
- [x] `Result<T, E>` con constructores `ok` y `err`, y helpers `map`, `mapErr`, `unwrapOr`.
- [x] `AppError` con `code`, `message`, `cause` y `context`; subtipos `ProviderError`,
      `UpstreamError`, `StoreError` con fábrica `from(scope, op, cause)`.
- [x] `logger` con niveles `debug|info|warn|error`, salida JSON y umbral configurable.
- [x] Test: claves `authorization`, `cookie`, `referer`, `token` y `headers` se sustituyen por
      `[redacted]` en cualquier nivel, incluido `debug`.
- [x] `grep -rn "console\." packages --include=*.ts` no devuelve nada fuera de `logger.ts`.

**Verificación:** `bun test packages/core` 45 pasan, 0 fallan · `bun test` 53 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0, sin infos · grep de `console.` sin coincidencias.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- `unwrapOr` sólo cae al sustituto cuando el resultado es un fallo. Un éxito cuyo valor es
  `undefined` sigue siendo un éxito, y hay un test que lo fija.
- El logger recibe un `sink` inyectable en lugar de escribir una cadena. Los tests reciben
  entradas tipadas y no necesitan ningún `as` para inspeccionarlas. La serialización JSON vive en
  `toJsonLine`, que es pura y se testea aparte.
- La redacción es por nombre de clave y a cualquier profundidad, sobre objetos y arrays, con
  detección de ciclos y truncado a seis niveles. Además de las cinco claves exactas, se redacta
  toda clave que contenga `token`, `cookie`, `secret` o `password`.
- La redacción no puede detectar un secreto embebido dentro de una cadena. Eso queda como
  responsabilidad de quien llama, y así está escrito en el encabezado del módulo.
- `packages/core/src/index.ts` enumera a mano la superficie pública. No es un barrel que
  reexporte el árbol del paquete.

**Depende de:** T1.

**Archivos:** `packages/core/src/{result,errors,logger}.ts`, sus `*.test.ts` y `index.ts`.

**Tamaño:** M. Tres archivos de implementación, tres de test y el punto de entrada.

---

### T3 — `core`: configuración, rutas XDG e i18n

**Descripción:** Resolución de rutas y ajustes del proceso, más el contrato de i18n con el
catálogo español.

**Aceptación:**
- [x] `loadConfig()` resuelve `dataDir`, `configDir` y `cacheDir` desde `XDG_*`, con overrides de
      flags y de `NN_ANIME_*`; precedencia flags > entorno > XDG > por defecto.
- [x] `ensureDirs()` crea los directorios con modo `0700` y es idempotente.
- [x] `i18n.ts` exporta `Locale`, `Messages`, `t(locale, key, params?)` y `resolveLocale(env)`.
- [x] `t` interpola `{param}` y cae a `es` ante locale o clave desconocidos, sin lanzar.
- [x] Test: con `XDG_DATA_HOME` temporal, ningún directorio real del usuario se toca.

**Verificación:** `bun test packages/core` 75 pasan, 0 fallan · `bun test` 83 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0 sin infos. El chequeo manual de `NN_ANIME_LANG=en` quedó
cubierto por el test de `resolveLocale('en')`, que debe devolver `es`. Los tests de `ensureDirs`
usan `mkdtemp` y comprueban el modo `0700` real con `stat`.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- `loadConfig` sólo calcula rutas. No crea nada: la creación vive en `ensureDirs`, explícita. Así
  un test puede calcular rutas sin tocar el disco.
- Sin `HOME` y sin overrides, `loadConfig` lanza `AppError` con código `config` y nombra qué
  directorios quedaron sin resolver. Es el único caso en que la configuración lanza en lugar de
  devolver un `Result`, porque es un error de arranque, no una condición esperada.
- Una variable de entorno vacía o con sólo espacios cuenta como no definida. Un `HOME=""` no
  produce rutas como `/nn-anime`.
- El idioma desconocido cae a `es` en lugar de fallar: un idioma mal escrito no debe impedir
  arrancar.
- `translate` recibe los catálogos como parámetro y está exportada. Es lo que permite testear el
  respaldo entre idiomas hoy, con un catálogo falso, sin esperar a que exista `en`.
- Clave desconocida devuelve la clave. Se ve en pantalla y delata el fallo, en lugar de mostrar
  una cadena vacía.
- El tipo `Messages` se importa en `i18n/es.ts` con `import type`, así que el ciclo entre los dos
  archivos no existe en tiempo de ejecución.

**Depende de:** T2.

**Archivos:** `packages/core/src/{config,i18n}.ts`, `packages/core/src/{config,i18n}.test.ts`,
`packages/core/src/i18n/es.ts` y `index.ts`.

**Tamaño:** M.

---

### T4 — `core`: modelo de dominio y schemas Zod

**Descripción:** Fijar el modelo compartido que consumen `provider-sdk`, `catalog-store`,
`media-proxy`, `recsys` y el server. Es el contrato que se congela antes de paralelizar.

**Aceptación:**
- [x] Tipos exportados: `ProviderRef`, `SearchResult`, `AnimeDetail`, `Episode`, `StreamRequest`,
      `StreamSource`, `SubtitleTrack`, `WatchEventInput`, `Candidate`, `CacheHit<T>`, `Mode`.
- [x] Un schema Zod espejo por tipo, con `readonly` en los tipos derivados.
- [x] `toPublicStreamSource(source)` devuelve una forma sin `headers` y el tipo público no tiene
      ese campo: el compilador impide filtrarlo por accidente.
- [x] Test paramétrico por tipo: un objeto válido pasa, un objeto con un campo mal tipado falla
      con mensaje que nombra el campo.
- [x] Test: `PublicStreamSource` no admite `headers` (verificado con `@ts-expect-error`).

**Verificación:** `bun test packages/core` 107 pasan, 0 fallan · `bun test` 115 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0 sin infos.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- **Los tipos se derivan de los schemas, no se escriben dos veces.** `models.ts` usa
  `z.infer<typeof schema>` más un `DeepReadonly` propio. Es lo que hace imposible que el tipo y su
  validación se desincronicen. La inmutabilidad la aporta `DeepReadonly`, no un `readonly` escrito
  a mano en cada campo.
- **Todos los objetos son estrictos.** Una clave desconocida se rechaza. En una respuesta de
  proveedor, una clave de más es un error del plugin o un cambio de contrato, y en ambos casos
  conviene enterarse en lugar de ignorarla. Hay un test que comprueba que un schema extendido con
  `.extend()` conserva la estrictez.
- **La validación de headers vive en el schema.** Nombres contra `^[A-Za-z0-9-]+$` y valores sin
  `\r`, `\n` ni `\0`. Al estar en la frontera, ningún header sin validar puede llegar al proxy ni
  a mpv. Es el criterio de seguridad M10 cerrado antes de que exista el proxy.
- **`PublicStreamSource` es `Omit<StreamSource, 'headers'>`.** La garantía no es una convención ni
  un comentario: es el compilador. El test usa `@ts-expect-error` para fijar que la fuga no
  compila, así que si alguien añade `headers` al tipo público, el build falla.
- `toPublicStreamSource` omite las claves ausentes en lugar de dejarlas en `undefined`, para que
  `Object.keys` de la forma pública no delate campos que no existen.
- `CacheHit<T>` se queda como interfaz escrita a mano y no deriva de un schema, porque nunca se
  deserializa: `catalog-store` lo construye desde SQLite. `cacheHitSchema` existe para cuando haga
  falta validar la forma, parametrizado por el schema del valor.
- Zod es la única dependencia nueva, y está en la tabla de Tech Stack del spec.

**Depende de:** T2.

**Archivos:** `packages/core/src/{models,schema}.ts`, `packages/core/src/schema.test.ts`,
`packages/core/package.json` y `index.ts`.

**Tamaño:** M.

---

## Checkpoint A — Fundación

- [x] `bun install && bun run typecheck && bun run lint && bun test` limpio.
- [ ] Revisión humana antes de seguir.

---

## Fase 1 — Arranque

### T5 — Parser de flags del CLI

**Descripción:** Parser de argumentos sin dependencias externas, con la tabla de flags del spec.

**Aceptación:**
- [ ] Soporta `[query]`, `-p/--port`, `--no-open`, `--data-dir`, `--config-dir`, `--provider`
      repetible, `--lang`, `-v/--verbose`, `-h/--help`, `--version`.
- [ ] `--port abc` y una flag desconocida devuelven error de uso con código 2.
- [ ] `nn-anime --help` no arranca el server y sale con 0.
- [ ] `--provider a --provider b` acumula ambos en orden.

**Verificación:** `bun test packages/cli` · manual: `bun packages/cli/src/index.ts --help`.

**Depende de:** T3.

**Archivos:** `packages/cli/src/{args,args.test}.ts`.

**Tamaño:** S.

---

### T6 — Server Hono con guards de seguridad y `/api/health`

**Descripción:** App Hono mínima con la seguridad del spec aplicada como middleware global.

**Aceptación:**
- [ ] `createServer({ session, port, ... })` monta `host-guard` y `session-guard` sobre `/api/*`
      y `/stream/*`.
- [ ] `host-guard` rechaza con 403 todo `Host` que no sea `127.0.0.1:<puerto>` o
      `localhost:<puerto>`.
- [ ] `session-guard` exige la cookie de sesión de T6a y responde 401 sin cuerpo útil en
      cualquier otro caso. No existe ninguna vía de autenticación por query string.
- [ ] `origin-guard` en métodos mutantes: `Origin` ausente, `null` o ajeno devuelve 403.
- [ ] `GET /api/health` devuelve `{ version, port, mpv, providers }` y exige sesión.
- [ ] Test de tabla de rutas: toda ruta registrada está cubierta por ambos guards, o el test falla.

**Verificación:** `bun test packages/server` · manual con `curl` sin token: 401.

**Depende de:** T4.

**Archivos:** `packages/server/src/{index,app}.ts`, `packages/server/src/middleware/{host-guard,token-guard,origin-guard}.ts`, `packages/server/src/app.test.ts`.

**Tamaño:** M.

---

### T6a — Bootstrap de sesión por cookie `HttpOnly`

**Descripción:** Canjear el token de arranque de un solo uso por una cookie de sesión que
JavaScript nunca puede leer, para que un XSS en la propia SPA no pueda exfiltrar la sesión.

**Aceptación:**
- [ ] `GET /?boot=<token>` valida el token con `crypto.timingSafeEqual` sobre buffers de igual
      longitud.
- [ ] Token válido: 302 a `/`, con `Set-Cookie: nn_session=<32 bytes CSPRNG>; HttpOnly;
      SameSite=Strict; Path=/`.
- [ ] El token de arranque se quema al usarlo: un segundo intento devuelve 401.
- [ ] Un token de longitud distinta devuelve 401 sin llegar a `timingSafeEqual` y sin lanzar.
- [ ] La cookie de sesión también se compara en tiempo constante.
- [ ] Dos arranques seguidos producen tokens y cookies distintos.
- [ ] Ninguna vía de autenticación por query string sobrevive después del canje.

**Verificación:** `bun test packages/server` · manual: abrir la URL, ver `/` limpio en la barra de
direcciones y `document.cookie` vacío en la consola.

**Depende de:** T6.

**Archivos:** `packages/server/src/{bootstrap,session}.ts`, `packages/server/src/{bootstrap,session}.test.ts`, `packages/cli/src/index.ts`.

**Tamaño:** M.

---

### T6b — Cabeceras de seguridad y CSP

**Descripción:** Aplicar en toda respuesta las cabeceras que convierten un XSS en un incidente
contenido en lugar de un compromiso total del server local.

**Aceptación:**
- [ ] `Content-Security-Policy: default-src 'self'; img-src 'self'; media-src 'self' blob:;
      connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`.
- [ ] `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `X-Frame-Options: DENY`.
- [ ] Las cuatro se aplican a la SPA, a `/api/*` y a `/stream/*` por igual: test sobre todas las
      familias de rutas.
- [ ] Ninguna respuesta lleva `Access-Control-Allow-Origin`.
- [ ] Un test recorre la tabla de rutas y falla si a alguna le falta una de las cuatro cabeceras.

**Verificación:** `bun test packages/server` · manual: `curl -I` contra la home y contra la API.

**Depende de:** T6.

**Archivos:** `packages/server/src/middleware/security-headers.ts`, `packages/server/src/security-headers.test.ts`.

**Tamaño:** S.

---

### T7 — Cableado CLI → server

**Descripción:** Unir el parser con el server: puerto libre, token de sesión, apertura del
navegador y cierre ordenado.

**Aceptación:**
- [ ] Puerto fijo ocupado: elige uno libre del SO e informa el elegido.
- [ ] Token de 32 bytes con CSPRNG, nunca persistido en disco.
- [ ] Abre el navegador con `xdg-open`, `open` o `start`; si falla, igual imprime la URL.
- [ ] `SIGINT` y `SIGTERM`: cierra el server, mata los hijos registrados y sale con 130.
- [ ] Migración fallida sale con código 3 sin arrancar el server.
- [ ] `--no-open` imprime la URL y no abre nada.

**Verificación:** `bun run start` · `nn-anime --port <ocupado>` · `pgrep mpv` tras Ctrl+C.

**Depende de:** T5, T6.

**Archivos:** `packages/cli/src/{index,open-browser,lifecycle}.ts`, `packages/cli/src/lifecycle.test.ts`, `packages/cli/bin/nn-anime`.

**Tamaño:** M.

---

### T8 — Esqueleto de la SPA

**Descripción:** Vite, React, enrutado del lado del cliente, cliente API con token y tokens de
estilo. Sin funcionalidad de producto todavía.

**Aceptación:**
- [ ] `bun run dev` levanta Vite con proxy de `/api` y `/stream` a `127.0.0.1:7717`.
- [ ] El cliente API no maneja ningún token: se apoya en la cookie `HttpOnly` con
      `credentials: 'same-origin'`.
- [ ] El cliente no lee, escribe ni borra cookies, y no guarda nada sensible en `localStorage`
      ni en `sessionStorage`.
- [ ] El router sirve `/`, `/search`, `/anime/:providerId/:ref`, `/watch/:providerId/:ref`,
      `/settings` sin recargar la página.
- [ ] `tokens.css` define color, espaciado, radios y tipografía; ningún componente usa valores
      sueltos.
- [ ] `i18n/` de la web expone `es.ts` y todo texto sale de `t()`.

**Verificación:** `bun run dev` · navegar entre rutas y ver que no hay recarga completa.

**Depende de:** T7.

**Archivos:** `packages/web/{index.html,vite.config.ts}`, `packages/web/src/{main.tsx,router.tsx}`, `packages/web/src/api/client.ts`, `packages/web/src/styles/tokens.css`, `packages/web/src/i18n/es.ts`.

**Tamaño:** M.

---

## Checkpoint B — Arranque

- [ ] `bun run start` imprime la URL, abre el navegador y muestra la home.
- [ ] Petición sin cookie de sesión o con `Host` ajeno: 401 y 403 respectivamente.
- [ ] El token de arranque sirve una sola vez y la barra de direcciones queda en `/`.
- [ ] Toda respuesta trae CSP, `nosniff`, `Referrer-Policy` y `X-Frame-Options`.

---

## Fase 2 — Proveedores

### T9 — `provider-sdk`: tipos, schema, registro, errores y conformidad

**Descripción:** Implementar el contrato `Provider` del spec sobre los tipos de `core`, con
validación, registro y un test de conformidad reutilizable.

**Aceptación:**
- [ ] `Provider`, `ProviderCapabilities`, `CallOptions`, `StreamRequest` y `ProviderError` según
      `SPEC-provider-core.md`.
- [ ] `validateProvider(unknown)` devuelve `Result` con el motivo exacto del rechazo.
- [ ] Un `StreamSource` con nombre de header fuera de `^[A-Za-z0-9-]+$`, o con valor que contenga
      `\r`, `\n` o `\0`, se rechaza nombrando el header ofensor.
- [ ] Registro con alta, consulta por id y detección de `id` duplicado (gana el primero).
- [ ] `assertConforms(provider)` recorre los métodos y reporta qué método incumple el contrato.
- [ ] `apiVersion` distinto de `'1'` produce un error que nombra la versión esperada.
- [ ] `search()` del SDK envuelve excepciones del plugin en `Result` y nunca lanza.

**Verificación:** `bun test packages/provider-sdk`.

**Depende de:** T4.

**Archivos:** `packages/provider-sdk/src/{types,schema,registry,errors,conformance}.ts` y tests.

**Tamaño:** M.

---

### T10 — `provider-sdk`: loader de plugins

**Descripción:** Escanear y cargar plugins desde el directorio del usuario, aislando cada fallo.

**Aceptación:**
- [ ] Escanea `*.ts`, `*.js` y `*.mjs` en orden alfabético y carga con `import()`.
- [ ] Un plugin cuyo import lanza se reporta y se omite; los demás cargan igual.
- [ ] Un plugin inválido o con `apiVersion` incorrecta no impide el arranque.
- [ ] Un export `default` y un export `providers` producen un solo conjunto sin duplicados.
- [ ] Test: directorio con un plugin bueno, uno roto y uno inválido da 1 activo y 2 rechazos
      con motivo.
- [ ] Test: el directorio se inyecta; no se lee `$XDG_CONFIG_HOME` real.

**Verificación:** `bun test packages/provider-sdk` · manual copiando un plugin a
`~/.config/nn-anime/providers/` y viendo `/api/providers`.

**Depende de:** T9.

**Archivos:** `packages/provider-sdk/src/{loader,loader.test}.ts`, `packages/provider-sdk/src/__fixtures__/*`.

**Tamaño:** M.

---

### T11 — `providers-fixture` con contrato completo y modos de fallo

**Descripción:** Proveedor de prueba sobre datos propios que simula un sitio real, incluidos sus
defectos. Es la base de todos los tests y del e2e.

**Aceptación:**
- [ ] Implementa `search`, `getAnime`, `getEpisodes`, `resolveStream` y `getTrending`.
- [ ] Sirve al menos 12 títulos con géneros, estudio, año, sinopsis y cobertura; episodios por
      título; streams `file` y `hls`; subtítulos `srt` y `vtt`.
- [ ] Modos de fallo seleccionables por variable o por `ref` especial: latencia configurable,
      timeout, 500, 404, método que lanza, stream que exige header `Referer`.
- [ ] Test de conformidad de T9 pasa contra este proveedor.
- [ ] Ningún acceso a red: verificado con un test que corre con `fetch` sustituido por algo que
      lanza.

**Verificación:** `bun test packages/providers-fixture`.

**Depende de:** T9.

**Archivos:** `packages/providers-fixture/src/{index,data}.ts`, `packages/providers-fixture/src/{fixture.test.ts,conformance.test.ts}`, `packages/providers-fixture/fixtures/*.json`, `packages/providers-fixture/media/*.m3u8`.

**Tamaño:** M.

---

### T12 — Búsqueda agregada

**Descripción:** Consultar todos los proveedores activos en paralelo y emitir resultados
parciales sin que un proveedor lento o roto bloquee al resto.

**Aceptación:**
- [ ] Búsqueda en paralelo con `AbortSignal.timeout(8000)` por proveedor.
- [ ] Se emiten resultados por proveedor a medida que llegan, con evento de cierre y de error.
- [ ] Un proveedor que lanza produce un evento de error con su id, no una excepción.
- [ ] Un proveedor que nunca responde se aborta a los 8 s y el flujo cierra igual.
- [ ] La consulta se normaliza (`trim`, minúsculas, NFC) antes de usarse como clave.

**Verificación:** `bun test packages/server`.

**Depende de:** T10, T11.

**Archivos:** `packages/server/src/search/{aggregate,aggregate.test}.ts`.

**Tamaño:** M.

---

### T13 — Rutas `/api/providers` y `/api/search` con SSE

**Descripción:** Exponer el registro y la búsqueda incremental por HTTP.

**Aceptación:**
- [ ] `GET /api/providers` lista id, nombre, capabilities y estado de carga.
- [ ] `GET /api/search?q=&provider=` responde `text/event-stream` con un evento por proveedor y
      un evento final.
- [ ] El cliente que corta la conexión cancela los `AbortSignal` de los proveedores.
- [ ] Un plugin roto aparece como proveedor rechazado con motivo, sin 500.
- [ ] Ambas rutas pasan por los guards de T6.

**Verificación:** `bun test packages/server` · manual: `curl -N` contra `/api/search`.

**Depende de:** T12.

**Archivos:** `packages/server/src/routes/{providers,search}.ts`, `packages/server/src/routes/search.test.ts`.

**Tamaño:** M.

---

### T14 — Página de búsqueda

**Descripción:** Vista de búsqueda con grilla, etiqueta de origen y navegación por teclado.

**Aceptación:**
- [ ] Campo de búsqueda con debounce de 400 ms; el término se refleja en `?q=`.
- [ ] Grilla con etiqueta del proveedor de origen en cada tarjeta.
- [ ] Tarjetas son enlaces reales, alcanzables por `Tab`, con anillo de foco visible.
- [ ] Estado vacío con texto claro cuando no hay resultados.
- [ ] Todo texto sale de `t()`.

**Verificación:** `bun run dev` · navegar y buscar con el fixture activo.

**Depende de:** T8, T13.

**Archivos:** `packages/web/src/features/search/{SearchPage,ResultGrid,ResultCard}.tsx`, `packages/web/src/components/Grid.tsx`.

**Tamaño:** M.

---

### T15 — Búsqueda incremental por SSE

**Descripción:** Consumir el stream de búsqueda y pintar por proveedor, con cancelación y
anuncios accesibles.

**Aceptación:**
- [ ] Los resultados se pintan a medida que llegan, con esqueleto por proveedor pendiente.
- [ ] Un proveedor que falla muestra su error y no deja el esqueleto para siempre.
- [ ] Cambiar la consulta cancela la petición anterior y descarta sus eventos.
- [ ] La región de resultados es `aria-live="polite"` y anuncia el conteo al cerrar.
- [ ] Deduplicación de `fetch` por clave: dos montajes de la misma consulta hacen una petición.

**Verificación:** `bun run dev` · buscar con el fixture en modo latencia y en modo timeout.

**Depende de:** T14.

**Archivos:** `packages/web/src/api/{stream-events.ts,dedupe.ts}`, `packages/web/src/features/search/useSearchStream.ts`, `packages/web/src/features/search/SearchPage.tsx`.

**Tamaño:** M.

---

## Checkpoint C — Proveedores

- [ ] Buscar en la UI muestra resultados del fixture por proveedor, sin recargar la página.
- [ ] Un proveedor roto se reporta y no rompe la búsqueda.
- [ ] Revisión humana.

---

## Fase 3 — Persistencia

### T16 — Apertura de base, migraciones y `0001-initial.sql`

**Descripción:** Base SQLite con WAL y runner de migraciones versionadas.

**Aceptación:**
- [ ] `openDb(path)` aplica `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- [ ] `0001-initial.sql` crea las once tablas del Data Model con sus índices.
- [ ] El runner aplica pendientes en transacción y registra en `schema_version`.
- [ ] Correr dos veces seguidas devuelve `applied: 0` la segunda vez.
- [ ] Una migración que falla deja el esquema sin cambios y el error nombra el archivo.
- [ ] Ningún otro paquete importa `bun:sqlite`.

**Verificación:** `bun test packages/catalog-store` · `bun run db:migrate` dos veces.

**Depende de:** T4.

**Archivos:** `packages/catalog-store/src/{db,index}.ts`, `packages/catalog-store/src/migrations/{runner.ts,0001-initial.sql}`, `packages/catalog-store/src/db.test.ts`.

**Tamaño:** M. Andamiaje de esquema: declara explícitamente que supera cinco archivos.

---

### T17 — Repositorios de anime, episodios y búsqueda

**Descripción:** Cache-aside con TTL y cálculo de `stale` para los tres recursos de metadatos.

**Aceptación:**
- [ ] `readAnime`/`writeAnime`, `readEpisodes`/`writeEpisodes`, `readSearch`/`writeSearch`.
- [ ] `CacheHit<T>` con `value`, `fetchedAt`, `stale` y `ttlS` según la tabla de TTL.
- [ ] Un MISS devuelve `null` y no lanza.
- [ ] Escritura de un anime con géneros y episodios en una sola transacción.
- [ ] Escritura repetida de la misma ref actualiza, no duplica.
- [ ] `genres` y `studios` sobreviven el viaje de ida y vuelta en orden.

**Verificación:** `bun test packages/catalog-store`.

**Depende de:** T16.

**Archivos:** `packages/catalog-store/src/repositories/{anime,episodes,search}.ts` y tests.

**Tamaño:** M.

---

### T18 — Repositorio de streams

**Descripción:** Caché de URLs de stream con TTL corto y revalidación forzada.

**Aceptación:**
- [ ] `readStream`, `writeStream`, `invalidateStream`.
- [ ] TTL de 600 s, y `readStream` devuelve `null` cuando el TTL venció aunque la fila exista.
- [ ] Los headers se guardan serializados y vuelven a `StreamSource` completos.
- [ ] `invalidateStream` borra sólo la clave de episodio y modo indicados.
- [ ] Test: los headers nunca se incluyen en la forma pública del resultado.

**Verificación:** `bun test packages/catalog-store`.

**Depende de:** T17.

**Archivos:** `packages/catalog-store/src/repositories/{stream.ts,stream.test.ts}`.

**Tamaño:** S.

---

### T19 — Cola de revalidación

**Descripción:** Refresco de fondo para datos stale, sin duplicar trabajo ni perder datos buenos.

**Aceptación:**
- [ ] Concurrencia máxima 2, deduplicada por clave: dos lecturas stale de la misma clave encolan
      un solo trabajo.
- [ ] Una revalidación que falla conserva la fila vieja y registra `last_error`.
- [ ] Una escritura concurrente de la misma clave no produce `SQLITE_BUSY` (test de 50 escrituras
      simultáneas).
- [ ] El trabajo se cancela al cerrar la base, sin quedar colgado.
- [ ] Las escrituras pasan por la cola interna: ningún repositorio escribe fuera de ella.

**Verificación:** `bun test packages/catalog-store` incluyendo el test de concurrencia.

**Depende de:** T17.

**Archivos:** `packages/catalog-store/src/{revalidate,write-queue}.ts`, `packages/catalog-store/src/revalidate.test.ts`.

**Tamaño:** M.

---

### T20 — Historial, progreso, favoritos y búsquedas recientes

**Descripción:** Señales del usuario, que son también la entrada de `recsys`.

**Aceptación:**
- [ ] `recordWatch`, `updateWatchPosition`, `listRecentlyWatched`, `setFavorite`,
      `listFavorites`, `recordSearch`, `listRecentSearches`.
- [ ] `updateWatchPosition` actualiza la misma fila; no crea una nueva por cada 15 s.
- [ ] `listRecentlyWatched` ordena por más reciente y devuelve metadatos del anime en la misma
      consulta, sin N+1.
- [ ] `setFavorite(ref, true)` dos veces no duplica.
- [ ] Todo sobrevive a cerrar y reabrir la base.

**Verificación:** `bun test packages/catalog-store`.

**Depende de:** T17.

**Archivos:** `packages/catalog-store/src/repositories/{watch,favorites,search-history}.ts` y tests.

**Tamaño:** M.

---

### T21 — Ajustes, `pruneOrphans` y `db:migrate`

**Descripción:** Cierre de la fachada del store: ajustes clave-valor, limpieza y comando manual.

**Aceptación:**
- [ ] `getSetting`/`setSetting` con JSON y valor por defecto.
- [ ] `pruneOrphans` borra `stream_cache` vencido hace más de 1 día y detalles sin actividad en
      90 días; no toca un anime visto hace 5 días.
- [ ] `pruneOrphans` informa cuántas filas borró por tabla.
- [ ] `bun run db:migrate` funciona fuera de tests contra el directorio de datos real.
- [ ] `runMigrations` es idempotente desde el CLI.

**Verificación:** `bun test packages/catalog-store` · `bun run db:migrate`.

**Depende de:** T20.

**Archivos:** `packages/catalog-store/src/repositories/settings.ts`, `packages/catalog-store/src/{prune,index}.ts`, `packages/catalog-store/src/prune.test.ts`, `packages/cli/src/db-migrate.ts`.

**Tamaño:** M.

---

### T22 — Cableado del store en el server y cabecera `X-Cache`

**Descripción:** Las rutas de búsqueda y detalle pasan a leer del store antes de ir al proveedor.

**Aceptación:**
- [ ] Flujo completo: leer caché, si MISS o STALE ir al proveedor, escribir y servir.
- [ ] `X-Cache: hit | miss | stale` en las respuestas de metadatos.
- [ ] Con dato FRESH no se llama al proveedor: verificado con un contador inyectado.
- [ ] Con dato STALE se responde de inmediato y la revalidación ocurre por detrás.
- [ ] Segunda ejecución del proceso sirve home y búsqueda con 0 llamadas a proveedores.

**Verificación:** `bun test packages/server` · manual: dos arranques y revisar el contador en logs.

**Depende de:** T21, T13.

**Archivos:** `packages/server/src/{container.ts,cache-read.ts}`, `packages/server/src/routes/search.ts`, `packages/server/src/cache-read.test.ts`.

**Tamaño:** S.

---

## Checkpoint D — Persistencia

- [ ] Segunda ejecución sirve desde la base con 0 llamadas a proveedores, medido.
- [ ] `bun run db:migrate` dos veces no cambia el esquema.
- [ ] Revisión humana.

---

## Fase 4 — Detalle

### T23 — Detalle y episodios de extremo a extremo

**Descripción:** Primera rebanada vertical nueva: del proveedor hasta la ruta, pasando por el
store.

**Aceptación:**
- [ ] `GET /api/anime/:providerId/:ref` devuelve detalle con géneros y estudios.
- [ ] `GET /api/anime/:providerId/:ref/episodes` devuelve episodios con número, título, duración
      y modo disponible.
- [ ] Ambas cachean con `X-Cache` y revalidan como T22.
- [ ] Ref inválida o proveedor desconocido: 404 con mensaje claro, sin 500.
- [ ] El detalle alimenta `search_history` cuando viene de una búsqueda.

**Verificación:** `bun test packages/server` · manual con `curl`.

**Depende de:** T22.

**Archivos:** `packages/server/src/routes/{anime,episodes}.ts`, `packages/server/src/routes/anime.test.ts`.

**Tamaño:** M.

---

### T24 — Página de detalle

**Descripción:** Vista de detalle con metadatos, lista de episodios, selector sub/dub y favorito.

**Aceptación:**
- [ ] Muestra portada, sinopsis, año, estado, géneros, estudios y lista de episodios.
- [ ] Selector sub/dub deshabilitado según capabilities del proveedor.
- [ ] Botón de favorito con estado reflejado de forma inmediata y persistido.
- [ ] Estados de carga con esqueleto y de error con reintento.
- [ ] Ningún dato de proveedor se inserta con `dangerouslySetInnerHTML`.
- [ ] Navegable con teclado y con textos de `t()`.

**Verificación:** `bun run dev` · abrir un título del fixture.

**Depende de:** T23.

**Archivos:** `packages/web/src/features/detail/{DetailPage,EpisodeList,FavoriteButton}.tsx`, `packages/web/src/features/detail/useDetail.ts`.

**Tamaño:** M.

---

## Checkpoint E — Detalle

- [ ] Buscar → detalle → lista de episodios, con datos servidos desde la base.
- [ ] Revisión humana.

---

## Fase 5 — Reproducción

### T25 — Almacén de tickets opacos

**Descripción:** Indirección entre el cliente y las URLs de upstream, con expiración y tope.

**Aceptación:**
- [ ] `issue(url, headers, ttlS)` devuelve un ticket aleatorio con CSPRNG.
- [ ] Tope de 500 entradas con desalojo LRU y expiración a los 600 s.
- [ ] `resolve(ticket)` devuelve URL y headers; ticket vencido da 410, inexistente da 404.
- [ ] El ticket no contiene la URL ni permite deducirla.
- [ ] Test: 600 tickets dejan exactamente 500 vivos y los 100 más viejos vencidos.
- [ ] Test: ningún ticket aparece en la salida del logger, ni en `debug`.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T4.

**Archivos:** `packages/media-proxy/src/{ticket-store,ticket-store.test}.ts`.

**Tamaño:** S.

---

### T26 — Proxy de bytes con `Range`

**Descripción:** Reenvío en streaming con soporte de rangos y aborto.

**Aceptación:**
- [ ] `GET /stream/:ticket` reenvía `Range` y devuelve 206 con `Content-Range` cuando el upstream
      lo da; si no, degrada a 200.
- [ ] Fuerza `Accept-Encoding: identity`.
- [ ] Usa `ReadableStream` y `pipeTo`; no hay ninguna llamada a `arrayBuffer()` ni a `Buffer.concat`
      del cuerpo completo.
- [ ] Al cortar el cliente, el upstream se aborta: test con contador de conexiones vivas.
- [ ] `Range` inválido (negativo, múltiple, absurdo) devuelve 416 sin llegar al upstream.
- [ ] Reproducir 10 minutos no supera 64 MB de RSS.
- [ ] Ningún header de upstream se serializa al cliente: test explícito.

**Verificación:** `bun test packages/media-proxy` · manual: `curl -r 0-1023` con el fixture.

**Depende de:** T25, T11.

**Archivos:** `packages/media-proxy/src/{byte-proxy,byte-proxy.test}.ts`, `packages/server/src/routes/stream.ts`.

**Tamaño:** M.

---

### T26a — Lista blanca de destinos y redirecciones

**Descripción:** Cerrar SSRF. El proxy sale sólo a donde debe y lo reverifica en cada salto de
redirección.

**Aceptación:**
- [ ] Sólo `http` y `https`. `file:`, `data:`, `ftp:` y cualquier otro esquema se rechazan antes
      de abrir conexión.
- [ ] Se rechazan loopback (`127.0.0.0/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`),
      link-local (`169.254/16`, `fe80::/10`) y direcciones de metadata de nube.
- [ ] La comprobación se aplica después de resolver DNS: un nombre que resuelve a `127.0.0.1` se
      rechaza igual que la IP literal.
- [ ] `redirect: 'manual'`: cada salto se revalida y el tope es 5; el sexto devuelve error.
- [ ] El error nombra la regla que rechazó el destino, sin volcar la URL completa en producción.
- [ ] Test con los cinco destinos prohibidos del spec y con una cadena permitido → prohibido que
      se corta en el salto.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{destination-guard.ts,destination-guard.test.ts}`, `packages/media-proxy/src/byte-proxy.ts`.

**Tamaño:** M.

---

### T26b — Saneamiento de respuestas: lista blanca de cabeceras

**Descripción:** Dejar de copiar cabeceras de upstream. Pasar sólo lo necesario y eliminar el
resto, `Set-Cookie` incluida.

**Aceptación:**
- [ ] Lista blanca de respuesta: `content-type`, `content-length`, `content-range`,
      `accept-ranges`, `cache-control`, `etag`, `last-modified`. Nada más.
- [ ] `Set-Cookie` se elimina siempre: test con un upstream de fixture que la devuelve.
- [ ] El `Content-Type` se fuerza desde lo que se pidió (playlist, segmento, subtítulo) y no se
      copia del upstream.
- [ ] Se añade `X-Content-Type-Options: nosniff`.
- [ ] Un test compara el conjunto completo de cabeceras de respuesta contra la lista permitida y
      falla si aparece una extra.
- [ ] Un upstream que declara `text/html` no cambia el `Content-Type` servido.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{response-headers.ts,response-headers.test.ts}`, `packages/media-proxy/src/byte-proxy.ts`.

**Tamaño:** S.

---

### T27 — Reescritura HLS: variantes y segmentos

**Descripción:** Detectar playlists, reescribir URIs y encadenar por el proxy sin romper la
resolución relativa.

**Aceptación:**
- [ ] Detección por `Content-Type` o extensión `.m3u8`.
- [ ] Reescribe URIs de segmentos y de sub-playlists a `/stream/:ticket/seg/:index`.
- [ ] Resuelve URLs relativas contra la URL base de cada playlist, incluidas las anidadas.
- [ ] Conserva el orden y los atributos de `#EXT-X-STREAM-INF`.
- [ ] Caché en memoria de playlists por 10 s como máximo.
- [ ] Rechaza playlists mayores de 4 MB antes de parsear, con error explícito.
- [ ] Test contra `fixtures/master.m3u8` y `fixtures/media.m3u8`: salida esperada versionada.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{hls.ts,hls.test.ts}`, `packages/media-proxy/fixtures/{master,media}.m3u8`.

**Tamaño:** M.

---

### T28 — Reescritura HLS: claves, discontinuidad y límites

**Descripción:** Los casos que suelen romper la reproducción: cifrado, saltos de secuencia y
límites de seguridad.

**Aceptación:**
- [ ] `#EXT-X-KEY` con URI reescrita al proxy, conservando `METHOD` e `IV`.
- [ ] `#EXT-X-DISCONTINUITY`: decisión registrada en el código y verificada por test. Por
      defecto, rechazo explícito con error claro.
- [ ] `#EXT-X-MAP` reescrito cuando existe.
- [ ] URIs con esquema distinto o `data:` se rechazan por lista de permitidos, no por lista de
      bloqueados.
- [ ] Un segmento pedido con índice fuera de rango devuelve 404.
- [ ] Test contra `fixtures/encrypted.m3u8` y `fixtures/discontinuity.m3u8`.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T27.

**Archivos:** `packages/media-proxy/src/{hls-keys.ts,hls-keys.test.ts}`, `packages/media-proxy/fixtures/{encrypted,discontinuity}.m3u8`.

**Tamaño:** M.

---

### T29 — Handoff a mpv

**Descripción:** Lanzar, seguir y matar mpv desde el server, con salida cuando no está instalado.

**Aceptación:**
- [ ] `POST /api/play/mpv` resuelve el stream, emite el ticket y lanza `mpv` con
      `--http-header-fields` construido desde los headers de upstream.
- [ ] `GET /api/play/mpv/events` emite SSE con `starting`, `playing`, `exited`, `failed`.
- [ ] Sin `mpv` en el `PATH`: 503 y `/api/health` informa `mpv: false`.
- [ ] Salida distinta de 0 devuelve el `stderr` recortado a 2 KB.
- [ ] `POST /api/play/mpv/:pid/stop` mata el proceso y el SSE emite `exited`.
- [ ] Al cerrar la app, todo mpv lanzado muere: verificado con `pgrep`.
- [ ] Ningún argumento de la línea de comandos se construye por concatenación de entrada del
      usuario; se usa el array de `spawn`.

**Verificación:** `bun test packages/media-proxy` · manual: botón de mpv con el fixture.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{mpv.ts,mpv.test.ts}`, `packages/server/src/routes/play.ts`.

**Tamaño:** M.

---

### T29a — Validación de headers hacia mpv

**Descripción:** Impedir que un valor de header inyecte argumentos o cabeceras en el proceso de
mpv.

**Aceptación:**
- [ ] Nombre de header validado con `^[A-Za-z0-9-]+$`; valor sin `\r`, `\n` ni caracteres de
      control.
- [ ] Un header inválido produce error con el nombre ofensor y no se lanza ningún proceso.
- [ ] Los argumentos se pasan en array a `Bun.spawn`; ninguna ruta construye la línea de comandos
      por concatenación.
- [ ] Tope de un mpv concurrente: un segundo `POST /api/play/mpv` devuelve 409.
- [ ] Test con `spawn` sustituido por un espía: se verifica el array exacto de argumentos.
- [ ] Test: un valor con `\n` no añade ningún argumento nuevo en el espía.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T29.

**Archivos:** `packages/media-proxy/src/{mpv-args.ts,mpv-args.test.ts}`, `packages/media-proxy/src/mpv.ts`.

**Tamaño:** S.

---

### T30 — Subtítulos: proxy y conversión `srt` a `vtt`

**Descripción:** Servir subtítulos por el proxy y convertir en memoria lo que el navegador no
entiende.

**Aceptación:**
- [ ] `GET /api/subtitles/:ticket` proxyfica la pista y fuerza `Content-Type: text/vtt`.
- [ ] `srt` se convierte a `vtt` en memoria: numeración, comas a puntos y cabecera `WEBVTT`.
- [ ] `ass` se devuelve tal cual para mpv y se omite en el reproductor web.
- [ ] Codificación distinta de UTF-8 se detecta y se convierte a UTF-8.
- [ ] Límite de 5 MB por pista; por encima, error explícito.
- [ ] Test de conversión con un `srt` de fixture que incluye BOM y saltos CRLF.

**Verificación:** `bun test packages/media-proxy`.

**Depende de:** T25, T11.

**Archivos:** `packages/media-proxy/src/{subtitles.ts,subtitles.test.ts}`, `packages/server/src/routes/subtitles.ts`, `packages/media-proxy/fixtures/sample.srt`.

**Tamaño:** M.

---

### T31 — Reproductor web con hls.js

**Descripción:** Reproducción dentro de la página, con seek, atajos de teclado y accesibilidad.

**Aceptación:**
- [ ] Detecta `kind` y usa `<video>` directo o `hls.js` según corresponda.
- [ ] Seek, pausa, volumen y pantalla completa funcionan con teclado.
- [ ] Flechas ±10 s, `Espacio` y `Enter` para pausa.
- [ ] Los atajos no secuestran la escritura cuando el foco está en un campo de texto.
- [ ] Estado del reproductor en región `aria-live="polite"`.
- [ ] Los controles se ven y funcionan en tema oscuro y claro, con contraste 4.5:1.

**Verificación:** `bun run dev` · reproducir el mp4 del fixture, adelantar 30 s.

**Depende de:** T26, T24.

**Archivos:** `packages/web/src/features/player/{Player,usePlayer,controls}.tsx`, `packages/web/src/features/player/Player.test.tsx`.

**Tamaño:** M.

---

### T31a — Lista blanca de esquemas para datos de proveedor

**Descripción:** Que ninguna URL que venga de un proveedor pueda ejecutar nada en la página.

**Aceptación:**
- [ ] `safeUrl(value)` acepta sólo `http` y `https`; devuelve `null` para todo lo demás.
- [ ] Un `coverUrl` con `javascript:`, `data:` o `vbscript:` se renderiza como texto plano y no
      produce ningún `href` ni `src`.
- [ ] La función se aplica en todos los puntos donde una URL de proveedor entra a un atributo,
      verificado con `grep` sobre `src` y `href` en el paquete y con un test por componente que
      muestra portada.
- [ ] Las URLs de subtítulos y de stream pasan por la misma función.
- [ ] Test: un título con `javascript:` no genera ningún atributo con ese valor en el DOM.

**Verificación:** `bun test packages/web` · `bun run e2e`.

**Depende de:** T24.

**Archivos:** `packages/web/src/lib/{safe-url.ts,safe-url.test.ts}`, `packages/web/src/components/ResultCard.tsx`, `packages/web/src/features/detail/DetailPage.tsx`.

**Tamaño:** S.

---

### T32 — Sub/dub, pista de subtítulos y registro de posición

**Descripción:** Cerrar el ciclo de reproducción: cambio de modo, subtítulos y señal de
visionado.

**Aceptación:**
- [ ] Cambiar de sub a dub vuelve a resolver el stream y reanuda en la misma posición.
- [ ] Selector de pista de subtítulos, con pista por defecto del proveedor preseleccionada.
- [ ] `POST /api/watch` al iniciar y `PATCH /api/watch/:id` cada 15 s y al pausar.
- [ ] Al cerrar o desmontar la vista, se envía la posición final con `sendBeacon` o `fetch` con
      `keepalive`.
- [ ] Sin reproducción real no se registra nada: verificado con un test que sólo carga la página.
- [ ] La posición registrada aparece en `listRecentlyWatched`.

**Verificación:** `bun test packages/server` · manual: ver la fila "continuar viendo" tras ver
30 s y recargar.

**Depende de:** T31, T20.

**Archivos:** `packages/web/src/features/player/{useWatchEvents.ts,subtitle-tracks.ts}`, `packages/server/src/routes/watch.ts`, `packages/server/src/routes/watch.test.ts`.

**Tamaño:** M.

---

## Checkpoint F — Reproducción

- [ ] El mp4 del fixture se reproduce en la página, el seek funciona y los subtítulos aparecen.
- [ ] mpv abre, se sigue por SSE y muere al cerrar la app.
- [ ] Decisión explícita sobre HLS: se mantiene o se aplica el plan B del riesgo 1.
- [ ] Revisión humana.

---

## Fase 6 — Recomendaciones

### T33 — Afinidad: vector, IDF y decaimiento

**Descripción:** Base del motor: qué le gusta al usuario, ponderado por recencia y completitud.

**Aceptación:**
- [ ] Vector de afinidad sobre tags, estudio y año.
- [ ] Peso = recencia × completitud, con semivida de 30 días y `now` inyectado.
- [ ] IDF sobre el corpus de candidatos: un tag en el 80 % pesa menos que uno en el 5 %.
- [ ] Similitud coseno con manejo de vector vacío sin `NaN`.
- [ ] Bonus de 0,1 por estudio compartido.
- [ ] Tests con corpus sintético determinista; sin red y sin base.

**Verificación:** `bun test packages/recsys`.

**Depende de:** T4.

**Archivos:** `packages/recsys/src/{affinity.ts,affinity.test.ts}`.

**Tamaño:** M.

---

### T34 — Co-visita

**Descripción:** Señal colaborativa puramente local: qué se ve junto en la misma sesión.

**Aceptación:**
- [ ] Sesión definida como eventos separados por menos de 6 h.
- [ ] Cuenta pares (candidato, título visto) dentro de la sesión, normalizado por el par más
      frecuente.
- [ ] Sin historial: componente en 0, sin división por cero.
- [ ] Un par visto una sola vez no domina sobre uno visto diez veces.
- [ ] Test con historial que cruza el borde de sesión.

**Verificación:** `bun test packages/recsys`.

**Depende de:** T33.

**Archivos:** `packages/recsys/src/{covisit.ts,covisit.test.ts}`.

**Tamaño:** M.

---

### T35 — Señal de búsqueda, exclusión y reencuentro

**Descripción:** Incorporar lo que el usuario busca ahora y decidir qué no recomendar.

**Aceptación:**
- [ ] Los términos buscados se cruzan con título y tags; un candidato abierto desde una búsqueda
      reciente y no visto sube con razón `matches-search`.
- [ ] Semivida de 3 días para la señal de búsqueda.
- [ ] Un título visto al 100 % no aparece en el top 10.
- [ ] Un título visto al 10 % hace más de 30 días sí puede reaparecer.
- [ ] Todo candidato ya visto queda fuera salvo la excepción anterior, verificada por test.

**Verificación:** `bun test packages/recsys`.

**Depende de:** T34.

**Archivos:** `packages/recsys/src/{search-signal.ts,filters.ts,search-signal.test.ts}`.

**Tamaño:** M.

---

### T36 — MMR y razones en español

**Descripción:** Diversidad final y explicación legible de cada recomendación.

**Aceptación:**
- [ ] Reranking MMR sobre tags con `lambda` 0,7 por defecto.
- [ ] Dos títulos del mismo tag no copan el top 5, verificado por test.
- [ ] `Reason` con `kind`, `text` y `evidence`; al menos una por recomendación del top 20.
- [ ] Los textos están en el catálogo i18n, no incrustados en el código.
- [ ] Ninguna razón con `text` vacío, verificado para el top 20 completo.

**Verificación:** `bun test packages/recsys`.

**Depende de:** T35.

**Archivos:** `packages/recsys/src/{mmr.ts,reasons.ts,reasons.test.ts}`, `packages/recsys/src/i18n/es.ts`.

**Tamaño:** M.

---

### T37 — Fachada `recommend()`, determinismo y rendimiento

**Descripción:** API pública del motor, con la garantía de reproducibilidad del spec.

**Aceptación:**
- [ ] `recommend(signals, candidates, options)` con `limit`, `mmrLambda` y `seed`.
- [ ] Salida idéntica en orden y contenido con el mismo `seed`, `now` y entradas.
- [ ] Sin historial: sólo `cold-start` ordenado por popularidad.
- [ ] 500 registros y 5000 candidatos por debajo de 50 ms, medido en el test.
- [ ] El paquete no importa `bun:sqlite` ni usa `fetch`: test que corre con ambos ausentes.
- [ ] `components` expone `affinity`, `covisit`, `recency` y `diversity` por separado.

**Verificación:** `bun test packages/recsys`.

**Depende de:** T36.

**Archivos:** `packages/recsys/src/{index.ts,recommend.test.ts}`.

**Tamaño:** M.

---

### T38 — Ruta `/api/recommendations`

**Descripción:** Alimentar al motor con señales locales y candidatos del store y del proveedor.

**Aceptación:**
- [ ] `GET /api/recommendations?limit=` devuelve ranking con razones.
- [ ] Candidatos: títulos del store, favoritos, semilla de búsqueda reciente y `getTrending` si
      el proveedor lo soporta.
- [ ] Cada candidato se enriquece con tags desde el store; sin tags queda fuera del ranking de
      afinidad y puede entrar sólo por popularidad.
- [ ] Sin historial no se llama a ningún proveedor salvo `getTrending`.
- [ ] La respuesta no incluye `components` en la forma pública por defecto.
- [ ] Se cumple el presupuesto de 50 ms del motor, medido en el handler.

**Verificación:** `bun test packages/server`.

**Depende de:** T37, T22.

**Archivos:** `packages/server/src/routes/recommendations.ts`, `packages/server/src/recommendation-input.ts`, `packages/server/src/routes/recommendations.test.ts`.

**Tamaño:** M.

---

### T39 — Panel de recomendaciones

**Descripción:** Mostrar el ranking con sus razones y reaccionar a lo que el usuario busca.

**Aceptación:**
- [ ] Panel en la home con al menos una razón visible por tarjeta; las demás en el `title`.
- [ ] Botón para ver el detalle del score (`components`).
- [ ] Al cambiar la consulta de búsqueda, el panel se refresca con debounce de 400 ms y cancela
      la petición anterior.
- [ ] El panel es distinto del de arranque en frío cuando hay historial.
- [ ] Estados de carga y de vacío claros; textos de `t()`.

**Verificación:** `bun run dev` · ver el panel antes y después de registrar historial.

**Depende de:** T38, T14.

**Archivos:** `packages/web/src/features/recommendations/{Panel,ReasonBadge,ScoreDetail}.tsx`, `packages/web/src/features/recommendations/useRecommendations.ts`.

**Tamaño:** M.

---

## Checkpoint G — Recomendaciones

- [ ] Cada recomendación del top 20 muestra al menos una razón legible.
- [ ] El panel cambia al buscar y difiere del arranque en frío.
- [ ] Revisión humana.

---

## Fase 7 — Pulido, seguridad y cierre

### T40 — Página de ajustes

**Descripción:** Ajustes visibles: proveedores, rutas de datos, disponibilidad de mpv y tema.

**Aceptación:**
- [ ] Lista de proveedores con capabilities y estado, incluidos los rechazados con su motivo.
- [ ] Muestra las rutas de datos, configuración y caché en uso.
- [ ] Indica si `mpv` está disponible, con la versión detectada.
- [ ] Aviso en texto claro de que un plugin se ejecuta sin sandbox con los permisos del usuario.
- [ ] Enlace a `SECURITY.md` desde la propia página, además del aviso en línea.
- [ ] Selector de tema oscuro y claro, persistido en ajustes.

**Verificación:** `bun run dev` · revisar `/settings` con un plugin roto presente.

**Depende de:** T13, T7.

**Archivos:** `packages/web/src/features/settings/{SettingsPage,ProviderList,ThemeToggle}.tsx`, `packages/server/src/routes/settings.ts`.

**Tamaño:** M.

---

### T41 — Filas de la home

**Descripción:** La home completa: continuar, favoritos, tendencias y recomendaciones.

**Aceptación:**
- [ ] Fila "continuar viendo" con posición registrada, sin reanudación automática.
- [ ] Fila de favoritos con estado vacío útil.
- [ ] Fila de tendencias desde `getTrending` cuando el proveedor lo soporta.
- [ ] El panel de recomendaciones de T39 integrado como una fila más.
- [ ] Grillas virtualizadas cuando superan 60 elementos.
- [ ] Con la base poblada la home pinta antes de 1 s con `X-Cache: hit`.

**Verificación:** `bun run dev` · medir con la pestaña de red abierta.

**Depende de:** T39, T32.

**Archivos:** `packages/web/src/features/home/{HomePage,ContinueRow,TrendingRow}.tsx`, `packages/web/src/components/VirtualGrid.tsx`.

**Tamaño:** M.

---

### T42 — Pasada de accesibilidad

**Descripción:** Verificar y corregir los mínimos de accesibilidad del spec sobre toda la SPA.

**Aceptación:**
- [ ] Recorrido completo por teclado: buscar, elegir título, elegir episodio y reproducir, sin
      mouse.
- [ ] Contraste verificado: 4.5:1 en texto normal y 3:1 en texto grande, en ambos temas.
- [ ] Con `prefers-reduced-motion: reduce` no hay animaciones de esqueleto ni transiciones.
- [ ] `aria-live` presente en resultados de búsqueda y estado del reproductor.
- [ ] Sin atajos globales activos cuando el foco está en un campo de texto.
- [ ] Informe breve de hallazgos y correcciones anotado en el commit.

**Verificación:** recorrido manual con teclado y con la preferencia de movimiento reducido
activada.

**Depende de:** T41.

**Archivos:** `packages/web/src/**/*.tsx` (correcciones puntuales), `packages/web/src/styles/tokens.css`, `docs/a11y.md`.

**Tamaño:** M.

---

### T43 — Arneses Playwright y casos de home y búsqueda

**Descripción:** Montar el e2e con el fixture y cubrir las dos primeras rutas.

**Aceptación:**
- [ ] `bun run e2e` levanta el server con `providers-fixture`, base temporal y `--no-open`.
- [ ] Ningún test toca red externa ni `$XDG_*` real.
- [ ] Caso: la home carga y muestra contenido.
- [ ] Caso: buscar muestra resultados incrementales y el estado vacío con una consulta sin
      coincidencias.
- [ ] Un proveedor en modo fallo aparece como error en la UI y el test lo verifica.
- [ ] Los tests son estables en tres ejecuciones seguidas.

**Verificación:** `bun run e2e` tres veces.

**Depende de:** T41.

**Archivos:** `playwright.config.ts`, `packages/web/e2e/{fixtures.ts,home.spec.ts,search.spec.ts}`.

**Tamaño:** M.

---

### T44 — Casos e2e de detalle, reproductor y recomendaciones

**Descripción:** Cerrar la cobertura e2e del camino crítico.

**Aceptación:**
- [ ] Caso: búsqueda → detalle → lista de episodios.
- [ ] Caso: reproducir el mp4 del fixture, adelantar 30 s y verificar el tiempo actual.
- [ ] Caso: activar subtítulos y verificar que el texto aparece.
- [ ] Caso: cada recomendación visible tiene una razón no vacía.
- [ ] Caso: con mpv simulado como ausente, se muestra el aviso y el reproductor web sigue.
- [ ] Los casos que dependen de mpv real están marcados y se saltan si no hay `mpv`.

**Verificación:** `bun run e2e`.

**Depende de:** T43, T32, T39.

**Archivos:** `packages/web/e2e/{detail.spec.ts,player.spec.ts,recommendations.spec.ts}`.

**Tamaño:** M.

---

### T45 — Tests de seguridad

**Descripción:** Convertir en tests, una por una, las doce mitigaciones del spec de proyecto. Un
hallazgo que no se convierte en criterio de aceptación es un hallazgo perdido.

**Aceptación:**
- [ ] M1 `Host`: 403 con `Host: evil.example`, incluido el caso de DNS rebinding, en toda ruta.
- [ ] M2 Sesión: sin cookie válida, 401 en toda ruta de `/api/*` y `/stream/*`, verificado por
      tabla de rutas. El token de arranque sirve una sola vez.
- [ ] M3 Tiempo constante: la comparación usa `timingSafeEqual`; test con longitudes distintas no
      lanza y devuelve 401.
- [ ] M4 `Origin` ausente, `null` y ajeno en método mutante: 403.
- [ ] M5 CSP, `nosniff`, `Referrer-Policy` y `X-Frame-Options` presentes en toda respuesta, y
      ninguna respuesta con `Access-Control-Allow-Origin`.
- [ ] M6 Ninguna respuesta al cliente contiene un header de upstream: barrido sobre todas las
      rutas.
- [ ] M7 `Set-Cookie` de upstream no aparece nunca en la respuesta; el conjunto de cabeceras de
      respuesta está contenido en la lista blanca.
- [ ] M8 El proxy rechaza `http://127.0.0.1:22`, `http://169.254.169.254/`, `http://10.0.0.1/`,
      `file:///etc/passwd` y `data:text/plain,x`, y no sigue una redirección hacia un destino
      prohibido.
- [ ] M9 Confinamiento: `../../etc/passwd` y symlinks fuera de la raíz no se sirven.
- [ ] M10 Un header con `\n` hacia mpv se rechaza; el espía de `spawn` no recibe argumentos
      extra.
- [ ] M11 `safeUrl` rechaza `javascript:` y el DOM no contiene atributos con ese valor.
- [ ] M12 Ningún log, en ningún nivel, contiene `authorization`, `cookie`, `referer`, `Set-Cookie`
      ni la cookie de sesión. El token no se escribe en disco: verificado con directorio temporal.
- [ ] Un `Range` malformado no llega al upstream.

**Verificación:** `bun test packages/server packages/media-proxy packages/web`.

**Depende de:** T26a, T26b, T29a, T31a, T6a, T6b, T22.

**Archivos:** `packages/server/src/{security.test.ts,routes-table.test.ts,bootstrap.test.ts}`, `packages/media-proxy/src/{leak.test.ts,destination-guard.test.ts,response-headers.test.ts}`, `packages/web/src/lib/safe-url.test.ts`.

**Tamaño:** M.

---

### T46 — Documentación y empaquetado

**Descripción:** Dejar el proyecto usable por otro y listo para npm sin publicarlo.

**Aceptación:**
- [ ] `README.md` con arranque, comandos, rutas de datos y captura de pantalla.
- [ ] `docs/providers.md` con la guía de autoría: contrato, ejemplo comentado sin lógica de
      scraping real, y cómo correr el test de conformidad.
- [ ] Aviso de seguridad de plugins en texto claro, en el README y en `/settings`.
- [ ] Nota explícita de que el repo no incluye scrapers y que las fuentes son responsabilidad
      del usuario.
- [ ] `packages/cli/package.json` con `bin`, `files` y `publishConfig`; `bun pm pack` produce un
      tarball instalable.
- [ ] `docs/PLAN-B-HLS.md` registra la decisión del Checkpoint F.

**Verificación:** `bun pm pack` · revisar el tarball generado.

**Depende de:** T44, T40.

**Archivos:** `README.md`, `docs/{providers.md,a11y.md,PLAN-B-HLS.md}`, `packages/cli/package.json`.

**Tamaño:** M.

---

### T47 — Barrido final de criterios de éxito

**Descripción:** Recorrer uno a uno los criterios de éxito del spec de proyecto y marcarlos, o
abrir un task de corrección por cada uno que falle.

**Aceptación:**
- [ ] Los ocho criterios de `SPEC-nn-anime.md` verificados y marcados en el propio spec.
- [ ] Los criterios de cada spec de módulo revisados; los no verificados se listan con motivo.
- [ ] `bun install && bun run build && bun test && bun run e2e` limpio en un checkout nuevo.
- [ ] Informe final con lo cumplido, lo diferido y lo que falla.

**Verificación:** los cuatro comandos en un clon limpio del repo.

**Depende de:** T46.

**Archivos:** `SPEC-nn-anime.md`, `SPEC-<module-id>.md`, `docs/v1-report.md`.

**Tamaño:** S.

---

## Checkpoint H — Cierre v1

- [ ] Todos los criterios de éxito del spec de proyecto verificados y marcados.
- [ ] `bun install && bun run build && bun test && bun run e2e` limpio en checkout nuevo.
- [ ] Revisión humana y decisión sobre v1.5 (`downloads`).

---

## Resumen de dependencias

Raíz común: `T1 → T2 → T3 → T4`.

```
T4 ├─ T6 → T7 → T8
   ├─ T9 → T10 ─┐
   │      T11 ──┴─ T12 → T13 → T14 → T15
   ├─ T16 → T17 → T18, T19, T20 → T21 → T22 → T23 → T24
   ├─ T25 → T26 → T27 → T28
   │          ├─ T29
   │          └─ T30
   └─ T33 → T34 → T35 → T36 → T37
```

Dependencias sueltas, en orden de ejecución:

| Task | Depende de |
|---|---|
| T5 | T3 |
| T6a | T6 |
| T6b | T6 |
| T7 | T5, T6 |
| T8 | T7 |
| T26a | T26 |
| T26b | T26 |
| T29a | T29 |
| T31 | T26, T24 |
| T31a | T24 |
| T32 | T31, T20 |
| T38 | T37, T22 |
| T39 | T38, T14 |
| T40 | T13, T7 |
| T41 | T39, T32 |
| T42 | T41 |
| T43 | T41 |
| T44 | T43, T32, T39 |
| T45 | T26a, T26b, T29a, T31a, T6a, T6b, T22 |
| T46 | T44, T40 |
| T47 | T46 |

Camino crítico más largo: T1 → T2 → T3 → T4 → T16 → T17 → T20 → T32 → T41 → T42 → T43 → T44 →
T46 → T47 (14 tasks). Las seis insertadas no alargan el camino crítico: T6a y T6b cuelgan de T6,
y T26a, T26b, T29a y T31a cuelgan de tasks que ya están en el camino o fuera de él.
