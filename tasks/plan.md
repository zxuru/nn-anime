# Implementation Plan: nn-anime v1

Estado: **para revisión humana** · 2026-10-10 · Specs aprobados en `6937fbe`, endurecidos tras
revisión de seguridad.
Tasks tracked in `tasks/todo.md` (55 tareas: T1–T47 más las insertadas T6a, T6b, T8a, T26a, T26b,
T26c, T29a y T31a). El índice completo de dependencias, generado desde los bloques de tarea, está al final
de `tasks/todo.md`.

## Overview

Construir la v1 completa de nn-anime: un comando que arranca un server local, abre una SPA en el
navegador, busca anime a través de proveedores enchufables, lo reproduce en la página o en mpv, y
recomienda de forma explicable usando sólo señales locales. Los datos de metadatos viven en
SQLite con caché y TTL; el video nunca se persiste. El repo no incluye scrapers: publica el
contrato de proveedor, el loader y un fixture propio con el que se verifica todo de punta a punta.

Alcance de este plan: los seis módulos aprobados más `core`. Las enmiendas `downloads` (v1.5) y
`metadata-enrichment` (sin fecha, sin aprobar) **no** se planifican aquí.

## Definition of Done (estándar permanente)

Todo task cierra este listón antes de darse por terminado:

- [ ] `bun run typecheck` sin errores en todos los paquetes.
- [ ] `bun run lint` sin errores ni advertencias nuevas.
- [ ] `bun test` verde en los paquetes tocados, con los tests nuevos incluidos.
- [ ] Criterios de aceptación del task marcados y verificados a mano.
- [ ] Sin `any` implícito, sin `@ts-ignore`, sin `as` para silenciar, sin tests saltados.
- [ ] Ninguna dependencia nueva fuera de la tabla de Tech Stack del spec.
- [ ] El task no toca más de 5 archivos de implementación.
- [ ] Commit atómico que cita el module id y el task.

Si algo de esto no se cumple, el task no está hecho: se corta o se divide, no se parchea.

## Architecture Decisions

1. **Los tipos de dominio viven en `core`, no en `provider-sdk`.** `packages/core/src/models.ts`
   posee `ProviderRef`, `AnimeDetail`, `Episode`, `StreamSource`, `SubtitleTrack`. El contrato
   `Provider` de `provider-sdk` los importa. Evita dos definiciones que se desincronizan; el spec
   de proyecto ya declara `core` como dueño del modelo.
2. **Sin paso de build para el servidor.** Bun ejecuta TypeScript directo. Sólo `packages/web`
   pasa por Vite. `bun run build` construye web y prepara el bundle del CLI.
3. **Composición por contenedor explícito.** `server/src/container.ts` construye las dependencias
   (store, registry, proxy, recsys) y las inyecta en las rutas. Sin framework de inyección.
   Los tests montan un contenedor con store en directorio temporal y provider fixture.
4. **La seguridad del server es middleware, no disciplina.** `host-guard` y `token-guard` se
   aplican a todo `/api/*` y `/stream/*` antes de cualquier handler. Un test recorre la tabla de
   rutas y falla si alguna quedó fuera de los guards. Esto convierte el criterio de seguridad en
   algo verificable en vez de confiable.
5. **Una sola conexión SQLite, escrituras serializadas.** `catalog-store` expone una cola de
   escritura interna. La revalidación de fondo y las peticiones HTTP comparten conexión, así que
   no hay contención sorpresa ni `SQLITE_BUSY` en producción. Los tests usan archivo temporal,
   nunca `:memory:`, porque WAL y migraciones se comportan distinto.
6. **SSE en lugar de sondeo.** Búsqueda incremental y estado de mpv usan Server-Sent Events.
   Menos código que WebSocket y alcanza para lo que se necesita: un mensaje por evento.
7. **Dev con dos procesos, producción con uno.** En desarrollo, Vite sirve la SPA y hace proxy de
   `/api` y `/stream` al server Bun en `127.0.0.1:7717`. En producción, el server Bun sirve el
   build estático y la API en el mismo origen. Un solo origen elimina CORS del camino crítico.
8. **El fixture simula un proveedor hostil.** `providers-fixture` no devuelve JSON lindo: simula
   latencia, redirects, headers obligatorios, playlist maestra HLS, subtítulo `srt`, 404, 500,
   timeout y un método que lanza. Si el código sobrevive al fixture, sobrevive a un sitio real.
