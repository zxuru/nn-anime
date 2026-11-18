-- Los títulos que ya se conocen, en una tabla que se consulta por columna.
--
-- `listRelated` y `listSources` encontraban sus candidatos recorriendo
-- `search_cache`, `trending_cache` y `feed_cache` con `json_each`: con 10 000
-- búsquedas de 24 resultados son 240 000 entradas por consulta, y dentro de un
-- array JSON no hay índice posible. Lo que la consulta necesita —el título, su
-- alternativa, la referencia, el año y el tipo— cabe en una fila.
--
-- La tabla la escriben los mismos `write` de las tres cachés, en su misma
-- transacción (`recordKnownTitles`), no un disparador: el runner de migraciones
-- prohíbe las sentencias que empiezan por `END`, y un `CREATE TRIGGER` lleva una
-- detrás. `updated_at` es el `fetched_at` de la fila que trajo el título, y el
-- `ON CONFLICT` sólo pisa si lo nuevo es igual o más reciente: un listado que
-- llega tarde no borra un dato que ya servía.
--
-- El respaldo rellena la tabla con lo que ya había en las tres cachés. Se hace
-- una vez, aquí, y no en el arranque: una migración que tarda es un despliegue
-- que se ve, y un arranque que recorre la caché entera es un arranque que no
-- termina. El `ORDER BY updated_at DESC` antes del `INSERT OR IGNORE` hace que
-- la primera fila de cada clave —la que se queda— sea la de la caché más
-- reciente, no la que SQLite leyera primero.
--
-- Sin índice sobre `title`: el `LIKE 'palabra%'` que usa la consulta no puede
-- aprovecharlo mientras el patrón venga de `json_each` (SQLite exige un literal
-- o un parámetro propio en el lado derecho para convertirlo en rango), y un
-- índice que no se usa sólo cuesta en cada escritura. La consulta recorre esta
-- tabla una vez, no las tres cachés con su JSON.
--
-- `json_each` va sobre un `CASE`: una fila que no sea JSON válido se lee como
-- lista vacía en vez de tumbar la migración. El respaldo de la 0021 no lo hacía,
-- y una caché corrupta dejaba el arranque en un error que se repite en cada
-- intento.

CREATE TABLE known_title (
  provider_id  TEXT    NOT NULL,
  provider_ref TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  title_alt    TEXT,
  cover_url    TEXT,
  year         INTEGER,
  kind         TEXT,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (provider_id, provider_ref)
);

INSERT OR IGNORE INTO known_title (
  provider_id, provider_ref, title, title_alt, cover_url, year, kind, updated_at
)
SELECT provider_id, provider_ref, title, title_alt, cover_url, year, kind, updated_at
FROM (
  SELECT
    sc.provider_id,
    json_extract(je.value, '$.ref.value') AS provider_ref,
    json_extract(je.value, '$.title')     AS title,
    json_extract(je.value, '$.titleAlt')  AS title_alt,
    json_extract(je.value, '$.coverUrl')  AS cover_url,
    json_extract(je.value, '$.year')      AS year,
    json_extract(je.value, '$.kind')      AS kind,
    sc.fetched_at                         AS updated_at
  FROM search_cache AS sc,
       json_each(CASE WHEN json_valid(sc.results_json) THEN sc.results_json ELSE '[]' END) AS je
  UNION ALL
  SELECT
    tc.provider_id,
    json_extract(je.value, '$.ref.value'),
    json_extract(je.value, '$.title'),
    json_extract(je.value, '$.titleAlt'),
    json_extract(je.value, '$.coverUrl'),
    json_extract(je.value, '$.year'),
    json_extract(je.value, '$.kind'),
    tc.fetched_at
  FROM trending_cache AS tc,
       json_each(CASE WHEN json_valid(tc.results_json) THEN tc.results_json ELSE '[]' END) AS je
  UNION ALL
  SELECT
    fc.provider_id,
    json_extract(je.value, '$.ref.value'),
    json_extract(je.value, '$.title'),
    json_extract(je.value, '$.titleAlt'),
    json_extract(je.value, '$.coverUrl'),
    json_extract(je.value, '$.year'),
    json_extract(je.value, '$.kind'),
    fc.fetched_at
  FROM feed_cache AS fc,
       json_each(CASE WHEN json_valid(fc.results_json) THEN fc.results_json ELSE '[]' END) AS je
)
WHERE provider_ref IS NOT NULL
  AND title IS NOT NULL
ORDER BY updated_at DESC;
