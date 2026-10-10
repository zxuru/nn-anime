-- Marca de que la lista de episodios se pidió alguna vez.
--
-- El problema: la tabla `episode` no puede representar «se pidió la lista y no
-- había ninguno». Un título anunciado, con cero episodios, se guardaba como cero
-- filas, indistinguible de «nunca se pidió». Al escribir el detalle primero —que
-- es lo que hace la ruta de episodios para poder guardar la lista— aparecía la
-- fila del anime, y a partir de ahí la lista parecía ya pedida: se servía vacía
-- sin preguntar al proveedor. Se vio en una prueba de la ruta, con una lista de
-- episodios que llegaba a cero.
--
-- La marca va en el anime y no en una tabla nueva porque es un dato del título:
-- una fila por anime, dos columnas, y se lee en la misma consulta que ya se hace.

ALTER TABLE anime ADD COLUMN episodes_fetched_at INTEGER;
ALTER TABLE anime ADD COLUMN episodes_ttl_s INTEGER;
