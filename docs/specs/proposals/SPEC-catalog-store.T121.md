# Propuesta: la caché local de AniList

Task: T121 · Spec afectado: `SPEC-catalog-store.md` (Data Model y tabla de TTL)

## El cambio exacto

Tres tablas nuevas —migración `0008-anilist.sql`, sólo hacia adelante— y cuatro TTL:

```sql
CREATE TABLE anilist_media (            -- el emparejamiento de una obra local
  title_key  TEXT    PRIMARY KEY,
  media_json TEXT,                      -- NULL es «se buscó y no hay»
  fetched_at INTEGER NOT NULL,
  ttl_s      INTEGER NOT NULL
);

CREATE TABLE anilist_list_cache (       -- el top y la parrilla
  query_key    TEXT    PRIMARY KEY,
  payload_json TEXT    NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_s        INTEGER NOT NULL
);

CREATE TABLE anilist_image (            -- la dirección de la imagen, por id
  media_id INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  url      TEXT    NOT NULL,
  PRIMARY KEY (media_id, kind)
);
```

| Recurso | TTL | Por qué |
|---|---|---|
| `anilistMedia` | 2 592 000 (30 días) | El título, la portada y la sinopsis de una obra no cambian |
| `anilistMiss` | 604 800 (7 días) | «Se buscó y no hay» es una respuesta y no se repite por nada |
| `anilistTop` | 21 600 (6 h) | Un ranking se mueve despacio |
| `anilistSchedule` | 1 800 (30 min) | Lo único que se mueve a diario |

Una lectura nueva en la fachada, `listLocalCandidates(names, limit)`: candidatos locales por nombre,
con la **misma** consulta preparada de los relacionados (`related.ts`), no una segunda.

## El motivo

Sin estas tablas, cada carga de la home volvería a preguntarle a un tercero por el mismo dato, y los
términos de uso de AniList prohíben usar su API «como servicio de respaldo o de almacenamiento»: la
caché es para **no repetir** una consulta que ya se hizo —TTL en cada fila y nada precargado—, no un
espejo de su catálogo.

`anilist_media` admite `NULL` en `media_json` a propósito: una fila sin valor es «esta obra se buscó
y no tiene equivalente», y una fila ausente es «no se ha buscado». Las dos cosas se leen distinto, y
sin la primera el «no hay» se vuelve a preguntar en cada carga.

`anilist_image` guarda direcciones de imagen **de un proveedor de metadatos**, no bytes: la ruta de
la imagen recibe `cover/<id>` y necesita resolverla contra algo, porque la CDN de AniList firma sus
URLs con un hash y el id solo no las compone.

## La alternativa descartada

**Una tabla genérica `anilist_cache(key, json)`**: mezcla tres vidas distintas —un mes, seis horas,
media hora— y una clave reservada, que es el truco que el propio spec ya rechazó al separar las
tendencias de la búsqueda (migración `0005`).

**Guardar los bytes de las imágenes**: el `Never` del spec prohíbe guardar bytes en disco, y una
caché HTTP con ETag ya resuelve la repetición.

## Lo que no cambia

- El almacén sigue siendo el único que abre SQLite; el cliente de AniList no lo toca.
- Toda escritura pasa por la cola de la fachada.
- Nada se poda por TTL al leer: se sirve vencido y se revalida, como el resto.
