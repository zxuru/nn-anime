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
│  ├─ core/                       tipos, errores, config, logger, Result, i18n
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
- Un export por concepto. Sin barrels `index.ts` que reexporten todo el paquete.
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
stream_cache     episode_id, mode, url, kind, headers_json, subtitles_json,
                 quality, fetched_at, ttl_s
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
- Escribir en `$XDG_*` del usuario desde un test.

## Seguridad

El modelo de amenaza de esta aplicación no es un servidor expuesto, es el navegador local.
Un server HTTP en `127.0.0.1` es alcanzable por cualquier página web que el usuario visite.

Mitigaciones obligatorias, verificables:

1. Bind a `127.0.0.1` y validación del header `Host` contra `127.0.0.1:<puerto>` y `localhost:<puerto>`
   en cada request, para bloquear DNS rebinding.
2. Token de sesión aleatorio de 32 bytes generado en cada arranque. Viaja en la URL que se abre
   el navegador y se exige en toda ruta `/api/*` y `/stream/*`. Sin token, 401.
3. `Origin` comprobado en métodos mutantes. Sin CORS abierto: no se emite
   `Access-Control-Allow-Origin` salvo para el propio origen.
4. Los headers de upstream (referer, cookies, tokens del sitio del proveedor) nunca llegan al
   cliente web: viven sólo dentro del proceso, en `media-proxy`.
5. Al cerrar el proceso, el token se descarta. No se persiste en disco.

Los plugins de proveedor se ejecutan en el mismo proceso, con los mismos permisos que la
aplicación. No hay sandbox. Esto se documenta en la UI al instalar y en `SPEC-provider-core.md`.

## Success Criteria

- [ ] `bun install && bun run build && bun test` pasa en un checkout limpio sin red, salvo la
      instalación de dependencias.
- [ ] `bun run start` arranca, imprime una URL con token y abre el navegador.
- [ ] Una petición sin token o con `Host` ajeno recibe 401 y no filtra datos.
- [ ] Segunda ejecución: home y detalle se sirven desde la base sin llamadas de red, medido con
      el contador de peticiones a proveedores.
- [ ] El historial de visionado sobrevive a reiniciar el proceso.
- [ ] Cada recomendación incluye al menos una razón legible.
- [ ] `bun run db:migrate` es idempotente: correrlo dos veces no cambia el esquema.
- [ ] Los seis specs de módulo están aprobados.

## Decisiones cerradas

Cerradas por el humano el 2026-10-10. No se reabren sin aprobación explícita.

1. **Progreso de reproducción.** `catalog-store` registra siempre la posición, porque es señal
   de entrada para `recsys`. La reanudación automática y el autoplay del episodio siguiente
   quedan para v2. La home puede mostrar la fila "continuar viendo" sin reanudar sola.
2. **Internacionalización.** Interfaz en español en v1, con i18n real desde el primer commit.
   Ninguna cadena visible se incrusta en el código. El contrato vive en
   `packages/core/src/i18n.ts`: tipo `Locale`, tipo `Messages`, `t(locale, key, params)`,
   resolución de locale por `NN_ANIME_LANG` y fallback a `es`. Los paquetes con texto de cara al
   usuario (`web`, `cli`) exponen su propio `i18n/<locale>.ts`. Añadir un idioma debe ser copiar
   el archivo y traducirlo, sin tocar componentes.
3. **Distribución.** v1 se construye y se usa en local con `bun run build` y `bun run start`.
   La publicación en npm queda preparada y no ejecutada: desde el inicio, `package.json` del CLI
   declara `bin`, `files` y `publishConfig`, y el build genera un artefacto instalable.
   Publicar es un evento "Ask first". Objetivo de v1.5: `npm publish` y uso vía `bunx nn-anime`.

## Diferido a v1.5

- **Descarga offline.** Guardar episodios en disco con `ffmpeg`. No es un ajuste del
  `media-proxy` actual: implica persistencia de bytes de video, gestión de espacio, cola de
  trabajos y borrado. Es una capacidad nueva y necesita su propio spec y su propio gate.

## Enmiendas pendientes al mapa

`downloads` (v1.5) y `metadata-enrichment` (opcional) están propuestos y **no aprobados** en
`CAPABILITY-MAP.md`. Ninguno se especifica ni se implementa hasta que el humano apruebe la
enmienda.

## Open Questions

1. **Proveedor de metadatos.** AniDB aparece como candidato para `metadata-enrichment`. Falta
   verificar sus términos de uso y el registro de cliente de su API antes de comprometerse.
   No hay verificación de red hecha en esta sesión.
2. **Alcance de v1.5.** ¿Entra sólo `downloads`, o también `metadata-enrichment`? Se propone
   sólo `downloads`, porque `metadata-enrichment` depende de la verificación del punto 1.
3. **Idiomas objetivo después de `es`.** Se asume `en` primero. ¿Alguno más desde el principio?
