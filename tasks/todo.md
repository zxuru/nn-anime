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
- [x] Búsqueda en paralelo con `AbortSignal.timeout(8000)` por proveedor.
- [x] Se emiten resultados por proveedor a medida que llegan, con evento de cierre y de error.
- [x] Un proveedor que lanza produce un evento de error con su id, no una excepción.
- [x] Un proveedor que nunca responde se aborta a los 8 s y el flujo cierra igual.
- [x] La consulta se normaliza (`trim`, minúsculas, NFC) antes de usarse como clave.

**Verificación:** `bun test packages/server/src/search` · 14 tests. Medido mutando la
implementación: sin la carrera que cierra el plazo falla 1, sin el caso de cero proveedores 1 (por
cuelgue: el test salta por tiempo límite), sin normalizar la consulta 2. Control: 0 fallos.

**Depende de:** T10, T11.

**Archivos:** `packages/server/src/search/{aggregate,aggregate.test}.ts`.

**Decisión que no es obvia y conviene recordar:** el plazo lo cierra **el módulo**, no el
proveedor. Pasar la señal no basta: un plugin que la ignore —o que haga una llamada de red sin
mirarla— mantendría la búsqueda abierta para siempre, y el criterio dice que su ausencia no puede
bloquear la respuesta. Por eso hay una carrera entre la consulta y el plazo, y hay una prueba con un
proveedor que duerme 200 ms ignorando la señal: la búsqueda cierra a los 50 ms igual.

**Tamaño:** M.

---

### T13 — Rutas `/api/providers` y `/api/search` con SSE

**Descripción:** Exponer el registro y la búsqueda incremental por HTTP.

**Aceptación:**
- [x] **Los schemas de entrada también viven ahí**, y toda ruta que reciba cuerpo valida con ellos
      antes de tocar nada. El spec lo pone en Boundaries como *Always* —«validar con Zod toda
      entrada HTTP»— y no lo reclamaba ninguna tarea. **Hoy la única entrada es la consulta**
      (`q` y `provider` repetido, con tope de 200 caracteres y forma de id kebab-case); el schema de
      cuerpo llegará con las rutas que lo reciban (T26, T32) usando el mismo mecanismo.
- [x] **Los schemas de respuesta viven en `packages/core/src/api.ts`.** Añadido al auditar: la
      interfaz valida con Zod desde T8 y el server construye JSON a mano, pero ninguna tarea era
      dueña de las formas compartidas. Con dos definiciones paralelas la deriva no da error de
      compilación, da un `ApiShapeError` en el navegador. Aquí se crean, y el server las usa para
      construir y la interfaz para validar.
- [x] `GET /api/providers` lista id, nombre, capabilities y estado de carga, con el schema
      compartido.
- [x] `GET /api/search?q=&provider=` responde `text/event-stream` con un evento por proveedor y
      un evento final.
- [x] El cliente que corta la conexión cancela los `AbortSignal` de los proveedores.
- [x] Un plugin roto aparece como proveedor rechazado con motivo, sin 500.
- [x] Ambas rutas pasan por los guards de T6.

**Verificación:** `bun test packages/server/src/routes` · 18 tests. **En vivo** con `curl -N` y el
CLI: el canje da la cookie, `/api/providers` devuelve el activo con sus capacidades reales y el
rechazado con su motivo, `/api/search?q=aurora` emite `event: results` y `event: done`, el filtro
`?provider=` limita, una consulta de 201 caracteres da 400 y sin cookie las dos rutas dan 401.
Medido mutando la implementación: sin pasar la señal del cliente falla 1, sin el filtro de proveedor
2, sin validar la consulta 2 y sin el motivo del rechazo 1. Control: 0 fallos.

**Depende de:** T12.

**Archivos:** `packages/server/src/routes/{providers,search}.ts`, `packages/server/src/routes/search.test.ts`.
**Ampliación declarada:** `packages/core/src/api.ts` (el contrato compartido que pide la aceptación),
`packages/server/src/{app,index}.ts` para montar las rutas, `packages/cli/src/boot.ts` para que el
informe del loader llegue al server —sin eso las dos rutas existirían para devolver una lista
vacía— y `provider-sdk` para reutilizar las capacidades de `core` en vez de tener dos definiciones
de la misma forma. El archivo de pruebas cubre las dos rutas.

**Decisión que conviene recordar:** el server recibe **una sola cosa**, el informe del loader
(activos y rechazados), y deriva de él tanto la búsqueda como los resúmenes. Con dos campos —uno de
activos para buscar y otro de resúmenes para mostrar— la interfaz podría enseñar un proveedor que la
búsqueda no consulta.

**Tamaño:** M.

---

### T14 — Página de búsqueda

**Descripción:** Vista de búsqueda con grilla, etiqueta de origen y navegación por teclado.

**Aceptación:**
- [x] Campo de búsqueda con debounce de 400 ms; el término se refleja en `?q=`.
- [x] Grilla con etiqueta del proveedor de origen en cada tarjeta.
- [x] Tarjetas son enlaces reales, alcanzables por `Tab`, con anillo de foco visible.
- [x] Estado vacío con texto claro cuando no hay resultados.
- [x] Todo texto sale de `t()`.

**Verificación:** `bun test packages/web` · 106 tests, y **build de producción** servido por el
CLI: `/search` y `/search?q=naruto` responden 200 con `text/html`, el CSS se sirve y la API
responde con la cookie. La comprobación en un navegador real es la del e2e (T43): hoy no hay
navegador automatizado en el proyecto.

**Depende de:** T8, T13.

**Archivos:** `packages/web/src/features/search/{SearchPage,ResultGrid,ResultCard}.tsx`, `packages/web/src/components/Grid.tsx`.
**Ampliación declarada:** `router.tsx` (un `useNavigate` para escribir `?q=` con `replace`, que es
lo que evita una entrada de historial por pulsación), los tokens y la hoja de estructura, el
catálogo de textos, `app.tsx` para montar la pantalla, la subruta `./api` de `core` y
`styles.test.ts`, que ahora comprueba **todos** los componentes y no sólo `app.tsx`.

**Dos hallazgos de esta tarea, convertidos en prueba:**

1. **El estado vacío dice por qué está vacío.** No es lo mismo una consulta sin coincidencias que
   una pantalla donde todavía no se ha buscado nada: un «no hay resultados» genérico obliga al
   usuario a adivinar cuál de las dos está mirando.
2. **El barril de `core` no se puede importar desde la interfaz.** Reexporta `config.ts`, que lee
   el sistema de archivos: en los tests no falla —Bun tiene `node:fs`— y el build del navegador se
   rompe con un error que habla de `isAbsolute`, no de la línea culpable. Apareció al escribir
   esta pantalla y ahora `boundary.test.ts` lo convierte en un fallo con el archivo delante, además
   de comprobar que toda subruta usada exista en el manifiesto de `core`.

**Tamaño:** M.

---

### T15 — Búsqueda incremental por SSE

**Descripción:** Consumir el stream de búsqueda y pintar por proveedor, con cancelación y
anuncios accesibles.

**Aceptación:**
- [x] Valida los eventos del stream con el schema compartido de `packages/core/src/api.ts`, no con
      uno local.
- [x] **Lee `q` y `provider` de la cadena de consulta** y los usa en la petición. Sin esto, el
      filtro que `--provider` pone en la dirección de arranque no tiene por dónde llegar.
- [x] **Agrupa los duplicados entre proveedores** por título normalizado más año, como pista
      visual y **sin fusionar referencias**: el spec lo pide y ninguna tarea lo cubría.
- [x] **Prefetch acotado**: sólo el detalle de las tarjetas visibles, al pasar el mouse, con
      `AbortController` al salir. Nunca el catálogo.
- [x] Los resultados se pintan a medida que llegan, con esqueleto por proveedor pendiente.
- [x] Un proveedor que falla muestra su error y no deja el esqueleto para siempre.
- [x] Cambiar la consulta cancela la petición anterior y descarta sus eventos.
- [x] La región de resultados es `aria-live="polite"` y anuncia el conteo al cerrar.
- [x] Deduplicación de `fetch` por clave: dos montajes de la misma consulta hacen una petición.

**Verificación:** `bun test packages/web` · 153 tests, y el build de producción compila. Medido
mutando la implementación: sin acumular los trozos del stream fallan 2, sin quitar el esqueleto al
fallar un proveedor 1, sin el año en la clave de agrupación 1, sin compartir la petición entre dos
montajes 1 y sin el tope de precarga 2. Control: 0 fallos. La comprobación en un navegador real es
del e2e (T43).

**Depende de:** T14.

**Archivos:** `packages/web/src/api/{stream-events.ts,dedupe.ts}`, `packages/web/src/features/search/useSearchStream.ts`, `packages/web/src/features/search/SearchPage.tsx`.
**Ampliación declarada:** `ResultCard`/`ResultGrid` (la pista de duplicados y los sucesos del
puntero), `router.tsx` —el enlace admite `onMouseEnter`/`onMouseLeave`, que es por donde entra la
precarga—, el catálogo de textos, los tokens y la hoja de estructura.

**Tres decisiones que conviene recordar:**

1. **El analizador acumula.** Un trozo de SSE puede cortar en mitad de un `data:`, así que se
   guarda el resto y sólo se entregan eventos completos. Analizar cada trozo por su cuenta pierde
   el primer evento de cada búsqueda y nadie sabe por qué.
2. **El distribuidor comparte el recorrido, no la respuesta.** Un cuerpo de SSE sólo se puede leer
   una vez, así que dos montajes de la misma consulta se suscriben al mismo stream. Y el trabajo
   arranca en el siguiente ciclo: si se fuera el suscriptor antes, se abriría una conexión que
   nadie va a leer.