9. **HLS se implementa contra playlists grabadas.** No se hace red en tests. Se versionan tres
   playlists de fixture: maestra con variantes, con `#EXT-X-KEY` y con `#EXT-X-DISCONTINUITY`.
   Si la reescritura de HLS se descontrola, el plan B está explícito en la tabla de riesgos.
10. **La seguridad es middleware, y el middleware no es la garantía.** Aplicar los guards en un
    solo lugar garantiza que ninguna ruta escape, y eso sí es verificable. La suficiencia no
    viene de ahí: viene de tres listas blancas (destinos del proxy, cabeceras de respuesta,
    cabeceras de petición) y de la CSP. Se añadieron seis tasks fundacionales —T6a, T6b, T26a,
    T26b, T29a y T31a— porque cinco de esos controles tienen que existir **antes** de T26 y T29,
    no después. Un hallazgo que no se convierte en criterio de aceptación es un hallazgo perdido.
11. **`SECURITY.md` declara el riesgo residual, no lo esconde.** Tres escenarios no se mitigan y
    se documentan como tales: un plugin instalado por el usuario, una extensión de navegador y
    cualquier programa que corra con los permisos del usuario. Decirlo es parte del diseño.

## Task List

### Fase 0 — Fundación
- [x] T1 Esqueleto del monorepo y tooling
- [x] T2 `core`: `Result`, errores y logger
- [x] T3 `core`: configuración, rutas XDG e i18n
- [x] T4 `core`: modelo de dominio y schemas Zod

### Checkpoint A — Fundación
- [x] `bun install && bun run typecheck && bun run lint && bun test` limpio
- [x] Verificado además en un checkout limpio (`git clone` a un directorio temporal): install 0,
      typecheck 0, lint 0, tests pasan, 0 fallan. La fundación es reproducible desde el repo.
- [x] Revisión adversarial de la fundación: cuatro defectos reales encontrados y corregidos con
      test que falla primero. Ver "Correcciones tras la revisión" abajo. 121 tests pasan.
- [x] Revisión humana antes de seguir (aprobado el Checkpoint A)

#### Correcciones tras la revisión adversarial del Checkpoint A

Ninguna cruza la puerta: son defectos *dentro* del artefacto que se está revisando.

| # | Defecto | Impacto | Corrección |
|---|---|---|---|
| 1 | `toJsonLine` extendía los campos del llamador sobre `ts`, `level` y `msg`: un campo llamado `level` cambiaba el nivel de la entrada en la línea serializada | Medio. Un log podía mentir sobre su propio nivel, y el filtrado por nivel en `jq` deja de ser fiable | Los campos van primero y los reservados ganan. Documentado en el encabezado del módulo |
| 2 | `sanitizeValue` marcaba como `[circular]` cualquier segunda referencia al mismo objeto, aunque no hubiera ciclo | Bajo pero corrosivo: `[circular]` es una etiqueta falsa, y quien depura un log deja de creerla | El objeto se marca sólo mientras se recorren sus descendientes y se desmarca al terminar |
| 3 | `scripts/workspaces.ts` calculaba `ROOT` con `new URL(...).pathname`, que percent-codifica | Alto para quien tenga un espacio en la ruta: `ROOT` apuntaba a `%20` y toda la herramienta de workspaces dejaba de encontrar los paquetes | `fileURLToPath` en una función `dirOfModule` testeable. Verificado ejecutando los scripts desde un directorio con espacio real |
| 4 | `ensureDirs` no tocaba el modo de un directorio que ya existía: si estaba en `0755`, se quedaba así | Medio, de seguridad: los datos quedaban legibles por otros usuarios, contra lo que dice el spec | `chmod 0700` tras el `mkdir`. Falla en lugar de seguir si no puede cerrarlo |

### Fase 1 — Arranque (cli-launcher + server shell)
- [x] T5 Parser de flags del CLI
- [x] T6 Server Hono con guards de seguridad y `/api/health`
- [x] T6a Bootstrap de sesión por cookie `HttpOnly` y comparación en tiempo constante
- [x] T6b Cabeceras de seguridad y CSP
- [x] T7 Cableado CLI → server: puerto, token, navegador, señales
- [x] T8 Esqueleto de la SPA: Vite, router, cliente API, tokens de estilo
- [x] T8a Servir la interfaz construida desde el server

