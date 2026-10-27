-- La cola de descargas.
--
-- Una fila por episodio, no por intento: volver a pedir algo ya descargado no
-- duplica el archivo ni el trabajo. `episode_ref` es la identidad real del
-- episodio (la misma que usa el visionado), y `provider_ref` es el título.
--
-- `path` es relativa a la raíz de descargas y la escribe sólo el motor. `kind`
-- distingue el archivo único (`file`), el HLS remezclado (`hls`) y el respaldo de
-- segmentos (`segments`). Los bytes son un dato de progreso, no de verdad: el
-- tamaño final lo dice el sistema de archivos.

CREATE TABLE download (
  id            INTEGER PRIMARY KEY,
  provider_id   TEXT    NOT NULL,
  provider_ref  TEXT    NOT NULL,
  episode_ref   TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  episode_label TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  path          TEXT,
  bytes         INTEGER NOT NULL DEFAULT 0,
  total_bytes   INTEGER,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (provider_id, episode_ref)
);

CREATE INDEX download_por_estado ON download (status, created_at DESC);
