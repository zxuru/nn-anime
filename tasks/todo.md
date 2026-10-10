# Task List: nn-anime v1

Plan: `tasks/plan.md` · Specs: `CAPABILITY-MAP.md`, `SPEC-nn-anime.md`, `SPEC-<module-id>.md`
Regla: todo task cierra el Definition of Done de `tasks/plan.md`. Tope de 5 archivos de
implementación por task; el andamiaje de T1 y T16 lo declara explícitamente.

55 tareas: T1–T47 más las seis insertadas tras la revisión de seguridad (T6a, T6b, T26a, T26b,
T29a, T31a), T8a —añadida al cerrar el Checkpoint B porque el spec exigía servir la interfaz
construida y ninguna tarea lo cubría— y T26c, añadida al auditar la trazabilidad porque el nivel de
pruebas de integración del spec no lo creaba nadie. Los ids con sufijo no se renumeran: el orden de ejecución lo
da la tabla de dependencias del final.

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
- [x] Soporta `[query]`, `-p/--port`, `--no-open`, `--data-dir`, `--config-dir`, `--provider`
      repetible, `--lang`, `-v/--verbose`, `-h/--help`, `--version`.
- [x] `--port abc` y una flag desconocida devuelven error de uso con código 2.
- [x] `nn-anime --help` no arranca el server y sale con 0.
- [x] `--provider a --provider b` acumula ambos en orden.

**Verificación:** `bun test packages/cli` 48 pasan, 0 fallan · `bun test` 169 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0 sin infos. Manual: `--help` sale 0 y no arranca el server,
`--port abc` sale 2 con el error en stderr, `--version` imprime `nn-anime 0.1.0`.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- **El parser no conoce ningún idioma.** Devuelve `key` y `params` del catálogo i18n; quien
  arranca traduce. Es lo que hace que `--lang` afecte también a los mensajes de error de uso, y
  que traducir no obligue a tocar el parser.
- **`--help` y `--version` ganan sobre todo lo demás**, incluido un argumento inválido. La
  búsqueda se detiene en `--`, así que `nn-anime -- --help` busca el texto `--help` en lugar de
  mostrar la ayuda.
- **La orquestación vive en `run.ts`, separada de `index.ts`.** `run` recibe `start` inyectado,
  y eso es lo que permite verificar el criterio "no arranca el server" sin arrancar nada. T7
  sustituye ese `start` por el arranque real.
- El rango de puerto admitido viaja en los parámetros del error, no incrustado en el texto, para
  que el mensaje traducido lo diga en el idioma del usuario.
- `--data-dir=-raro` funciona: con `=` el valor puede empezar por guion.

**Ampliación de spec:** el criterio de `SPEC-cli-launcher.md` sobre `--lang en` decía que cambiaba
los mensajes del CLI. Hoy `en` no es un idioma soportado en `LOCALES`, así que cae a `es`. El
criterio se reescribió para describir la garantía real: el mecanismo está probado y añadir un
idioma es un archivo. Traducir el inglés no estaba pedido y no se hizo.

**Depende de:** T3.

**Archivos:** `packages/cli/src/{args,run,index}.ts`, `packages/cli/src/{args,run}.test.ts`,
`packages/cli/src/i18n/{index,es}.ts`.

**Tamaño:** S. Se añadieron `run.ts` y el catálogo i18n, que no estaban previstos, para que el
criterio de "no arranca el server" fuera verificable y para que los mensajes salieran del catálogo
como pide el spec.

---

### T6 — Server Hono con guards de seguridad y `/api/health`

**Descripción:** App Hono mínima con la seguridad del spec aplicada como middleware global.

**Aceptación:**
- [x] `createApp({ session, port, ... })` monta `host-guard` y `session-guard` sobre `/api/*`
      y `/stream/*`.
- [x] `host-guard` rechaza con 403 todo `Host` que no sea `127.0.0.1:<puerto>` o
      `localhost:<puerto>`.
- [x] `session-guard` exige la cookie de sesión de T6a y responde 401 sin cuerpo útil en
      cualquier otro caso. No existe ninguna vía de autenticación por query string.
- [x] `origin-guard` en métodos mutantes: `Origin` ausente, `null` o ajeno devuelve 403.
- [x] `GET /api/health` devuelve `{ version, port, mpv, providers }` y exige sesión.
- [x] Test de tabla de rutas: toda ruta registrada está cubierta por ambos guards, o el test falla.

**Verificación:** `bun test packages/server` 28 pasan, 0 fallan · `tsc --noEmit` 0 ·
`biome check .` 0 sin infos.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- **El spec decía `createServer`; hay dos funciones.** `createApp` devuelve la aplicación Hono y
  `startServer` la escucha con `Bun.serve`. Separarlas es lo que permite testear los guards con
  `app.request(...)`, sin abrir un socket.
- **El puerto se lee de forma diferida** (`number | (() => number)`). Con `port: 0` el sistema
  elige el puerto y los guards lo necesitan para validar `Host`: resolverlo antes de arrancar
  tendría una carrera real. `startServer` arranca con un marcador y lo rellena cuando Bun informa
  el puerto.
- **El guard de `Host` comprueba dos fuentes, la cabecera y la URL.** En una petición real
  coinciden. Si discrepan, algo raro pasa y se rechaza, en lugar de elegir una y confiar.
- **Bun no materializa la cabecera `Host` en un `Request` construido a mano**, sólo en uno real.
  Lo descubrí con los tests en rojo: leer sólo `c.req.header('host')` devolvía 403 en todo. Mirar
  también `new URL(c.req.url).host` arregla el test y no debilita nada en producción.
