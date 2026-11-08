-- Caché de los intervalos saltable de AniSkip, por episodio.
--
-- Tabla propia y no una entrada de `anilist_media`: los intervalos son de un
-- **episodio**, no de la obra, y su clave natural es otra —el id de MAL, el número
-- de episodio y la duración redondeada—. La obra se empareja una vez y dura un
-- mes; cada episodio se pregunta aparte, y una serie de veintiséis capítulos
-- escribe veintiséis filas donde el emparejamiento escribe una.
--
-- La duración entra en la clave a propósito: AniSkip ajusta los intervalos a la
-- longitud que se le pasa, y el mismo episodio con otra duración es otra pregunta.
-- Redondeada porque un reproductor que conoce la duración con decimales no puede
-- crear una fila por cada décima.
--
-- `found` dice si AniSkip **conoció** el episodio, y no es lo mismo que «la lista
-- quedó vacía»: una obra sin intervalos publicados y un episodio que el índice no
-- tiene se responden igual al reproductor, pero no merecen la misma espera. El
-- TTL se guarda en la fila —un acierto vive un mes, un «no hay» seis horas y un
-- fallo quince minutos—, así que `found` es lo que permite explicar por qué la
-- fila caduca cuando caduca. En la lectura manda: una fila marcada como «no hay»
-- no enciende botones aunque el JSON traiga algo.
--
-- `intervals_json` guarda la lista ya normalizada —`{type, start, end}` del
-- contrato—, como el resto de las cachés: lo que entra por un tercero se valida
-- en la frontera, no se confía.

CREATE TABLE aniskip_cache (
  cache_key      TEXT    PRIMARY KEY,
  intervals_json TEXT    NOT NULL,
  found          INTEGER NOT NULL,
  fetched_at     INTEGER NOT NULL,
  ttl_s          INTEGER NOT NULL
);
