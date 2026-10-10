-- Errores de revalidación, por recurso y clave.
--
-- El spec dice que una revalidación fallida «conserva la fila vieja y se marca
-- `last_error`», y no existía dónde marcarlo: ninguna de las diez tablas tenía
-- esa columna.
--
-- Va en una tabla propia y no en cuatro columnas nuevas —`anime`, `episode`,
-- `search_cache`, `stream_cache`— por dos razones. Una: son cuatro sitios donde
-- acordarse de limpiar el error cuando la revalidación sí funciona, y el que se
-- olvide deja un aviso rojo permanente sobre un dato que ya está bien. Y dos: el
-- error de la lista de episodios vive en el anime, así que compartirían columna
-- y se pisarían entre ellos. Aquí cada recurso tiene su fila.
--
-- Los errores son pocos y raros; la tabla se puede leer entera para la pantalla
-- de ajustes sin coste.

CREATE TABLE revalidate_error (
  resource TEXT    NOT NULL,
  key      TEXT    NOT NULL,
  message  TEXT    NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (resource, key)
);
