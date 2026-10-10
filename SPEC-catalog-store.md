# Spec: catalog-store

Module id: `catalog-store` · Depende de: `core` · Paquete: `packages/catalog-store`
Convenciones heredadas de `SPEC-nn-anime.md`. El modelo de datos completo vive allí; este
documento define la API de repositorio y la política de caché.

## Objective

Ser el único dueño del estado persistente y la respuesta a "no recargar todo". Guarda
metadatos y señales, nunca video. Sirve lo que ya tiene y refresca en segundo plano sólo lo que
el usuario está mirando.

Éxito significa:

1. Reabrir la aplicación muestra home, búsqueda reciente y detalle sin una sola llamada de red,
   mientras el refresco ocurre por detrás.
2. Una respuesta stale se sirve de inmediato y se revalida en segundo plano; el usuario nunca
   espera por un dato que ya existía.
3. Nada se descarga en masa. El número de peticiones a proveedores es proporcional a lo que el
   usuario ve, no al tamaño del catálogo.
4. El historial de visionado es correcto y sirve como señal para `recsys`.
5. Correr las migraciones dos veces no cambia nada.

## Contrato

API de repositorio. Ningún otro paquete abre SQLite.

```ts
// packages/catalog-store/src/index.ts
export interface CatalogStore {
  // Caché de metadatos, cache-aside con TTL
  readAnime(ref: ProviderRef): Promise<CacheHit<AnimeDetail> | null>
  writeAnime(ref: ProviderRef, detail: AnimeDetail): Promise<void>
  readEpisodes(ref: ProviderRef): Promise<CacheHit<readonly Episode[]> | null>
  writeEpisodes(ref: ProviderRef, episodes: readonly Episode[]): Promise<void>
  readSearch(providerId: string, query: string): Promise<CacheHit<readonly SearchResult[]> | null>
  writeSearch(providerId: string, query: string, results: readonly SearchResult[]): Promise<void>

  // Streams: TTL corto, revalidación forzada antes de reproducir
  /**
   * Devuelve la fila cacheada. `headers` siempre viene sin definir: no se
   * persisten. Y devuelve `null` **también cuando el TTL venció**, no un
   * `CacheHit` con `stale`: un enlace de video caducado no es un dato un poco
   * viejo, es un 403 del upstream en mitad de la reproducción.
   */
  readStream(episodeRef: ProviderRef, mode: Mode): Promise<StreamSource | null>
  /**
   * Guarda URL, tipo, calidad y subtítulos. Los `headers` de la fuente se
   * descartan. La clave es (episodio, modo), así que se guarda **una** fuente:
   * la de la calidad pedida, o la primera que devolvió el proveedor, que es su
   * orden de preferencia. Elegir `hls` sobre `file` aquí sería una decisión de
   * reproducción tomada en la capa de persistencia.
   */
  writeStream(request: StreamRequest, sources: readonly StreamSource[]): Promise<void>
  invalidateStream(episodeRef: ProviderRef, mode: Mode): Promise<void>

  // Señales del usuario
  recordWatch(event: WatchEventInput): Promise<void>
  updateWatchPosition(eventId: number, positionS: number, durationS: number): Promise<void>
  listRecentlyWatched(limit: number): Promise<readonly WatchRecord[]>
  setFavorite(ref: ProviderRef, value: boolean): Promise<void>
  listFavorites(): Promise<readonly AnimeSummary[]>
  recordSearch(query: string, providerId: string, hits: number): Promise<void>
  listRecentSearches(limit: number): Promise<readonly SearchRecord[]>

  // Ajustes y mantenimiento
  getSetting<T>(key: string, fallback: T): Promise<T>
  setSetting(key: string, value: unknown): Promise<void>
  runMigrations(): Promise<MigrationReport>
  pruneOrphans(now: Date): Promise<PruneReport>
  close(): Promise<void>
}

export interface CacheHit<T> {
  readonly value: T
  readonly fetchedAt: Date
  readonly stale: boolean
  /** Presente cuando el dato sigue fresco, según el TTL del recurso. */
  readonly ttlS: number
}
```

Política de lectura, idéntica para todo recurso cacheado:

