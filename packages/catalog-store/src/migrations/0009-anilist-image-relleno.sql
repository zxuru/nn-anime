-- Relleno de las direcciones de imagen de lo ya emparejado.
--
-- El problema: la ruta que sirve una imagen de AniList la resuelve **por id**
-- contra `anilist_image` —la CDN firma la dirección y el id solo no la compone—,
-- y el emparejamiento guardaba la obra en `anilist_media` sin escribir sus
-- direcciones. Las obras que llegaban por una lista sí las tenían —esa escritura
-- las guardaba—, pero las emparejadas por búsqueda, que son justo las que abre la
-- ficha, no: `/api/anilist/image/banner/<id>` contestaba 404 y la ficha se veía
-- con el icono de imagen rota del navegador y la portada caída al degradado.
--
-- Desde el arreglo las escribe `writeMedia`, en la misma escritura que la obra.
-- Esto rellena lo que ya estaba guardado, que si no espera al TTL de un mes para
-- volver a escribirse —o a que la obra se empareje otra vez— y la ficha sigue sin
-- imagen mientras tanto.
--
-- Se lee el JSON de la propia fila y no se reescribe `media_json`: la forma de la
-- obra no cambia, sólo faltaba su mitad en la otra tabla.

INSERT INTO anilist_image (media_id, kind, url)
SELECT json_extract(media_json, '$.id'), 'cover', json_extract(media_json, '$.coverUrl')
  FROM anilist_media
 WHERE media_json IS NOT NULL
   AND json_extract(media_json, '$.coverUrl') IS NOT NULL
ON CONFLICT (media_id, kind) DO NOTHING;

INSERT INTO anilist_image (media_id, kind, url)
SELECT json_extract(media_json, '$.id'), 'banner', json_extract(media_json, '$.bannerUrl')
  FROM anilist_media
 WHERE media_json IS NOT NULL
   AND json_extract(media_json, '$.bannerUrl') IS NOT NULL
ON CONFLICT (media_id, kind) DO NOTHING;
