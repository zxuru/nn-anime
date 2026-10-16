-- Las referencias que constan como contenido para adultos.
--
-- Una tabla propia y no una columna de `anime`, aunque la marca sea de la obra: la
-- aprende el emparejamiento de AniList, y la obra **puede no tener fila** —una
-- novedad del feed de un título que nadie ha abierto no la tiene—, así que una
-- columna obligaría a inventar un `anime` con un detalle de mentira y una caducidad
-- que miente para poder escribirla.
--
-- La marca es de la **referencia** y no de la caché: que una obra sea para adultos
-- no se vence, así que esta tabla no tiene `fetched_at` ni `ttl_s` y el refresco del
-- proveedor no la toca. La clave primaria es también el índice de las dos consultas
-- que hay: la de una referencia y la de un lote.

CREATE TABLE adult_ref (
  provider_id TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  PRIMARY KEY (provider_id, provider_ref)
);
