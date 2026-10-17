-- La marca de «quiero ver» de una obra.
--
-- Tercera marca del usuario, hermana del favorito y de la de visto, y con las
-- mismas decisiones que ellas: tabla propia y no una columna de `anime` —la marca
-- es del usuario y el refresco del proveedor reescribe la fila del título, así que
-- una columna la pisaría—, la clave primaria es el anime —que es lo que hace
-- idempotente el botón: pulsarlo dos veces deja una fila— y sin `fetched_at` ni
-- `ttl_s`, porque querer ver algo no se vence.
--
-- **Es independiente de `watched_title` y de `favorite`.** Marcar una obra como
-- vista no la saca de aquí, y ponerla aquí no la marca como vista: son tres listas
-- del usuario y ninguna escribe en otra. Acoplarlas sería inventar una regla que
-- nadie pidió y que, además, borraría una marca a mano sin decirlo.
--
-- Sin `watch_event`, como la de visto: «quiero ver» declara una intención, no un
-- visionado, y fabricar progreso que nadie hizo ensuciaría la afinidad del motor.
--
-- Protegida de la poda, como el favorito y la de visto: ante la duda, se conserva
-- lo que el usuario marcó a mano.

CREATE TABLE plan_to_watch (
  anime_id   INTEGER PRIMARY KEY REFERENCES anime (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
