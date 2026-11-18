-- Las portadas que ya se conocen, en una tabla que se consulta por clave.
--
-- `findCoverUrl` leía todos los listados cacheados de un proveedor y parseaba
-- cada `results_json`. Con 10 000 búsquedas de 24 resultados, una sola portada
-- costaba 284 ms después de T305 y 1 065 ms antes: la consulta no tiene índice
-- posible porque busca dentro de un array JSON.
--
-- La tabla la escriben los mismos `write` de las tres cachés, en su misma
-- transacción (`recordCovers`), no un disparador: el runner de migraciones
-- prohíbe las sentencias que empiezan por `END`, y un `CREATE TRIGGER` lleva una
-- detrás. `updated_at` es el `fetched_at` de la fila que trajo la portada, y el
-- `ON CONFLICT` sólo pisa si la nueva es más reciente: un listado viejo que llega
-- tarde no borra una URL que ya funcionaba.
--
-- El respaldo inicial rellena la tabla con lo que ya había en las cachés. Se
-- hace una vez, aquí, y no en el arranque: una migración que tarda es un
-- despliegue que se ve, y un arranque que recorre la caché entera es un arranque
-- que no termina.

CREATE TABLE known_cover (
  provider_id  TEXT    NOT NULL,
  provider_ref TEXT    NOT NULL,
  url          TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (provider_id, provider_ref)
);

INSERT OR IGNORE INTO known_cover (provider_id, provider_ref, url, updated_at)
SELECT
  sc.provider_id,
  json_extract(je.value, '$.ref.value'),
  json_extract(je.value, '$.coverUrl'),
  sc.fetched_at
FROM search_cache AS sc, json_each(sc.results_json) AS je
WHERE json_valid(sc.results_json)
  AND json_extract(je.value, '$.ref.value') IS NOT NULL
  AND json_extract(je.value, '$.coverUrl') IS NOT NULL;

INSERT OR IGNORE INTO known_cover (provider_id, provider_ref, url, updated_at)
SELECT
  tc.provider_id,
  json_extract(je.value, '$.ref.value'),
  json_extract(je.value, '$.coverUrl'),
  tc.fetched_at
FROM trending_cache AS tc, json_each(tc.results_json) AS je
WHERE json_valid(tc.results_json)
  AND json_extract(je.value, '$.ref.value') IS NOT NULL
  AND json_extract(je.value, '$.coverUrl') IS NOT NULL;

INSERT OR IGNORE INTO known_cover (provider_id, provider_ref, url, updated_at)
SELECT
  fc.provider_id,
  json_extract(je.value, '$.ref.value'),
  json_extract(je.value, '$.coverUrl'),
  fc.fetched_at
FROM feed_cache AS fc, json_each(fc.results_json) AS je
WHERE json_valid(fc.results_json)
  AND json_extract(je.value, '$.ref.value') IS NOT NULL
  AND json_extract(je.value, '$.coverUrl') IS NOT NULL;
