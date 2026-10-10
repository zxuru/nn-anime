# Spec: nn-anime (proyecto)

Estado: borrador para aprobación · 2026-10-10 · Gate: `CAPABILITY-MAP.md` aprobado.

Las convenciones compartidas de este documento aplican a los seis specs de módulo.
Cada spec de módulo define sólo su objetivo, contrato, criterios y límites propios.

## Objective

Aplicación local de escritorio-adjacent para ver anime con interfaz gráfica, que se comporta
como `ani-cli` en el arranque: un comando levanta todo y abre una página en el navegador.

El usuario es una sola persona, en su máquina, con su propio historial. No hay servidor remoto
ni cuentas.

Éxito significa:

1. `nn-anime` arranca en menos de 2 s, abre el navegador en `http://127.0.0.1:<puerto>` y
   muestra contenido útil sin ningún paso manual.
2. El usuario busca un anime, ve el detalle, elige episodio y modo sub o dub, y lo reproduce
   dentro de la página o lo lanza a mpv.
3. El sistema recomienda animes concordantes con lo que el usuario va buscando y viendo, con
   una razón legible por recomendación.
4. Nunca se recarga todo el contenido. Sólo se persiste lo que hizo falta para funcionar:
   metadatos vistos, historial, favoritos y ajustes. El video jamás se persiste.
5. Al reabrir la aplicación, el estado anterior está ahí sin volver a pedirlo a la red.

## Tech Stack

| Pieza | Elección | Versión objetivo |
|---|---|---|
| Runtime | Bun | 1.4.x |
| Lenguaje | TypeScript estricto | 5.9+ |
| Workspaces | Bun workspaces | — |
| HTTP server | Hono sobre `Bun.serve` | Hono 4.x |
| UI | React + Vite | React 19, Vite 7 |
| Base de datos | `bun:sqlite` en modo WAL | integrado |
| Validación | Zod | 4.x |
| Reproductor web | `hls.js` sobre `<video>` | 1.6+ |
| Reproductor externo | `mpv` (proceso hijo) | 0.41+ |
| Lint y formato | Biome | 2.x |
| Tests | `bun test` + Playwright para e2e | — |

Sin dependencias fuera de esta tabla sin pasar por el límite "Ask first".

## Commands

```bash
bun install                     # instalar dependencias del workspace
bun run dev                     # server (watch) + Vite dev server, todo en un comando
bun run build                   # build de web + bundle de server y cli
bun run start                   # arrancar el binario construido
bun run typecheck               # tsc --noEmit sobre todos los paquetes
bun run lint                    # biome check .
bun run lint:fix                # biome check --write .
bun test                        # tests unitarios y de integración
bun test packages/recsys        # tests de un paquete
bun run e2e                     # Playwright contra el server con providers-fixture
bun run db:migrate              # aplicar migraciones pendientes (idempotente)
```

## Project Structure

```
nn-anime/
├─ CAPABILITY-MAP.md              mapa aprobado de módulos
├─ SPEC-nn-anime.md               este documento
├─ SPEC-<module-id>.md            un spec por módulo
├─ tasks/                         plan.md y todo.md (Fase 2 y 3)
├─ package.json                   workspaces y scripts raíz
├─ biome.json
├─ tsconfig.base.json
├─ packages/
│  ├─ core/                       result, errors, logger, config, settings, i18n,
│  │                              models y schema del dominio
│  ├─ provider-sdk/               interfaz Provider, registro, loader de plugins
│  ├─ catalog-store/              SQLite, migraciones, repositorios, política de caché
│  ├─ media-proxy/                proxy de bytes y HLS, control de mpv
│  ├─ recsys/                     motor de recomendación, funciones puras
│  ├─ server/                     app Hono, rutas, SSE, composición
│  ├─ web/                        SPA React (index.html + src/)
│  ├─ cli/                        binario `nn-anime`
│  └─ providers-fixture/          proveedor de prueba sobre datos propios
└─ tests/                         integración entre paquetes
```

