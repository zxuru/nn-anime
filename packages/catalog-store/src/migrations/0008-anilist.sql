-- Caché de AniList: lo emparejado, lo listado y las imágenes que lo acompañan.
--
-- Tres tablas y no una, porque caducan distinto y significan cosas distintas: un
-- emparejamiento de título con su obra dura un mes —el título de una obra no
-- cambia—, la lista del top unas horas, y la parrilla media hora. Meterlas en la
-- misma tabla con una clave reservada habría sido el truco que el siguiente
-- tendría que descifrar, que es la razón que ya se escribió al separar las
-- tendencias de la búsqueda (0005).
--
-- `media_json` admite NULL, y no es un descuido: la fila **sin** valor es «esta
-- obra se buscó y no tiene equivalente en AniList», y se guarda para no volver a
-- preguntarlo en cada carga de la home. Una fila ausente es «no se ha buscado
-- todavía»: las dos cosas se leen distinto y por eso no se pueden confundir.
--
-- `anilist_image` guarda la **dirección** de la imagen por id, porque la ruta que
-- la sirve recibe la referencia —`/api/anilist/image/cover/<id>`— y no puede
-- construirla: la CDN de AniList la firma con un hash y el id solo no la compone.
-- Es una tabla de direcciones de un proveedor de metadatos, no de bytes.

CREATE TABLE anilist_media (
  title_key  TEXT    PRIMARY KEY,
  media_json TEXT,
  fetched_at INTEGER NOT NULL,
  ttl_s      INTEGER NOT NULL
);

CREATE TABLE anilist_list_cache (
  query_key    TEXT    PRIMARY KEY,
  payload_json TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL
);

CREATE TABLE anilist_image (
  media_id INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  url      TEXT    NOT NULL,
  PRIMARY KEY (media_id, kind)
);
