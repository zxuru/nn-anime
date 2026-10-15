# Propuesta: saber qué referencia es para adultos

Task: T128 · Spec afectado: `SPEC-catalog-store.md` · Estado: pendiente de que lo integre el dueño
del spec.

## El cambio exacto

1. **Migración `0010-adulto.sql`: `ALTER TABLE anime ADD COLUMN adult INTEGER NOT NULL DEFAULT 0`.**
   La tabla `anime` ya tiene una fila por referencia de proveedor conocida, y esa fila es la que
   leen todos los consumidores que pueden enseñar una obra: `favorites`, `recent` (seguir viendo),
   los candidatos del motor y los relacionados.
2. **El almacén gana la escritura y la lectura del dato, y ninguna de las dos decide por su
   cuenta.** La escritura marca una referencia cuando el enriquecimiento trae una obra que AniList
   declara para adultos; la lectura excluye las marcadas **cuando quien cablea la ruta se lo pide**
   —el ajuste lo lee el servidor, que es quien lo conoce—. El almacén no consulta ajustes desde
   dentro de sus consultas: la misma fila se lee desde sitios que sí deben verla, como la ficha del
   título que el usuario ya abrió.
3. **La marca es de la referencia, no del título.** El enriquecimiento sabe de las dos cosas a la
   vez —la petición `POST /api/enrichment` lleva referencias y la respuesta trae la obra—, así que
   se guarda donde sirve: `provider_id` y `provider_ref` ya son la clave única de `anime`, y el
   historial y los favoritos guardan referencias. Guardarlo por título obligaría a normalizar dos
   veces el mismo nombre para encontrarlo.

## El motivo

El punto 5 de la propuesta de `discovery` descarta lo marcado en la frontera, y eso basta para las
listas de AniList, que se reconstruyen de la respuesta. **No basta para las filas que salen de la
base**: una recomendación, un favorito o un «seguir viendo» son filas del almacén, y ahí no hay
entrada de AniList que consultar sin salir a la red por cada candidato. La única forma de que el
estado cerrado las cubra es **tener el dato guardado**, y la única forma de tenerlo es haberlo
aprendido mientras el interruptor estaba encendido.

El filtro va en la lectura y **antes** del motor, con el mismo motivo que ya está escrito en
`routes/recommendations.ts`: recortar después de recomendar deja la fila con menos piezas de las
que hay, porque el motor ya habría llenado su tope con títulos que no se van a enseñar.

## Dos estados y no tres

`0` significa «no consta que sea para adultos», y el desconocido se comporta como el que no lo es:
se enseña. Un tercer estado —«se preguntó y no lo es»— sólo serviría para medir la cobertura del
emparejamiento, y una columna de métricas se queda en el esquema para siempre. Si algún día hace
falta esa cuenta, se saca de `anilist_media`, que ya distingue la fila ausente de la fila sin valor.

## Las trampas que el task tiene que medir

- **Un refresco del proveedor no puede borrar la marca.** `anime.write` viene de `getAnime`, que no
  sabe nada de esto: si la escritura reemplaza la fila —un `INSERT OR REPLACE`— la marca se pierde
  y la obra vuelve a enseñarse en la siguiente lectura. Se mide mutando: reemplazando en vez de
  actualizar, la prueba del refresco queda en rojo.
- **La ampliación de la tabla es aditiva.** `ALTER TABLE` con valor por defecto deja las filas que
  ya existen en `0`, que es la respuesta correcta: no consta.
- **`prune` no necesita tocarla**, pero la limpieza de `anime` se lleva la marca con la fila, que es
  lo que debe pasar: sin obra no hay nada que esconder.

## La alternativa descartada

**Una tabla propia (`adult_ref`) en vez de una columna.** Separa mejor el dato de la caché —que
caduca— pero obliga a una unión en cada lectura que puede enseñar una obra, y esas lecturas ya
llevan una consulta por fila de la interfaz. La marca no caduca como el detalle: que una obra sea
para adultos no se vence, y eso es justo lo que una columna pegada a la fila dice.

**Que decida el almacén leyendo el ajuste.** Sería una línea menos en el servidor y una dependencia
más dentro del almacén: `getSetting` ya vive ahí, pero la misma consulta de candidatos se usa para
cosas que sí deben ver la obra marcada. Un almacén que decide política es un almacén que no se
puede probar sin montar la política.