Rutas de datos en tiempo de ejecución, nunca dentro del repo:

```
$XDG_CONFIG_HOME/nn-anime/providers/     plugins del usuario (*.ts, *.js, *.mjs)
$XDG_CONFIG_HOME/nn-anime/config.json    ajustes de proceso
$XDG_DATA_HOME/nn-anime/nn-anime.db      base SQLite
$XDG_CACHE_HOME/nn-anime/                caché desechable (playlists HLS, miniaturas)
```

## Code Style

TypeScript estricto. Sin `any` implícito, sin `as` para silenciar tipos, sin `@ts-ignore`.
Errores como valores en las fronteras de red y disco; excepciones sólo para bugs de programa.

```ts
// packages/provider-sdk/src/provider.ts
import type { Provider } from './types'

export interface SearchOptions {
  readonly limit?: number
  readonly signal?: AbortSignal
}

export type Result<T, E = ProviderError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

/**
 * Busca títulos en el proveedor.
 * Devuelve Result y nunca lanza: un proveedor caído no debe tumbar la búsqueda agregada.
 */
export async function search(
  provider: Provider,
  query: string,
  options: SearchOptions = {},
): Promise<Result<readonly SearchResult[]>> {
  const { limit = 30, signal } = options
  if (query.trim() === '') return { ok: true, value: [] }

  try {
    const value = await provider.search(query, { limit, signal })
    return { ok: true, value }
  } catch (cause) {
    return { ok: false, error: ProviderError.from(provider.id, 'search', cause) }
  }
}
```

Convenciones:

- Archivos y directorios en `kebab-case`. Tipos y componentes en `PascalCase`.
- Funciones y variables en `camelCase`. Constantes de módulo en `SCREAMING_SNAKE_CASE`.
- Un export por concepto. El `index.ts` de un paquete es su **superficie pública curada**: enumera
  a mano lo que es contrato y no reexporta el árbol del paquete. Un `export *` no se usa nunca, ni
  siquiera entre módulos del mismo paquete.
- Preferir `readonly` y tipos de unión sobre flags booleanos.
- Comentarios en español, identificadores en inglés. Los comentarios explican el porqué, no el qué.
- Sin `console.log` fuera de `packages/core/src/logger.ts`.

## Data Model

Contrato compartido entre `catalog-store`, `recsys` y `server`. Vive en `packages/core/src/models.ts`.

```
anime            id, provider_id, provider_ref, title, title_alt, synopsis, cover_url,
                 year, status, episode_count, fetched_at, ttl_s, raw_json
genre            anime_id, name
episode          id, anime_id, number, title, duration_s, mode, fetched_at, ttl_s
watch_event      id, anime_id, episode_id, provider_id, mode, position_s, duration_s,
                 started_at, finished
favorite         anime_id, created_at
search_history   id, query, provider_id, hits, created_at
stream_cache     episode_id, mode, url, kind, quality, subtitles_json,
                 fetched_at, ttl_s
setting          key, value_json
schema_version   version, applied_at
```

TTL por tipo de recurso, en segundos:

| Recurso | TTL | Revalidación |
|---|---|---|
| búsqueda | 900 | stale-while-revalidate |
| detalle de anime | 86400 | stale-while-revalidate |
| lista de episodios | 21600 | stale-while-revalidate |
| URL de stream | 600 | revalidación forzada antes de reproducir |
| miniatura | 604800 | caché HTTP normal |

Regla dura del modelo: la base guarda metadatos y señales, nunca bytes de video. El proxy
transmite y descarta.

**Los headers de upstream no se persisten, y `stream_cache` no tiene columna para ellos.** La
mitigación 6 dice que viven sólo en memoria del proceso; una columna `headers_json` la
contradecía, y una caché en disco con cookies o tokens de referencia de un tercero es superficie
de ataque a cambio de muy poco: la URL caduca en diez minutos igual que sus headers. Quien los
necesite los pide al almacén en memoria de `media-proxy`; si ya no están, el proxy revalida contra
el proveedor. La miniatura de subtítulos sí se persiste: son etiquetas y direcciones, no secretos.

