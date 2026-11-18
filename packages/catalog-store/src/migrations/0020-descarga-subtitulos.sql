-- Los subtítulos de una descarga.
--
-- Una pista por fila. Hasta ahora el motor bajaba el vídeo y tiraba las pistas
-- que la fuente declaraba, así que «ver sin conexión» era cierto para la imagen
-- y falso para el resto del episodio.
--
-- `indice` es la posición en la lista que devolvió el proveedor y la que viaja
-- en la URL de la interfaz: pedir una pista no obliga a adivinar su nombre.
-- `path` es relativa a la raíz de descargas, igual que la del vídeo, porque una
-- absoluta ataría la base a un disco que puede cambiar de sitio.
--
-- La cascada borra las filas con su descarga. Los **archivos** no los borra
-- SQLite: de eso se encarga la cola, que es quien conoce la raíz.

CREATE TABLE download_subtitle (
  download_id INTEGER NOT NULL REFERENCES download (id) ON DELETE CASCADE,
  indice      INTEGER NOT NULL,
  lang        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  format      TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (download_id, indice)
);