```
read(ref):
  fila = SELECT ... WHERE ref
  si no hay fila                 -> MISS        -> el llamador pide al proveedor y escribe
  si fetched_at + ttl > ahora    -> FRESH       -> devolver sin red
  si no                          -> STALE       -> devolver ya, y encolar revalidación
```

La revalidación es un trabajo de fondo con concurrencia máxima 2, deduplicado por clave. Si la
revalidación falla, la fila vieja se conserva y se marca `last_error`; nunca se borra un dato
bueno por un fallo de red.

`pruneOrphans` borra episodios y detalles `raw_json` cuyo anime no se haya visto ni buscado en
90 días, y todo `stream_cache` vencido hace más de 1 día. Es la única reducción de disco y se
ofrece como comando manual y como tarea al arrancar si la base supera 200 MB.

Esquema, migraciones y TTL: ver Data Model en `SPEC-nn-anime.md`. Las migraciones son archivos
`NNNN-nombre.sql` numerados, aplicados en una transacción, registrados en `schema_version`.

## Estructura del módulo

```
packages/catalog-store/
├─ src/index.ts               fachada CatalogStore
├─ src/db.ts                  apertura, WAL, foreign_keys, busy_timeout
├─ src/migrations/
│  ├─ 0001-initial.sql
│  └─ runner.ts
├─ src/repositories/
│  ├─ anime.ts  episodes.ts  search.ts  stream.ts  watch.ts  settings.ts
├─ src/cache-policy.ts        TTL por recurso, cálculo de stale
├─ src/revalidate.ts          cola de revalidación con deduplicación
└─ src/*.test.ts
```

## Success Criteria

- [ ] `runMigrations()` dos veces seguidas devuelve `applied: 0` la segunda vez.
- [ ] Escribir y leer un `AnimeDetail` conserva `genres`, `studios` y la ref original.
- [ ] Con TTL vencido, `readAnime` devuelve `stale: true` sin llamar a la red.
- [ ] La revalidación fallida conserva el dato viejo y no borra la fila.
- [ ] Dos lecturas stale de la misma clave encolan un solo trabajo de revalidación.
- [ ] `recordWatch` + `listRecentlyWatched` sobreviven a cerrar y reabrir la base.
- [ ] `pruneOrphans` borra un `stream_cache` vencido y no toca un anime visto hace 5 días.
- [ ] Con la base abierta, ningún otro paquete importa `bun:sqlite`:
      `grep -rn "bun:sqlite" packages --include=*.ts` sólo da resultados en este paquete.
- [ ] Los tests corren contra un directorio temporal y no tocan `$XDG_DATA_HOME`.

## Boundaries

**Always**

- Abrir la base con `journal_mode=WAL`, `foreign_keys=ON` y `busy_timeout=5000`.
- Escribir metadatos en transacción cuando se inserta un anime con sus géneros y episodios.
- Guardar todo timestamp en UTC, en segundos desde epoch, como entero.
- Versionar el esquema sólo con migraciones hacia adelante, nunca editando una ya aplicada.

**Ask first**

- Añadir o cambiar una tabla, columna o índice.
- Cambiar un TTL de la tabla del spec de proyecto.
- Meter cualquier precarga especulativa, aunque sea de un elemento.
- Cambiar la política de `pruneOrphans`.

**Never**

- Guardar bytes de video, miniaturas en la base ni rutas a archivos de video.
- Guardar headers de upstream, en claro o cifrados. Viven sólo en memoria del proceso, en
  `media-proxy`: una caché en disco con credenciales de un tercero es superficie de ataque, y la
  URL caduca en diez minutos igual que sus headers.
- Borrar datos del usuario por un fallo de red.
- Precargar por adelantado el catálogo de un proveedor.
- Emitir SQL concatenado con entrada del usuario: siempre sentencias preparadas.

## Open Questions

1. ¿La posición de reproducción se guarda cada cuántos segundos? Se propone cada 15 s y al
   pausar o cerrar, con escritura en la misma fila de `watch_event`.
2. ¿Se conserva `raw_json` del proveedor para poder mejorar el parser después, o se descarta
   para ahorrar disco? Se propone conservarlo 90 días.
3. ¿Hace falta exportar e importar el historial en JSON para respaldo? No está en v1.