3. **La dirección usa `%20`, no `+`.** `URLSearchParams` escribe `+` y la dirección de arranque del
   CLI escribe `%20`; dos convenciones para la misma consulta son dos claves de caché distintas.

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
- [x] `openDb(path)` aplica `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- [x] `0001-initial.sql` crea **las nueve** tablas del Data Model con sus índices, y un test las
      cuenta contra la lista del spec.
- [x] El runner aplica pendientes en transacción y registra en `schema_version`.
- [x] Correr dos veces seguidas devuelve `applied: 0` la segunda vez.
- [x] Una migración que falla deja el esquema sin cambios y el error nombra el archivo.
- [x] Ningún otro paquete importa `bun:sqlite`.

**Verificación:** `bun test packages/catalog-store` · 20 tests. **En vivo**, `bun run db:migrate` dos
veces contra un directorio XDG temporal: la primera dice qué versiones aplicó y sale con 0 (entonces
«Migraciones aplicadas: 1. Versión del esquema: 1.»; hoy son dos migraciones), la segunda dice «No
hay migraciones pendientes» y sale con 0, y la base queda dentro del directorio de datos, que se
crea con modo `0700`. Medido mutando la
implementación: sin `foreign_keys` fallan 2, sin WAL 1, sin transacción 2, sin la comprobación de
versión 4 y sin una de las tablas 2. Control: 0 fallos.

**Depende de:** T4.

**Archivos:** `packages/catalog-store/src/{db,index}.ts`, `packages/catalog-store/src/migrations/{runner.ts,0001-initial.sql}`, `packages/catalog-store/src/db.test.ts`.
**Andamiaje de esquema: declara explícitamente que supera cinco archivos.** Añadidos:
`packages/cli/src/{db-migrate,env}.ts` y `packages/cli/src/db-migrate.test.ts`, porque el comando
`bun run db:migrate` era un marcador que se negaba a salir con 0 y el propio archivo decía que T16 lo
sustituía por el runner real. `env.ts` sale de `index.ts` porque ahora hay dos procesos que leen el
entorno y `index.ts` hace trabajo al importarse.

**Dos decisiones que conviene recordar:**

1. **Una transacción por migración, no una para el lote.** Así un fallo en la tercera no borra el
   efecto de las dos primeras, que además quedan registradas. Con una sola transacción para todo el
   lote, un fallo en la tercera desharía también las dos primeras: el esquema quedaría sin nada
   aunque esas migraciones sí se ejecutaron y existían.
2. **`schema_version` lleva `IF NOT EXISTS` y el runner también la asegura.** El runner necesita
   anotar la versión antes de ejecutar nada, y una lista de migraciones inyectada en un test puede
   no traerla. Sin eso, la primera migración falla con «table schema_version already exists» —que es
   exactamente lo que pasó al escribirlo.

**Tamaño:** M.

---

### T17 — Repositorios de anime, episodios y búsqueda

**Descripción:** Cache-aside con TTL y cálculo de `stale` para los tres recursos de metadatos.

**Aceptación:**
- [x] `readAnime`/`writeAnime`, `readEpisodes`/`writeEpisodes`, `readSearch`/`writeSearch`.
- [x] **Los tipos que nombra el contrato del store se definen en `packages/core/src/models.ts`**,
      no en el paquete que los usa. `SPEC-catalog-store.md` devuelve `WatchRecord`, `AnimeSummary`,
      `SearchRecord`, `MigrationReport` y `PruneReport`, y no existían en ningún sitio: un contrato
      que nombra tipos indefinidos se implementa inventándoselos, uno por consumidor.
- [x] Los tests corren contra un directorio temporal inyectado y no tocan `$XDG_DATA_HOME`.
- [x] `CacheHit<T>` con `value`, `fetchedAt`, `stale` y `ttlS` según la tabla de TTL.
- [x] Un MISS devuelve `null` y no lanza.
- [x] Escritura de un anime con géneros y episodios en una sola transacción.
- [x] Escritura repetida de la misma ref actualiza, no duplica.
- [x] `genres` y `studios` sobreviven el viaje de ida y vuelta en orden.

**Verificación:** `bun test packages/catalog-store` · 48 tests. Medido mutando la implementación:
sin normalizar la clave de búsqueda falla 1, sin borrar los géneros viejos 2, tomando el TTL de la
lista de episodios del anime 1, sin validar los resultados cacheados 7, sin la transacción de la
escritura conjunta 1 y con `stale` siempre falso 2. Control: 0 fallos.

**Depende de:** T16.

**Archivos:** `packages/catalog-store/src/repositories/{anime,episodes,search}.ts` y tests.
**Ampliación declarada:** `packages/catalog-store/src/cache-policy.ts` (los TTL y el cálculo de
`stale`, que el spec nombra en la estructura del módulo y ninguna tarea reclamaba),
`packages/catalog-store/src/migrations/0002-search-cache.sql` (la tabla que el contrato exigía y el
Data Model no tenía), los tipos nuevos en `packages/core/src/models.ts` y `normalizeQuery`, que se
mudó a `core` porque la usan el server y el store y **tiene que ser la misma** en los dos: es la
clave de caché, y dos normalizaciones distintas darían dos entradas para la misma búsqueda.

**Tres decisiones que conviene recordar:**

1. **Se lee del `raw_json`, no de las columnas.** `genres` y `studios` son listas ordenadas y una
   tabla de géneros las devolvería por nombre; además `kind` y `studios` no tienen columna. Las
   columnas siguen ahí para lo que se consulta y ordena, y para `pruneOrphans`.
2. **El reloj de la lista de episodios sale de las filas de episodios**, no del anime: el TTL de la
   lista es 21600 y el del detalle 86400, y usar el del anime serviría como fresca una lista de
   hace un día. Lo encontró la prueba del TTL, que esperaba 21600 y recibió 86400.
3. **Un anime sin episodios es una lista vacía, no un MISS.** Una obra anunciada tiene cero
   episodios y eso es un dato: si fuera `null`, cada visita volvería a pedirle la lista al
   proveedor para recibir otra vez la lista vacía. El MISS es que no haya anime.

**Tamaño:** M.

---

### T18 — Repositorio de streams

**Descripción:** Caché de URLs de stream con TTL corto y revalidación forzada.

**Aceptación:**
- [x] `readStream`, `writeStream`, `invalidateStream`.
- [x] TTL de 600 s, y `readStream` devuelve `null` cuando el TTL venció aunque la fila exista.
- [x] **Los headers de upstream no se guardan.** La fila lleva URL, tipo, calidad y subtítulos.
      Esta aceptación decía «los headers se guardan serializados», que contradecía a la vez la
      mitigación 6 del spec de proyecto y el `Never` de `SPEC-catalog-store.md`. Corregido al
      auditar: quien los necesite los pide al almacén en memoria de `media-proxy`, y si ya no
      están, el proxy revalida.
- [x] `invalidateStream` borra sólo la clave de episodio y modo indicados.
- [x] Test: los headers no aparecen en ninguna fila de la base ni en la forma pública.

**Verificación:** `bun test packages/catalog-store` · 67 tests en el paquete, 19 de ellos de este
repositorio. La ausencia de headers se comprueba de tres formas: la forma pública no tiene la
clave, el secreto no aparece en ninguna columna de ninguna tabla, y tampoco aparece en **los bytes
del archivo** de la base —con `wal_checkpoint(TRUNCATE)` antes de leerlo, porque si no se estaría
mirando un archivo al que todavía no se ha volcado nada—. Medido mutando la implementación: sin
comprobar el TTL fallan 2, invalidando sin el modo 1, sin mirar la calidad pedida 1, dejando que los
headers acaben en la URL 3 y usando el TTL del anime para el stream 3. Control: 0 fallos.

**Depende de:** T17.

**Archivos:** `packages/catalog-store/src/repositories/{stream.ts,stream.test.ts}`.

**Tres decisiones que conviene recordar:**

1. **Un enlace caducado no es un dato stale.** Los metadatos viejos se sirven y se revalidan por
   detrás; una URL de video vencida no sirve para nada, así que `readStream` devuelve `null` en
   cuanto pasa el TTL, con la fila intacta para que quien revalide pueda sobrescribirla.
2. **Se cachea una fuente, no la lista.** La clave del esquema es (episodio, modo) y el contrato
   devuelve un `StreamSource`. Gana la calidad pedida; si no hay coincidencia, la primera que
   devolvió el proveedor. Preferir `hls` sobre `file` aquí sería decidir la reproducción desde la
   capa de persistencia.
3. **`episodeIdOf` hace un `JOIN` con el anime**, porque la tabla de episodios no guarda el
   proveedor: lo hereda, y una referencia de episodio sólo es única dentro de su proveedor.

**Tamaño:** S.

---

### T19 — Cola de revalidación

**Descripción:** Refresco de fondo para datos stale, sin duplicar trabajo ni perder datos buenos.

**Aceptación:**
- [x] Concurrencia máxima 2, deduplicada por clave: dos lecturas stale de la misma clave encolan
      un solo trabajo.
- [x] Una revalidación que falla conserva la fila vieja y registra `last_error`.
- [x] Una escritura concurrente de la misma clave no produce `SQLITE_BUSY` (test de 50 escrituras
      simultáneas).
- [x] El trabajo se cancela al cerrar la base, sin quedar colgado.
- [ ] **Las escrituras pasan por la cola interna: ningún repositorio escribe fuera de ella.**
      **Movido a T21, con motivo.** La cola existe y está probada (serializa, aguanta un trabajo que
      falla y no admite trabajo después de cerrarse), y el revalidador la usa. Lo que falta es
      cambiar la firma de los cuatro repositorios —su `write` pasaría a devolver promesa y a
      encolarse— y eso toca 37 sitios de construcción y 48 de escritura en sus pruebas. Es un
      cambio de una sola vez y su sitio natural es T21, donde vive la fachada que define **todas**
      las rutas públicas de escritura: hacerlo antes obliga a pasar la cola por cuatro constructores
      para que la fachada la reciba igual.

**Verificación:** `bun test packages/catalog-store` · 86 tests en el paquete, 19 de ellos de este
módulo, incluido el de 50 escrituras simultáneas sobre la misma clave. Medido mutando la
implementación: sin deduplicar falla 1, sin el límite de concurrencia 1, cerrando sin abortar ni
descartar 2, con la cola sin serializar 1, con un fallo que rompe la cola 1 y anotando el aborto
como fallo 1. Control: 0 fallos.

**Depende de:** T17.

**Archivos:** `packages/catalog-store/src/{revalidate,write-queue}.ts`, `packages/catalog-store/src/revalidate.test.ts`.
**Ampliación declarada:** `packages/catalog-store/src/migrations/0003-revalidate-error.sql`, la tabla
donde vive `last_error`.

**Tres decisiones que conviene recordar:**

1. **`last_error` es una tabla, no cuatro columnas.** El spec dice que una revalidación fallida
   «se marca», y ninguna tabla tenía dónde. Con una columna en `anime`, `episode`, `search_cache` y
   `stream_cache` habría cuatro sitios donde acordarse de limpiar el aviso cuando la revalidación sí
   funciona, y el que se olvide deja un error rojo permanente sobre un dato que ya está bien.
   Además el error de la lista de episodios vive en el anime: compartirían columna y se pisarían.
2. **Un aborto no es un fallo, y se distingue por el motivo.** `close()` aborta **todo** lo que
   corre, así que mirar `signal.aborted` convertiría un fallo real que llega en ese instante en una
   cancelación silenciosa y se perdería el aviso. Se compara la causa con `signal.reason`.
3. **La clave de una referencia usa `#`, no `/`.** `uno` + `x/y` y `uno/x` + `y` darían la misma
   clave con barras, y dos recursos distintos compartirían aviso de error. El id de proveedor es
   kebab-case por contrato, así que `#` no puede aparecer en él.