- **`Origin` sólo se exige en métodos mutantes.** En una lectura, `Host` más la cookie
  `SameSite=Strict` ya cubren; exigirlo rompería la navegación normal.
- El rechazo no lleva cuerpo: no le dice a quien prueba por qué falló.
- `PROTECTED_PREFIXES` se exporta y el test de tabla de rutas recorre `app.routes`, filtra las
  rutas protegidas y exige que **haya al menos una**. Así una ruta nueva sin protección rompe el
  build, y el test no puede pasar por vacío.

**Depende de:** T4.

**Archivos:** `packages/server/src/{index,app,session,cookies}.ts`,
`packages/server/src/middleware/{host-guard,origin-guard,session-guard}.ts`,
`packages/server/src/app.test.ts`. El plan decía `token-guard`; se llama `session-guard` porque
lo que exige es la cookie de sesión, no un token en la URL.

**Tamaño:** M.

---

### T6a — Bootstrap de sesión por cookie `HttpOnly`

**Descripción:** Canjear el token de arranque de un solo uso por una cookie de sesión que
JavaScript nunca puede leer, para que un XSS en la propia SPA no pueda exfiltrar la sesión.

**Aceptación:**
- [x] `GET /?boot=<token>` valida el token con `crypto.timingSafeEqual` sobre buffers de igual
      longitud.
- [x] Token válido: 302 a `/`, con `Set-Cookie: nn_session=<32 bytes CSPRNG>; HttpOnly;
      SameSite=Strict; Path=/`.
- [x] El token de arranque se quema al usarlo: un segundo intento devuelve 401.
- [x] Un token de longitud distinta devuelve 401 sin llegar a `timingSafeEqual` y sin lanzar.
- [x] La cookie de sesión también se compara en tiempo constante.
- [x] Dos arranques seguidos producen tokens y cookies distintos.
- [x] Ninguna vía de autenticación por query string sobrevive después del canje.

**Verificación:** `bun test packages/server` 52 pasan, 0 fallan · `bun test` 221 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0 sin infos. El canje se prueba con `app.request` sobre Hono, sin
abrir socket. La comprobación manual de que `document.cookie` queda vacío en el navegador se hace
en el Checkpoint B, cuando exista la SPA.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- **El canje escucha en `/` pero sólo actúa si viene `boot`.** Sin el parámetro deja pasar: `/` es
  también la ruta de la interfaz, y devolver 401 ahí dejaría la aplicación inaccesible.
- **`redeemed` es un cierre en memoria, no estado persistido.** Muere con el proceso, igual que la
  sesión. No hay nada que limpiar en disco ni que pueda quedar a medias.
- `safeEqual` comprueba la longitud antes de llamar a `timingSafeEqual`, que lanzaría con buffers
  de distinto tamaño. Un token de longitud equivocada devuelve 401 sin excepción.
- **Sin `Secure` en la cookie, y está comentado en el código.** La aplicación se sirve por http en
  loopback; marcarla `Secure` haría que el navegador la descartara y no habría sesión. Es una
  excepción consciente, no un olvido.
- La cookie no lleva `Max-Age`: es de sesión, así que el navegador la tira al cerrarse. Encaja con
  "al cerrar el proceso se descarta".
- `Session` extiende `SessionStore` con `value`, y sólo el canje lo lee. El resto del server usa
  `matches` y no puede ver el secreto por accidente.

**Depende de:** T6.

**Archivos:** `packages/server/src/{bootstrap,session}.ts`, `packages/server/src/{bootstrap,session}.test.ts`, `packages/cli/src/index.ts`.

**Tamaño:** M.

**Corrección al registro (revisión del Checkpoint B):** T6 y T6a se commitearon juntas, en
`0f1bba6`, contra la regla de un solo cambio lógico por commit, y entre las dos superaron el tope
de cinco archivos de implementación sin dejarlo escrito —a diferencia de T1 y T8, que sí lo
declararon—. No se reescribe la historia; se anota aquí. El commit lleva siete archivos de T6 y
uno de T6a.

---

### T6b — Cabeceras de seguridad y CSP

**Descripción:** Aplicar en toda respuesta las cabeceras que convierten un XSS en un incidente
contenido en lugar de un compromiso total del server local.

**Aceptación:**
- [x] `Content-Security-Policy: default-src 'self'; img-src 'self'; media-src 'self' blob:;
      connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`.