### Checkpoint B — Arranque

#### Correcciones tras la revisión adversarial del Checkpoint B

Revisión delegada a contexto fresco sobre `795b04b`. Ninguna corrección cruza la puerta: son
defectos dentro del artefacto que se está revisando. Todas con test que falla primero.

| # | Defecto | Impacto | Corrección |
|---|---|---|---|
| 1 | `boot` analizaba la consulta posicional y la tiraba: `nn-anime naruto` abría la home | Alto. Es el caso de uso de arranque de `ani-cli` y un criterio de éxito del spec | El canje redirige a `/search?q=<consulta>`. El destino lo decide el servidor, no el cliente, y se valida como ruta local |
| 2 | `listenOnFreePort` capturaba cualquier error y lo leía como «puerto ocupado» | Medio. Un puerto fuera de rango o un fallo al montar la aplicación se reportaban como puerto ocupado y el error real desaparecía | Sólo `EADDRINUSE` justifica reintentar; el resto se reporta con su causa |
| 3 | En desarrollo, el proxy apunta a un puerto fijo pero el CLI podía mudarse de puerto en silencio | Medio. La interfaz cargaba y todas las llamadas a la API fallaban por conexión | Con `NN_ANIME_DEV_ORIGIN` puesto, no se permite reserva de puerto: falla de forma ruidosa |
| 4 | Los manejadores de señal se registraban después de arrancar el servidor | Medio a futuro. Un Ctrl+C en esa ventana se salta el cierre ordenado; en T29 dejaría un mpv vivo | La espera de señal se registra antes de arrancar |
| 5 | El cliente HTTP fijaba 8 s sin forma de subirlo | Medio a futuro. Trampa para la primera petición legítimamente lenta | `timeoutMs` por petición, con `0` para desactivarlo |
| 6 | `staticAssets` se montaba antes que las rutas: cualquier ruta nueva fuera de los prefijos protegidos quedaba inalcanzable | Bajo hoy, tercero de la misma clase | Se monta el último, y queda escrito que toda ruta nueva va antes |
| 7 | La comprobación de prefijo protegido usaba la ruta sin descodificar y el confinamiento la descodificada | Bajo. `/%61pi/health` se colaba entre las dos | Se descodifica una sola vez y las dos comprobaciones usan el mismo valor |
| 8 | Tres claves huérfanas en el catálogo de la interfaz y dos en el de `core` | Bajo, pero es deuda que crece | Eliminadas, y hay un test que falla si aparece una clave sin usar |
| 9 | `redeemed = true` antes de emitir la cookie | Bajo. Un fallo al emitirla dejaba el token gastado y al usuario sin sesión | La cookie se emite primero |
| 10 | T6 y T6a se commitearon juntos y superaron el tope de cinco archivos sin dejarlo escrito | Proceso. El registro del proyecto no contaba la verdad | Anotado en las dos tareas |

También se corrigieron, en la misma revisión, dos defectos que el revisor confirmó y que ya se
habían arreglado en esta ronda antes de recibir su informe: la ruta leída de `window.location` y
los dos `as` del cliente HTTP.

#### Segunda revisión: ¿los tests de las correcciones prueban algo?

Una segunda revisión delegada, sobre las correcciones y no sobre el código original, midió cada
veredicto **revirtiendo el arreglo en un clon y corriendo los tests**. Resultado: de 11 correcciones
con código, 8 tenían test que fallaba sin el arreglo, y 3 no tenían ninguno o el que tenían era
vacuamente cierto.

| Corrección | Veredicto de la revisión | Estado tras corregirlo |
|---|---|---|
| La consulta abre la búsqueda | Arregla, con test | — |
| `isPortBusy` y el `catch` desnudo | Arregla, con test | — |
| Sin reserva de puerto en desarrollo | Arregla, con test | — |
| Señales antes de arrancar | Arregla, **sin test** | Extraído `start.ts`; revertirlo ahora da **2 fallos** |
| Una sola descodificación | Arregla, **test vacuamente cierto** | El test pide `/%61pi/no-existe`; revertirlo da **1 fallo** |
| Estáticos al final | **Sólo tapaba** | Montaje movido a `withStaticAssets`; revertirlo da **1 fallo** |
| `redeemed` después de la cookie | Arregla, **sin test** | Servidor de sesión que falla al leerse; revertirlo da **1 fallo** |
| Ruta del enrutador y validación Zod | Arreglan, con test | — |