**Tamaño:** M.

---

### T20 — Historial, progreso, favoritos y búsquedas recientes

**Descripción:** Señales del usuario, que son también la entrada de `recsys`.

**Aceptación:**
- [x] `recordWatch`, `updateWatchPosition`, `listRecentlyWatched`, `setFavorite`,
      `listFavorites`, `recordSearch`, `listRecentSearches`.
- [x] `updateWatchPosition` actualiza la misma fila; no crea una nueva por cada 15 s.
- [x] `listRecentlyWatched` ordena por más reciente y devuelve metadatos del anime en la misma
      consulta, sin N+1.
- [x] `setFavorite(ref, true)` dos veces no duplica.
- [x] Todo sobrevive a cerrar y reabrir la base.

**Verificación:** `bun test packages/catalog-store` · 109 tests en el paquete, 23 de ellos de este
módulo. Medido mutando la implementación: con `updateWatchPosition` insertando en vez de actualizar
fallan 2, con el historial ordenado al revés 1, con el favorito a base de `INSERT` a secas 1, con las
búsquedas ordenadas por identificador 1, con el visionado naciendo terminado 1 y con una consulta
por fila en lugar del `JOIN` 1. Control: 0 fallos.

**Depende de:** T17.

**Archivos:** `packages/catalog-store/src/repositories/{watch,favorites,search-history}.ts` y tests.

**Cuatro decisiones que conviene recordar:**

1. **`recordWatch` devuelve el identificador**, aunque el contrato diga `Promise<void>`. La ruta que
   registra el inicio de la reproducción tiene que devolvérselo al reproductor para que pueda
   actualizar la posición después; sin él, la única alternativa sería buscar la última fila, que es
   una carrera. Devolverlo es aditivo: quien no lo mire, no lo ve.
2. **El N+1 se comprueba contando consultas, no mirando el SQL.** El envoltorio cuenta las consultas
   preparadas sobre la base y la prueba exige que cinco filas sean **una**. Borrar una tabla y ver
   que sigue funcionando no prueba cuántas veces se preguntó: lo encontré escribiendo la prueba
   floja primero.
3. **El historial de búsquedas es un registro, no una caché.** Cada búsqueda añade una fila, y la
   caché de resultados vive en `search_cache` con su clave normalizada. La consulta se guarda
   **tal como se escribió**: la clave de caché se normaliza porque tiene que coincidir, pero el
   historial se lee, y ahí «Naruto» y «naruto» son lo que la persona escribió.
4. **El orden por fecha se prueba con un reloj que va hacia atrás.** Con inserciones seguidas en el
   mismo milisegundo, ordenar por fecha y ordenar por identificador dan el mismo resultado, así que
   la prueba no distinguiría una de otra —y la mutación que ordenaba por identificador pasaba—. El
   reloj inyectado hace que las dos formas discrepen.

**Tamaño:** M.

---

### T21 — Ajustes, `pruneOrphans` y `db:migrate`

**Descripción:** Cierre de la fachada del store: ajustes clave-valor, limpieza y comando manual.

**Aceptación:**
- [x] `getSetting`/`setSetting` con JSON y valor por defecto.
- [x] `pruneOrphans` borra `stream_cache` vencido hace más de 1 día y detalles sin actividad en
      90 días; no toca un anime visto hace 5 días.
- [x] `pruneOrphans` informa cuántas filas borró por tabla.
- [ ] `pruneOrphans` se ofrece como comando manual **y como tarea al arrancar si la base supera
      200 MB**. El comando manual está (`bun run db:prune`) y la comprobación de tamaño también
      (`shouldPrune`). **El disparador al arrancar se mueve a T22, con motivo:** el arranque del CLI
      todavía no abre la base —`deps.migrate` es un marcador y el store entra en el server en T22—,
      así que no hay ningún punto donde colgarlo sin inventar uno que T22 va a reescribir.
- [x] `bun run db:migrate` funciona fuera de tests contra el directorio de datos real.
- [x] `runMigrations` es idempotente desde el CLI.
- [x] **Las escrituras de la fachada pasan por la cola interna** (criterio movido desde T19): la
      fachada envuelve las cuatro familias de escritura en `queue.run`, y hay una prueba que
      envuelve la cola y cuenta lo que pasa por ella.

**Verificación:** `bun test packages/catalog-store` · 142 tests en el paquete. **En vivo**:
`bun run db:migrate` aplica `1, 2, 3` y `bun run db:prune` informa por tabla y sale con 0.
Medido mutando la implementación: sin el plazo de 90 días fallan 11, sin proteger los favoritos 1,
sin el margen de un día para los streams 1, sin proteger lo visto 11, con la fachada escribiendo
fuera de la cola 2, cerrando la base antes de vaciar la cola 1 y sin validar el ajuste al leerlo 1.
Control: 0 fallos. **Dos de esas mutaciones sobrevivieron a la primera versión de las pruebas** —el
margen del stream y el orden del cierre— y las dos pruebas hubo que reescribirlas: la primera
sembraba un stream que aún no había vencido, y la segunda medía una sola escritura, que alcanzaba a
ejecutarse antes del cierre por cómo reparte el bucle de eventos.

**Depende de:** T20.

**Archivos:** `packages/catalog-store/src/repositories/settings.ts`, `packages/catalog-store/src/{prune,index}.ts`, `packages/catalog-store/src/prune.test.ts`, `packages/cli/src/db-migrate.ts`.
**Ampliación declarada:** `packages/catalog-store/src/store.ts` (la fachada `CatalogStore`; en
`index.ts` vive el barril, y el spec decía que la fachada estaba ahí),
`packages/catalog-store/src/store.test.ts`, `packages/cli/src/db-prune.ts` y su prueba, y el script
`db:prune` del `package.json`.

**Cuatro decisiones que conviene recordar:**

1. **`getSetting` pide un schema.** El contrato lo escribía como `getSetting<T>(key, fallback): T`,
   y eso no se puede cumplir sin una conversión de tipo: el JSON de la fila es `unknown`. Con el
   schema, un ajuste con otra forma devuelve el valor por defecto en lugar de colarse disfrazado.
2. **`pruneOrphans` informa de todas las tablas, con cero las que no tocó.** `undefined` y `0` se
   confunden con facilidad al pintar el resultado, y «no borré nada de aquí» es un dato.
3. **Un favorito no se limpia nunca**, aunque el spec no lo diga. Borrarlo sería hacer desaparecer
   de la lista algo que el usuario marcó a mano, y el plazo de 90 días habla de lo visto y lo
   buscado, no de lo guardado.
4. **La fachada crea sus repositorios la primera vez que hacen falta.** Los repositorios preparan
   sus sentencias al construirse, así que crearlos en el constructor exigiría que el esquema ya
   existiera antes de llamar a `runMigrations`, y la fachada no podría migrar una base recién
   creada. Lo encontró la primera prueba de la fachada, con un «no such table: anime».

**Tamaño:** M.

---

### T22 — Cableado del store en el server y cabecera `X-Cache`

**Descripción:** Las rutas de búsqueda y detalle pasan a leer del store antes de ir al proveedor.

**Aceptación:**
- [x] Flujo completo: leer caché, si MISS o STALE ir al proveedor, escribir y servir.
- [ ] `X-Cache: hit | miss | stale` en las respuestas de metadatos. **Movido a T23, con motivo:**
      la única ruta de metadatos que existe hoy es `/api/search`, y es SSE: en SSE las cabeceras se
      escriben antes de saber qué proveedor responde, así que el origen no se puede anunciar ahí.
      El resumen está implementado y probado (`summarizeSources`), y las rutas JSON —detalle y
      episodios— llegan en T23, cuya aceptación ya incluye la cabecera.
- [x] Con dato FRESH no se llama al proveedor: verificado con un contador inyectado.
- [x] Con dato STALE se responde de inmediato y la revalidación ocurre por detrás.
- [x] Segunda ejecución del proceso sirve **búsqueda** con 0 llamadas a proveedores. La mitad de
      «home» es de T38, que es donde existe esa ruta.
- [x] **El disparador de la limpieza al arrancar** (criterio movido desde T21): `bun run start`
      migra de verdad y, si la base supera 200 MB, limpia e informa en una línea.

**Verificación:** `bun test packages/server packages/cli` · 24 pruebas en la ruta de búsqueda y 10
en el lector de caché. **En vivo**: arrancar el CLI crea y migra la base (11 tablas, versión 3), que
antes no tocaba. Medido mutando la implementación: sin refrescar por detrás el dato vencido fallan
4, tratando el vencido como fresco 4, sin escribir en un MISS 11 y sin que la ruta use la caché 4.
Control: 0 fallos. **La segunda ejecución se prueba de verdad**: se busca, se cierra la base, se
reabre con un proceso nuevo y un proveedor nuevo con su contador a cero, y la misma búsqueda sale
de la base con **0 llamadas**.

**Depende de:** T21, T13.

**Archivos:** `packages/server/src/{container.ts,cache-read.ts}`, `packages/server/src/routes/search.ts`, `packages/server/src/cache-read.test.ts`.
**Ampliación declarada:** `packages/server/src/app.ts` e `index.ts` (la aplicación recibe el
contenedor), `packages/server/src/search/aggregate.ts` (la llamada a un proveedor se inyecta, para
que la caché entre en medio sin que el agregado sepa de tablas), `packages/cli/src/index.ts` (la
migración deja de ser un marcador y trae el disparador de limpieza), `packages/cli/src/boot.ts` y su
catálogo (una migración puede querer contar algo) y la dependencia `@nn-anime/catalog-store` del
server.

**Cuatro decisiones que conviene recordar:**

1. **La política de caché vive en un sitio.** `readThrough` la implementa una vez; repetida en cada
   ruta —búsqueda ahora, detalle y episodios en T23— acabaría con tres versiones del mismo cálculo y
   una de ellas mal.
2. **La llamada al proveedor se inyecta en el agregado.** Así la caché entra en medio sin que el
   agregado sepa de tablas, y sigue habiendo un solo camino para consultar un plugin.
3. **Un refresco de fondo que falla no se relanza.** Se anota el error y el trabajo se da por
   terminado: relanzarlo lo contaría dos veces si el revalidador tuviera su propio manejador, y el
   fallo de un refresco no tiene a quién avisar.
