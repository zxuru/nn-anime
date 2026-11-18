-- El audio con el que se pidió una descarga.
--
-- El motor resolvía siempre con `mode: 'sub'`. Un usuario de doblaje no podía
-- elegir, y una fuente que sólo tuviera dub fallaba sin decir por qué. Las filas
-- anteriores se quedan en `sub`, que es lo que se bajaron.

ALTER TABLE download ADD COLUMN mode TEXT NOT NULL DEFAULT 'sub';