## Testing Strategy

Tres niveles, con `bun test` por defecto.

- **Unitario** — junto al archivo, `*.test.ts`. Obligatorio para `core`, `catalog-store`,
  `recsys`, `provider-sdk` y la reescritura HLS de `media-proxy`. `recsys` debe poder testearse
  con una base en memoria y cero red.
- **Integración** — en `tests/`. Base SQLite temporal, proveedor fixture, sin red externa.
  Cubre el ciclo buscar → detalle → episodios → resolver stream → cachear.
- **e2e** — Playwright en `packages/web/e2e/`. Sólo el shell: home, búsqueda, detalle,
  recomendaciones y arranque del reproductor con un stream local. Un e2e que dependa de un
  tercero en internet es un test roto.

Cobertura objetivo: 80 % en `core`, `catalog-store`, `recsys` y `provider-sdk`. Sin umbral
numérico para `web` y `media-proxy`: se exige el caso feliz y un caso de fallo por ruta.

Ningún test puede tocar la red. Si un test necesita red, se sustituye por un fixture. Los
tests no leen ni escriben en `$XDG_*` real: se inyecta un directorio temporal.

## Boundaries

**Always**

- `bun run typecheck`, `bun run lint` y `bun test` antes de cada commit.
- Validar con Zod toda entrada HTTP y toda respuesta de proveedor antes de persistirla.
- Escribir en la base sólo través de `catalog-store`; ningún otro paquete abre SQLite.
- Escuchar únicamente en `127.0.0.1`. Nunca `0.0.0.0`.
- Mantener la regla de caché: nada se descarga en masa ni de forma especulativa.
- Registrar en `watch_event` sólo lo que el usuario reprodujo de verdad.

**Ask first**

- Añadir una dependencia fuera de la tabla de Tech Stack.
- Cambiar el esquema de la base o el TTL de un recurso.
- Cambiar el contrato de `Provider` o el formato de datos del plugin.
- Publicar o distribuir el binario, y publicar el paquete en npm.
- Cambiar el contrato de i18n o el conjunto de locales soportados.
- Añadir cualquier llamada saliente a un servicio de terceros que no sea un proveedor
  configurado por el usuario.

**Never**

- Incluir scrapers de sitios sin licencia en el repo.
- Persistir bytes de video, ni hacer de espejo de contenido.
- Enviar el historial del usuario a ningún lado.
- Desactivar la verificación de tipos, el linter o un test para que pase el build.
- Registrar headers de upstream o tokens en los logs.
- Guardar el token de sesión en `localStorage`, en `sessionStorage` o en una cookie accesible por
  JavaScript.
- Copiar cabeceras de respuesta de un upstream, incluida `Set-Cookie`.
- Añadir una ruta que no pase por los guards de `Host`, sesión y `Origin`.
- Escribir en `$XDG_*` del usuario desde un test.

## Seguridad

El modelo de amenaza de esta aplicación no es un servidor expuesto, es el navegador local.
Un server HTTP en `127.0.0.1` es alcanzable por cualquier página web que el usuario visite.

Criterio de aceptación de seguridad, en una frase: **una página web arbitraria que el usuario
visite no debe poder leer datos, cambiar estado ni hacer que el proceso actúe en su nombre.**

Mitigaciones obligatorias. Todas son verificables por un test.

1. **Bind y `Host`.** Escuchar sólo en `127.0.0.1`. Validar el header `Host` contra
   `127.0.0.1:<puerto>` y `localhost:<puerto>` en cada request. Bloquea DNS rebinding.