4. **La migración cuenta lo que hizo con una nota, y quien la imprime es el arranque.** Quien migra
   no sabe de idiomas ni de salidas.

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
- [x] `GET /api/anime/:providerId/:ref` devuelve detalle con géneros y estudios.
- [x] `GET /api/anime/:providerId/:ref/episodes` devuelve episodios con número, título, duración
      y modo disponible.
- [x] Ambas cachean con `X-Cache` y revalidan como T22 (criterio movido desde T22: aquí es donde
      existen rutas de metadatos JSON donde la cabecera tiene sentido).
- [x] Ref inválida o proveedor desconocido: 404 con mensaje claro, sin 500.
- [x] El detalle alimenta `search_history` cuando viene de una búsqueda.

**Verificación:** `bun test packages/server` · 21 pruebas nuevas. **En vivo**, con un plugin de
prueba: el detalle sale `X-Cache: miss` y después `hit`; los episodios salen `miss`; `?q=accion`
deja su fila en `search_history`; un proveedor desconocido da 404 y sin cookie, 401. En la base
quedaron 1 anime, 1 episodio, 1 género y la marca de la lista. Medido mutando la implementación: con
`X-Cache` siempre `hit` fallan 2, con el proveedor desconocido como 500 1, sin anotar el historial 1
y con un 404 del upstream convertido en 502 2. Control: 0 fallos.

**Depende de:** T22.

**Archivos:** `packages/server/src/routes/{anime,episodes}.ts`, `packages/server/src/routes/anime.test.ts`.
**Ampliación declarada:** los schemas compartidos de respuesta en `packages/core/src/api.ts`
(`animeResponseSchema`, `episodesResponseSchema`), `app.ts` (las rutas se registran sólo con
contenedor), `packages/cli/src/{boot,start,index}.ts` (el arranque abre el store y lo cierra con el
servidor), `packages/provider-sdk/src/call.ts`, la migración `0004-episodes-fetched.sql` con el
repositorio de episodios, y la prueba de conformidad del fixture.

**Tres decisiones que conviene recordar:**

1. **El SDK no vuelve a envolver un error que ya es del proveedor.** Lo hacía, y al hacerlo perdía
   el contexto: el 404 del sitio se convertía en un fallo genérico y la ruta no podía distinguir
   «este título no existe» de «el proveedor se cayó». Ahora un `ProviderError` del plugin pasa tal
   cual, con su estado. La prueba del fixture esperaba `kind: 'threw'`, que era justo la señal de
   esa pérdida; se actualizó.
2. **La lista de episodios necesita una marca de «pedida».** Cero filas no distingue «no hay
   episodios» de «no se ha pedido»: al escribir el detalle primero, la lista parecía cacheada y se
   servía vacía. Dos columnas en el anime y una migración nueva. Lo encontró la prueba de la ruta.
3. **Un 404 del upstream es 404 y lo demás es 502.** No es un fallo del servidor que un título no
   exista, y decir «error interno» obligaría a mirar los registros para saber algo que ya se sabe.

**Tamaño:** M.

---

### T24 — Página de detalle

**Descripción:** Vista de detalle con metadatos, lista de episodios, selector sub/dub y favorito.

**Aceptación:**
- [x] Muestra portada, sinopsis, año, estado, géneros, estudios y lista de episodios.
- [x] Selector sub/dub deshabilitado según capabilities del proveedor.
- [x] Botón de favorito con estado reflejado de forma inmediata y persistido.
- [x] Estados de carga con esqueleto y de error con reintento.
- [x] Ningún dato de proveedor se inserta con `dangerouslySetInnerHTML`.
- [x] Navegable con teclado y con textos de `t()`.

**Verificación:** `bun test packages/web packages/server` · 12 pruebas nuevas de la pantalla y 7 de
las rutas de favoritos. Medido mutando la implementación: ofreciendo siempre los dos modos falla 1,
sin `aria-pressed` 1, con una duración de cero convertida en «0 min» 1 y con la baja de un favorito
ignorada 1. Control: 0 fallos. La comprobación en navegador real es del e2e (T43).

**Depende de:** T23.

**Archivos:** `packages/web/src/features/detail/{DetailPage,EpisodeList,FavoriteButton}.tsx`, `packages/web/src/features/detail/useDetail.ts`.
**Ampliación declarada:** las rutas `GET`/`POST /api/favorites` con su prueba
(`packages/server/src/routes/favorites.ts`), que **ninguna tarea reclamaba** y sin las cuales el
favorito no se puede persistir; los schemas compartidos `animeSummarySchema`, `favoritesResponseSchema`
y `favoriteRequestSchema` en `core`; el catálogo y la hoja de estructura; y `app.tsx` para montar la
pantalla.

**Cuatro decisiones que conviene recordar:**

1. **El alta y la baja de un favorito son el mismo `POST`** con `value`, no un `POST` y un `DELETE`.
   El botón no sabe qué había antes: sabe en qué estado quiere dejarlo, y el cuerpo lo dice.
2. **El favorito se pinta antes de que el servidor conteste** y se revierte si falla. Un botón que
   espera a la red para cambiar de color se siente roto; mentir más de lo que tarda la petición, no.
3. **El reintento es la misma función que la primera carga**, no un contador de intentos. Con el
   contador, el efecto tenía una dependencia que no usaba y el linter lo señalaba con razón.
4. **Las claves de traducción se escriben una a una**, aunque una plantilla con el modo funcionara
   igual: una clave compuesta esconde los textos al buscador de claves sin usar, y acabarían
   borradas del catálogo por parecer huérfanas.

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
- [x] `issue(url, headers, ttlS)` devuelve un ticket aleatorio con CSPRNG.
- [x] Tope de 500 entradas con desalojo LRU y expiración a los 600 s.
- [x] `resolve(ticket)` devuelve URL y headers; ticket vencido da 410, inexistente da 404.
- [x] El ticket no contiene la URL ni permite deducirla.
- [x] Test: 600 tickets dejan exactamente 500 vivos y los 100 más viejos vencidos.
- [x] Test: ningún ticket aparece en la salida del logger, ni en `debug`.

**Verificación:** `bun test packages/media-proxy` · 15 tests. Medido mutando la implementación: sin
desalojo LRU fallan 3, sin caducidad 4, sin rejuvenecer al resolver 1, con el ticket llevando la URL
dentro 1 y sin redactar el campo `ticket` en el logger 1. Control: 0 fallos.

**Depende de:** T4.

**Archivos:** `packages/media-proxy/src/{ticket-store,ticket-store.test}.ts`.
**Ampliación declarada:** `packages/media-proxy/src/index.ts` (el barril), el `package.json` del
paquete (exporta el almacén y depende de `core`) y **`SENSITIVE_KEYS` de `core/src/logger.ts`**, que
ahora incluye `ticket`: un ticket es la llave de una URL de video, y en un log equivale a registrar
la dirección del upstream.

**Tres decisiones que conviene recordar:**

1. **El LRU no necesita estructura extra.** El `Map` conserva el orden de inserción y resolver
   reinserta la entrada al final, así que el primero de la tabla es siempre el que hace más tiempo
   que no se usa. El desalojo es borrar por delante.
2. **El almacén no expone la lista de tickets, a propósito.** Sólo `size()`. Una lista de tickets es
   una lista de URLs de video esperando a que alguien la registre en un log; la prueba comprueba que
   ni `JSON.stringify` ni `Bun.inspect` del almacén contienen un ticket.
3. **El error distingue vencido de desconocido y no lleva el ticket dentro.** El mensaje se registra;
   el ticket no puede.

**Tamaño:** S.

---

### T26 — Proxy de bytes con `Range`

**Descripción:** Reenvío en streaming con soporte de rangos y aborto.

**Aceptación:**
- [x] `POST /api/stream/resolve` con `{ episodeRef, mode }` devuelve la lista de `StreamSource`
      **pasada por `toPublicStreamSource`**, para que el cliente web reciba los tickets y nunca las
      cabeceras.
- [x] `GET /api/cover/:providerId/:ref` sirve la portada del título cacheado, con la lista blanca
      de tipos ráster, el tope de 5 MB y `Cache-Control` más `ETag` por referencia.
- [x] `GET /stream/:ticket` reenvía `Range` y devuelve 206 con `Content-Range` cuando el upstream
      lo da; si no, degrada a 200.
- [x] Fuerza `Accept-Encoding: identity`.
- [x] Usa `ReadableStream` y `pipeTo`; no hay ninguna llamada a `arrayBuffer()` ni a `Buffer.concat`
      del cuerpo completo.
- [x] Al cortar el cliente, el upstream se aborta: test con contador de conexiones vivas.
- [x] `Range` inválido (negativo, múltiple, absurdo) devuelve 416 sin llegar al upstream.
- [x] Reproducir 10 minutos no supera 64 MB de RSS.
- [x] Ningún header de upstream se serializa al cliente: test explícito.

**Verificación:** `bun test packages/media-proxy packages/server` · 34 pruebas del proxy, 11 de las
rutas de reproducción y 10 de la de portadas. Medido mutando la implementación: sin la lista blanca
de tipos falla 1, sin el tope de tamaño 1, con el ETag derivado de la referencia 1 y sin comprobar el
415 1. Control: 0 fallos. La portada se prueba con un upstream de mentira inyectado; con un
proveedor real es del e2e (T43). La memoria se mide de verdad: se pasan 200 MB por el proxy y se comprueba que el RSS crece
menos de 64 MB. La cancelación se mide con un cuerpo de mentira que avisa cuando lo cancelan. El
código se comprueba además leyéndolo: no contiene `arrayBuffer` ni `Buffer.concat`, y sí `pipeTo`.

**Depende de:** T25, T11.

**Archivos:** `packages/media-proxy/src/{byte-proxy,byte-proxy.test}.ts`, `packages/server/src/routes/stream.ts`.
**Ampliación declarada:** `packages/server/src/routes/stream.test.ts`, el contenedor (tickets y
resolución de stream), `app.ts` (las rutas y un `fetch` inyectable para el proxy), los barriles de
`media-proxy` y las dependencias `@nn-anime/media-proxy` y `zod` del server.

**Cuatro decisiones que conviene recordar:**

1. **El proxy no decide a dónde se puede salir.** Eso es la lista blanca de destinos (T26a), y vive
   fuera de este archivo para poder probar el reenvío con un `fetch` de mentira.
2. **Los headers se copian y se sobrescribe `accept-encoding`, no se mezclan en un objeto.** Con un
   objeto plano, `Accept-Encoding` y `accept-encoding` son dos claves distintas, `Headers` une las
   dos y la compresión del cliente sobrevivía: los rangos dejaban de ser rangos. Lo encontró la
   prueba.
