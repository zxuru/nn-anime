-- La marca de «ya visto» de una obra.
--
-- Una tabla propia y no una columna de `anime`, por el mismo motivo que el
-- favorito: la marca es del usuario y el refresco del proveedor reescribe la fila
-- del título, así que una columna la pisaría. La clave primaria —el anime— es
-- también lo que hace idempotente el botón: pulsarlo dos veces deja una fila.
--
-- **No escribe `watch_event`.** Fabricar un visionado por episodio para decir «la
-- vi» inventaría progreso que nadie hizo —una serie de mil capítulos tendría mil
-- filas— y ensuciaría la afinidad del motor, que se calcula con lo que de verdad
-- se reprodujo. La marca entra en el motor como lo que es: un estado visto, no una
-- medición.
--
-- Sin `fetched_at` ni `ttl_s`: que una obra se haya visto no se vence, así que el
-- refresco del proveedor no toca esta tabla. Y protegida de la poda, como el
-- favorito: ante la duda, se conserva lo que el usuario marcó a mano.

CREATE TABLE watched_title (
  anime_id   INTEGER PRIMARY KEY REFERENCES anime (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