Los cuatro experimentos se corrieron con el mismo método que usó la revisión: clon, revertir,
medir, restaurar. El control sin revertir da 11 pass, 0 fail.

**Hallazgo propio de esa revisión, y el más incómodo:** había reintroducido `URL.pathname` en 14
sitios de los tests nuevos, el mismo defecto que había corregido en `scripts/workspaces.ts`. En un
directorio con un espacio, la lectura de archivos fallaba y el test de claves huérfanas acusaba al
catálogo. Verificado en un directorio con espacio real: antes 388 pasan y 7 fallan, después 397 y 0.

#### Tercera revisión: comportamiento especificado y no implementado

En vez de revisar código otra vez, se buscó **comportamiento que el spec pide y el código no
hace**. Es la clase de fallo que ya había aparecido dos veces —la consulta posicional y el token de
arranque en el log— y volvió a aparecer:

| # | Defecto | Impacto | Corrección |
|---|---|---|---|
| 11 | `configFile` se calculaba y **no se leía nunca**. El paso 2 del arranque del spec —cargar `config.json` si existe, con las banderas ganando— no existía | Alto. Un archivo de configuración que se ignora en silencio: el usuario cree haber configurado algo que no se aplica | Implementado, con esquema estricto en `core`, precedencia probada y error ruidoso que nombra el campo que falla |

Verificado en vivo: `{"port": 8123, "open": false}` hace que el servidor escuche en 8123 y no abra
el navegador; `--port 8321` gana; `{"puerto": 8080}` sale con 1 nombrando `puerto`. Los tests de
precedencia discriminan: invertirla da **2 fallos**.

También se cerró una asimetría que este trabajo destapó: `open` no se podía desactivar desde el
archivo porque la ausencia de la bandera y su valor por defecto eran indistinguibles.

#### Cuarta revisión: trazabilidad spec↔plan

Delegada a contexto fresco y con un encargo distinto de las anteriores: no revisar código, sino
comprobar **cada requisito normativo de los ocho documentos de spec contra los criterios de
aceptación de las 54 tareas**. Es la comprobación que convierte en método lo que hasta ahora
encontraba por casualidad.

Resultado: **11 huecos, 5 coberturas parciales y 3 contradicciones.** Las contradicciones no las
había visto nadie porque cada documento, leído solo, es coherente.

**Contradicciones, resueltas (manda el spec):**

| Contradicción | Resolución |
|---|---|
| `SPEC-provider-core` dice que un plugin no puede exportar `default` y `providers` a la vez; T10 decía que se fusionan | Se rechaza, nombrando el plugin |
| T16 decía «las once tablas»; el Data Model lista nueve | Nueve, y un test las cuenta contra la lista |
| `media-proxy` usaba `{Available: false}`; el resto del sistema usa `mpv: false` | Unificado en `mpv: false` |

**Huecos corregidos como código, no como promesa:**

- **`--provider` no lo usaba nadie.** Se analizaba, se fusionaba desde `config.json` y se tiraba:
  exactamente el defecto de la consulta posicional. Ahora viaja en la dirección del canje.
- **`url` y `coverUrl` del esquema de `core` eran `z.string().min(1)`**, así que `javascript:` y
  `data:` pasaban la frontera. El spec dice que el esquema se valida en la frontera y la frontera
  es `core`: si la comprobación viviera sólo en la interfaz, cualquier consumidor nuevo reabriría
  el agujero. Lista blanca de esquemas en los cuatro campos de URL.
- **El cliente HTTP no deduplicaba.** El spec pide un `Map` de promesas por clave de URL; sólo lo
  cubría la búsqueda. Implementado compartiendo lecturas en vuelo.