3. **Un rango imposible se rechaza antes de salir a la red.** Un 416 sin preguntar al upstream evita
   usar el proxy como generador de tráfico.
4. **Devolver la respuesta del proxy tal cual saltaba el mapa de cabeceras del contexto**: el
   `Cache-Control` y el `ETag` se perdían sin decir nada. Se envuelve la respuesta para añadirlos, y
   lo encontró la prueba.
5. **El ETag de una portada es un hash de la referencia, no la referencia.** Un nombre de archivo de
   caché o el valor de una cabecera no se derivan nunca de un dato del proveedor: `..%2F..%2F` no
   tiene recorrido posible sólo mientras nadie lo use como ruta.
6. **No poder cachear un stream no es un fallo.** El episodio puede no estar en la base porque nadie
   abrió su ficha; devolver un error dejaría al usuario sin reproducir por un problema de caché.
   También lo encontró una prueba, con un 502 que no correspondía.

**Tamaño:** M.

---

### T26a — Lista blanca de destinos y redirecciones

**Descripción:** Cerrar SSRF. El proxy sale sólo a donde debe y lo reverifica en cada salto de
redirección.

**Aceptación:**
- [x] Sólo `http` y `https`. `file:`, `data:`, `ftp:` y cualquier otro esquema se rechazan antes
      de abrir conexión.
- [x] Se rechazan loopback (`127.0.0.0/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`),
      link-local (`169.254/16`, `fe80::/10`) y direcciones de metadata de nube.
- [x] La comprobación se aplica después de resolver DNS: un nombre que resuelve a `127.0.0.1` se
      rechaza igual que la IP literal.
- [x] `redirect: 'manual'`: cada salto se revalida y el tope es 5; el sexto devuelve error.
- [x] El error nombra la regla que rechazó el destino, sin volcar la URL completa en producción.
- [x] Test con los cinco destinos prohibidos del spec y con una cadena permitido → prohibido que
      se corta en el salto.

**Verificación:** `bun test packages/media-proxy` · 27 pruebas nuevas. Medido mutando la
implementación: sin comprobar el esquema fallan 2, sin comprobar la dirección resuelta 2, sin
revalidar cada salto 2, sin el tope de saltos 1 y con el error volcando la URL 1. Control: 0 fallos.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{destination-guard,destination-guard.test}.ts`, `packages/media-proxy/src/byte-proxy.ts`.
**Ampliación declarada:** el barril de `media-proxy`, `packages/server/src/app.ts` y las rutas de
stream y portadas, que reciben un resolutor inyectable para poder probarse sin DNS.

**Cuatro decisiones que conviene recordar:**

1. **Se revisan todas las respuestas del DNS, no la primera.** Un nombre que devuelve `127.0.0.1` y
   una dirección pública a la vez no es un destino permitido: es un intento de colarse.
2. **Una IPv4 escrita dentro de una IPv6 se comprueba como IPv4.** `::ffff:127.0.0.1` es loopback
   para el sistema y sería transparente para una comprobación que sólo mirara el texto de la IPv6.
3. **`localhost` se rechaza sin resolver nada**, y la comprobación se repite tras resolver: son dos
   puertas para el mismo caso.
4. **Riesgo residual anotado, no escondido:** entre la comprobación y la conexión, un DNS hostil
   puede cambiar la respuesta (*rebinding*). Cerrarlo exige conectar a la IP ya validada, y eso rompe
   SNI y la validación del certificado. Queda como riesgo aceptado en el informe de v1.

**Tamaño:** M.

---

### T26b — Saneamiento de respuestas: lista blanca de cabeceras

**Descripción:** Dejar de copiar cabeceras de upstream. Pasar sólo lo necesario y eliminar el
resto, `Set-Cookie` incluida.

**Aceptación:**
- [x] Lista blanca de respuesta: `content-type`, `content-length`, `content-range`,
      `accept-ranges`, `cache-control`, `etag`, `last-modified`. Nada más.
- [x] `Set-Cookie` se elimina siempre: test con un upstream de fixture que la devuelve.
- [x] El `Content-Type` se fuerza desde lo que se pidió (playlist, segmento, subtítulo) y no se
      copia del upstream.
- [x] Se añade `X-Content-Type-Options: nosniff`.
- [x] Un test compara el conjunto completo de cabeceras de respuesta contra la lista permitida y
      falla si aparece una extra.
- [x] Un upstream que declara `text/html` no cambia el `Content-Type` servido.

**Verificación:** `bun test packages/media-proxy packages/server` · 13 pruebas del saneador y 12 de
la ruta de stream. Medido mutando la implementación: copiando todas las cabeceras en lugar de la
lista blanca fallan 3, sin forzar el tipo 2, sin `nosniff` 3 y con la playlist servida como
`text/html` 2. Control: 0 fallos.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{response-headers.ts,response-headers.test.ts}`, `packages/media-proxy/src/byte-proxy.ts`.
**Ampliación declarada:** el barril de `media-proxy`, `packages/server/src/routes/stream.ts` (deduce
el tipo de lo que se pidió y lo impone) y su prueba.

**Tres decisiones que conviene recordar:**

1. **Se construye una cabecera nueva con la lista blanca; no se borran las que sobran.** Una lista
   de prohibiciones se queda corta en cuanto el upstream inventa una cabecera nueva.
2. **El tipo se impone a playlist, segmento y subtítulo, y no a lo demás.** El contenedor real de un
   archivo progresivo —mp4, webm, mkv— sólo lo sabe el upstream, y la extensión no es autoridad. La
   imagen tiene su propia lista blanca de tipos ráster (T26).
3. **La deducción del tipo va por la dirección, no por lo que diga el cliente.** El `Accept` del
   navegador no decide qué se está sirviendo; la URL del ticket, sí.

**Tamaño:** S.

---

### T26c — Pruebas de integración del ciclo completo

**Descripción:** Tarea **nueva**, añadida al auditar la trazabilidad. `SPEC-nn-anime.md` declara un
nivel de pruebas de integración en `tests/` que «cubre el ciclo buscar → detalle → episodios →
resolver stream → cachear», y **ninguna tarea lo creaba**. Cada tarea prueba su paquete; el ciclo
completo no lo probaba nadie, que es justo donde aparecen los fallos de integración.

**Aceptación:**
- [x] Existe el directorio `tests/` y `bun test` lo recoge.
- [x] Base SQLite en directorio temporal y proveedor fixture inyectado: **sin red externa**.
- [x] El ciclo se ejerce **por las rutas HTTP** contra `createApp`, no llamando a los módulos de cada
      paquete: los guards, la validación de entrada y el orden de los middlewares son parte de lo que
      se prueba, y ahí es donde han vivido los tres fallos de integración de este proyecto.
- [x] Un test recorre el ciclo entero por HTTP: buscar → detalle → episodios → resolver stream →
      comprobar que quedó cacheado. Que quedó cacheado se observa **en la tabla**, no por el contador.
- [x] Un test comprueba que la segunda vuelta del ciclo **no llama al proveedor**: el contador de
      peticiones del fixture se queda igual. Es el criterio que mide el contador; el anterior mide la
      tabla.
- [x] Un test comprueba que un proveedor que falla no rompe el ciclo: se sirve lo cacheado.
- [x] Con reloj inyectado, un test comprueba la caducidad: pasada la TTL, la siguiente vuelta vuelve a
      llamar al proveedor, y dentro de la TTL no.
- [x] Con reloj inyectado, un test comprueba `stale-while-revalidate`: con el valor caducado y dentro
      de la ventana, la respuesta sale del valor viejo **y** el proveedor se llama una vez para
      refrescar.
- [x] Ningún test toca `$XDG_*` real.

**Verificación:** `bun test tests` · 12 pruebas. `bun test` completo: 1035. Medido mutando la
implementación: sin pasar el reloj a las escrituras falla 1 y sin cachear el detalle 5. Control: 0
fallos.

**Depende de:** T22, T23, T26b.

**Archivos:** `tests/ciclo-completo.test.ts`, `tests/fixtures.ts`.
**Ampliación declarada:** el `package.json` de la raíz, que declara los paquetes como dependencias de
desarrollo para que el nivel de integración pueda importarlos por su nombre y no por una ruta
relativa; y `ContainerOptions.now` más el reloj de la fachada, sin los cuales la caducidad no se
puede probar sin esperar un día.

**Hallazgo que valió la tarea:** la fachada del store pasaba el reloj inyectado a las **lecturas**
pero no a las **escrituras**, así que una fila quedaba con la fecha real y la caducidad inyectada no
se podía probar: el `stale` nunca llegaba. Lo encontró la primera prueba de caducidad de este nivel,
que es exactamente para lo que existe.

**Tamaño:** M.

---

### T27 — Reescritura HLS: variantes y segmentos

**Descripción:** Reescribir las playlists para que todo pase por el proxy.

**Aceptación:**
- [x] Detección por `Content-Type` o extensión `.m3u8`.
- [x] Reescribe URIs de segmentos y de sub-playlists a `/stream/:ticket/seg/:index`.
- [x] Resuelve URLs relativas contra la URL base de cada playlist, incluidas las anidadas.
- [x] Conserva el orden y los atributos de `#EXT-X-STREAM-INF`.
- [x] Caché en memoria de playlists por 10 s como máximo.
- [x] Rechaza playlists mayores de 4 MB antes de parsear, con error explícito.
- [x] Test contra `fixtures/master.m3u8` y `fixtures/media.m3u8`: salida esperada versionada.

**Verificación:** `bun test packages/media-proxy` · 20 pruebas nuevas, dos de ellas comparando contra
`master.expected.m3u8` y `media.expected.m3u8`, que están versionados en el repositorio. Medido
mutando la implementación: resolviendo contra el nivel de arriba fallan 2, reescribiendo también las
etiquetas 10, con la caché siempre vencida 3 y detectando sólo por extensión 1. Control: 0 fallos.

**Depende de:** T26, T26b.

**Archivos:** `packages/media-proxy/src/{hls.ts,hls.test.ts}`, `packages/media-proxy/fixtures/*.m3u8`.
**Ampliación declarada:** el barril de `media-proxy`.

**Cuatro decisiones que conviene recordar:**

1. **La resolución es contra la URL base de la playlist, no contra la del ticket.** Una sub-playlist
   vive en otra carpeta y sus segmentos son relativos a ella; resolverlos contra el nivel de arriba da
   404 en todos. Es el fallo clásico de un reescritor de HLS, y tiene su prueba.
