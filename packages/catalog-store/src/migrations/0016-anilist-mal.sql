-- El id de MyAnimeList de lo emparejado, y el de AniList como índice.
--
-- AniSkip —los intervalos de intro y ending que pinta el reproductor— se pide por
-- el id de **MyAnimeList**, y el emparejamiento sólo guardaba el JSON de la obra.
-- La ruta de los saltos recibe un id de AniList y no tiene el título con el que
-- buscarlo, así que necesita la vuelta: de id de AniList a id de MAL. Leerla
-- parseando `media_json` de cada fila sería recorrer la tabla y decodificar una
-- obra entera por candidata; la clave primaria de `anilist_media` es el título
-- emparejado, que no sirve para esta pregunta.
--
-- `mal_id` es anulable y **no se rellena aquí** a propósito: las filas escritas
-- antes de esta columna no llevan el `malId` dentro del JSON —ésa es justo la
-- razón por la que el servidor vuelve a pedir el emparejamiento cuando el campo
-- no está—, así que un relleno no tendría de dónde sacarlo. `null` significa «se
-- preguntó y AniList dice que esa obra no tiene ficha de MAL»; la ausencia de
-- fila, «no se ha buscado». Una fila con `anilist_id` y sin `mal_id` es una caché
-- vieja y se refetchea.
--
-- El índice es de la consulta que existe —una, por id de AniList—: sin él, cada
-- petición de saltos recorre la caché entera del usuario.

ALTER TABLE anilist_media ADD COLUMN anilist_id INTEGER;
ALTER TABLE anilist_media ADD COLUMN mal_id INTEGER;

-- El id de AniList ya está dentro del JSON de cada emparejamiento: se copia a la
-- columna para que la vuelta funcione sin esperar a que la fila se reescriba,
-- que con el TTL de un mes puede tardar. Las filas de «se buscó y no hay»
-- (`media_json` nulo) no tienen id que copiar y se quedan sin él.
UPDATE anilist_media
   SET anilist_id = json_extract(media_json, '$.id')
 WHERE media_json IS NOT NULL;

CREATE INDEX anilist_media_por_anilist ON anilist_media (anilist_id);
