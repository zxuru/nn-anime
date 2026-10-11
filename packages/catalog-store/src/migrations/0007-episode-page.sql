-- Caché de las páginas de episodios.
--
-- Tabla propia y no la lista de `episode`: la lista completa se cachea seis
-- horas porque es lo que tarda en cambiar un catálogo, y una **página** se cachea
-- cinco minutos porque es lo que se está mirando ahora mismo. Son dos preguntas
-- distintas —«qué episodios tiene esta serie» y «qué hay en esta ventana del
-- selector»— y una sola tabla obligaría a que una de las dos fingiera el TTL de
-- la otra.
--
-- El JSON guarda los episodios ya validados con `episodeSchema`, como el resto de
-- las cachés: lo que entra por el plugin es entrada no confiable, y la frontera
-- se comprueba al escribir y al leer.
--
-- `anime_id` es la clave foránea y no la referencia del proveedor: la página
-- pertenece a un título, y sin fila del anime la escritura falla nombrando lo que
-- falta, igual que en `replaceEpisodes`.

CREATE TABLE episode_page (
  anime_id      INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL,
  episodes_json TEXT    NOT NULL,
  has_more      INTEGER NOT NULL,
  total         INTEGER,
  fetched_at    INTEGER NOT NULL,
  ttl_s         INTEGER NOT NULL,
  PRIMARY KEY (anime_id, page)
);
