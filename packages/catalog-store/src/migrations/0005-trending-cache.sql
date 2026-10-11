-- Caché de tendencias.
--
-- La auditoría de T47 lo encontró midiendo: la segunda carga de la home volvía a
-- llamar a `getTrending`, así que el criterio «la segunda ejecución no hace
-- llamadas de red» no se cumplía para la home. Las tendencias no estaban en la
-- tabla de TTL del spec y nadie las cacheaba.
--
-- La tabla es propia y no una entrada de `search_cache`: una búsqueda la pide el
-- usuario y una tendencia la pide la home sola, con vidas distintas y con un
-- significado distinto. Meterlas en la misma tabla con una clave reservada habría
-- sido un truco que el siguiente que la leyera tendría que descifrar.

CREATE TABLE trending_cache (
  provider_id  TEXT    NOT NULL,
  results_json TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL,
  PRIMARY KEY (provider_id)
);
