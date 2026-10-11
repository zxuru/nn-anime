# Capability Map: nn-anime

Estado: **aprobado** por el humano el 2026-10-10 · Gate Fase 0 superado.

Índice de specs: este mapa es la única fuente de verdad sobre qué módulos existen.
Cada módulo tiene su `SPEC-<module-id>.md` en `docs/specs/`, junto a este mapa.

## Módulos

| Module id | Responsabilidad | Depende de | Paquete |
|---|---|---|---|
| `provider-core` | Interfaz de proveedor, registro, carga de plugins, búsqueda, detalle, episodios, resolución de streams | `core` | `packages/provider-sdk`, `packages/server` |
| `cli-launcher` | Binario que arranca el server local, migra la base, abre el navegador y maneja señales | `core`, `server` | `packages/cli` |
| `catalog-store` | SQLite local: metadatos cacheados con TTL, favoritos, historial, progreso, ajustes, migraciones | `core` | `packages/catalog-store` |
| `media-proxy` | Proxy de bytes y HLS con headers de upstream, reescritura de playlists, handoff y control de mpv | `core`, `provider-core` | `packages/media-proxy` |
| `recsys` | Motor de recomendación explicable sobre señales locales | `core`, `catalog-store` | `packages/recsys` |
| `web-ui` | SPA: home, búsqueda, detalle, reproductor web, panel de recomendaciones | `core`, los 5 anteriores vía HTTP | `packages/web` |

Módulo auxiliar no listado como capacidad de producto:

- `core` — kernel compartido: tipos, errores, config, logger, resultado tipado. Sin dependencias.
- `providers-fixture` — proveedor de prueba sobre datos propios, para tests y e2e. Fuera de producción.
- `server` — composición HTTP de los seis módulos. No contiene lógica de dominio propia.

## Dirección de dependencias

```
core ──┬──> provider-core ──┬──> media-proxy ──┐
       │                    │                  │
       ├──> catalog-store ──┴──> recsys ───────┼──> web-ui
       │                                       │
       └──────────────> cli-launcher ──────────┘
```

Un solo sentido. Sin ciclos. `web-ui` no importa código de los otros módulos: sólo consume su
superficie HTTP. `recsys` no importa `provider-core`: recibe metadatos ya persistidos.

## Build order

1. `core` (kernel, sin gate de producto)
2. `cli-launcher` — shell delgado: server vacío + health check + apertura de navegador
3. `provider-core` — interfaz, loader, proveedor fixture, búsqueda y detalle
4. `catalog-store` — esquema, migraciones, cache-aside con TTL
5. `media-proxy` — proxy, reescritura HLS, mpv handoff
6. `recsys` — motor puro + tests sin red
7. `web-ui` — home, búsqueda, detalle, reproductor, panel de recomendaciones

`cli-launcher` va antes que `provider-core` porque sin él no hay forma de levantar y verificar
ningún módulo de forma interactiva.

## Interfaces en la frontera

El contrato entre módulos vive en el spec del módulo proveedor:

- `Provider` y `StreamSource` → `SPEC-provider-core.md`
- API de repositorio de `catalog-store` → `SPEC-catalog-store.md`
- Contrato de respuesta de `recsys` → `SPEC-recsys.md`
- Superficie HTTP usada por `web-ui` → `SPEC-web-ui.md`, derivada de los anteriores

## Enmiendas pendientes de aprobación

**Ninguna fila de esta sección está aprobada.** No se escribe su spec ni su código hasta que el
humano apruebe la enmienda, y aprobarla cambia el build order de la sección anterior.

| Module id | Responsabilidad | Depende de | Cuándo |
|---|---|---|---|
| `downloads` | Cola de descargas con ffmpeg, almacenamiento en disco, gestión de espacio y borrado | `core`, `provider-core`, `catalog-store`, `media-proxy` | v1.5 |
| `metadata-enrichment` | Enriquecimiento de metadatos desde una fuente de metadatos con API pública, para alimentar `recsys` | `core`, `catalog-store` | opcional, sin fecha |

`downloads` es la única capacidad nueva ya comprometida para v1.5. `metadata-enrichment` espera
la verificación de términos comentada en `SPEC-provider-core.md`.

## Fuera de alcance de toda la iniciativa

- Scrapers de sitios sin licencia dentro del repo. La capa de proveedores es una interfaz
  pública más un loader de plugins que el usuario instala por su cuenta.
- Cuentas de usuario, autenticación remota, servidor multiusuario.
- Cualquier servicio que requiera subir el historial de visionado a un tercero.