- **La cobertura objetivo del 80 % no la medía nadie.** Añadido `bun run test:coverage`.

  **Y el número hay que leerlo con su alcance.** `bun test --coverage` sólo mide los archivos que
  algún test carga: de 47 archivos de código, mide 36. El 98.28 % de líneas es de esos 36, no de
  todo el proyecto. Los once que no se cargan son cinco marcadores vacíos (`catalog-store`,
  `media-proxy`, `provider-sdk`, `providers-fixture` y `recsys`, que sólo tienen `export {}`), dos
  archivos de configuración o andamiaje (`vite.config.ts`, `db-migrate.ts`) y cuatro puntos de
  entrada o scripts que se ejecutan al importarse: `packages/cli/src/index.ts`,
  `packages/web/src/main.tsx`, `scripts/dev.ts` y `scripts/build.ts`.

  El que importa de esos cuatro es `cli/index.ts`: es el cableado de todo, y por eso la lógica se
  extrajo a `start.ts`, que sí está medido al 100 %. `main.tsx` monta React y necesita un DOM, que
  no está en la tabla de Tech Stack. Los otros dos son herramientas de desarrollo.

**Huecos resueltos asignándolos a una tarea:** la validación de entrada HTTP (T13), la agrupación
de duplicados y el prefetch acotado (T14), los tipos que el contrato del store nombraba sin
definirlos (T16-T21), el `pruneOrphans` al arrancar por encima de 200 MB (T21) y la lectura de `q`
y `provider` en la ruta de la SPA (T14).

**Dos huecos necesitaron decisión, no asignación:**

- **No existía ninguna ruta para portadas**, y `SPEC-web-ui.md` prohíbe en su sección Never
  incrustar recursos remotos. El contrato exigía algo sin dar el mecanismo. Se añade
  `GET /api/cover/:providerId/:ref`: el cliente manda una referencia, nunca una dirección, así que
  el navegador no puede convertirse en un proxy hacia donde quiera y la lista blanca de destinos
  sigue siendo la única puerta. Resuelve además el TTL de miniatura, que se declaraba sin ruta.
- **El nivel de pruebas de integración en `tests/` no lo creaba nadie.** El spec pide que cubra el
  ciclo buscar → detalle → episodios → resolver stream → cachear, y cada tarea sólo probaba su
  paquete. **Tarea nueva: T26c.** Total: 55 tareas.

**Riesgo residual aceptado y documentado, no corregido:** el token de arranque viaja como
argumento de `xdg-open` y es visible en `ps` durante un instante. La mitigación 12 habla de disco
y de logs, no de la lista de procesos. En una máquina de un solo usuario el impacto es nulo, y el
token es de un solo uso y caduca.

**Reverificación completa tras las correcciones**, con el servidor real y no sólo con tests:

| Comprobación | Producción | Desarrollo |
|---|---|---|
| Home y rutas del enrutador | 200 con el `index.html` | 200 por Vite |
| Recurso estático | 200 con su tipo de contenido | — |
| API sin cookie | 401 | 401 |
| Canje del token | 302 con cookie `HttpOnly`; destino `/` sin consulta y `/search?q=...` con ella | 302 con la misma cookie, a través del proxy |
| API con la cookie del canje | 200 JSON | 200 JSON |
| `Host` ajeno con cookie válida | 403 | 403 |
| `/%61pi/health` con sesión | Llega a la API, ya no devuelve HTML: la asimetría entre las dos normalizaciones está cerrada | — |
| Puerto 7717 ocupado | Cae a uno libre y lo informa | **Falla con el mensaje que lo explica**, en vez de mudarse en silencio y dejar la API inalcanzable |
| `kill -INT` | 130 | — |

**Anotado sin actuar, a propósito:** `logger.child`, `result.map`/`mapErr` y varios alias de tipo
no tienen consumidor todavía. Los consumen T10, T12 y T12 respectivamente; borrarlos ahora para
reescribirlos en dos tareas sería ruido. `WatchEventInput` no exige `positionS <= durationS`:
falta decidir si `durationS: 0` significa «desconocida», y esa decisión es de T32, con el proxy
delante.

**Y un hallazgo de T9 que se resuelve cuando toque:** los mensajes propios de Zod salen en inglés
(«Invalid input: expected boolean, received undefined»). Los que escribe el proyecto —el nombre del
header, el campo que falta en un método— sí están en español, así que el mensaje compuesto queda
mezclado. Zod 4 trae catálogos de idioma (`z.locales.es()`), medido: con `z.config(z.locales.es())`
el mismo problema sale «Entrada inválida: se esperaba booleano, recibido indefinido». Aplicarlo es
una línea, pero cambia los mensajes de todos los paquetes y merece decidirse cuando esos textos
lleguen a la interfaz, que es T10, no aquí.

