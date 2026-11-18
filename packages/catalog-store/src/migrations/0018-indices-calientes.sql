-- Índices de las consultas que crecen con el uso.
--
-- El historial hace una subconsulta por `episode_id` y ordena por fecha; la home
-- ordena el catálogo por `fetched_at`; y la búsqueda por género filtra por
-- `name`, que no era la primera columna de la clave primaria. Ninguno cambia el
-- esquema: son índices y se pueden reconstruir.

CREATE INDEX IF NOT EXISTS watch_event_por_episodio
  ON watch_event (episode_id, started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS anime_por_fetch
  ON anime (fetched_at DESC);

CREATE INDEX IF NOT EXISTS genre_por_nombre
  ON genre (name);