- [x] `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `X-Frame-Options: DENY`.
- [x] Las cuatro se aplican a la SPA, a `/api/*` y a `/stream/*` por igual: test sobre todas las
      familias de rutas.
- [x] Ninguna respuesta lleva `Access-Control-Allow-Origin`.
- [x] Un test recorre la tabla de rutas y falla si a alguna le falta una de las cuatro cabeceras.

**Verificación:** `bun test packages/server` 64 pasan, 0 fallan · `tsc --noEmit` 0 ·
`biome check .` 0 sin infos. Se comprueban las cuatro cabeceras en siete respuestas distintas: API
con sesión, canje de arranque, 401 por falta de sesión, 403 por Host, 403 por Origin, 404 y la
tabla completa de rutas.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- **Las cabeceras se escriben después de `next()`.** Si se escribieran antes, las respuestas que
  cortan los guards —el 401 y el 403— nacerían sin ellas, que es justo cuando más importa que la
  política esté puesta.
- La política se copia literal del spec, sin relajaciones preventivas. **No se añadió
  `'unsafe-inline'` para estilos.** React aplica la propiedad `style` por CSSOM y la CSP no la
  bloquea, así que los estilos dinámicos siguen funcionando sin abrir la puerta a los scripts en
  línea. Si más adelante aparece una violación real, se documenta y se decide con la evidencia
  delante, no por adelantado.
- `securityHeaders` acepta una política alternativa inyectable, para poder relajarla en
  desarrollo sin tocar la de producción.
- El test de CORS comprueba que la cabecera no se emite **ni siquiera cuando el origen es el
  propio**: no hay CORS en juego, todo es mismo origen.

**Depende de:** T6.

**Archivos:** `packages/server/src/middleware/security-headers.ts`,
`packages/server/src/security-headers.test.ts`, `packages/server/src/app.ts`.

**Tamaño:** S.

---

### T7 — Cableado CLI → server

**Descripción:** Unir el parser con el server: puerto libre, token de sesión, apertura del
navegador y cierre ordenado.

**Aceptación:**
- [x] Puerto fijo ocupado: elige uno libre del SO e informa el elegido.
- [x] Token de 32 bytes con CSPRNG, nunca persistido en disco.
- [x] Abre el navegador con `xdg-open`, `open` o `start`; si falla, igual imprime la URL.
- [x] `SIGINT` y `SIGTERM`: cierra el server, mata los hijos registrados y sale con 130.
- [x] Migración fallida sale con código 3 sin arrancar el server.
- [x] `--no-open` imprime la URL y no abre nada.

**Verificación:** `bun test packages/cli` 93 pasan, 0 fallan · `bun test` 279 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0 sin infos. Además, con el servidor real:

- `curl` sin cookie: 401. Con `Host: evil.example:7717` y cookie válida: **403** (el `Host` se
  comprueba aparte de la sesión). Con la cookie del canje: 200 y el JSON de salud.
- Segundo uso del token de arranque: 401. `?t=<token>` en la API: 401.
- `kill -INT` al proceso: **código de salida 130** y la secuencia de cierre registrada.
- `listenOnFreePort` con un puerto ya ocupado por otro proceso real: cae a uno libre y lo informa.

**Código de salida 3:** se verifica con la migración inyectada, que es un marcador que devuelve
éxito. T16 sustituye el marcador por `catalog-store` y el contrato no cambia.

**Estado:** hecho.

**Fuga encontrada al ejecutarlo, no al testearlo:** el log estructurado escribía la URL de
arranque, que lleva el token. Un log se copia, se guarda y se comparte; no es destino para un
secreto. Ahora `boot` devuelve el puerto además de la URL y sólo se registra el puerto. La URL
sigue apareciendo en la línea que ve el usuario y en el navegador que se abre, que son los dos
destinos legítimos. El test de T45 debe comprobar que la salida JSON del CLI no contiene el token.

**Decisiones tomadas al implementar:**

- **Todo inyectado en `boot`.** Escuchar, migrar y abrir el navegador son dependencias. Es lo que
  permite verificar el código 3 y `--no-open` sin sockets ni navegadores. El único puerto que se
  prueba con socket de verdad es el de la caída a puerto libre, porque ahí el socket es el objeto
  de la prueba.
- **`listenOnFreePort` no pregunta si el puerto está libre, lo intenta.** Preguntar y luego usar
  tiene una carrera; intentar y reaccionar al fallo no.
- **El ciclo de vida cierra en orden de registro**, que es el inverso al de arranque de los
  recursos. Un cierre que falla no impide los siguientes y se reporta por `onError`.
- **Abrir el navegador es una comodidad, no un requisito.** Si falla, el arranque sale con 0 y
  avisa con la dirección para abrirla a mano.
- `signalExitCode` usa la convención de shell: 128 más el número de señal, 130 y 143.
- **`configEnvironment` copia las ocho variables a mano** en lugar de pasar `process.env`. El
  contrato del entorno queda explícito y no se cuela una variable por accidente.
- `NN_ANIME_LANG` se respeta como idioma por defecto, con `--lang` ganando sobre él, que es lo que
  decía el spec y no estaba cableado.
- **El CLI no tiene `--cache-dir`.** `loadConfig` soporta los tres directorios y hay
  `NN_ANIME_CACHE_DIR`, pero la tabla de banderas del spec sólo lista `--data-dir` y
  `--config-dir`. No se inventó una bandera nueva; queda anotado como posible añadido.

**Depende de:** T5, T6.

**Archivos:** `packages/cli/src/{index,boot,lifecycle,open-browser}.ts`,
`packages/cli/src/{boot,lifecycle,open-browser}.test.ts`, `packages/cli/bin/nn-anime`,
`packages/cli/src/i18n/es.ts`, `packages/cli/src/run.ts`.

**Tamaño:** M. Se añadieron `boot.ts` y sus tests, que no estaban en la lista del plan, para que
las dependencias del arranque fueran inyectables.

---

### T8 — Esqueleto de la SPA

**Descripción:** Vite, React, enrutado del lado del cliente, cliente API con token y tokens de
estilo. Sin funcionalidad de producto todavía.

**Aceptación:**
- [x] `bun run dev` levanta Vite con proxy de `/api` y `/stream` a `127.0.0.1:7717`.
- [x] El cliente API no maneja ningún token: se apoya en la cookie `HttpOnly` con
      `credentials: 'same-origin'`.
- [x] El cliente no lee, escribe ni borra cookies, y no guarda nada sensible en `localStorage`
      ni en `sessionStorage`.
- [x] El router sirve `/`, `/search`, `/anime/:providerId/:ref`, `/watch/:providerId/:ref`,
      `/settings` sin recargar la página.
- [x] `tokens.css` define color, espaciado, radios y tipografía; ningún componente usa valores
      sueltos.
- [x] `i18n/` de la web expone `es.ts` y todo texto sale de `t()`.

**Verificación:** `bun run dev` · navegar entre rutas y ver que no hay recarga completa.

**Depende de:** T7.

**Archivos:** `packages/web/{index.html,vite.config.ts}`, `packages/web/src/{main.tsx,router.tsx}`, `packages/web/src/api/client.ts`, `packages/web/src/styles/tokens.css`, `packages/web/src/i18n/es.ts`.

**Tamaño:** M.

---

**Verificación:** `bun test packages/web` 45 pasan, 0 fallan · `bun test` 344 pasan, 0 fallan ·
`tsc --noEmit` 0 · `biome check .` 0 sin infos. Con el servidor y Vite en marcha de verdad:

- Vite sirve la SPA y `/?boot=<token>` llega al server por el proxy: 302 con la cookie
  `HttpOnly` para el origen 5173. `api/health` con esa cookie: 200. Sin ella: 401.
- El log del server no contiene la URL de arranque: sólo el puerto.
- `xdg-open` lanzó Firefox de verdad y **el navegador consumió el token**; el segundo intento
  devolvió 401. Es la prueba de que el flujo funciona con un navegador real, y por eso la
  verificación por `curl` necesita `--no-open`.

**Estado:** hecho.

**Decisiones tomadas al implementar:**

- **El enrutador es propio, sin dependencias.** `react-router` no está en la tabla de Tech Stack
  y añadirlo pide aprobación. Son 40 líneas con un historial inyectable, y el historial
  inyectable es lo que permite testear las rutas sin un DOM.
- **`Link` es un `<a href>` de verdad.** Funciona con el botón central, con «abrir en otra
  pestaña» y sin JavaScript; la navegación sin recarga se añade encima. Además, sólo intercepta
  el clic primario sin modificadores.
- **El orden de las reglas del proxy importa y es una trampa.** Vite recorre las claves en orden
  de inserción y `/` es prefijo de todo: con `/` primero, `/api/health` devolvía el HTML de la
  SPA. Se descubrió ejecutándolo, no razonando. Las reglas van de más específica a menos.
- **El proxy reescribe `Host` y `Origin`, no los guards.** `changeOrigin` pone el `Host` del
  destino y un `configure` pone el `Origin` del server. La alternativa —relajar los guards en
  desarrollo— dejaría el camino de producción sin probar hasta el final.
- **Vite se ata a `127.0.0.1` a propósito.** Su valor por defecto escucha en `localhost`, que en
  esta máquina resuelve a `[::1]`, y entonces la dirección que abre el CLI no respondería. Con
  `strictPort`, si el puerto está ocupado falla en lugar de cambiar de origen en silencio.
- **Se añadieron subrutas de exportación a `core`.** Importar el barrel arrastraba `node:fs` y
  `node:path` al paquete del navegador y rompía el build de Vite. La web importa
  `@nn-anime/core/i18n`, no el paquete entero. Es la factura de un barrel, y queda pagada.
- Los marcadores de pantalla dicen qué irá en cada una, en lugar de fingir una interfaz.

**Depende de:** T7.

**Archivos:** `packages/web/{index.html,vite.config.ts}`, `packages/web/src/{main,app,router}.tsx`,
`packages/web/src/api/{client,client.test}.ts`, `packages/web/src/router.test.ts`,
`packages/web/src/styles/tokens.css`, `packages/web/src/i18n/{index,es,i18n.test}.ts`,
`scripts/dev.ts`, `packages/core/package.json`.

**Tamaño:** M, con más archivos de los cinco previstos: es andamiaje, como T1.

---

### T8a — Servir la interfaz construida desde el server

**Descripción:** Tarea que **no estaba en el plan**. El Checkpoint B exige que `bun run start`
muestre la home, y la decisión 7 del plan dice que en producción un solo proceso sirve interfaz
y API. Ninguna tarea lo cubría, así que se añade en lugar de dar el checkpoint por bueno con la
API solamente.

**Aceptación:**
- [x] `bun run start` sirve la home construida en `/`
- [x] Una ruta del enrutador del cliente devuelve el `index.html`, porque el enrutado es del
      cliente y esa ruta no existe en disco
- [x] Los recursos se sirven con su tipo de contenido y caché inmutable; el HTML no se cachea
- [x] El servido de estáticos **no** intercepta `/api/*` ni `/stream/*`
- [x] Una ruta con `..` no sirve nada de fuera de la raíz; el ascenso escapado tampoco
- [x] Un enlace simbólico que apunta fuera de la raíz no se sirve
- [x] Sin build en disco, el server sólo expone la API y el desarrollo va por Vite

**Verificación:** `bun test packages/server` 84 pasan, 0 fallan · `tsc --noEmit` 0 ·
`biome check .` 0 sin infos. Con `bun run build` y el server en marcha: home 200, `/settings`
200 con el `index.html`, recurso con `text/javascript` y `immutable`, API sin cookie 401, canje
302 con cookie, API con cookie 200 JSON, `Host` ajeno 403, y `/stream` con sesión 404 en lugar de
HTML.

**Estado:** hecho.

**Defecto encontrado al ejecutarlo, no al testearlo:** con la sesión válida, el middleware de
estáticos se tragaba `/api/health`. El archivo no existe, así que caía al `index.html` y el
cliente recibía HTML donde espera JSON. El test que tenía no lo detectaba porque pedía la ruta
**sin** sesión: el guard cortaba antes y el middleware nunca llegaba a ejecutarse. Ahora
`staticAssets` se abstiene explícitamente de las rutas protegidas y hay un test con sesión
válida que lo fija.

**Decisiones tomadas al implementar:**

- **El confinamiento rechaza los `..` en lugar de normalizarlos.** Pedir `../../etc/passwd` no es
  un descuido, y una respuesta 404 es más honesta que servir algo parecido.
- **Sólo se sirven archivos regulares, comprobados con `lstat`.** Un enlace simbólico no es un
  archivo del build: si apunta fuera de la raíz, servirlo sería una lectura arbitraria. Es el
  criterio M9 del endurecimiento.
- Una secuencia de escape inválida (`%zz`) devuelve 404, no un 500: es una petición que no
  existe, no un fallo del servidor.
- El HTML va con `no-store` y los recursos con caché inmutable de un año, porque Vite les pone
  hash en el nombre.
- Sin build en disco, el middleware deja pasar y el server queda sólo con la API. Es lo que hace
  que el mismo binario sirva para desarrollo y para producción.

**Depende de:** T8.

**Archivos:** `packages/server/src/{static-assets,static-assets.test,paths,app}.ts`,
`packages/cli/src/{boot,index}.ts`, `packages/web/vite.config.ts`.

**Tamaño:** M.

---

## Checkpoint B — Arranque

- [x] `bun run start` imprime la URL y sirve la home construida.
- [x] Petición sin cookie de sesión: 401. Con `Host` ajeno y cookie válida: 403.
- [x] El token de arranque sirve una sola vez y la barra de direcciones queda en `/`.
- [x] Toda respuesta trae CSP, `nosniff`, `Referrer-Policy` y `X-Frame-Options`.
- [x] Verificado también en desarrollo (`bun run dev`), con los guards sin relajar.
- [ ] Revisión humana antes de seguir.

---

## Fase 2 — Proveedores

### T9 — `provider-sdk`: tipos, schema, registro, errores y conformidad

**Descripción:** Implementar el contrato `Provider` del spec sobre los tipos de `core`, con
validación, registro y un test de conformidad reutilizable.

**Aceptación:**
- [x] `Provider`, `ProviderCapabilities`, `CallOptions`, `StreamRequest` y `ProviderError` según
      `SPEC-provider-core.md`.
- [x] `validateProvider(unknown)` devuelve `Result` con el motivo exacto del rechazo.
- [x] Un `StreamSource` con nombre de header fuera de `^[A-Za-z0-9-]+$`, o con valor que contenga
      `\r`, `\n` o `\0`, se rechaza nombrando el header ofensor.
- [x] Registro con alta, consulta por id y detección de `id` duplicado (gana el primero).
- [x] `assertConforms(provider)` recorre los métodos y reporta qué método incumple el contrato.
- [x] `apiVersion` distinto de `'1'` produce un error que nombra la versión esperada.
- [x] `search()` del SDK envuelve excepciones del plugin en `Result` y nunca lanza.

**Verificación:** `bun test packages/provider-sdk` · 75 tests, 0 fallos.

**Depende de:** T4.

**Archivos:** `packages/provider-sdk/src/{types,schema,registry,errors,conformance}.ts` y tests.
**Ampliación declarada:** `src/call.ts`, porque el criterio «`search()` envuelve excepciones en
`Result`» no cabía en ninguno de los cinco archivos previstos: los cinco describen formas y
clasificación, no llamadas. Y `src/index.ts`, que ya existía como marcador y pasa a ser el barrel
público. Seis archivos de implementación en vez de cinco, con este motivo escrito.

**Tamaño:** M.

---

### T10 — `provider-sdk`: loader de plugins

**Descripción:** Escanear y cargar plugins desde el directorio del usuario, aislando cada fallo.

**Aceptación:**
- [x] Escanea `*.ts`, `*.js` y `*.mjs` en orden alfabético y carga con `import()`.
- [x] Un plugin cuyo import lanza se reporta y se omite; los demás cargan igual.
- [x] Un plugin inválido o con `apiVersion` incorrecta no impide el arranque.
- [x] Un plugin **no puede exportar `default` y `providers` a la vez**: se rechaza nombrándolo.
      Esta aceptación decía «producen un solo conjunto sin duplicados», que contradice a
      `SPEC-provider-core.md`. Manda el spec: dos exports son ambiguos y rechazarlos es más claro
      que adivinar cuál es el bueno.
- [x] Test: directorio con un plugin bueno, uno roto y uno inválido da 1 activo y 2 rechazos
      con motivo.
- [x] Test: el directorio se inyecta; no se lee `$XDG_CONFIG_HOME` real.
- [x] **Añadido al revisar el spec:** el paso 8 del arranque de `SPEC-cli-launcher.md` pide que el
      CLI imprima «la URL de arranque **y la lista de proveedores activos**». La imprime tras la
      URL, con los activos por id y, si los hay, los rechazados con su motivo.

**Verificación:** `bun test packages/provider-sdk` · 93 tests. **En vivo** con el CLI y un
directorio de plugins de verdad (vía `XDG_CONFIG_HOME`), tres casos: un plugin bueno y uno que
lanza al importarse → `Proveedores activos: mio` y `Proveedor rechazado: roto.ts: no se pudo
importar: ...`; sin plugins → la línea que dice dónde copiarlos; dos plugins con el mismo `id` →
gana el primero y el segundo se reporta con el motivo.

**Depende de:** T9.

**Archivos:** `packages/provider-sdk/src/{loader,loader.test}.ts`, `packages/provider-sdk/src/__fixtures__/*`.
**Ampliación declarada:** el criterio del paso 8 no cabe en el paquete: toca
`packages/cli/src/{boot,start,index}.ts`, el catálogo `i18n/es.ts`, `boot.test.ts` y `start.test.ts`
para inyectar el loader. Y `scripts/coverage-gate.ts` deja de contar `__fixtures__` como código: son
datos de prueba y sumarlos a la lista de «ningún test carga» la volvía inútil.

**Tamaño:** M.

---

### T11 — `providers-fixture` con contrato completo y modos de fallo

**Descripción:** Proveedor de prueba sobre datos propios que simula un sitio real, incluidos sus
defectos. Es la base de todos los tests y del e2e.

**Aceptación:**
- [x] Implementa `search`, `getAnime`, `getEpisodes`, `resolveStream` y `getTrending`.
- [x] Sirve al menos 12 títulos con géneros, estudio, año, sinopsis y cobertura; episodios por
      título; streams `file` y `hls`; subtítulos `srt` y `vtt`.
- [x] Modos de fallo seleccionables por variable o por `ref` especial: latencia configurable,
      timeout, 500, 404, método que lanza, stream que exige header `Referer`.
- [x] Test de conformidad de T9 pasa contra este proveedor.
- [x] Ningún acceso a red: verificado con un test que corre con `fetch` sustituido por algo que
      lanza.

**Verificación:** `bun test packages/providers-fixture` · 41 tests. Medido mutando la
implementación: sin filtrar por la consulta fallan 2, sin contar las llamadas 2, con el 404
reportado como 500 1, con el timeout resolviendo en vez de colgarse 2 y sin el `Referer` del stream
1. Control: 0 fallos.

**Depende de:** T9.

**Archivos:** `packages/providers-fixture/src/{index,data}.ts`, `packages/providers-fixture/src/{fixture.test.ts,conformance.test.ts}`, `packages/providers-fixture/fixtures/catalogo.json`, `packages/providers-fixture/media/*.m3u8`.

**Detalle que conviene saber:** el catálogo es inventado y valida con Zod al cargarse (doce títulos
escritos a mano son justo donde un campo que falta se descubre tres tareas después). Todas las
direcciones son de `fixture.invalid`, un dominio reservado que no resuelve: un test que salga a la
red falla por conexión y no por suerte. Y `calls` cuenta por método, que es lo que permitirá afirmar
«la segunda vuelta no llamó al proveedor».

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
- [ ] **Los schemas de entrada también viven ahí**, y toda ruta que reciba cuerpo valida con ellos
      antes de tocar nada. El spec lo pone en Boundaries como *Always* —«validar con Zod toda
      entrada HTTP»— y no lo reclamaba ninguna tarea.
- [ ] **Los schemas de respuesta viven en `packages/core/src/api.ts`.** Añadido al auditar: la
      interfaz valida con Zod desde T8 y el server construye JSON a mano, pero ninguna tarea era
      dueña de las formas compartidas. Con dos definiciones paralelas la deriva no da error de
      compilación, da un `ApiShapeError` en el navegador. Aquí se crean, y el server las usa para
      construir y la interfaz para validar.
- [ ] `GET /api/providers` lista id, nombre, capabilities y estado de carga, con el schema
      compartido.
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
- [ ] Valida los eventos del stream con el schema compartido de `packages/core/src/api.ts`, no con
      uno local.
- [ ] **Lee `q` y `provider` de la cadena de consulta** y los usa en la petición. Sin esto, el
      filtro que `--provider` pone en la dirección de arranque no tiene por dónde llegar.
- [ ] **Agrupa los duplicados entre proveedores** por título normalizado más año, como pista
      visual y **sin fusionar referencias**: el spec lo pide y ninguna tarea lo cubría.
- [ ] **Prefetch acotado**: sólo el detalle de las tarjetas visibles, al pasar el mouse, con
      `AbortController` al salir. Nunca el catálogo.
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

**Corregido al auditar:** esta tarea decía «crea las once tablas del Data Model». El Data Model de
`SPEC-nn-anime.md` lista **nueve**: `anime`, `genre`, `episode`, `watch_event`, `favorite`,
`search_history`, `stream_cache`, `setting` y `schema_version`. Manda el spec. Un test que cuente
las tablas creadas contra esa lista evita que vuelva a desviarse.

**Aceptación:**
- [ ] `openDb(path)` aplica `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- [ ] `0001-initial.sql` crea **las nueve** tablas del Data Model con sus índices, y un test las cuenta contra la lista del spec.
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
- [ ] **Los tipos que nombra el contrato del store se definen en `packages/core/src/models.ts`**,
      no en el paquete que los usa. `SPEC-catalog-store.md` devuelve `WatchRecord`, `AnimeSummary`,
      `SearchRecord`, `MigrationReport` y `PruneReport`, y no existían en ningún sitio: un contrato
      que nombra tipos indefinidos se implementa inventándoselos, uno por consumidor.
- [ ] Los tests corren contra un directorio temporal inyectado y no tocan `$XDG_DATA_HOME`.
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
- [ ] **Los headers de upstream no se guardan.** La fila lleva URL, tipo, calidad y subtítulos.
      Esta aceptación decía «los headers se guardan serializados», que contradecía a la vez la
      mitigación 6 del spec de proyecto y el `Never` de `SPEC-catalog-store.md`. Corregido al
      auditar: quien los necesite los pide al almacén en memoria de `media-proxy`, y si ya no
      están, el proxy revalida.
- [ ] `invalidateStream` borra sólo la clave de episodio y modo indicados.
- [ ] Test: los headers no aparecen en ninguna fila de la base ni en la forma pública.

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
- [ ] `pruneOrphans` se ofrece como comando manual **y como tarea al arrancar si la base supera
      200 MB**, que es lo que pide el spec del store. El disparador vive en el arranque; la
      comprobación de tamaño, aquí.
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
- [ ] `POST /api/stream/resolve` con `{ episodeRef, mode }` devuelve la lista de `StreamSource`
      **pasada por `toPublicStreamSource`**, para que el cliente web reciba los tickets y nunca las
      cabeceras. **Añadido al auditar:** la superficie HTTP de `SPEC-web-ui.md` declara esta ruta y
      ninguna tarea la reclamaba; sin ella la interfaz no tiene forma de resolver un stream.
- [ ] `GET /api/cover/:providerId/:ref` sirve la portada del título cacheado. **Añadido al
      auditar:** `SPEC-web-ui.md` prohíbe en su sección Never incrustar recursos remotos —
      «portadas, subtítulos y video pasan por el proxy»— y **no existía ninguna ruta para
      portadas**, así que la interfaz no podía mostrar una sin incumplir su propio contrato. El
      cliente nunca manda una URL, sólo la referencia que el servidor ya conoce: así no hay
      superficie de SSRF desde el navegador y la lista blanca de destinos sigue siendo la única
      puerta. Se sirve con caché larga, el TTL de miniatura de la tabla del spec. La referencia se
      captura escapada (`encodeURIComponent` en el cliente, medido con Hono: sin escapar, la ruta da
      404) y el nombre de archivo de la caché, si la hay, sale de un hash y nunca de la referencia.
      El `Content-Type` sale de una lista blanca de tipos ráster —`image/svg+xml` se rechaza con
      415— y el tope es de 5 MB, con 413 por encima. Una referencia desconocida devuelve 404 sin
      pedirla al proveedor.
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

### T26c — Pruebas de integración del ciclo completo

**Descripción:** Tarea **nueva**, añadida al auditar la trazabilidad. `SPEC-nn-anime.md` declara un
nivel de pruebas de integración en `tests/` que «cubre el ciclo buscar → detalle → episodios →
resolver stream → cachear», y **ninguna tarea lo creaba**. Cada tarea prueba su paquete; el ciclo
completo no lo probaba nadie, que es justo donde aparecen los fallos de integración.

**Aceptación:**
- [ ] Existe el directorio `tests/` y `bun test` lo recoge.
- [ ] Base SQLite en directorio temporal y proveedor fixture inyectado: **sin red externa**.
- [ ] El ciclo se ejerce **por las rutas HTTP** contra `createApp`, no llamando a los módulos de cada
      paquete: los guards, la validación de entrada y el orden de los middlewares son parte de lo que
      se prueba, y ahí es donde han vivido los tres fallos de integración de este proyecto.
- [ ] Un test recorre el ciclo entero por HTTP: buscar → detalle → episodios → resolver stream →
      comprobar que quedó cacheado. Que quedó cacheado se observa **en la tabla** (`stream_cache` o la
      que corresponda), no por el contador de peticiones.
- [ ] Un test comprueba que la segunda vuelta del ciclo **no llama al proveedor**: el contador de
      peticiones del fixture se queda igual. Es el criterio que mide el contador; el anterior mide la
      tabla.
- [ ] Un test comprueba que un proveedor que falla no rompe el ciclo: se sirve lo cacheado.
- [ ] Con reloj inyectado, un test comprueba la caducidad: pasada la TTL, la siguiente vuelta vuelve a
      llamar al proveedor, y dentro de la TTL no.
- [ ] Con reloj inyectado, un test comprueba `stale-while-revalidate`: con el valor caducado y dentro
      de la ventana, la respuesta sale del valor viejo **y** el proveedor se llama una vez para
      refrescar.
- [ ] Ningún test toca `$XDG_*` real.

**Verificación:** `bun test tests` · `bun test` sigue verde.

**Depende de:** T22, T23, T26b. Necesita la búsqueda cacheada, el detalle y sus rutas, la resolución de
stream y el proxy; por eso va después y no antes.

**Archivos:** `tests/ciclo-completo.test.ts`, `tests/fixtures.ts`.

**Tamaño:** M.

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
- [ ] `packages/cli/package.json` con `bin` (hecho), `files` y `publishConfig`; `bun pm pack`
      produce un tarball instalable. **Hallazgo al verificar el empaquetado:** hoy el tarball
      incluye los tests, porque no hay `files` que los excluya, y las dependencias son
      `workspace:*`, que npm no resuelve al publicar —`bun publish` sí las reescribe—. Las dos
      cosas hay que resolverlas aquí.
- [ ] Decidir y dejar escrito qué produce `bun run build`. Las Commands de `SPEC-nn-anime.md` dicen
      «build de web + bundle de server y cli», y hoy sólo construye la web: el server y el CLI se
      ejecutan desde el código fuente con Bun. O se compila un artefacto, o se corrige el spec.
- [ ] `docs/PLAN-B-HLS.md` registra la decisión del Checkpoint F.

**Verificación:** `bun pm pack` · revisar el tarball generado.

**Depende de:** T44, T40.

**Archivos:** `README.md`, `docs/{providers.md,a11y.md,PLAN-B-HLS.md}`, `packages/cli/package.json`.

**Tamaño:** M.

---

### T47 — Barrido final de criterios de éxito

**Descripción:** Recorrer uno a uno los criterios de éxito del spec de proyecto y marcarlos, o
abrir un task de corrección por cada uno que falle.

**Añadido al revisar:** este barrido tiene que empezar por una **auditoría de trazabilidad
spec↔plan**, no por los criterios de éxito. Tres veces a lo largo de la v1 apareció el mismo
defecto: el spec pedía algo, ninguna tarea lo reclamaba en sus criterios de aceptación, y no se
implementaba. Los criterios de éxito no lo detectan porque sólo cubren una parte de lo que el spec
impone. La auditoría recorre **todos** los requisitos normativos —objetivos, pasos de arranque,
contratos, tablas de TTL y de modelo, Boundaries y Seguridad— y para cada uno comprueba si está
implementado y, si no, qué tarea lo cubre por su aceptación.

**Aceptación:**
- [ ] **La cobertura objetivo del spec —80 % en `core`, `catalog-store`, `recsys` y
      `provider-sdk`— cumplida y hecha cumplir.** Al auditar no la medía nadie. Ahora hay
      `bun run test:coverage` para mirarla y `bun run coverage:gate` para **fallar** si algún
      paquete baja del objetivo: `bun test --coverage` informa pero no falla, así que el 80 % era
      una aspiración. El gate imprime además los archivos que ningún test carga, para que el
      porcentaje no se lea como si cubriera todo el proyecto —hoy son 12 de 48, casi todos
      marcadores vacíos o puntos de entrada—. Verificado que discrimina: con objetivo 99 % sale
      con 1, y con un objetivo inválido, con 2.
- [ ] **Auditoría de trazabilidad spec↔plan hecha primero**, con su tabla de huecos y cada hueco
      asignado a una tarea o convertido en una tarea nueva.
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
T4 ├─ T6 → T7 → T8 → T8a          y T6a, T6b cuelgan de T6
   ├─ T9 → T10 ─┐
   │      T11 ──┴─ T12 → T13 → T14 → T15
   ├─ T16 → T17 → T18, T19, T20 → T21 → T22 → T23 → T24
   ├─ T25 → T26 → T27 → T28        y T26a, T26b cuelgan de T26
   │          ├─ T29 → T29a
   │          └─ T30
   ├─ T31 → T31a
   └─ T33 → T34 → T35 → T36 → T37
```

Dependencias de cada tarea, generadas desde los `Depende de:` de sus bloques. Éste es el
índice completo; el árbol de arriba es un resumen para leer de un vistazo, no la fuente de verdad.

| Task | Depende de |
|---|---|
| T1 | — |
| T2 | T1 |
| T3 | T2 |
| T4 | T2 |
| T5 | T3 |
| T6 | T4 |
| T6a | T6 |
| T6b | T6 |
| T7 | T5, T6 |
| T8 | T7 |
| T8a | T8 |
| T9 | T4 |
| T10 | T9 |
| T11 | T9 |
| T12 | T10, T11 |
| T13 | T12 |
| T14 | T8, T13 |
| T15 | T14 |
| T16 | T4 |
| T17 | T16 |
| T18 | T17 |
| T19 | T17 |
| T20 | T17 |
| T21 | T20 |
| T22 | T13, T21 |
| T23 | T22 |
| T24 | T23 |
| T25 | T4 |
| T26 | T11, T25 |
| T26a | T26 |
| T26b | T26 |
| T26c | T22, T23, T26b |
| T27 | T26 |
| T28 | T27 |
| T29 | T26 |
| T29a | T29 |
| T30 | T11, T25 |
| T31 | T24, T26 |
| T31a | T24 |
| T32 | T20, T31 |
| T33 | T4 |
| T34 | T33 |
| T35 | T34 |
| T36 | T35 |
| T37 | T36 |
| T38 | T22, T37 |
| T39 | T14, T38 |
| T40 | T7, T13 |
| T41 | T32, T39 |
| T42 | T41 |
| T43 | T41 |
| T44 | T32, T39, T43 |
| T45 | T6a, T6b, T22, T26a, T26b, T29a, T31a |
| T46 | T40, T44 |
| T47 | T46 |

Camino crítico más largo: T1 → T2 → T3 → T4 → T16 → T17 → T20 → T32 → T41 → T42 → T43 → T44 →
T46 → T47 (14 tareas).

Las siete tareas insertadas después de escribir el plan no alargan ese camino. T6a y T6b cuelgan
de T6; T26a, T26b, T29a y T31a cuelgan de tareas que ya estaban en el camino o fuera de él; y T8a
cuelga de T8 y sólo entra en el camino a través de T43, que es quien verifica el modo producción
de punta a punta.

**T8a no estaba en la tabla.** Se añadió al auditarla: la tabla original era parcial —sólo listaba
las dependencias que cruzaban de fase— y no lo decía, así que un lector podía creer que eran
todas. Ahora está generada desde los bloques y es completa.