2. **Sesión por cookie `HttpOnly`.** El CLI abre el navegador con un token de arranque de un solo
   uso. El server lo canjea por una cookie `HttpOnly; SameSite=Strict; Path=/`, redirige a `/`
   con URL limpia y quema el token de arranque, que además caduca a los cinco minutos: la URL
   queda en el scrollback de la terminal y no debe seguir valiendo horas después. El token de
   sesión nunca vuelve a tocar
   JavaScript, así que un XSS en la propia interfaz no puede exfiltrarlo. Sin cookie válida, 401.
3. **Comparación en tiempo constante.** La cookie se compara con `crypto.timingSafeEqual` sobre
   buffers de igual longitud. Nada de `===`.
4. **`Origin` en métodos mutantes.** `Origin` ausente, `null` o ajeno: 403. Sin CORS abierto: no
   se emite `Access-Control-Allow-Origin` en ninguna respuesta.
5. **Cabeceras de seguridad en toda respuesta de la SPA.** `Content-Security-Policy` estricta
   (`default-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self';
   frame-ancestors 'none'; base-uri 'none'; object-src 'none'`), `X-Content-Type-Options:
   nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. Sin CSP, un XSS en la
   interfaz es compromiso total del server local, porque la SPA y la API comparten origen.
6. **Cabeceras de upstream confinadas.** Los headers del sitio del proveedor nunca llegan al
   cliente web: viven sólo en memoria del proceso, en `media-proxy`. Un test barre todas las
   rutas y falla si alguno aparece en una respuesta.
7. **Respuestas de upstream saneadas.** `media-proxy` reenvía sólo una lista blanca de cabeceras
   de respuesta y **elimina `Set-Cookie` siempre**. Las cookies ignoran el puerto: un upstream
   hostil podría escribir cookies para todo `127.0.0.1` y contaminar cualquier otro servicio
   local del usuario. El `Content-Type` se fuerza desde lo que se pidió, no se copia.
8. **Lista blanca de destinos.** El proxy sólo acepta `http` y `https`. Por defecto rechaza
   loopback, RFC1918, link-local y metadata de nube. Cada salto de redirección se revalida con la
   misma lista y hay tope de saltos. Cierra SSRF.
9. **Confinamiento de rutas.** El server estático y las rutas de caché normalizan y confinan a su
   raíz, y rechazan symlinks que apunten afuera.
10. **Sin inyección hacia mpv.** Los nombres y valores de header se validan con una expresión
    estricta que rechaza caracteres de control antes de construir cualquier argumento. Los
    argumentos van en array, nunca por shell. Tope de un mpv concurrente.
11. **Datos de proveedor tratados como hostiles en la interfaz.** Toda URL que venga de un
    proveedor pasa por una lista blanca de esquemas `http`/`https` o se renderiza como texto
    plano. `dangerouslySetInnerHTML` está prohibido sobre datos de proveedor.
12. **Sin persistencia de secretos.** Al cerrar el proceso se descartan cookie y token. El token
    no se escribe en disco ni en logs, en ningún nivel.

Los plugins de proveedor se ejecutan en el mismo proceso, con los mismos permisos que la
aplicación. **No hay sandbox.** Esto se documenta en la UI al instalar, en `SECURITY.md` y en
`SPEC-provider-core.md`.

### Riesgo residual, explícito

Ninguna de las mitigaciones de arriba cubre estos casos, y no se van a cubrir:

| Escenario | Estado | Motivo |
|---|---|---|
| Una página web que el usuario visita | Mitigado | Es el criterio de aceptación de esta sección |
| Otro usuario local de la máquina | Mitigado | Puede conectar a `127.0.0.1`, no tiene la cookie |
| Un plugin que el usuario instala | **No mitigado, por diseño** | Un plugin es código arbitrario con los permisos del usuario. Lee la base, el historial y el disco |
| Una extensión de navegador con permisos amplios | **No mitigado** | Puede leer la cookie, el DOM y el historial |
| Un programa que corra como el usuario | **No mitigado** | Puede leer la base y la memoria del proceso |

`SECURITY.md` debe decir esto en texto claro, y `/settings` debe enlazarlo.

## Success Criteria

Estado a `cc53d31`: **seis verificados, siete pendientes por diseño.** Cada pendiente nombra la
tarea que lo cierra. T47 hace el barrido final y comprueba que ninguno se quedó por el camino.

- [x] `bun install && bun run build && bun test` pasa en un checkout limpio sin red, salvo la
      instalación de dependencias. **Verificado** con `git clone` a un directorio temporal:
      install 0, build 0, 395 tests pasan, typecheck 0, lint 0 sin infos.
- [x] `bun run start` arranca, imprime una URL con token y abre el navegador. **Verificado**: en la
      comprobación de T8 el navegador abrió Firefox de verdad y consumió el token, que es la prueba
      de que el flujo funciona con un navegador y no sólo con `curl`.
- [x] Una petición sin cookie de sesión válida o con `Host` ajeno recibe 401 o 403 y no filtra
      datos. Ninguna ruta de `/api/*` ni `/stream/*` escapa a los guards. **Verificado** con el test
      de tabla de rutas y con `curl` contra el servidor en los dos modos.
- [x] El token de arranque sirve una sola vez: un segundo uso devuelve 401. **Verificado** en vivo,
      y además caduca a los cinco minutos.
- [ ] Ninguna respuesta contiene `Set-Cookie` de origen upstream ni cabeceras de upstream.
      → **T26b**, cuando exista el proxy.
- [x] La SPA se sirve con CSP, `nosniff`, `Referrer-Policy: no-referrer` y `X-Frame-Options`.
      **Verificado** en toda respuesta, incluidas las que cortan los guards y las que no existen.
- [ ] El proxy rechaza `http://127.0.0.1:22`, `http://169.254.169.254/` y `file:///etc/passwd`, y
      revalida la lista blanca en cada salto de redirección. → **T26a**.
- [ ] `SECURITY.md` existe, describe el modelo de amenaza y el riesgo residual, y `/settings` lo
      enlaza. → **T46** el documento, **T40** el enlace.
- [ ] Segunda ejecución: home y detalle se sirven desde la base sin llamadas de red, medido con el
      contador de peticiones a proveedores. → **T22**. Necesita `catalog-store`.
- [ ] El historial de visionado sobrevive a reiniciar el proceso. → **T20**.
- [ ] Cada recomendación incluye al menos una razón legible. → **T36** el motor, **T39** el panel.
- [ ] `bun run db:migrate` es idempotente: correrlo dos veces no cambia el esquema. → **T16** el
      runner, **T21** el comando. Hoy el comando existe, resuelve y **se niega a salir con 0**
      diciendo que todavía no hay base de datos que migrar: un comando de base de datos que dice
      «todo bien» sin haber hecho nada es peor que uno que falla.
- [x] Los seis specs de módulo están aprobados. **Verificado**: aprobados por el humano.

## Open Questions

1. **Proveedor de metadatos.** AniDB aparece como candidato para `metadata-enrichment`. Falta
   verificar sus términos de uso y el registro de cliente de su API antes de comprometerse.
   No hay verificación de red hecha en esta sesión.
2. **Alcance de v1.5.** ¿Entra sólo `downloads`, o también `metadata-enrichment`? Se propone
   sólo `downloads`, porque `metadata-enrichment` depende de la verificación del punto 1.
3. **Idiomas objetivo después de `es`.** Se asume `en` primero. ¿Alguno más desde el principio?
4. **¿Sobra `stream_cache`?** `media-proxy` ya guarda URL y headers en memoria, con tope de 500
   entradas y vida de 600 s. Persistir además la URL en SQLite sólo sirve para sobrevivir a un
   reinicio dentro de esos diez minutos, y a cambio deja en disco una dirección que puede llevar
   token. La alternativa es quitar la tabla y la tarea T18, y dejar la caché de streams
   enteramente en memoria. Es una decisión de alcance y la tiene que tomar el humano.