2. **Las líneas que no son URIs se copian literales.** `#EXT-X-STREAM-INF` lleva el ancho de banda y
   el códec; reconstruirla es la forma de perderlos.
3. **La reescritura devuelve también las URIs originales, en orden.** El proxy necesita las dos
   cosas: el texto para el reproductor y el índice para resolver `seg/:index` sin volver a parsear.
4. **El tope de 4 MB se comprueba antes de parsear.** Parsear primero y comprobar después es gastar
   memoria en algo que se va a descartar.

**Tamaño:** M.

---

### T28 — HLS: claves, discontinuidad y límites

**Descripción:** El resto de la reescritura: lo que no es un segmento también pasa por el proxy.

**Aceptación:**
- [x] `#EXT-X-KEY` con `URI="..."` se reescribe para que la clave también pase por el proxy.
- [x] `#EXT-X-MAP` con `URI="..."` se reescribe igual (los segmentos de inicialización).
- [x] `#EXT-X-DISCONTINUITY` y las etiquetas desconocidas se conservan sin tocar.
- [x] Una playlist con más de 5000 líneas se rechaza antes de reescribir, con error explícito.
- [x] Test con una playlist que tiene dos claves distintas y una discontinuidad entre ellas: cada
      clave apunta a su propia ruta del proxy y el orden se conserva.

**Verificación:** `bun test packages/media-proxy` · 12 pruebas nuevas y el fixture `cifrado.m3u8` con
su salida esperada versionada. Medido mutando la implementación: sin reescribir las claves fallan 5,
sin el tope de líneas 1, con las claves usando la ruta de los segmentos 5 y perdiendo la
discontinuidad 2. Control: 0 fallos.

**Depende de:** T27.

**Archivos:** `packages/media-proxy/src/{hls.ts,hls.test.ts}`, `packages/media-proxy/fixtures/cifrado*.m3u8`.
**Ampliación declarada:** el barril de `media-proxy`.

**Tres decisiones que conviene recordar:**

1. **Claves e inicializadores comparten lista e índice** (`/key/:index`), en orden de aparición. Para
   pedir los bytes dan igual: las dos son un recurso del upstream que tiene que pasar por el proxy.
   Separarlos obligaría a dos rutas y a dos listas para lo mismo.
2. **Sólo se toca el atributo `URI`; el resto de la etiqueta se copia literal.** `METHOD`, `IV` y
   `BYTERANGE` son del upstream, y reconstruir la línea es la forma de perderlos.
3. **Sólo `#EXT-X-KEY` y `#EXT-X-MAP` se reescriben.** Una etiqueta desconocida con un `URI` no se
   toca: inventarse la semántica de una etiqueta que no se conoce es peor que dejarla pasar, y el
   destino se valida igual cuando alguien pida esa URI.

**Un fallo que valió una prueba:** un grupo de captura que no participa llega como `undefined`, no
como cadena vacía, así que comparar contra `''` dejaba pasar el `undefined` y la clave se resolvía
como «undefined». Lo encontró la prueba de las comillas simples, que existe precisamente porque el
spec de HLS permite las dos.

**Tamaño:** S.

---

### T29 — Handoff a mpv

**Descripción:** Lanzar, seguir y matar mpv desde el server, con salida cuando no está instalado.

**Aceptación:**
- [x] `POST /api/play/mpv` resuelve el stream, emite el ticket y lanza `mpv` con
      `--http-header-fields` construido desde los headers de upstream.
- [x] `GET /api/play/mpv/events` emite SSE con `starting`, `playing`, `exited`, `failed`.
- [x] Sin `mpv` en el `PATH`: 503 y `/api/health` informa `mpv: false`.
- [x] Salida distinta de 0 devuelve el `stderr` recortado a 2 KB.
- [x] `POST /api/play/mpv/:pid/stop` mata el proceso y el SSE emite `exited`.
- [x] Al cerrar la app, todo mpv lanzado muere: verificado con `pgrep`.
- [x] Ningún argumento de la línea de comandos se construye por concatenación de entrada del
      usuario; se usa el array de `spawn`.

**Verificación:** `bun test packages/media-proxy packages/server` · 22 pruebas del reproductor y 13
de las rutas. Medido mutando la implementación: sin `--no-config` fallan 2, sin recortar el `stderr`
2, sin matar en `close()` 3 y sin el tope de procesos 1. Control: 0 fallos.
**En vivo**, con mpv instalado en esta máquina: el arranque informa `mpv: true`, el lanzamiento
devuelve un pid, el proceso aparece vivo medio segundo después, y al no haber red hacia el upstream
sale con código 2 y el SSE emite `failed` con ese código. **El criterio de `pgrep` no se pudo medir
en vivo**: mpv salió solo al no poder cargar el stream, así que no había nada que matar al apagar. Lo
que sí está probado —y mutado— es que `close()` mata todo lo que siga vivo.

**Depende de:** T26.

**Archivos:** `packages/media-proxy/src/{mpv.ts,mpv.test.ts}`, `packages/server/src/routes/play.ts`.
**Ampliación declarada:** `packages/server/src/routes/play.test.ts`, el contenedor (el reproductor y
su lanzador inyectable), `app.ts` (las rutas y una sola fuente de verdad para la salud), el barril de
`media-proxy`, y el arranque del CLI, que mira si hay mpv **una vez** y no en cada petición.

**Cuatro decisiones que conviene recordar:**

1. **A mpv se le da la URL del proxy con su ticket, no la del upstream.** Si se le diera la del
   sitio, el ticket y la lista blanca de destinos dejarían de servir para el reproductor externo, que
   es justo donde más fácil es saltarse el proxy sin que nadie lo note. El `Referer` sí nombra al
   upstream: es la cabecera que el sitio exige, y va dentro del argumento de cabeceras.
2. **Los argumentos van en un array.** Un `Referer` con un espacio o un `;` sería una inyección de
   argumentos, y el array la hace imposible por construcción. Hay una prueba con `rm -rf /` dentro de
   una cabecera.
3. **`playing` se anuncia con un retardo.** mpv tarda en abrir la ventana, y decir «reproduciendo» en
   el mismo instante en que se lanza es mentira.
4. **Un solo mpv a la vez**, que es lo que pide el spec: el segundo intento es 409 y no una ventana
   más.

**Un fallo que valió la prueba en vivo:** la salud leía `mpvAvailable` de las opciones de la
aplicación mientras la ruta leía el reproductor del contenedor, así que el contenedor decía que había
mpv y la salud decía que no. Ahora hay una sola fuente de verdad.

**Tamaño:** M.

---

### T29a — Validación de headers hacia mpv

**Descripción:** Impedir que un valor de header inyecte argumentos o cabeceras en el proceso de mpv.

**Aceptación:**
- [x] Nombre de header validado con `^[A-Za-z0-9-]+$`; valor sin `\r`, `\n` ni caracteres de
      control.
- [x] Un header inválido produce error con el nombre ofensor y no se lanza ningún proceso.
- [x] Los argumentos se pasan en array a `Bun.spawn`; ninguna ruta construye la línea de comandos
      por concatenación.
- [x] Tope de un mpv concurrente: un segundo `POST /api/play/mpv` devuelve 409.
- [x] Test con `spawn` sustituido por un espía: se verifica el array exacto de argumentos.
- [x] Test: un valor con `\n` no añade ningún argumento nuevo en el espía.

**Verificación:** `bun test packages/media-proxy packages/server` · 13 pruebas del constructor de
argumentos y 14 de las rutas. Medido mutando la implementación: sin validar el nombre falla 1, sin
validar el valor 2, dejando pasar los saltos de línea 3 y con el error llevando el valor de la
cabecera 1. Control: 0 fallos.

**Depende de:** T29.

**Archivos:** `packages/media-proxy/src/{mpv-args.ts,mpv-args.test.ts}`, `packages/media-proxy/src/mpv.ts`.
**Ampliación declarada:** el barril de `media-proxy` y `packages/server/src/routes/play.ts`, que ahora
distingue los tres motivos de rechazo (409 ocupado, 400 cabecera inválida, 503 sin mpv).

**Tres decisiones que conviene recordar:**

1. **La defensa es doble: el array y la validación.** El array impide que un espacio o un `;` cree un
   argumento nuevo; la validación impide que un `\n` cree una cabecera nueva. Ninguna de las dos basta
   sola: `--http-header-fields` separa por comas y las entiende mpv, así que un salto de línea ahí
   dentro es una cabecera que este programa no pidió.
2. **Un header inválido no se descarta en silencio: se rechaza la reproducción con su nombre.** Un
   descarte silencioso esconde que un plugin manda basura, y el usuario vería un video que no arranca
   sin saber por qué.
3. **El error nombra la cabecera y nunca su valor.** El nombre es lo que hace falta para arreglarlo; el
   valor puede llevar un token de referencia, y un error se registra.

**La construcción de argumentos vive ahora en su propio módulo** (`mpv-args.ts`), separada de
`mpv.ts`: es una función pura y es donde está la defensa, así que se prueba sola. En `mpv.ts` queda
lanzar, seguir y matar.

**Tamaño:** S.

---

### T30 — Subtítulos: proxy y conversión `srt` a `vtt`

**Descripción:** Servir subtítulos por el proxy y convertir en memoria lo que el navegador no
entiende.

**Aceptación:**
- [x] `GET /api/subtitles/:ticket` proxyfica la pista y fuerza `Content-Type: text/vtt`.
- [x] `srt` se convierte a `vtt` en memoria: numeración, comas a puntos y cabecera `WEBVTT`.
- [x] `ass` se devuelve tal cual para mpv y se omite en el reproductor web.
- [x] Codificación distinta de UTF-8 se detecta y se convierte a UTF-8.
- [x] Límite de 5 MB por pista; por encima, error explícito.
- [x] Test de conversión con un `srt` de fixture que incluye BOM y saltos CRLF.

**Verificación:** `bun test packages/media-proxy packages/server` · 17 pruebas de conversión y 7 de la
ruta, con `fixtures/sample.srt` (BOM y CRLF) y su salida esperada versionada. Medido mutando la
implementación: sin quitar la numeración fallan 2, sin cambiar las comas 3, sin detectar UTF-16 1 y
con el decodificador quedándose el BOM 2. Control: 0 fallos.

**Depende de:** T25, T11.

**Archivos:** `packages/media-proxy/src/{subtitles.ts,subtitles.test.ts}`, `packages/server/src/routes/subtitles.ts`, `packages/media-proxy/fixtures/sample.srt`.
**Ampliación declarada:** `packages/server/src/routes/subtitles.test.ts`, el fixture
`sample.expected.vtt`, el barril de `media-proxy` y `app.ts` para montar la ruta.