### Revisión adversarial de la fase 1

Un revisor con contexto nuevo clonó el repo y **revirtió cada arreglo para medir si alguna prueba
fallaba**, en vez de leer el diff. Cuatro hallazgos eran reales y están corregidos; cada uno se
verificó aquí revirtiéndolo en una copia y midiendo el resultado.

| Hallazgo | Medición al revertirlo |
|---|---|
| `--provider " "` y `" x "` llegaban al filtro de la interfaz | 3 pruebas fallan |
| `httpUrlSchema` bendecía una cadena que `new URL` convierte en otra | 3 pruebas fallan |
| La deduplicación compartía la señal entre llamadores | 2 pruebas fallan |
| La entrada de deduplicación sobrevivía al final de la lectura | 0 pruebas fallan; es dependencia de orden, no un fallo reproducible a voluntad |

Los tres primeros son defectos: el cuarto se arregló igualmente porque la contaminación **se
observó** (dos pruebas de ese archivo fallaron por ella en una ejecución) y un `finally` suelto deja
una carrera abierta. Se dice tal cual: no hay prueba que lo discrimine por sí solo.

Además, cuatro cosas que el spec no fijaba de la ruta de portadas —el escapado de la referencia, de
dónde sale el nombre de archivo de la caché, el tipo de contenido y el tope de tamaño, y qué pasa si
la referencia no está cacheada— y dos de T26c: por qué frontera se ejerce el ciclo (rutas HTTP contra
`createApp`, no llamadas entre módulos) y que faltaba T23 en sus dependencias.

- [x] `bun run start` imprime la URL y sirve la home construida
- [x] Petición sin cookie de sesión: 401. Con `Host` ajeno y cookie válida: 403
- [x] El token de arranque sirve una sola vez y la URL queda limpia
- [x] Cada respuesta trae CSP, `nosniff`, `Referrer-Policy` y `X-Frame-Options`
- [x] Verificado también en desarrollo (`bun run dev`): Vite sirve la SPA y su proxy
      reenvía el canje, con los mismos guards sin relajar
- [x] Revisión humana antes de seguir (aprobado el Checkpoint B)

### Fase 2 — Proveedores
- [x] T9 `provider-sdk`: tipos, schema, registro, errores y test de conformidad
- [x] T10 `provider-sdk`: loader de plugins con aislamiento de fallos
- [x] T11 `providers-fixture` con contrato completo y modos de fallo
- [x] T12 Búsqueda agregada con timeout por proveedor y resultados parciales
- [x] T13 Rutas `/api/providers` y `/api/search` con SSE
- [x] T14 Página de búsqueda: grilla, etiqueta de origen, navegación por teclado
- [x] T15 Búsqueda incremental por SSE: esqueletos, cancelación, `aria-live`

### Checkpoint C — Proveedores
- [x] Buscar en la UI muestra resultados del fixture por proveedor, sin recargar
- [x] Un proveedor roto se reporta y no rompe la búsqueda: `/api/providers` lo lista como rechazado
      con su motivo y la búsqueda sigue emitiendo el resto
- Revisión humana: **no es parada dura**; el humano fijó las paradas en A, B, F y H

### Fase 3 — Persistencia
- [x] T16 Apertura de base, runner de migraciones y `0001-initial.sql`
- [x] T17 Repositorios de anime, episodios y búsqueda con cache-aside
- [x] T18 Repositorio de streams con TTL corto e invalidación
- [x] T19 Cola de revalidación con deduplicación y concurrencia 2
- [x] T20 Historial, progreso, favoritos y búsquedas recientes
- [x] T21 Ajustes, `pruneOrphans` y script `db:migrate`
- [x] T22 Cableado en el server y cabecera `X-Cache`

### Checkpoint D — Persistencia
- [x] Segunda ejecución sirve desde la base con 0 llamadas a proveedores, medido: la prueba reabre
      la base con un proceso y un proveedor nuevos, con el contador a cero, y la misma búsqueda sale
      de la base sin llamar a nadie. La mitad de «home y detalle» es de T38 y T23, que es donde
      existen esas rutas
