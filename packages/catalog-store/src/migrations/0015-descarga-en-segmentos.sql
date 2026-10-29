-- La descarga que quedó en segmentos se grababa como si fuera un archivo.
--
-- El motor distingue un MP4 (`kind` 'file') de una carpeta con playlist local
-- ('segments'), pero la fila nacía en 'file' —antes de resolver el stream— y el
-- `update` que debía corregirla no escribía la columna. Quedaban filas con la
-- ruta de un `index.m3u8` y `kind` 'file', que la ruta de servido leía como un
-- MP4: contestaba `video/mp4` con el texto del manifiesto y el reproductor no
-- abría nada.
--
-- La ruta delata el caso sin ambigüedad: el resultado de una descarga en
-- segmentos es siempre una playlist. Se corrige lo ya grabado para que las
-- descargas que el usuario tiene en disco se reproduzcan sin volver a bajarlas.
UPDATE download
   SET kind = 'segments'
 WHERE kind = 'file'
   AND path IS NOT NULL
   AND lower(path) LIKE '%.m3u8';