**Tres decisiones que conviene recordar:**

1. **La codificación se detecta, no se supone.** Primero los BOM, que son una declaración explícita;
   después UTF-8 estricto, que falla si no lo es; y sólo entonces una codificación de un byte, que
   nunca falla y por eso no puede ser la primera opción.
2. **La numeración sólo se descarta si lo que viene detrás son tiempos.** Una línea que es sólo un
   número puede ser el diálogo de un subtítulo que dice «1», y borrarla es comerse el texto. Lo
   encontró la prueba, y era un fallo de verdad.
3. **`ass` no se toca.** Es un formato con estilos que mpv entiende y el navegador no; convertirlo mal
   es peor que no ofrecerlo, y quien decide no ofrecerlo es el reproductor web (T31).

**Una línea que se quitó tras medirla:** el BOM de UTF-8 se quitaba a mano y ninguna mutación podía
distinguirlo, porque el decodificador se lo come él solo. Se eliminó, y el fixture con BOM sigue
cubriendo el caso: con `ignoreBOM: true` la prueba falla.

**Tamaño:** M.

---

### T31 — Reproductor web con hls.js

**Descripción:** Reproducción dentro de la página, con seek, atajos de teclado y accesibilidad.

**Aceptación:**
- [x] Detecta `kind` y usa `<video>` directo o `hls.js` según corresponda.
- [x] Seek, pausa, volumen y pantalla completa funcionan con teclado.
- [x] Flechas ±10 s, `Espacio` y `Enter` para pausa.
- [x] Los atajos no secuestran la escritura cuando el foco está en un campo de texto.
- [x] Estado del reproductor en región `aria-live="polite"`.
- [x] Los controles se ven y funcionan en tema oscuro y claro, con contraste 4.5:1.

**Verificación:** `bun test packages/web` · 25 pruebas del reproductor (18 de los atajos y 7 del
componente). Medido mutando la implementación: secuestrando la escritura falla 1, ignorando los
modificadores 1 y sin limitar el salto al final del video 1. Control: 0 fallos. `bun run build`
confirma que `hls.js` sale en su propio trozo: la importación dinámica hace lo que se esperaba de
ella.

**Depende de:** T26, T24.

**Archivos:** `packages/web/src/features/player/{Player,usePlayer,controls}.tsx`, `packages/web/src/features/player/Player.test.tsx`.
**Ampliación declarada:** `controls.test.ts`, `WatchPage.tsx` (la pantalla que resuelve el stream y
monta el reproductor), `app.tsx` para montarla en su ruta, el catálogo y la hoja de estructura, la
dependencia `hls.js`, y **`streamResolveResponseSchema` movido a `core/api.ts`**: estaba en la ruta
del servidor y el cliente no puede importar código de servidor. Ahora la forma la define `core` y las
dos partes la usan, que es la regla del proyecto. El cliente gana además `apiPostJson`, un `POST` que
devuelve el cuerpo validado.

**Cuatro decisiones que conviene recordar:**

1. **`hls.js` se carga con importación dinámica.** Son unos 300 KB que sólo hacen falta cuando alguien
   reproduce en HLS; importarlos arriba engordaría la búsqueda —la pantalla que todo el mundo usa—
   para servir a la que se usa de vez en cuando. La atribución aparece sólo cuando se usa la
   biblioteca, porque su licencia lo pide.
2. **Los atajos no hacen nada si el foco está en un campo de texto, ni con `Ctrl`, `Meta` o `Alt`.**
   Un reproductor que se queda con la barra espaciadora mientras alguien escribe en el buscador rompe
   la página entera, y quitarle a alguien `Ctrl+R` es ganarse un enemigo.
3. **La región `aria-live` es `polite`, no `assertive`.** El estado cambia constantemente, y una
   región que interrumpe cada segundo hace la página inservible con un lector de pantalla.
4. **El elemento sigue siendo un `<video>` de verdad**, sin `controls` y con controles propios: los
   del navegador no se pueden atar a los atajos del spec ni anunciarse.

**Tamaño:** M.

---

### T31a — Lista blanca de esquemas para datos de proveedor

**Descripción:** Que ninguna URL que venga de un proveedor pueda ejecutar nada en la página.

**Aceptación:**
- [x] `safeUrl(value)` acepta sólo `http` y `https`; devuelve `null` para todo lo demás.
- [x] Un `coverUrl` con `javascript:`, `data:` o `vbscript:` se renderiza como texto plano y no
      produce ningún `href` ni `src`.
- [x] La función se aplica en todos los puntos donde una URL de proveedor entra a un atributo,
      verificado con `grep` sobre `src` y `href` en el paquete y con un test por componente que
      muestra portada.
- [x] Las URLs de subtítulos y de stream pasan por la misma función. **Las de stream ya no son URLs
      del proveedor**: el cliente recibe rutas del proxy con su ticket (T26), y las de subtítulos
      también (T30). La función es la puerta para lo que llegue.
- [x] Test: un título con `javascript:` no genera ningún atributo con ese valor en el DOM.

**Verificación:** `bun test packages/web` · 10 pruebas de la función y la guarda, más una por
componente que muestra portada. Medido mutando la implementación: con una lista negra en vez de
blanca falla 1, admitiendo cualquier esquema 4 y sin comprobar la portada en la tarjeta 1. Control: 0
fallos. `bun run e2e` es de T43, que todavía no existe.

**Depende de:** T24.

**Archivos:** `packages/web/src/lib/{safe-url.ts,safe-url.test.ts}`, `packages/web/src/features/search/ResultCard.tsx`, `packages/web/src/features/detail/DetailPage.tsx`.

**Un hallazgo que conviene decir:** **hoy ninguna URL de proveedor entra en un atributo**. Las
portadas salen de `/api/cover/:providerId/:ref` (T26) y las fuentes de reproducción son rutas del
proxy con ticket, así que la lista blanca no tiene por dónde colarse. Lo que sí se hizo es usarla
donde el dato decide algo: una portada con un esquema prohibido cuenta como «sin portada», así que la
tarjeta no pide al proxy algo que no puede existir y el detalle pinta el hueco en vez de una imagen
rota. Y se añadió una **guarda por texto** que recorre todos los `src=` y `href=` del paquete y falla
si alguna expresión que nombre una URL de proveedor no pasa por `safeUrl`: la alternativa es confiar
en que quien escriba el próximo componente se acuerde, y este proyecto ya ha visto tres veces lo que
pasa cuando algo depende de que alguien se acuerde.

**Dos decisiones que conviene recordar:**

1. **Lista blanca, no negra.** Una lista de prohibiciones se queda corta en cuanto aparece un esquema
   nuevo, y aquí el precio de quedarse corta es ejecutar código ajeno en el origen de la aplicación.
2. **La dirección se resuelve con `URL` antes de comparar.** `JaVaScRiPt:` y un salto de línea dentro
   del esquema son el mismo esquema, y una comparación de cadenas los dejaría pasar.

**Tamaño:** S.

---

### T32 — Sub/dub, pista de subtítulos y registro de posición

**Descripción:** Cerrar el ciclo de reproducción: cambio de modo, subtítulos y señal de visionado.

**Aceptación:**
- [x] Cambiar de sub a dub vuelve a resolver el stream y reanuda en la misma posición.
- [x] Selector de pista de subtítulos, con pista por defecto del proveedor preseleccionada.
- [x] `POST /api/watch` al iniciar y `PATCH /api/watch/:id` cada 15 s y al pausar.
- [x] Al cerrar o desmontar la vista, se envía la posición final con `sendBeacon` o `fetch` con
      `keepalive`.
- [x] Sin reproducción real no se registra nada: verificado con un test que sólo carga la página.
- [x] La posición registrada aparece en `listRecentlyWatched`.

**Verificación:** `bun test packages/server packages/web` · 11 pruebas de las rutas de visionado y 14
del lado de la interfaz. Medido mutando la implementación: mandando el avance siempre fallan 2, sin
omitir `ass` 1 y admitiendo cualquier dirección de pista 3. Control: 0 fallos.

**Depende de:** T31, T20.

**Archivos:** `packages/web/src/features/player/{useWatchEvents.ts,subtitle-tracks.ts}`, `packages/server/src/routes/watch.ts`, `packages/server/src/routes/watch.test.ts`.
**Ampliación declarada:** los schemas de visionado en `core/api.ts` (la forma la define `core`, no la
ruta), `app.ts` para montar las rutas, y `Player.tsx`/`usePlayer.ts`, que ahora avisan de
reproducción, pausa y avance y saben reanudar en una posición.

**Cuatro decisiones que conviene recordar:**

1. **El alta es al reproducir, no al cargar.** Si se registrara al abrir la ficha, «continuar viendo»
   se llenaría de títulos que nadie reprodujo. Hay una prueba que carga la página y comprueba que no
   se escribió nada.
2. **Avance cada 15 s y al pausar.** Cada 15 y no cada segundo: una escritura por segundo en una base
   de un solo escritor, y la posición se guarda para reanudar, no para dibujar una gráfica. Al pausar
   se manda siempre, porque pausar a los dos segundos de empezar tiene que guardar esos dos segundos.
3. **La posición final viaja con `keepalive`.** Sin eso, cerrar la pestaña pierde los últimos
   segundos, que son justo los que hacen que reanudar sirva de algo.
4. **Una fila por visionado, identificada por su `id`.** Buscar por episodio y modo en cada avance
   haría que dos pestañas abiertas con el mismo episodio se pisaran la posición.

**Dos decisiones sobre los subtítulos en la web:** `ass` se omite porque el navegador no lo entiende
—el proxy lo sirve igual para mpv— y la dirección de la pista se comprueba **en el atributo**, no sólo
al construir la lista: si mañana alguien pasa pistas sin filtrar, ahí no entra una dirección de fuera
igual. Esa comprobación la vigila además la guarda de T31a, que recorre todos los `src=` y `href=`.

**Tamaño:** M.

---

## Checkpoint F — Reproducción

**Estado: alcanzado, pendiente de revisión humana.** Es parada dura: no se sigue sin tu decisión.

- [ ] El mp4 del fixture se reproduce en la página, el seek funciona y los subtítulos aparecen.
      **No se puede comprobar aquí**: el fixture apunta a `https://fixture.invalid/...`, que no
      existe, y el proxy rechaza el loopback por diseño (T26a). Verificarlo necesita navegador y un
      upstream alcanzable: es el e2e (T43), y hay que decidir cómo se monta.
