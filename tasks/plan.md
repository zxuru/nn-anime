# Implementation Plan: nn-anime v1

Estado: **para revisión humana** · 2026-10-10 · Specs aprobados en `6937fbe`, endurecidos tras
revisión de seguridad.
Tasks tracked in `tasks/todo.md` (53 tareas: T1–T47 más las insertadas T6a, T6b, T26a, T26b,
T29a y T31a).

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
- [ ] Revisión humana antes de seguir

#### Correcciones tras la revisión adversarial del Checkpoint A

Ninguna cruza la puerta: son defectos *dentro* del artefacto que se está revisando.

| # | Defecto | Impacto | Corrección |
|---|---|---|---|
| 1 | `toJsonLine` extendía los campos del llamador sobre `ts`, `level` y `msg`: un campo llamado `level` cambiaba el nivel de la entrada en la línea serializada | Medio. Un log podía mentir sobre su propio nivel, y el filtrado por nivel en `jq` deja de ser fiable | Los campos van primero y los reservados ganan. Documentado en el encabezado del módulo |
| 2 | `sanitizeValue` marcaba como `[circular]` cualquier segunda referencia al mismo objeto, aunque no hubiera ciclo | Bajo pero corrosivo: `[circular]` es una etiqueta falsa, y quien depura un log deja de creerla | El objeto se marca sólo mientras se recorren sus descendientes y se desmarca al terminar |
| 3 | `scripts/workspaces.ts` calculaba `ROOT` con `new URL(...).pathname`, que percent-codifica | Alto para quien tenga un espacio en la ruta: `ROOT` apuntaba a `%20` y toda la herramienta de workspaces dejaba de encontrar los paquetes | `fileURLToPath` en una función `dirOfModule` testeable. Verificado ejecutando los scripts desde un directorio con espacio real |
| 4 | `ensureDirs` no tocaba el modo de un directorio que ya existía: si estaba en `0755`, se quedaba así | Medio, de seguridad: los datos quedaban legibles por otros usuarios, contra lo que dice el spec | `chmod 0700` tras el `mkdir`. Falla en lugar de seguir si no puede cerrarlo |

### Fase 1 — Arranque (cli-launcher + server shell)
- [ ] T5 Parser de flags del CLI
- [ ] T6 Server Hono con guards de seguridad y `/api/health`
- [ ] T6a Bootstrap de sesión por cookie `HttpOnly` y comparación en tiempo constante
- [ ] T6b Cabeceras de seguridad y CSP
- [ ] T7 Cableado CLI → server: puerto, token, navegador, señales
- [ ] T8 Esqueleto de la SPA: Vite, router, cliente API, tokens de estilo

### Checkpoint B — Arranque
- [ ] `bun run start` imprime URL y abre la home
- [ ] Petición sin cookie de sesión o con `Host` ajeno: 401 o 403
- [ ] El token de arranque sirve una sola vez y la URL queda limpia
- [ ] Toda respuesta trae CSP, `nosniff`, `Referrer-Policy` y `X-Frame-Options`

### Fase 2 — Proveedores
- [ ] T9 `provider-sdk`: tipos, schema, registro, errores y test de conformidad
- [ ] T10 `provider-sdk`: loader de plugins con aislamiento de fallos
- [ ] T11 `providers-fixture` con contrato completo y modos de fallo
- [ ] T12 Búsqueda agregada con timeout por proveedor y resultados parciales
- [ ] T13 Rutas `/api/providers` y `/api/search` con SSE
- [ ] T14 Página de búsqueda: grilla, etiqueta de origen, navegación por teclado
- [ ] T15 Búsqueda incremental por SSE: esqueletos, cancelación, `aria-live`

### Checkpoint C — Proveedores
- [ ] Buscar en la UI muestra resultados del fixture por proveedor, sin recargar
- [ ] Un proveedor roto no rompe la búsqueda

### Fase 3 — Persistencia
- [ ] T16 Apertura de base, runner de migraciones y `0001-initial.sql`
- [ ] T17 Repositorios de anime, episodios y búsqueda con cache-aside
- [ ] T18 Repositorio de streams con TTL corto e invalidación
- [ ] T19 Cola de revalidación con deduplicación y concurrencia 2
- [ ] T20 Historial, progreso, favoritos y búsquedas recientes
- [ ] T21 Ajustes, `pruneOrphans` y script `db:migrate`
- [ ] T22 Cableado en el server y cabecera `X-Cache`

### Checkpoint D — Persistencia
- [ ] Segunda ejecución sirve home y detalle con 0 llamadas a proveedores
- [ ] `db:migrate` dos veces no cambia el esquema

### Fase 4 — Detalle (rebanada vertical)
- [ ] T23 Detalle y episodios de extremo a extremo: proveedor → store → ruta
- [ ] T24 Página de detalle: metadatos, episodios, sub/dub, favorito

### Checkpoint E — Detalle
- [ ] Buscar → detalle → lista de episodios, con datos cacheados

### Fase 5 — Reproducción
- [ ] T25 Almacén de tickets opacos en memoria
- [ ] T26 Proxy de bytes con `Range`, streaming y abort
- [ ] T26a Lista blanca de destinos del proxy y revalidación de redirecciones
- [ ] T26b Saneamiento de respuestas: lista blanca de cabeceras y `Set-Cookie` fuera
- [ ] T27 Reescritura HLS: variantes y segmentos
- [ ] T28 Reescritura HLS: claves, discontinuidad y límites
- [ ] T29 Handoff a mpv: spawn, SSE de estado, fallback sin mpv, cierre
- [ ] T29a Validación de headers hacia mpv y tope de un proceso concurrente
- [ ] T30 Subtítulos: proxy y conversión `srt` a `vtt` en memoria
- [ ] T31 Reproductor web con hls.js: reproducción, seek, atajos, a11y
- [ ] T31a Lista blanca de esquemas para datos de proveedor en la interfaz
- [ ] T32 Sub/dub, pista de subtítulos y registro de posición

### Checkpoint F — Reproducción
- [ ] El fixture se reproduce en la página y el seek funciona
- [ ] mpv abre, se controla por SSE y muere al cerrar la app

### Fase 6 — Recomendaciones
- [ ] T33 Afinidad: vector, IDF y decaimiento temporal
- [ ] T34 Co-visita: sesiones y pares
- [ ] T35 Señal de búsqueda, exclusión y reglas de reencuentro
- [ ] T36 MMR y generación de razones en español
- [ ] T37 Fachada `recommend()`, determinismo y test de rendimiento
- [ ] T38 Ruta `/api/recommendations` con candidatos del store y tendencias
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
- [ ] T47 Barrido final de criterios de éxito de `SPEC-nn-anime.md`

### Checkpoint H — Cierre v1
- [ ] Todos los criterios de éxito del spec de proyecto verificados y marcados
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