- [x] `db:migrate` dos veces no cambia el esquema: en vivo, «Migraciones aplicadas: 1, 2, 3» y
      después «No hay migraciones pendientes», con 11 tablas y versión 3 las dos veces

### Fase 4 — Detalle (rebanada vertical)
- [x] T23 Detalle y episodios de extremo a extremo: proveedor → store → ruta
- [x] T24 Página de detalle: metadatos, episodios, sub/dub, favorito

### Checkpoint E — Detalle
- [x] Buscar → detalle → lista de episodios, con datos cacheados: las tres rutas pasan por
      `readThrough` y anuncian su origen en `X-Cache`; la pantalla de detalle consume las dos de
      metadatos y el favorito se persiste. La comprobación en navegador real es del e2e (T43)

### Fase 5 — Reproducción
- [x] T25 Almacén de tickets opacos en memoria
- [x] T26 Proxy de bytes con `Range`, streaming y abort
- [x] T26a Lista blanca de destinos del proxy y revalidación de redirecciones
- [x] T26b Saneamiento de respuestas: lista blanca de cabeceras y `Set-Cookie` fuera
- [x] T26c Pruebas de integración del ciclo completo
- [x] T27 Reescritura HLS: variantes y segmentos
- [x] T28 Reescritura HLS: claves, discontinuidad y límites
- [x] T29 Handoff a mpv: spawn, SSE de estado, fallback sin mpv, cierre
- [x] T29a Validación de headers hacia mpv y tope de un proceso concurrente
- [x] T30 Subtítulos: proxy y conversión `srt` a `vtt` en memoria
- [x] T31 Reproductor web con hls.js: reproducción, seek, atajos, a11y
- [x] T31a Lista blanca de esquemas para datos de proveedor en la interfaz
- [x] T32 Sub/dub, pista de subtítulos y registro de posición

### Checkpoint F — Reproducción
- [ ] El fixture se reproduce en la página y el seek funciona: **no se puede comprobar sin navegador
      y sin un upstream alcanzable**. Se acordó una excepción de loopback sólo en modo test para el
      e2e de T43, con la lista blanca intacta en producción
- [x] mpv abre, se controla por SSE y muere al cerrar la app: medido en vivo, con `--idle=yes` para
      que el proceso sobreviva a la falta de red y poder comprobar que `close()` lo mata
- [x] Decisión sobre HLS: se mantiene en v1, registrada en `docs/PLAN-B-HLS.md`

### Fase 6 — Recomendaciones
- [x] T33 Afinidad: vector, IDF y decaimiento temporal
- [x] T34 Co-visita: sesiones y pares
- [x] T35 Señal de búsqueda, exclusión y reglas de reencuentro
- [x] T36 MMR y generación de razones en español
- [x] T37 Fachada `recommend()`, determinismo y test de rendimiento
- [x] T38 Ruta `/api/recommendations` con candidatos del store y tendencias
- [ ] T39 Panel de recomendaciones en la home, con razones y refresco por búsqueda

### Checkpoint G — Recomendaciones
- [ ] Cada recomendación del top 20 muestra al menos una razón legible
- [ ] El panel cambia al buscar y es distinto del de arranque en frío

### Fase 7 — Pulido, seguridad y cierre
- [ ] T40 Página de ajustes: proveedores, rutas de datos, mpv, tema, enlace a `SECURITY.md`
- [ ] T41 Filas de la home: continuar, favoritos, tendencias, recomendaciones
- [ ] T42 Pasada de accesibilidad: foco, contraste, movimiento reducido, `aria-live`
- [ ] T43 Arneses Playwright y casos de home y búsqueda
- [ ] T44 Casos e2e de detalle, reproductor y recomendaciones
- [ ] T45 Tests de seguridad: sesión, `Host`, `Origin`, `Set-Cookie`, destinos internos, CSP,
      fuga de headers y de token en logs
- [ ] T46 Documentación: README, guía de autoría de plugins, aviso de seguridad, empaquetado npm
- [ ] T47 Auditoría de trazabilidad spec↔plan, y después el barrido de criterios de éxito

