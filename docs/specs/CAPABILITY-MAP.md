# Capability Map: RoNa

Estado: **aprobado** por el humano el 2026-10-10 · Gate Fase 0 superado · **enmiendas de
`downloads` y `watch-party` incorporadas el 2026-11-15** (T219), con lo que el código ya traía.

Índice de specs: este mapa es la única fuente de verdad sobre qué módulos existen.
Cada módulo tiene su `SPEC-<module-id>.md` en `docs/specs/`, junto a este mapa —salvo los que
siguen en `proposals/`, que se señalan en «Interfaces en la frontera».

## Módulos

| Module id | Responsabilidad | Depende de | Paquete |
|---|---|---|---|
| `provider-core` | Interfaz de proveedor, registro, carga de plugins, búsqueda, detalle, episodios, resolución de streams | `core` | `packages/provider-sdk`, `packages/server` |
| `cli-launcher` | Binario que arranca el server local, migra la base, abre el navegador y maneja señales | `core`, `server` | `packages/cli` |
| `catalog-store` | SQLite local: metadatos cacheados con TTL, favoritos, historial, progreso, ajustes, migraciones | `core` | `packages/catalog-store` |
| `media-proxy` | Proxy de bytes y HLS con headers de upstream, reescritura de playlists, handoff y control de mpv | `core`, `provider-core` | `packages/media-proxy` |
| `recsys` | Motor de recomendación explicable sobre señales locales | `core`, `catalog-store` | `packages/recsys` |
| `downloads` | Descargas para ver sin conexión: cola persistente con reanudación, remux a MP4, gestión de espacio y borrado | `core`, `provider-core`, `catalog-store`, `media-proxy` | `packages/media-proxy` (motor), `packages/server` (cola y rutas), `packages/web` (interfaz) |
| `watch-party` | Sala de visionado sincronizada en la red local, con relevo del invitado | `core`, `server` | `packages/core` (protocolo), `packages/server` (coordinador LAN), `packages/web` (interfaz) |
| `web-ui` | SPA: home, búsqueda, detalle, reproductor web, panel de recomendaciones | `core`, los módulos de arriba vía HTTP | `packages/web` |
| `desktop` | Anfitrión de ventana: en Windows extrae y lanza el servidor embebido; en macOS y Linux lanza el que viaja a su lado. Abre la ventana y cierra el servidor al salir | `cli-launcher` | `desktop/` (**fuera de `packages/`**) |

Módulo auxiliar no listado como capacidad de producto:

- `core` — kernel compartido: tipos, errores, config, logger, resultado tipado. Sin dependencias.
- `providers-fixture` — proveedor de prueba sobre datos propios, para tests y e2e. Fuera de producción.
- `server` — composición HTTP de los módulos de arriba. No contiene lógica de dominio propia.

### `watch-party` es experimental

La sala es real y está en producción desde la 0.8.0, pero **está apagada por defecto**: sin
`RONA_PARTY=1` no se registra ninguna ruta `/api/party/*` —17 las cuenta el árbol—. Lo que hay
es el **modo LAN**: el invitado habla desde su propio servidor y el anfitrión le releva. Lo que
**no** hay es el modo P2P —la decisión **D3** sigue abierta—, ni la coincidencia de contenido, ni el
chat. Su contrato es `SPEC-watch-party.md`; su modelo de amenaza, `SECURITY.md`.

El resto de módulos del mapa no tienen esa condición: están encendidos siempre.

## Dirección de dependencias

```
core ──┬──> provider-core ──┬──> media-proxy ──┬──> downloads ──┐
       │                    │                  │              │
       ├──> catalog-store ──┴──> recsys ───────┼──> web-ui <───┤
       │                                       │              │
       └──────────────> cli-launcher ──────────┴──────────────┘

watch-party: `core` (protocolo y máquina de estados) + `server` (coordinador LAN).
`web-ui` lo consume por HTTP, igual que el resto.
```

Un solo sentido. Sin ciclos. `web-ui` no importa código de los otros módulos: sólo consume su
superficie HTTP. `recsys` no importa `provider-core`: recibe metadatos ya persistidos.
`downloads` no importa `web-ui` ni al revés: el motor vive en `media-proxy`, la cola en
`catalog-store` y la interfaz habla por HTTP, como todo lo demás.

`desktop` no aparece en el diagrama porque **no es una capacidad de producto**: consume
`cli-launcher` por su línea de arranque y su cierre por entrada estándar, y habla con la aplicación
**sólo por HTTP**, igual que un navegador. No importa código de `packages/` y vive fuera del
monorepo, en `desktop/`.

## Build order

