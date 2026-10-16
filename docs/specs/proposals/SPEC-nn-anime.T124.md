# Propuesta: la vida de la caché de relaciones de AniList

Task: T124 · Spec afectado: el modelo de datos y su tabla de TTL (`SPEC-nn-anime.md`; T121 lo propuso
en `SPEC-catalog-store.md`)

## El cambio exacto

Una fila más en la tabla de TTL y **ninguna tabla nueva**: las relaciones se guardan en
`anilist_list_cache`, con la clave `related:<id de AniList>` y el payload
`{ relation, media }[]`.

| Recurso | TTL | Revalidación |
|---|---|---|
| relaciones de AniList | 604800 (7 días) | caché normal; vencida se vuelve a pedir y, si falla, se sirve lo viejo |

Siete días y no un mes como el emparejamiento: lo que se guarda aquí es la **estructura de una
franquicia** —qué secuela tiene, qué precuela— y una secuela anunciada aparece cuando se anuncia. No
se parece a `anilistTop` (seis horas, un ranking se mueve) ni a `anilistSchedule` (media hora, lo
único que cambia a diario).

## Una nota de trazabilidad: las filas de T121 no están en la tabla

La tabla de TTL de `SPEC-nn-anime.md` sigue sin las cuatro entradas que T121 añadió al código
—`anilistMedia` 2 592 000, `anilistMiss` 604 800, `anilistTop` 21 600, `anilistSchedule` 1 800—: la
propuesta de T121 las declaró contra `SPEC-catalog-store.md`, que remite al modelo de datos, y ahí no
llegaron. Se aplican las cinco de una vez, o se quedan cinco TTL viviendo sólo en `cache-policy.ts`,
que es justo lo que el spec evita al tener la tabla.

## El motivo

Sin TTL, abrir la ficha de una obra preguntaría por sus relaciones en cada visita, y los términos de
uso de AniList prohíben usar su API «como servicio de respaldo o de almacenamiento». Con caché, la
segunda ficha de la misma obra —y la de cualquiera que comparta su id— no sale a la red.

Un payload de lista y no una tabla propia porque la pregunta es la misma que la del top y la parrilla
—«¿qué obras trae esta consulta?»— y la respuesta se compone igual: la pieza, más la media que la
ruta de la imagen necesita para resolver su portada.