### Checkpoint H — Cierre v1
- [ ] Verificados y marcados todos los criterios de éxito del spec de proyecto
- [ ] `bun install && bun run build && bun test && bun run e2e` limpio en checkout nuevo
- [ ] Revisión humana y decisión sobre v1.5 (`downloads`)

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La reescritura de HLS se vuelve un pozo sin fondo: variantes, claves, discontinuidad, URLs relativas anidadas | Alto | T27 y T28 se limitan a tres playlists de fixture versionadas. Plan B explícito: en v1 sólo streams `file` (mp4) y HLS queda para v1.1. La decisión se toma en el Checkpoint F, no a mitad de camino |
| `mpv` cambia de comportamiento entre versiones y falla el spawn o los headers | Medio | T29 detecta la versión, valida con `--version`, y toda falla tiene salida: 503 y reproductor web. Nunca se depende de mpv para que la app arranque |
| Los plugins corren sin sandbox: un plugin malicioso lee la base y el historial | Medio | Riesgo aceptado y documentado, no mitigado con código. T46 exige el aviso en texto claro en README y en la UI de ajustes. Prohibido simular aislamiento con `node:vm` |
| El fixture es tan simple que esconde bugs que un sitio real sí dispara | Medio | Decisión 8: el fixture simula latencia, fallos, headers y playlists reales, con modos de fallo explícitos |
| SQLite con revalidación de fondo y peticiones HTTP produce `SQLITE_BUSY` | Medio | Decisión 5: una conexión, cola de escritura interna, `busy_timeout=5000`. T19 verifica con escrituras concurrentes |
| Playwright sobre Bun da problemas de integración | Bajo | T43 monta el arnés primero, contra el server ya arrancado. Si Bun falla, el runner de e2e puede correr con Node sin cambiar la app |
| La caché se convierte en precarga especulativa por la puerta de atrás | Medio | Sólo se cachea lo que una petición ya pidió. T22 verifica el contador de llamadas a proveedores y lo deja en 0 en la segunda ejecución |
| El alcance crece hacia v1.5 antes de cerrar v1 | Medio | `downloads` y `metadata-enrichment` no aparecen en ninguna tarea de este plan. Se abordan después del Checkpoint H |
| Una cookie de upstream contamina todo `127.0.0.1` y alcanza otros servicios locales | Alto | T26b elimina `Set-Cookie` siempre. T45 lo verifica con un upstream de fixture que la devuelve |
| Un XSS en la SPA compromete el server local, porque SPA y API comparten origen | Alto | T6b aplica CSP estricta y `nosniff`; T31a valida esquemas de URL de proveedor. T45 comprueba las cabeceras en toda respuesta |
| El proxy se convierte en pivote hacia la red interna o a metadata de nube | Alto | T26a implementa lista blanca de destinos con revalidación en cada salto. T45 prueba loopback, RFC1918 y link-local |
| La cookie `HttpOnly` obliga a defender CSRF, que antes cubría el token en JS | Medio | `SameSite=Strict` más `Origin` obligatorio en métodos mutantes, ambos en T6 y T6a |

## Paralelización

- **Secuencial obligatorio:** T1–T4 (fundación), T16 (migraciones), T27–T28 (reescritura HLS),
  todo lo que toca `container.ts`.
- **Paralelizable tras T9:** T11 (fixture) y T13 (rutas), si el contrato de `provider-sdk` está
  congelado.
- **Paralelizable tras T16:** T17, T18, T20, T21 tocan tablas distintas y repositorios distintos.
  Requieren coordinación para no chocar en `src/index.ts`.
- **Paralelizable tras T23:** T25–T26 (proxy) y T33–T37 (recsys) no comparten estado. `recsys`
  sólo depende de tipos y de filas ya persistidas.
- **Necesita contrato primero:** T12 y T38 comparten la forma de `Candidate` y `SearchResult`.
  El contrato se congela en T4 y T9 antes de paralelizar nada.

## Open Questions

1. ¿El plan B de HLS (sólo `file` en v1) se acepta por adelantado, o prefieres que HLS sea
   obligatorio y el Checkpoint F no pueda recortarlo? Se propone aceptarlo por adelantado.
2. ¿Los 47 tasks se ejecutan en una sola sesión larga o prefieres revisar después de cada
   checkpoint? Se propone parar en A, B, F y H como mínimo.
3. El plan no incluye tests de rendimiento del proxy con archivos grandes más allá del tope de
   RSS de 64 MB. ¿Alcanza?
