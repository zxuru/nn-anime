-- Caché del feed de novedades.
--
-- Tabla propia y no una entrada de `trending_cache`: las dos las pide la home
-- sola, pero no son lo mismo. Un feed trae **cuándo** se publicó cada cosa y se
-- lee para ordenar por novedad; las tendencias son una lista curada sin fechas.
-- Meterlas juntas obligaría a que una de las dos fingiera el campo que no tiene,
-- y el que leyera la tabla tendría que adivinar cuál de las dos formas espera.
--
-- El TTL es más largo que el de las tendencias (1800 s frente a 900): un feed
-- cambia como mucho a diario y cada consulta es una petición al sitio de otro.

CREATE TABLE feed_cache (
  provider_id  TEXT    NOT NULL,
  results_json TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL,
  PRIMARY KEY (provider_id)
);