1. `core` (kernel, sin gate de producto)
2. `cli-launcher` — shell delgado: server vacío + health check + apertura de navegador
3. `provider-core` — interfaz, loader, proveedor fixture, búsqueda y detalle
4. `catalog-store` — esquema, migraciones, cache-aside con TTL
5. `media-proxy` — proxy, reescritura HLS, mpv handoff
6. `recsys` — motor puro + tests sin red
7. `web-ui` — home, búsqueda, detalle, reproductor, panel de recomendaciones
8. `downloads` — cola persistente, motor de descarga con reanudación, remux y espacio en disco
9. `watch-party` — sala LAN con relevo del invitado; el modo P2P sigue sin estar

`cli-launcher` va antes que `provider-core` porque sin él no hay forma de levantar y verificar
ningún módulo de forma interactiva.

`downloads` y `watch-party` entran al final porque son **enmiendas**: los dos se propusieron
después de que el grafo de arriba ya funcionaba, y los dos llegaron al código con su decisión
tomada —**D2** para las descargas, el modo LAN para la sala—. El build order no se reescribe: dice
en qué orden se construyó la cosa, y por eso quedan los dos al final.

## Interfaces en la frontera

El contrato entre módulos vive en el spec del módulo proveedor:

- `Provider` y `StreamSource` → `SPEC-provider-core.md`
- API de repositorio de `catalog-store` → `SPEC-catalog-store.md`
- Contrato de respuesta de `recsys` → `SPEC-recsys.md`
- Superficie HTTP usada por `web-ui` → `SPEC-web-ui.md`, derivada de los anteriores
- Protocolo de la sala → `SPEC-watch-party.md`
- Descargas → [`proposals/SPEC-descargas.T181.md`](proposals/SPEC-descargas.T181.md), que sigue
  siendo una propuesta: sus decisiones —**D2**— están tomadas y su código está en producción, pero
  su integración al contrato canónico la hace su dueño, no este mapa

## Enmiendas pendientes de aprobación

**Ninguna fila de esta sección está aprobada.** No se escribe su spec ni su código hasta que el
humano apruebe la enmienda, y aprobarla cambia el build order de la sección anterior.

| Module id | Responsabilidad | Depende de | Cuándo |
|---|---|---|---|
| `metadata-enrichment` | Enriquecimiento de metadatos desde una fuente de metadatos con API pública, para alimentar `recsys` | `core`, `catalog-store` | opcional, sin fecha |

### La decisión sobre `metadata-enrichment` (2026-11-15)

**Se queda pendiente de aprobación**, y queda escrito por qué, porque antes este mapa afirmaba
una cosa y el árbol hacía otra.

- **Lo que propone la enmienda** es una fuente de metadatos con API pública —AniDB— para alimentar
  `recsys`, y **nada de eso está escrito**: no hay su spec, ni su código, ni su cliente. La
  verificación de sus términos sigue pendiente, y `SPEC-provider-core.md` la sigue marcando así.
- **Y TMDB ya no existe.** Estuvo como enriquecimiento **opcional** con la clave del usuario
  (`GET /api/anime/:providerId/:ref/metadata`) mientras la aplicación prometía imagen real. T372
  retiró ese alcance: no hay ruta, ni clave, ni sección en Ajustes, ni entrada en `SECURITY.md`.
  La aplicación sirve anime y películas de anime, y AniList cubre ese catálogo.
- Por eso la fila sigue en «pendientes» y no se pide la aprobación retrospectiva: **no hay código de
  `metadata-enrichment` que aprobar**.

### `downloads` salió de aquí el 2026-11-15

`downloads` estaba en esta tabla con la etiqueta «código sin abrir», y el código lleva en la release
desde la 0.4: 14 rutas `/api/downloads/*`, las migraciones `0014-descargas.sql` y
`0015-descarga-en-segmentos.sql`, el motor con ffmpeg y remux en `packages/media-proxy/src/download/`
y la cola en `packages/server/src/downloads/`. La decisión **D2** —MP4 primero, segmentos como
respaldo— la tomó el humano, y su spec está en
[`docs/specs/proposals/SPEC-descargas.T181.md`](proposals/SPEC-descargas.T181.md). Entra en el grafo
como capacidad, con su build order y sus dependencias.

### `watch-party` y su revisión

La capacidad entra en el grafo porque el código la sigue y el humano la pidió por escrito —es la
tarea 3.1 de `docs/roadmap.md`—, pero **la revisión formal de `SPEC-watch-party.md` sigue pendiente
de aprobación humana**. Lo que se aprueba aquí es el módulo y su lugar en el grafo; lo que queda
por aprobar es el documento del contrato, que dice exactamente qué queda fuera del modo LAN —P2P,
coincidencia de contenido y chat—.

## Fuera de alcance de toda la iniciativa

- Scrapers de sitios sin licencia dentro del repo. La capa de proveedores es una interfaz
  pública más un loader de plugins que el usuario instala por su cuenta.
- Cuentas de usuario, autenticación remota, servidor multiusuario.
- Cualquier servicio que requiera subir el historial de visionado a un tercero.
