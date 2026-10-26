-- La temporada del episodio, cuando la fuente numera por temporada.
--
-- Nullable y sin valor por defecto: las filas que ya existen se leen con el
-- marcador del título (`T2 E1`), que es lo que hacían antes de esta columna, y un
-- `UPDATE` de relleno inventaría temporadas que la fuente no declaró.
--
-- No se toca `watch_event`: guarda `episode_id`, así que la temporada y la
-- referencia real del episodio se leen del `JOIN` con `episode`.

ALTER TABLE episode ADD COLUMN season INTEGER;
