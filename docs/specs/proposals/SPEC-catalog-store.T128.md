# Propuesta: saber qué referencia es para adultos

Task: T128 · Spec afectado: `SPEC-catalog-store.md` · Estado: pendiente de que lo integre el dueño
del spec.

## El cambio exacto

1. **Migración `0010-adulto.sql`: `ALTER TABLE anime ADD COLUMN adult INTEGER NOT NULL DEFAULT 0`.**
   La tabla `anime` ya tiene una fila por referencia de proveedor conocida, y esa fila es la que
   leen todos los consumidores que pueden enseñar una obra: `favorites`, `recent` (seguir viendo),
   los candidatos del motor y los relacionados.
2. **La marca se escribe por referencia y sin el contenido.** La sabe el emparejamiento —que tiene
   el título y la obra que AniList devuelve— pero se guarda donde sirve: `provider_id` y
   `provider_ref` ya son la clave única de `anime`, y el historial, los favoritos y el feed guardan
   referencias. Cuando la obra viene marcada y el interruptor está apagado, **no se escribe la fila
   de `anilist_media`**: se escribe el booleano y nada más, así que la caché no llega a tener la
   portada ni la sinopsis. Con el interruptor encendido se guarda entera, como hoy.
3. **Lectura por lote de las marcas.** Una consulta que recibe las referencias de una fila y
   devuelve cuáles están marcadas: es lo que usan `/api/feed` y `/api/trending` para descartar
   **antes de preguntar** —una referencia marcada no gasta una petición a AniList nunca más—. Va por
   lote y no por referencia por el motivo de siempre: una fila puede traer veinte piezas y veinte
   consultas para pintar una fila es lo que el spec prohíbe.
4. **Las lecturas que alimentan filas excluyen las marcadas cuando quien cablea se lo pide**: los
   candidatos del motor, el historial, los favoritos y lo último conocido. El almacén no decide
   política: expone el parámetro y el servidor lo pasa con el ajuste en la mano.

## El motivo

El punto 5 de la propuesta de `discovery` descarta lo marcado en la frontera, y eso basta para las
listas de AniList, que se reconstruyen de la respuesta. **No basta para las filas que salen de la
base**: una recomendación, un favorito, un «seguir viendo» o una entrada del feed son filas del
almacén, y ahí no hay entrada de AniList que consultar sin salir a la red. La única forma de que el
estado apagado las cubra es **tener el dato guardado**, y la única forma de tenerlo es haberlo
aprendido al emparejar.

El filtro va en la lectura y **antes** del motor, con el mismo motivo que ya está escrito en
`routes/recommendations.ts`: recortar después de recomendar deja la fila con menos piezas de las que
hay, porque el motor ya habría llenado su tope con títulos que no se van a enseñar.

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
- **La marca sobrevive al interruptor.** No es un ajuste: es lo que se aprendió. Apagar el
  interruptor no la borra, y volver a encenderlo no vuelve a preguntar por lo ya marcado.
- **`prune` no necesita tocarla**, pero la limpieza de `anime` se lleva la marca con la fila, que es
  lo que debe pasar: sin obra no hay nada que esconder.

## Las alternativas descartadas

**Una tabla propia (`adult_ref`) en vez de una columna.** Separa mejor el dato de la caché —que
caduca— pero obliga a una unión en cada lectura que puede enseñar una obra, y esas lecturas ya
llevan una consulta por fila de la interfaz. La marca no caduca como el detalle: que una obra sea
para adultos no se vence, y eso es justo lo que una columna pegada a la fila dice.

**Que decida el almacén leyendo el ajuste.** Sería una línea menos en el servidor y una dependencia
más dentro del almacén: `getSetting` ya vive ahí, pero la misma lectura se usa para cosas que sí
deben ver la obra marcada —la ficha que el usuario ya abrió, por ejemplo—. Un almacén que decide
política es un almacén que no se puede probar sin montar la política.
