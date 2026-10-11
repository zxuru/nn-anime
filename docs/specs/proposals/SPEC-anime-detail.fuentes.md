# SPEC-anime-detail.fuentes — la misma obra en otra fuente

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-anime-detail.md`, que
anota la aprobación y borra este archivo. Las tres decisiones —el selector en la ficha, una tarjeta
por obra en la home y la clave de título más año— las eligió quien pidió el cambio
(2026-10-11), con las alternativas delante.

## Qué cambia

La sección «`server` — dos rutas y un umbral» pasa a tres rutas:

```
GET /api/anime/:providerId/:ref/related   -> { items: AnimeSummary[] }
GET /api/anime/:providerId/:ref/sources   -> { items: AnimeSummary[] }
GET /api/anime/:providerId/:ref/watched   -> { episodes: WatchedEpisode[] }
```

`/sources` es local, como las otras dos: no llama al proveedor y no lleva `X-Cache`. Un proveedor
desconocido es 404 y una referencia que no está en la base es lista vacía. Devuelve **las otras
fuentes que tienen esta misma obra**, una entrada por proveedor, nunca la del `ref` pedido, con el
tope del servidor (`MAX_RELATED_LIMIT`, 24) y sin parámetro de límite en la consulta.

En «`web-ui` — la ficha», la barra lateral gana una sección:

```
.detail__aside   portada, acciones, modos, fuentes, géneros, estudios, relacionados
```

La sección «También en» pinta un botón por fuente —el nombre declarado por el proveedor, o su id si
no está cargado— y cada uno es un enlace a `/anime/<providerId>/<ref>` de **esa** fuente. Sin otras
fuentes la sección **no se pinta**.

## Por qué

La ficha conoce una sola referencia y hasta ahora no decía que la misma obra estuviera en otro sitio.
Medido sobre la base de desarrollo (dos proveedores activos, 51 fichas): hay **15 obras repetidas**
entre `jkanime` y `animeav1`, la mayoría sin año en ninguna de las dos fuentes.

La alternativa descartada era **fusionar las referencias**: una ficha por obra con la fuente elegida
dentro. Se descartó porque cada fuente tiene sus episodios, sus modos y su numeración; una ficha
fusionada tendría que inventarse cuál manda, y el modo elegido en una fuente no dice nada de la otra.
El enlace conserva lo que ya funciona: cada referencia es la suya y se elige antes de reproducir.

## Lo que no entra, y se dice

El selector **dentro del reproductor**. Cambiar de fuente a mitad de episodio pide mapear la
numeración de una fuente a la otra y decidir qué pasa con el segundo donde se iba; no se propone aquí.
