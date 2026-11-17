-- Esquema inicial del catálogo.
--
-- Nueve tablas, las del Data Model de `SPEC-nn-anime.md`. Un test las cuenta
-- contra esa lista para que no vuelvan a desviarse: la tarea que creó este
-- archivo decía «las once tablas» y el spec lista nueve.
--
-- Convenciones de este esquema:
--
-- - Los instantes (`fetched_at`, `applied_at`, `started_at`, `created_at`) son
--   milisegundos desde el epoch, como `Date.now()`. Los TTL son segundos, como
--   la tabla del spec. Mezclar unidades sin decirlo es cómo se calcula mal la
--   caducidad una vez y nadie lo nota hasta que un dato viejo se sirve como
--   fresco.
-- - Nada de bytes de video. Aquí sólo hay metadatos y señales; el proxy
--   transmite y descarta.
-- - `stream_cache` no tiene columna para los headers del upstream: viven sólo en
--   la memoria del proceso (mitigación 6). Una caché en disco con cookies de un
--   tercero es superficie de ataque a cambio de muy poco.

CREATE TABLE anime (
  id            INTEGER PRIMARY KEY,
  provider_id   TEXT    NOT NULL,
  provider_ref  TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  title_alt     TEXT,
  synopsis      TEXT,
  cover_url     TEXT,
  year          INTEGER,
  status        TEXT,
  episode_count INTEGER,
  fetched_at    INTEGER NOT NULL,
  ttl_s         INTEGER NOT NULL,
  raw_json      TEXT,
  UNIQUE (provider_id, provider_ref)
);

CREATE TABLE genre (
  anime_id INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  PRIMARY KEY (anime_id, name)
);

-- `provider_ref` es la referencia del episodio dentro del proveedor. El Data
-- Model del spec no la listaba, y sin ella `readEpisodes` no puede devolver la
-- forma que promete el contrato: `Episode` lleva `ref` y `animeRef`. Deducirla
-- del número de episodio sería inventar una convención que ningún proveedor
-- garantiza. Se añade al spec en el mismo commit.
CREATE TABLE episode (
  id           INTEGER PRIMARY KEY,
  anime_id     INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  provider_ref TEXT    NOT NULL,
  number       INTEGER NOT NULL,
  title        TEXT,
  duration_s   REAL,
  mode         TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL,
  UNIQUE (anime_id, provider_ref)
);

CREATE INDEX episode_por_anime ON episode (anime_id, number);

CREATE TABLE watch_event (
  id          INTEGER PRIMARY KEY,
  anime_id    INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  episode_id  INTEGER NOT NULL REFERENCES episode (id) ON DELETE CASCADE,
  provider_id TEXT    NOT NULL,
  mode        TEXT    NOT NULL,
  position_s  REAL    NOT NULL DEFAULT 0,
  duration_s  REAL    NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  finished    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX watch_event_por_fecha ON watch_event (started_at DESC);

CREATE TABLE favorite (
  anime_id   INTEGER PRIMARY KEY REFERENCES anime (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE search_history (
  id          INTEGER PRIMARY KEY,
  query       TEXT    NOT NULL,
  provider_id TEXT    NOT NULL,
  hits        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX search_history_por_fecha ON search_history (created_at DESC);

CREATE TABLE stream_cache (
  episode_id     INTEGER NOT NULL REFERENCES episode (id) ON DELETE CASCADE,
  mode           TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  quality        TEXT,
  subtitles_json TEXT,
  fetched_at     INTEGER NOT NULL,
  ttl_s          INTEGER NOT NULL,
  PRIMARY KEY (episode_id, mode)
);

CREATE INDEX stream_cache_por_fecha ON stream_cache (fetched_at);

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

-- El runner también se asegura de que exista, porque necesita anotar la versión
-- antes de ejecutar nada y porque una lista de migraciones inyectada en un test
-- puede no traerla. `IF NOT EXISTS` es lo que hace que las dos cosas convivan.
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