- [x] mpv abre, se sigue por SSE y muere al cerrar la app. **Medido en vivo** con mpv instalado y
      `--idle=yes` para que el proceso sobreviva a la falta de red: se lanza (pid vivo), los eventos
      salen por SSE (`starting`, `playing`, `failed`) y **tras `close()` el pid ya no existe** y
      `pgrep` no encuentra ningún `mpv`.
- [x] Decisión explícita sobre HLS: **se mantiene en v1**, no se aplica el plan B. Registrada en
      `docs/PLAN-B-HLS.md` con lo que se decidió, con qué y qué queda fuera.
- [x] Revisión humana. El humano decidió además cómo se monta la verificación en navegador:
      **excepción de loopback sólo en modo test** para el e2e de T43, con la lista blanca intacta en
      producción y una prueba de que sin la variable el loopback se sigue rechazando.

**Lo que sí está medido hasta aquí:** 1199 pruebas, 0 fallos; `tsc` 0, `biome` 0, `bun run build`
verde con `hls.js` en su propio trozo; cobertura por paquete en `core 97.90 %`,
`catalog-store 96.07 %`, `provider-sdk 99.78 %`. T27 y T28 se limitaron a tres playlists de fixture
versionadas, como pedía el plan para acotar el riesgo 1.

---

## Fase 6 — Recomendaciones

### T33 — Afinidad: vector, IDF y decaimiento

**Descripción:** Base del motor: qué le gusta al usuario, ponderado por recencia y completitud.

**Aceptación:**
- [x] Vector de afinidad sobre tags, estudio y año.
- [x] Peso = recencia × completitud, con semivida de 30 días y `now` inyectado.
- [x] IDF sobre el corpus de candidatos: un tag en el 80 % pesa menos que uno en el 5 %.
- [x] Similitud coseno con manejo de vector vacío sin `NaN`.
- [x] Bonus de 0,1 por estudio compartido.
- [x] Tests con corpus sintético determinista; sin red y sin base.

**Verificación:** `bun test packages/recsys` · 33 pruebas. Medido mutando la implementación: sin
decaimiento fallan 3, sin IDF 3, sin proteger el coseno del vector vacío 2, sin el bonus de estudio 2,
ignorando la completitud 3 y sin normalizar 7. Control: 0 fallos. Cobertura del paquete: 100 %.

**Depende de:** T4.

**Archivos:** `packages/recsys/src/{affinity.ts,affinity.test.ts}`.
**Ampliación declarada:** el barril y el `package.json` del paquete (exporta el módulo y depende de
`core`).

**Cuatro decisiones que conviene recordar:**

1. **El IDF se aplica sobre la suma por característica, no evento a evento.** Lo que se pondera es
   «cuánto le gusta este tag», no cada visionado por separado.
2. **El decaimiento no premia un evento futuro.** Un reloj movido hacia atrás daría un peso mayor que
   1, y eso es un error de quien llama, no una señal.
3. **El coseno recorre el vector más corto.** Es simétrico, así que se hacen menos comparaciones sin
   cambiar el resultado.
4. **El bonus por estudio es pequeño a propósito.** Sirve para desempatar entre dos candidatos
   parecidos, no para imponer un estudio: hacen falta diez coincidencias para igualar un coseno de 1.

**Una trampa que costó dos intentos y quedó documentada:** el corpus con el que se construye la
afinidad tiene que ser **el mismo** con el que se puntúa. Con IDF distinto, la afinidad y el candidato
viven en espacios de pesos distintos y el coseno sale bajo sin que nada avise: el ranking se ordena
mal y no hay ningún error. Lo encontró una prueba que medía el bonus por estudio con dos estudios.

**Tamaño:** M.

---

### T34 — Co-visita

**Descripción:** Señal colaborativa puramente local: qué se ve junto en la misma sesión.

**Aceptación:**
- [x] Sesión definida como eventos separados por menos de 6 h.
- [x] Cuenta pares (candidato, título visto) dentro de la sesión, normalizado por el par más
      frecuente.
- [x] Sin historial: componente en 0, sin división por cero.
- [x] Un par visto una sola vez no domina sobre uno visto diez veces.
- [x] Test con historial que cruza el borde de sesión.

**Verificación:** `bun test packages/recsys` · 22 pruebas. Medido mutando la implementación: sin el
corte de sesión fallan 5, sin el umbral de soporte 1, sin normalizar por el par más frecuente 2 y sin
ordenar el historial 1. Control: 0 fallos. Cobertura del paquete: 100 %.

**Depende de:** T33.

**Archivos:** `packages/recsys/src/{covisit.ts,covisit.test.ts}`.
**Ampliación declarada:** el barril y los `exports` del paquete.

**Cuatro decisiones que conviene recordar:**

1. **Dentro de una sesión cuentan todos los cruces, no sólo los vecinos.** Si en una sesión se ven
   `a`, `b` y `c`, los pares son los seis. Contar sólo lo inmediatamente anterior perdería la señal de
   «estos tres se ven juntos», que es justo la que interesa.
2. **Los pares van en los dos sentidos.** Si A y B se ven juntos, «después de A, B» y «después de B,
   A» son las dos direcciones útiles: la lista se construye desde lo último visto, y puede ser
   cualquiera de los dos.
3. **El umbral de soporte es 2.** Una coincidencia suelta es ruido: con miles de pares posibles,
   cualquiera aparece una vez por azar.
4. **El peso se queda entre 0 y 1.** El par más frecuente vale 1 y el resto se reparte por debajo, que
   es lo que permite sumar esta señal con la afinidad, que también está normalizada.

**Lo que costó dos intentos:** mis primeras pruebas daban por hecho que el par más frecuente valdría
exactamente 1, y con decaimiento temporal no es así —el par más viejo pesa menos—. Se separaron en dos:
una con todos los eventos en el mismo instante, que mide la normalización sola, y otra con decaimiento,
que comprueba el orden. Y otra prueba contaba pares vecinos cuando el módulo cuenta cruces: la
expectativa era mía, no del código.

**Tamaño:** M.

---

### T35 — Señal de búsqueda, exclusión y reencuentro

**Descripción:** Incorporar lo que el usuario busca ahora y decidir qué no recomendar.

**Aceptación:**
- [x] Los términos buscados se cruzan con título y tags; un candidato abierto desde una búsqueda
      reciente y no visto sube con razón `matches-search`.
- [x] Semivida de 3 días para la señal de búsqueda.
- [x] Un título visto al 100 % no aparece en el top 10.
- [x] Un título visto al 10 % hace más de 30 días sí puede reaparecer.
- [x] Todo candidato ya visto queda fuera salvo la excepción anterior, verificada por test.

**Verificación:** `bun test packages/recsys` · 33 pruebas. Medido mutando la implementación: sin
decaimiento de la búsqueda fallan 2, sumando todas las búsquedas en vez de tomar la que más encaja 1,
dejando volver lo terminado 1 y sin la excepción de reencuentro 3. Control: 0 fallos. Cobertura del
paquete: 100 %.

**Depende de:** T34.

**Archivos:** `packages/recsys/src/{search-signal.ts,filters.ts,search-signal.test.ts}`.
**Ampliación declarada:** el barril y los `exports` del paquete.

**Cuatro decisiones que conviene recordar:**

1. **Semivida de 3 días, no de 30.** Es la señal más volátil del motor: si alguien busca «mecha» hoy,
   lo que le interesa hoy tiene que ver con eso, y una búsqueda de la semana pasada ya no dice qué se
   quiere ver esta noche.
2. **Se toma la búsqueda que más encaja, no la suma.** Sumando, veinte búsquedas vagas del mismo día
   superarían a una búsqueda concreta: el volumen mandaría sobre la coincidencia.
3. **El término del título vale el doble que el de un tag.** Quien busca «mecha» y ve un título con
   «mecha» ha encontrado lo que buscaba.
4. **El reencuentro tiene excepción y umbrales con nombre.** Terminado al 90 % o más: fuera, sin
   excepción. Empezado por debajo del 50 % y hace más de 30 días: vuelve, con un peso que crece con el
   tiempo y no pasa de 1. Lo visto casi entero no vuelve ni con el tiempo: ya se vio.

**Dos fallos que encontraron las pruebas:** el índice de visionados se quedaba con el **más viejo** de
cada título —comparaba «días desde 1970», que daba siempre cero—, y la mutación que **sumaba** las
búsquedas sobrevivía porque el resultado se recorta a 1 y las sumas se saturaban. La segunda se cazó
midiendo dos búsquedas que encajan al máximo, donde la mejor da 0,5 y la suma daría 1.

**Tamaño:** M.

---

### T36 — MMR y razones en español

**Descripción:** Diversidad final y explicación legible de cada recomendación.

**Aceptación:**
- [x] Reranking MMR sobre tags con `lambda` 0,7 por defecto.
- [x] Dos títulos del mismo tag no copan el top 5, verificado por test.
- [x] `Reason` con `kind`, `text` y `evidence`; al menos una por recomendación del top 20.
- [x] Los textos están en el catálogo i18n, no incrustados en el código.
- [x] Ninguna razón con `text` vacío, verificado para el top 20 completo.

**Verificación:** `bun test packages/recsys` · 22 pruebas nuevas. Medido mutando la implementación: con
`lambda` 1 —sin diversidad— falla 1, con el parecido siempre cero 3, sin ordenar las razones 2 y con
una razón de texto vacío 3. Control: 0 fallos. Cobertura del paquete: 100 %.

**Depende de:** T35.

**Archivos:** `packages/recsys/src/{mmr.ts,reasons.ts,reasons.test.ts}`, `packages/recsys/src/i18n/es.ts`.

**Cuatro decisiones que conviene recordar:**

1. **MMR decide el orden, no cambia las puntuaciones.** Cambiarlas rompería la promesa de que la razón
   que se enseña sale del mismo cálculo que la puntuación.
2. **El parecido es Jaccard sobre las características.** Compartir un tag de tres se parece menos que
   compartir el único: contar sólo los comunes haría que un título con veinte tags fuera «parecido» a
   casi todo.
3. **La razón que se enseña es la de más peso, no la primera que aparezca.** Si alguien ve «está de
   moda» cuando lo que mandó fue su búsqueda de ayer, la explicación miente aunque los números estén
   bien.
4. **Una señal con peso cero no explica nada y no aparece.** Y si no queda ninguna, la genérica tiene
   texto: una razón con `text` vacío es peor que no tener ninguna, porque parece que la hay.

**Los textos viven en `src/i18n/es.ts`** con sus huecos `{...}`, y ninguna frase se construye
concatenando: concatenar es la forma de que una traducción acabe con el orden de palabras de otro
idioma. Hay una prueba que comprueba que ningún hueco queda sin rellenar.

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
