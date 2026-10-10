-- Caché de resultados de búsqueda.
--
-- El Data Model del spec listaba nueve tablas y ninguna guardaba esto, pero el
-- contrato del store promete `readSearch`/`writeSearch` con TTL de 900 s, y la
-- tabla de TTL reserva una entrada para «búsqueda». Sin una tabla, esas dos
-- funciones no tienen dónde escribir.
--
-- Va en una migración nueva y no editando la 0001: una migración ya aplicada no
-- se toca. Editarla daría dos esquemas distintos con el mismo número de versión,
-- que es la forma más silenciosa de romper una base en marcha.

CREATE TABLE search_cache (
  provider_id  TEXT    NOT NULL,
  query        TEXT    NOT NULL,
  results_json TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL,
  PRIMARY KEY (provider_id, query)
);

CREATE INDEX search_cache_por_fecha ON search_cache (fetched_at);
